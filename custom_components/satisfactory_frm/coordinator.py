"""Data coordinators for Satisfactory FRM.

FRMFastCoordinator  - session, power circuits, switches (default 15 s). Never raises
                      on outages: it reports reachable / world_ready instead, so the
                      status sensors stay available while everything else goes
                      unavailable.
FRMSlowCoordinator  - production stats + factory summary (default 60 s). Only polls
                      while the world is ready.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.components import persistent_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .api import FRMClient, FRMConnectionError, FRMError, FRMNotReady

_LOGGER = logging.getLogger(__name__)


def save_slug(session_name: str | None) -> str | None:
    """Stable id fragment for a save; used in save-level unique IDs."""
    return slugify(session_name) if session_name else None


def circuit_id(raw: dict[str, Any]) -> int | None:
    cid = raw.get("CircuitGroupID", raw.get("CircuitID"))
    try:
        return int(cid)
    except (TypeError, ValueError):
        return None


def item_key(raw: dict[str, Any]) -> str | None:
    return raw.get("ClassName") or raw.get("Name")


@dataclass
class FastData:
    reachable: bool = False
    world_ready: bool = False
    not_ready_since: datetime | None = None
    last_error: str | None = None
    session: dict[str, Any] = field(default_factory=dict)
    session_name: str | None = None
    circuits: dict[int, dict[str, Any]] = field(default_factory=dict)
    switches: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def save(self) -> str | None:
        return save_slug(self.session_name) if self.world_ready else None


@dataclass
class SlowData:
    session_name: str | None = None
    prod: dict[str, dict[str, Any]] = field(default_factory=dict)
    factory: dict[str, Any] = field(default_factory=dict)


class FRMFastCoordinator(DataUpdateCoordinator[FastData]):
    """Server status, session, power and switches."""

    config_entry: ConfigEntry

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, client: FRMClient, interval: int
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{entry.title} (fast)",
            update_interval=timedelta(seconds=interval),
        )
        self.client = client
        self._not_ready_since: datetime | None = None
        self._last_session: str | None = None
        self._was_ready = False
        self.slow: FRMSlowCoordinator | None = None  # set during setup

    async def _async_update_data(self) -> FastData:
        data = FastData()
        try:
            session, power = await asyncio.gather(
                self.client.get_session_info(), self.client.get_list("getPower")
            )
        except FRMNotReady:
            data.reachable = True
            data.last_error = "World not ready"
            self._mark_not_ready(data)
            return data
        except FRMConnectionError as err:
            data.last_error = str(err)
            self._mark_not_ready(data)
            return data
        except FRMError as err:
            data.reachable = True
            data.last_error = str(err)
            self._mark_not_ready(data)
            return data

        data.reachable = True
        data.world_ready = True
        self._not_ready_since = None
        data.session = session
        data.session_name = session.get("SessionName")

        for raw in power:
            cid = circuit_id(raw)
            if cid is not None and cid >= 0 and cid not in data.circuits:
                data.circuits[cid] = raw

        try:
            for raw in await self.client.get_list("getSwitches"):
                sid = raw.get("ID")
                if sid:
                    data.switches[str(sid)] = raw
        except FRMError as err:
            _LOGGER.debug("getSwitches failed: %s", err)

        changed = self._check_save_change(data.session_name)
        if self.slow is not None and (changed or not self._was_ready):
            # Pick up production data right away after a (re)load instead of
            # waiting for the next slow cycle.
            self.hass.async_create_task(self.slow.async_request_refresh())
        self._was_ready = True
        return data

    def _mark_not_ready(self, data: FastData) -> None:
        self._was_ready = False
        if self._not_ready_since is None:
            self._not_ready_since = dt_util.utcnow()
        data.not_ready_since = self._not_ready_since

    def _check_save_change(self, session_name: str | None) -> bool:
        if not session_name:
            return False
        previous, self._last_session = self._last_session, session_name
        if not previous or previous == session_name:
            return False
        persistent_notification.async_create(
            self.hass,
            (
                f"Server **{self.config_entry.title}** is now running save "
                f"**{session_name}** (previously **{previous}**). Entities from "
                f"the previous save are unavailable until it is loaded again. "
                f"Use the `satisfactory_frm.purge_inactive_saves` action to "
                f"remove them permanently."
            ),
            title="Satisfactory: different save loaded",
            notification_id=f"satisfactory_frm_save_{self.config_entry.entry_id}",
        )
        return True


class FRMSlowCoordinator(DataUpdateCoordinator[SlowData]):
    """Production stats and factory summary."""

    config_entry: ConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: FRMClient,
        fast: FRMFastCoordinator,
        interval: int,
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{entry.title} (slow)",
            update_interval=timedelta(seconds=interval),
        )
        self.client = client
        self.fast = fast

    async def _async_update_data(self) -> SlowData:
        fast = self.fast.data
        if fast is None or not fast.world_ready:
            # Keep returning empty data rather than failing; entities check availability.
            return SlowData()

        data = SlowData(session_name=fast.session_name)
        try:
            prod = await self.client.get_list("getProdStats")
            for raw in prod:
                key = item_key(raw)
                if key:
                    data.prod[key] = raw
        except FRMError as err:
            _LOGGER.debug("getProdStats failed: %s", err)

        try:
            data.factory = summarize_factory(await self.client.get_list("getFactory"))
        except FRMError as err:
            _LOGGER.debug("getFactory failed: %s", err)

        return data


def summarize_factory(machines: list[dict[str, Any]]) -> dict[str, Any]:
    total = producing = paused = idle = unconfigured = 0
    productivity: list[float] = []
    for m in machines:
        total += 1
        if not m.get("IsConfigured", True):
            unconfigured += 1
            continue
        if m.get("IsPaused"):
            paused += 1
        elif m.get("IsProducing"):
            producing += 1
        else:
            idle += 1
        value = m.get("Productivity")
        if isinstance(value, (int, float)):
            productivity.append(float(value))
    return {
        "total": total,
        "producing": producing,
        "paused": paused,
        "idle": idle,
        "unconfigured": unconfigured,
        "avg_productivity": round(sum(productivity) / len(productivity), 1)
        if productivity
        else None,
    }
