"""Priority group (0-8) for priority power switches."""

from __future__ import annotations

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .api import FRMError
from .coordinator import FRMFastCoordinator
from .entity import FRMConfigEntry, FRMSaveEntityMixin, save_device, save_uid
from .switch import switch_name, switch_priority


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
        for sid, raw in data.switches.items():
            # Only priority switches report a priority value.
            if switch_priority(raw) is not None and (data.save, sid) not in added:
                added.add((data.save, sid))
                new.append(SwitchPriority(fast, data.save, sid))
        if new:
            async_add_entities(new)

    _add()
    entry.async_on_unload(fast.async_add_listener(_add))


class SwitchPriority(FRMSaveEntityMixin, CoordinatorEntity[FRMFastCoordinator], NumberEntity):
    _attr_has_entity_name = True
    _attr_native_min_value = 0
    _attr_native_max_value = 8
    _attr_native_step = 1
    _attr_mode = NumberMode.BOX

    def __init__(self, coordinator: FRMFastCoordinator, save: str, sid: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._sid = save, sid
        self._attr_name = f"{switch_name(coordinator.data.switches[sid], sid)} priority"
        self._attr_unique_id = save_uid(entry, save, f"switch:{sid}:priority")
        self._attr_device_info = save_device(entry, save, "switches", "power switches", "Power switches")

    @property
    def available(self) -> bool:
        return (
            super().available
            and self._save_loaded(self.coordinator)
            and self._sid in self.coordinator.data.switches
        )

    @property
    def native_value(self) -> int | None:
        return switch_priority(self.coordinator.data.switches[self._sid])

    async def async_set_native_value(self, value: float) -> None:
        try:
            await self.coordinator.client.set_switch_priority(self._sid, int(value))
        except FRMError as err:
            raise HomeAssistantError(str(err)) from err
        await self.coordinator.async_request_refresh()
