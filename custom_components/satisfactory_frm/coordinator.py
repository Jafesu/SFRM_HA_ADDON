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
from collections.abc import Mapping
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


def _f(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def is_produced(raw: dict[str, Any]) -> bool:
    """True if the factory has machines set up to make this item.

    Uses MaxProd (capacity), so it still works while grids are dead or paused.
    """
    return _f(raw.get("MaxProd")) > 0 or _f(raw.get("CurrentProd")) > 0


def item_plan(options: Mapping[str, Any], prod: dict[str, dict[str, Any]]) -> dict[str, tuple[str, ...]]:
    """Which item sensors should exist: {item_key: sensor description keys}.

    - "Always track" items get all four sensors.
    - With auto-track on, every produced item gets net + efficiency.
    - "Never track" wins over auto-track (but not over always-track).
    """
    from .const import (  # noqa: PLC0415
        ALL_ITEM_SENSORS, AUTO_ITEM_SENSORS, CONF_AUTO_TRACK,
        CONF_EXCLUDED_ITEMS, CONF_TRACKED_ITEMS, DEFAULT_AUTO_TRACK,
    )

    always = set(options.get(CONF_TRACKED_ITEMS, []))
    excluded = set(options.get(CONF_EXCLUDED_ITEMS, []))
    plan: dict[str, tuple[str, ...]] = {}
    if options.get(CONF_AUTO_TRACK, DEFAULT_AUTO_TRACK):
        for key, raw in prod.items():
            if key not in excluded and is_produced(raw):
                plan[key] = AUTO_ITEM_SENSORS
    for key in always:
        plan[key] = ALL_ITEM_SENSORS
    return plan


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
    # Every controllable building by FRM ID; each raw dict gets "_kind":
    # "factory" | "extractor" | "generator".
    machines: dict[str, dict[str, Any]] = field(default_factory=dict)
    machines_ok: bool = False  # True only if all building lists loaded


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

        results = await asyncio.gather(
            self.client.get_list("getFactory"),
            self.client.get_list("getExtractor"),
            self.client.get_list("getGenerators"),
            return_exceptions=True,
        )
        ok = True
        for kind, result in zip(("factory", "extractor", "generator"), results):
            if isinstance(result, BaseException):
                ok = False
                _LOGGER.debug("Building list %s failed: %s", kind, result)
                continue
            if kind == "factory":
                data.factory = summarize_factory(result)
            for raw in result:
                bid = raw.get("ID")
                if bid:
                    data.machines[str(bid)] = {**raw, "_kind": kind}
        data.machines_ok = ok
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
