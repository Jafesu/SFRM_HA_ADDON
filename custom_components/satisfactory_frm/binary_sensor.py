"""Binary sensors: server reachable, world ready, paused, fuses, battery draining."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .coordinator import FRMFastCoordinator
from .entity import FRMConfigEntry, FRMSaveEntityMixin, FRMServerEntity, save_device, save_uid


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FRMConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    fast = entry.runtime_data.fast
    async_add_entities([ReachableSensor(fast), WorldReadySensor(fast), PausedSensor(fast)])

    added: set[tuple[str, int]] = set()

    @callback
    def _add_circuits() -> None:
        data = fast.data
        if not data or not data.save:
            return
        new = []
        for cid in data.circuits:
            if (data.save, cid) not in added:
                added.add((data.save, cid))
                new += [FuseSensor(fast, data.save, cid), DrainingSensor(fast, data.save, cid)]
        if new:
            async_add_entities(new)

    _add_circuits()
    entry.async_on_unload(fast.async_add_listener(_add_circuits))


class ReachableSensor(FRMServerEntity, BinarySensorEntity):
    """On when FRM answers at all. Stays available during outages by design."""

    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: FRMFastCoordinator) -> None:
        super().__init__(coordinator, "reachable")

    @property
    def available(self) -> bool:
        return self.coordinator.data is not None

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.reachable


class WorldReadySensor(FRMServerEntity, BinarySensorEntity):
    """On when the world is loaded. Off during load or the 'World not ready' hang."""

    def __init__(self, coordinator: FRMFastCoordinator) -> None:
        super().__init__(coordinator, "world_ready")

    @property
    def available(self) -> bool:
        return self.coordinator.data is not None

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.world_ready

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data
        return {
            "not_ready_since": data.not_ready_since.isoformat() if data.not_ready_since else None,
            "last_error": data.last_error,
        }


class PausedSensor(FRMServerEntity, BinarySensorEntity):
    def __init__(self, coordinator: FRMFastCoordinator) -> None:
        super().__init__(coordinator, "paused")

    @property
    def available(self) -> bool:
        return super().available and bool(self.coordinator.data and self.coordinator.data.world_ready)

    @property
    def is_on(self) -> bool | None:
        value = self.coordinator.data.session.get("IsPaused")
        return None if value is None else bool(value)


class _CircuitBinary(FRMSaveEntityMixin, CoordinatorEntity[FRMFastCoordinator], BinarySensorEntity):
    _attr_has_entity_name = True
    _key: str

    def __init__(self, coordinator: FRMFastCoordinator, save: str, cid: int) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._cid = save, cid
        self._attr_translation_key = self._key
        self._attr_unique_id = save_uid(entry, save, f"circuit:{cid}:{self._key}")
        self._attr_device_info = save_device(entry, save, f"circuit:{cid}", f"circuit {cid}", "Power circuit")

    @property
    def available(self) -> bool:
        return (
            super().available
            and self._save_loaded(self.coordinator)
            and self._cid in self.coordinator.data.circuits
        )

    @property
    def _raw(self) -> dict[str, Any]:
        return self.coordinator.data.circuits[self._cid]


class FuseSensor(_CircuitBinary):
    _key = "fuse_triggered"
    _attr_device_class = BinarySensorDeviceClass.PROBLEM

    @property
    def is_on(self) -> bool:
        return bool(self._raw.get("FuseTriggered"))


class DrainingSensor(_CircuitBinary):
    _key = "battery_draining"

    @property
    def is_on(self) -> bool | None:
        raw = self._raw
        try:
            if float(raw.get("BatteryCapacity") or 0) <= 0:
                return None
            return float(raw.get("BatteryDifferential") or 0) < 0
        except (TypeError, ValueError):
            return None
