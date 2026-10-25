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

from homeassistant.helpers import entity_registry as er

from .buildings import (
    STATUSES,
    building_names,
    recipe_of,
    remove_all_building_entities,
    remove_stale_buildings,
    status_of,
    type_name,
)
from .const import CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES
from .coordinator import FRMFastCoordinator, FRMSlowCoordinator, item_plan
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
    if cap is None or used is None:
        return None
    if cap <= 0:
        # Dead grid: report 100 % if anything wants power (consumption or
        # demand), 0 % only for a circuit with nothing on it.
        demand = _num(raw.get("PowerMaxConsumed")) or 0
        return 100.0 if (used > 0 or demand > 0) else 0.0
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

    added_slow: set[tuple[str, str, str]] = set()
    cleaned_saves: set[str] = set()
    cleaned_buildings: set[str] = set()
    buildings_on = entry.options.get(CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES)
    if not buildings_on:
        remove_all_building_entities(hass, entry)

    @callback
    def _add_slow() -> None:
        data, fdata = slow.data, fast.data
        if not data or not fdata or not fdata.save or data.session_name != fdata.session_name:
            return
        save = fdata.save
        new: list[SensorEntity] = []
        if data.factory and (save, "__factory__", "") not in added_slow:
            added_slow.add((save, "__factory__", ""))
            new.extend(FactorySensor(slow, save, d) for d in FACTORY_SENSORS)

        plan = item_plan(entry.options, data.prod)
        if data.prod and save not in cleaned_saves:
            cleaned_saves.add(save)
            _remove_unwanted_items(hass, entry, save, plan)

        for key, wanted in plan.items():
            if key not in data.prod:
                continue
            name = data.prod[key].get("Name") or key
            for d in ITEM_SENSORS:
                if d.key in wanted and (save, key, d.key) not in added_slow:
                    added_slow.add((save, key, d.key))
                    new.append(ItemSensor(slow, save, key, name, d))
        if buildings_on and data.machines:
            if data.machines_ok and save not in cleaned_buildings:
                cleaned_buildings.add(save)
                remove_stale_buildings(hass, entry, save, data.machines)
            names = None
            for bid, raw in data.machines.items():
                if (save, bid, "building") in added_slow:
                    continue
                names = names or building_names(data.machines)
                added_slow.add((save, bid, "building"))
                new.append(BuildingStatusSensor(slow, save, bid, names[bid], raw))
        if new:
            async_add_entities(new)

    _add_circuits()
    _add_slow()
    entry.async_on_unload(fast.async_add_listener(_add_circuits))
    entry.async_on_unload(slow.async_add_listener(_add_slow))


@callback
def _remove_unwanted_items(
    hass: HomeAssistant, entry: FRMConfigEntry, save: str, plan: dict[str, tuple[str, ...]]
) -> None:
    """Drop item sensors the options no longer ask for (e.g. an item moved to
    "never track", auto-track switched off, or always -> auto)."""
    reg = er.async_get(hass)
    prefix = f"{entry.entry_id}|save:{save}|item:"
    for ent in er.async_entries_for_config_entry(reg, entry.entry_id):
        uid = ent.unique_id or ""
        if not uid.startswith(prefix):
            continue
        key, _, desc = uid[len(prefix):].rpartition(":")
        if desc not in plan.get(key, ()):
            reg.async_remove(ent.entity_id)


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


class BuildingStatusSensor(FRMSaveEntityMixin, CoordinatorEntity[FRMSlowCoordinator], SensorEntity):
    """Producing / idle / paused / no power / not configured, with machine details."""

    _attr_has_entity_name = True
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = STATUSES
    _attr_translation_key = "building_status"

    def __init__(self, coordinator, save: str, bid: str, label: str, raw: dict[str, Any]) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._save, self._bid = save, bid
        self._attr_name = f"{label} status"
        self._attr_unique_id = save_uid(entry, save, f"building:{bid}:status")
        self._attr_device_info = save_device(
            entry, save, f"type:{raw.get('ClassName', 'building')}", type_name(raw), "Building group"
        )

    @property
    def available(self) -> bool:
        slow = self.coordinator.data
        return (
            super().available
            and self._save_loaded(self.coordinator.fast)
            and slow is not None
            and slow.session_name == self.coordinator.fast.data.session_name
            and self._bid in slow.machines
        )

    @property
    def native_value(self) -> str:
        return status_of(self.coordinator.data.machines[self._bid], self.coordinator.fast.data)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        raw = self.coordinator.data.machines[self._bid]
        power = raw.get("PowerInfo") or {}
        attrs = {
            "building": type_name(raw),
            "recipe": recipe_of(raw),
            "frm_id": self._bid,
            "productivity": _num(raw.get("Productivity")),
            "clock_speed": _num(raw.get("ManuSpeed")),
            "power_draw_mw": _num(power.get("PowerConsumed")),
            "circuit": power.get("CircuitGroupID"),
            "power_shards": raw.get("PowerShards"),
            "somersloops": raw.get("Somersloops"),
        }
        if raw.get("_kind") == "generator":
            attrs["base_output_mw"] = _num(raw.get("BaseProd"))
            attrs["fuel_amount"] = raw.get("FuelAmount")
        return {k: v for k, v in attrs.items() if v is not None}
