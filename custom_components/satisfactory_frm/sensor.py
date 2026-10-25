"""Sensors: session (server-level), power circuits, production, factory summary (save-level)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import PERCENTAGE, UnitOfEnergy, UnitOfPower, UnitOfTime
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_TRACKED_ITEMS
from .coordinator import FRMFastCoordinator, FRMSlowCoordinator
from .entity import (
    FRMConfigEntry,
    FRMSaveEntityMixin,
    FRMServerEntity,
    save_device,
    save_uid,
)

PER_MIN = "items/min"


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _hms_to_seconds(value: Any) -> int | None:
    """FRM reports battery times as 'HH:MM:SS'."""
    if not isinstance(value, str):
        return None
    try:
        parts = [float(p) for p in value.split(":")]
    except ValueError:
        return None
    if len(parts) != 3:
        return None
    h, m, s = parts
    return int(h * 3600 + m * 60 + s)


def _has_batteries(raw: dict[str, Any]) -> bool:
    return (_num(raw.get("BatteryCapacity")) or 0) > 0


def _headroom(raw: dict[str, Any]) -> float | None:
    cap, used = _num(raw.get("PowerCapacity")), _num(raw.get("PowerConsumed"))
    return None if cap is None or used is None else round(cap - used, 1)


def _load(raw: dict[str, Any]) -> float | None:
    cap, used = _num(raw.get("PowerCapacity")), _num(raw.get("PowerConsumed"))
    if not cap or used is None:
        return None
    return round(used / cap * 100, 1)


@dataclass(frozen=True, kw_only=True)
class FRMSensorDescription(SensorEntityDescription):
    value_fn: Callable[[dict[str, Any]], Any]


# --- Server-level (session) ------------------------------------------------

SESSION_SENSORS: tuple[FRMSensorDescription, ...] = (
    FRMSensorDescription(
        key="session_name",
        value_fn=lambda s: s.get("SessionName"),
    ),
    FRMSensorDescription(
        key="play_time",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.HOURS,
        state_class=SensorStateClass.TOTAL_INCREASING,
        value_fn=lambda s: _num(s.get("TotalPlayDuration")),
    ),
    FRMSensorDescription(
        key="game_day",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda s: s.get("PassedDays"),
    ),
    FRMSensorDescription(
        key="days_since_death",
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda s: s.get("NumberOfDaysSinceLastDeath"),
    ),
    FRMSensorDescription(
        key="game_time",
        value_fn=lambda s: (
            f"{int(s['Hours']):02d}:{int(s['Minutes']):02d}"
            if s.get("Hours") is not None and s.get("Minutes") is not None
            else None
        ),
    ),
)

# --- Save-level: power circuits ----------------------------------------------

def _mw(key: str, field: str, **kw: Any) -> FRMSensorDescription:
    return FRMSensorDescription(
        key=key,
        device_class=SensorDeviceClass.POWER,
        native_unit_of_measurement=UnitOfPower.MEGA_WATT,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=kw.pop("value_fn", lambda r: _num(r.get(field))),
        **kw,
    )


CIRCUIT_SENSORS: tuple[FRMSensorDescription, ...] = (
    _mw("power_production", "PowerProduction"),
    _mw("power_consumed", "PowerConsumed"),
    _mw("power_capacity", "PowerCapacity"),
    _mw("power_max_consumed", "PowerMaxConsumed"),
    _mw("power_headroom", "", value_fn=_headroom),
    FRMSensorDescription(
        key="power_load",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=_load,
    ),
    _mw(
        "battery_differential",
        "BatteryDifferential",
        value_fn=lambda r: _num(r.get("BatteryDifferential")) if _has_batteries(r) else None,
    ),
    FRMSensorDescription(
        key="battery_percent",
        device_class=SensorDeviceClass.BATTERY,
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda r: _num(r.get("BatteryPercent")) if _has_batteries(r) else None,
    ),
    FRMSensorDescription(
        key="battery_capacity",
        device_class=SensorDeviceClass.ENERGY_STORAGE,
        native_unit_of_measurement=UnitOfEnergy.MEGA_WATT_HOUR,
        state_class=SensorStateClass.MEASUREMENT,
        entity_category=EntityCategory.DIAGNOSTIC,
        value_fn=lambda r: _num(r.get("BatteryCapacity")),
    ),
    FRMSensorDescription(
        key="battery_time_empty",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.MINUTES,
        value_fn=lambda r: _hms_to_seconds(r.get("BatteryTimeEmpty")) if _has_batteries(r) else None,
    ),
    FRMSensorDescription(
        key="battery_time_full",
        device_class=SensorDeviceClass.DURATION,
        native_unit_of_measurement=UnitOfTime.SECONDS,
        suggested_unit_of_measurement=UnitOfTime.MINUTES,
        value_fn=lambda r: _hms_to_seconds(r.get("BatteryTimeFull")) if _has_batteries(r) else None,
    ),
)

# --- Save-level: production (per tracked item) -------------------------------

def _efficiency(raw: dict[str, Any]) -> float | None:
    cur, mx = _num(raw.get("CurrentProd")), _num(raw.get("MaxProd"))
    if not mx or cur is None:
        return None
    return round(cur / mx * 100, 1)


def _net(raw: dict[str, Any]) -> float | None:
    p, c = _num(raw.get("CurrentProd")), _num(raw.get("CurrentConsumed"))
    return None if p is None or c is None else round(p - c, 2)


ITEM_SENSORS: tuple[FRMSensorDescription, ...] = (
    FRMSensorDescription(
        key="item_produced", native_unit_of_measurement=PER_MIN,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda r: _num(r.get("CurrentProd")),
    ),
    FRMSensorDescription(
        key="item_consumed", native_unit_of_measurement=PER_MIN,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda r: _num(r.get("CurrentConsumed")),
    ),
    FRMSensorDescription(
        key="item_net", native_unit_of_measurement=PER_MIN,
        state_class=SensorStateClass.MEASUREMENT, value_fn=_net,
    ),
    FRMSensorDescription(
        key="item_efficiency", native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT, value_fn=_efficiency,
    ),
)

FACTORY_SENSORS: tuple[FRMSensorDescription, ...] = tuple(
    FRMSensorDescription(
        key=f"machines_{k}", state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda f, k=k: f.get(k),
    )
    for k in ("total", "producing", "idle", "paused")
) + (
    FRMSensorDescription(
        key="avg_productivity", native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        value_fn=lambda f: f.get("avg_productivity"),
    ),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FRMConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    fast = entry.runtime_data.fast
    slow = entry.runtime_data.slow
    tracked: list[str] = list(entry.options.get(CONF_TRACKED_ITEMS, []))

    async_add_entities(SessionSensor(fast, d) for d in SESSION_SENSORS)

    added_circuits: set[tuple[str, int]] = set()

    @callback
    def _add_circuits() -> None:
        data = fast.data
        if not data or not data.save:
            return
        new = []
        for cid in data.circuits:
            if (data.save, cid) in added_circuits:
                continue
            added_circuits.add((data.save, cid))
            new.extend(CircuitSensor(fast, data.save, cid, d) for d in CIRCUIT_SENSORS)
        if new:
            async_add_entities(new)

    added_slow: set[tuple[str, str]] = set()

    @callback
    def _add_slow() -> None:
        data, fdata = slow.data, fast.data
        if not data or not fdata or not fdata.save or data.session_name != fdata.session_name:
            return
        save = fdata.save
        new: list[SensorEntity] = []
        if data.factory and (save, "__factory__") not in added_slow:
            added_slow.add((save, "__factory__"))
            new.extend(FactorySensor(slow, save, d) for d in FACTORY_SENSORS)
        for key in tracked:
            if key in data.prod and (save, key) not in added_slow:
                added_slow.add((save, key))
                name = data.prod[key].get("Name") or key
                new.extend(ItemSensor(slow, save, key, name, d) for d in ITEM_SENSORS)
        if new:
            async_add_entities(new)

    _add_circuits()
    _add_slow()
    entry.async_on_unload(fast.async_add_listener(_add_circuits))
    entry.async_on_unload(slow.async_add_listener(_add_slow))


class SessionSensor(FRMServerEntity, SensorEntity):
    entity_description: FRMSensorDescription

    def __init__(self, coordinator: FRMFastCoordinator, description: FRMSensorDescription) -> None:
        super().__init__(coordinator, description.key)
        self.entity_description = description

    @property
    def available(self) -> bool:
        return super().available and bool(self.coordinator.data and self.coordinator.data.world_ready)

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data.session)


class CircuitSensor(FRMSaveEntityMixin, CoordinatorEntity[FRMFastCoordinator], SensorEntity):
    _attr_has_entity_name = True
    entity_description: FRMSensorDescription

    def __init__(self, coordinator, save: str, cid: int, description: FRMSensorDescription) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._cid = save, cid
        self.entity_description = description
        self._attr_translation_key = description.key
        self._attr_unique_id = save_uid(entry, save, f"circuit:{cid}:{description.key}")
        self._attr_device_info = save_device(
            entry, save, f"circuit:{cid}", f"circuit {cid}", "Power circuit"
        )

    @property
    def available(self) -> bool:
        return (
            super().available
            and self._save_loaded(self.coordinator)
            and self._cid in self.coordinator.data.circuits
        )

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data.circuits[self._cid])


class _SlowSaveSensor(FRMSaveEntityMixin, CoordinatorEntity[FRMSlowCoordinator], SensorEntity):
    _attr_has_entity_name = True
    entity_description: FRMSensorDescription

    def _slow_ok(self) -> bool:
        return (
            super().available
            and self._save_loaded(self.coordinator.fast)
            and self.coordinator.data is not None
            and self.coordinator.data.session_name == self.coordinator.fast.data.session_name
        )


class ItemSensor(_SlowSaveSensor):
    def __init__(self, coordinator, save: str, key: str, name: str, description) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._key = save, key
        self.entity_description = description
        self._attr_translation_key = description.key
        self._attr_translation_placeholders = {"item": name}
        self._attr_unique_id = save_uid(entry, save, f"item:{key}:{description.key}")
        self._attr_extra_state_attributes = {"item": name, "item_key": key}
        self._attr_device_info = save_device(entry, save, "production", "production", "Production")

    @property
    def available(self) -> bool:
        return self._slow_ok() and self._key in self.coordinator.data.prod

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data.prod[self._key])


class FactorySensor(_SlowSaveSensor):
    def __init__(self, coordinator, save: str, description) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save = save
        self.entity_description = description
        self._attr_translation_key = description.key
        self._attr_unique_id = save_uid(entry, save, f"factory:{description.key}")
        self._attr_device_info = save_device(entry, save, "production", "production", "Production")

    @property
    def available(self) -> bool:
        return self._slow_ok() and bool(self.coordinator.data.factory)

    @property
    def native_value(self) -> Any:
        return self.entity_description.value_fn(self.coordinator.data.factory)
