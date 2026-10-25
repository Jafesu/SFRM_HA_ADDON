"""In-game power switches as HA switches (needs the FRM token to control)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

import asyncio

from .api import FRMError
from .buildings import (
    NO_GROUP_SWITCH,
    STATUS_LABELS,
    building_names,
    is_running,
    recipe_of,
    recipe_slug,
    status_of,
    type_name,
)
from .const import CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES
from .coordinator import FRMFastCoordinator, FRMSlowCoordinator
from .entity import FRMConfigEntry, FRMSaveEntityMixin, save_device, save_uid


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
    added: set[tuple[str, str]] = set()

    @callback
    def _add() -> None:
        data = fast.data
        if not data or not data.save:
            return
        new = []
        for sid in data.switches:
            if (data.save, sid) not in added:
                added.add((data.save, sid))
                new.append(PowerSwitch(fast, data.save, sid))
        if new:
            async_add_entities(new)

    _add()
    entry.async_on_unload(fast.async_add_listener(_add))

    if not entry.options.get(CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES):
        return
    slow = entry.runtime_data.slow
    added_b: set[tuple[str, str]] = set()

    @callback
    def _add_buildings() -> None:
        data, fdata = slow.data, fast.data
        if not data or not fdata or not fdata.save or data.session_name != fdata.session_name:
            return
        save = fdata.save
        new: list[SwitchEntity] = []
        names = None
        for bid, raw in data.machines.items():
            if (save, bid) not in added_b:
                names = names or building_names(data.machines)
                added_b.add((save, bid))
                new.append(BuildingSwitch(slow, save, bid, names[bid], raw))
        for recipe in {recipe_of(r) for r in data.machines.values()} - NO_GROUP_SWITCH:
            key = f"recipe:{recipe_slug(recipe)}"
            if (save, key) not in added_b:
                added_b.add((save, key))
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

        async def one(bid: str) -> None:
            async with sem:
                await client.set_enabled(bid, on)

        results = await asyncio.gather(*(one(b) for b in ids), return_exceptions=True)
        failed = [r for r in results if isinstance(r, BaseException)]
        machines = self.coordinator.data.machines
        for bid, result in zip(ids, results):
            if not isinstance(result, BaseException) and bid in machines:
                machines[bid]["IsPaused"] = not on  # optimistic until next poll
        self.coordinator.async_update_listeners()
        await self.coordinator.async_request_refresh()
        if failed:
            first = failed[0]
            msg = str(first) if isinstance(first, FRMError) else repr(first)
            raise HomeAssistantError(
                f"{len(failed)} of {len(ids)} building(s) didn't change: {msg}"
            )


class BuildingSwitch(_SlowSaveSwitch):
    """On = running, off = standby. Paused buildings draw no power."""

    _attr_icon = "mdi:factory"

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

    @property
    def is_on(self) -> bool:
        return is_running(self.coordinator.data.machines[self._bid])

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        raw = self.coordinator.data.machines[self._bid]
        status = status_of(raw, self.coordinator.fast.data)
        return {
            "frm_id": self._bid,
            "building": type_name(raw),
            "recipe": recipe_of(raw),
            "status": status,
            "status_label": STATUS_LABELS.get(status, status),
        }

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._apply([self._bid], True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._apply([self._bid], False)


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
