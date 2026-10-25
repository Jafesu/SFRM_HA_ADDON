"""In-game power switches as HA switches (needs the FRM token to control)."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .api import FRMError
from .coordinator import FRMFastCoordinator
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
