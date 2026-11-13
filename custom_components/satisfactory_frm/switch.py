"""In-game power switches as HA switches (needs the FRM token to control)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity

import asyncio
import logging

from .api import FRMError
from .buildings import (
    NO_GROUP_SWITCH,
    STATUS_LABELS,
    building_names,
    is_running,
    recipe_of,
    recipe_slug,
    reports_standby,
    status_of,
    type_name,
)
from .const import CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES
from .coordinator import FRMFastCoordinator, FRMSlowCoordinator
from .entity import FRMConfigEntry, FRMSaveEntityMixin, claim, save_device, save_uid

_LOGGER = logging.getLogger(__name__)
VERIFY_DELAY = 2.0  # seconds for the game to apply standby before re-checking


def switch_name(raw: dict[str, Any], sid: str) -> str:
    return raw.get("Name") or raw.get("SwitchTag") or f"Switch {sid[-6:]}"


def switch_is_on(raw: dict[str, Any]) -> bool | None:
    for key in ("IsOn", "SwitchOn", "Status"):
        if key in raw:
            return bool(raw[key])
    return None


def switch_priority(raw: dict[str, Any]) -> int | None:
    for key in ("Priority", "PriorityGroup"):
        if isinstance(raw.get(key), (int, float)):
            return int(raw[key])
    return None


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FRMConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    fast = entry.runtime_data.fast

    @callback
    def _add() -> None:
        data = fast.data
        if not data or not data.save:
            return
        new = []
        for sid in data.switches:
            if claim(entry, "switch", data.save, f"switch:{sid}"):
                new.append(PowerSwitch(fast, data.save, sid))
        if new:
            async_add_entities(new)

    _add()
    entry.async_on_unload(fast.async_add_listener(_add))

    if not entry.options.get(CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES):
        return
    slow = entry.runtime_data.slow

    @callback
    def _add_buildings() -> None:
        data, fdata = slow.data, fast.data
        if not data or not fdata or not fdata.save or data.session_name != fdata.session_name:
            return
        save = fdata.save
        new: list[SwitchEntity] = []
        names = None
        for bid, raw in data.machines.items():
            if claim(entry, "switch", save, f"building:{bid}"):
                names = names or building_names(data.machines)
                new.append(BuildingSwitch(slow, save, bid, names[bid], raw))
        for recipe in {recipe_of(r) for r in data.machines.values()} - NO_GROUP_SWITCH:
            if claim(entry, "switch", save, f"recipe:{recipe_slug(recipe)}"):
                new.append(RecipeGroupSwitch(slow, save, recipe))
        if new:
            async_add_entities(new)

    _add_buildings()
    entry.async_on_unload(slow.async_add_listener(_add_buildings))


class PowerSwitch(FRMSaveEntityMixin, CoordinatorEntity[FRMFastCoordinator], SwitchEntity):
    _attr_has_entity_name = True

    def __init__(self, coordinator: FRMFastCoordinator, save: str, sid: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._sid = save, sid
        raw = coordinator.data.switches[sid]
        self._attr_name = switch_name(raw, sid)
        # The map card finds switch entities through this unique ID pattern.
        self._attr_unique_id = save_uid(entry, save, f"switch:{sid}")
        self._attr_device_info = save_device(entry, save, "switches", "power switches", "Power switches")

    @property
    def available(self) -> bool:
        return (
            super().available
            and self._save_loaded(self.coordinator)
            and self._sid in self.coordinator.data.switches
        )

    @property
    def is_on(self) -> bool | None:
        return switch_is_on(self.coordinator.data.switches[self._sid])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        raw = self.coordinator.data.switches[self._sid]
        return {"frm_id": self._sid, "priority": switch_priority(raw)}

    async def _set(self, on: bool) -> None:
        try:
            await self.coordinator.client.set_switch(self._sid, on)
        except FRMError as err:
            raise HomeAssistantError(str(err)) from err
        # Optimistic update, then confirm from the server.
        self.coordinator.data.switches[self._sid]["IsOn"] = on
        self.async_write_ha_state()
        await self.coordinator.async_request_refresh()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class _SlowSaveSwitch(FRMSaveEntityMixin, CoordinatorEntity[FRMSlowCoordinator], SwitchEntity):
    _attr_has_entity_name = True

    def _slow_ok(self) -> bool:
        slow = self.coordinator.data
        return (
            super().available
            and self._save_loaded(self.coordinator.fast)
            and slow is not None
            and slow.session_name == self.coordinator.fast.data.session_name
        )

    async def _apply(self, ids: list[str], on: bool) -> None:
        client = self.coordinator.client
        sem = asyncio.Semaphore(4)

        async def one(bid: str) -> Any:
            async with sem:
                return await client.set_enabled(bid, on)

        results = await asyncio.gather(*(one(b) for b in ids), return_exceptions=True)
        for bid, result in zip(ids, results):
            _LOGGER.debug("setEnabled %s -> %s: FRM replied %r", bid, on, result)
        failed = [r for r in results if isinstance(r, BaseException)]
        sent = [bid for bid, r in zip(ids, results) if not isinstance(r, BaseException)]

        if sent:
            # Re-read the buildings from FRM to see whether the game really changed them.
            await asyncio.sleep(VERIFY_DELAY)
            await self.coordinator.async_refresh()

        machines = self.coordinator.data.machines if self.coordinator.data else {}
        # Buildings that don't report standby (generators) can't be checked.
        unchanged = [
            b for b in sent
            if b in machines and reports_standby(machines[b]) and is_running(machines[b]) != on
        ]
        if unchanged:
            kinds = sorted({type_name(machines[b]) for b in unchanged})
            _LOGGER.warning(
                "FRM accepted %s for %d building(s) but they did not change (%s). "
                "FRM or the game may not support standby for this building type",
                "run" if on else "standby", len(unchanged), ", ".join(kinds),
            )
            raise HomeAssistantError(
                f"FRM accepted the command, but {len(unchanged)} of {len(ids)} building(s) "
                f"({', '.join(kinds)}) are still {'in standby' if on else 'running'}. "
                "Standby may not be supported for this building type."
            )
        if failed:
            first = failed[0]
            msg = str(first) if isinstance(first, FRMError) else repr(first)
            raise HomeAssistantError(f"{len(failed)} of {len(ids)} building(s) didn't change: {msg}")


class BuildingSwitch(_SlowSaveSwitch, RestoreEntity):
    """On = running, off = standby. Paused buildings draw no power.

    For buildings whose standby state FRM doesn't report (generators), the switch
    shows the last state it was set to (restored across restarts) and reports
    assumed_state, so HA shows separate on/off buttons.
    """

    _attr_icon = "mdi:factory"
    _commanded: bool | None = None

    def __init__(self, coordinator, save: str, bid: str, label: str, raw: dict[str, Any]) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._bid = save, bid
        self._attr_name = label
        self._attr_unique_id = save_uid(entry, save, f"building:{bid}:switch")
        self._attr_device_info = save_device(
            entry, save, f"type:{raw.get('ClassName', 'building')}", type_name(raw), "Building group"
        )

    @property
    def available(self) -> bool:
        return self._slow_ok() and self._bid in self.coordinator.data.machines

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_state()
        if last and last.state in ("on", "off"):
            self._commanded = last.state == "on"

    def _raw(self) -> dict[str, Any] | None:
        data = self.coordinator.data
        return data.machines.get(self._bid) if data else None

    @property
    def assumed_state(self) -> bool:
        raw = self._raw()
        return raw is not None and not reports_standby(raw)

    @property
    def is_on(self) -> bool:
        raw = self._raw() or {}
        if reports_standby(raw):
            return is_running(raw)
        return True if self._commanded is None else self._commanded

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        raw = self.coordinator.data.machines[self._bid]
        status = status_of(raw, self.coordinator.fast.data)
        return {
            "frm_id": self._bid,
            "standby_reported": reports_standby(raw),
            "building": type_name(raw),
            "recipe": recipe_of(raw),
            "status": status,
            "status_label": STATUS_LABELS.get(status, status),
        }

    async def _set(self, on: bool) -> None:
        previous, self._commanded = self._commanded, on
        try:
            await self._apply([self._bid], on)
        except Exception:
            self._commanded = previous
            raise
        finally:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)


class RecipeGroupSwitch(_SlowSaveSwitch):
    """Every building on one recipe. On if any of them is running."""

    _attr_icon = "mdi:cogs"

    def __init__(self, coordinator, save: str, recipe: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._recipe = save, recipe
        self._attr_name = f"All {recipe}"
        self._attr_unique_id = save_uid(entry, save, f"recipe:{recipe_slug(recipe)}:switch")
        self._attr_device_info = save_device(
            entry, save, "production_lines", "production lines", "Production lines"
        )

    def _ids(self) -> list[str]:
        return [b for b, r in self.coordinator.data.machines.items() if recipe_of(r) == self._recipe]

    @property
    def available(self) -> bool:
        return self._slow_ok() and bool(self._ids())

    @property
    def is_on(self) -> bool:
        m = self.coordinator.data.machines
        return any(is_running(m[b]) for b in self._ids())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        m = self.coordinator.data.machines
        ids = self._ids()
        return {
            "recipe": self._recipe,
            "buildings": len(ids),
            "running": sum(1 for b in ids if is_running(m[b])),
            "building_types": sorted({type_name(m[b]) for b in ids}),
        }

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._apply(self._ids(), True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._apply(self._ids(), False)
