"""Helpers for building (machine) entities.

Unique IDs (save-level):
  building:<FRM ID>:status   sensor
  building:<FRM ID>:switch   switch (run / standby via setEnabled)
  recipe:<recipe slug>:switch  switch for every building on that recipe
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.util import slugify

if TYPE_CHECKING:
    from .coordinator import FastData
    from .entity import FRMConfigEntry

STATUSES = ["producing", "idle", "paused", "no_power", "not_configured"]
STATUS_LABELS = {
    "producing": "Producing",
    "idle": "Idle",
    "paused": "Standby",
    "no_power": "No power",
    "not_configured": "Not configured",
}
UNCONFIGURED = "Unconfigured"


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def recipe_of(raw: dict[str, Any]) -> str:
    recipe = raw.get("Recipe")
    if isinstance(recipe, str) and recipe.strip() and recipe.strip().upper() != "N/A":
        return recipe.strip()
    if raw.get("_kind") == "generator":
        return "Power"
    return UNCONFIGURED


def type_name(raw: dict[str, Any]) -> str:
    return raw.get("Name") or raw.get("ClassName") or "Building"


# No "All ..." group switch for these: unconfigured machines do nothing, and a
# one-tap "stand by every generator" switch would black out the whole factory.
NO_GROUP_SWITCH = {UNCONFIGURED, "Power"}


def recipe_slug(recipe: str) -> str:
    return slugify(recipe) or "unknown"


def _id_number(bid: str) -> int:
    m = re.search(r"(\d+)$", bid)
    return int(m.group(1)) if m else 0


def building_names(machines: dict[str, dict[str, Any]]) -> dict[str, str]:
    """Stable per-building labels: "<recipe>" or "<recipe> <n>" within a building type.

    Numbered by FRM ID order, so existing buildings keep their number when new
    ones are built (new IDs are higher).
    """
    groups: dict[tuple[str, str], list[str]] = {}
    for bid, raw in machines.items():
        groups.setdefault((raw.get("ClassName", ""), recipe_of(raw)), []).append(bid)
    names: dict[str, str] = {}
    for (_, recipe), ids in groups.items():
        ids.sort(key=_id_number)
        for n, bid in enumerate(ids, start=1):
            names[bid] = recipe if len(ids) == 1 else f"{recipe} {n}"
    return names


def is_running(raw: dict[str, Any]) -> bool:
    """Switch state: on unless the building is in standby."""
    return not bool(raw.get("IsPaused"))


def status_of(raw: dict[str, Any], fast: FastData | None) -> str:
    if raw.get("IsPaused"):
        return "paused"
    if raw.get("_kind") != "generator" and raw.get("IsConfigured") is False:
        return "not_configured"
    power = raw.get("PowerInfo") or {}
    cid = power.get("CircuitGroupID")
    if raw.get("_kind") != "generator" and cid is not None:
        try:
            cid = int(cid)
        except (TypeError, ValueError):
            cid = None
        if cid == -1:
            return "no_power"
        circuit = fast.circuits.get(cid) if (fast and cid is not None) else None
        if circuit and (circuit.get("FuseTriggered") or _num(circuit.get("PowerCapacity")) <= 0):
            return "no_power"
    if raw.get("_kind") == "generator":
        if raw.get("IsFullSpeed") or raw.get("IsProducing"):
            return "producing"
        return "idle"
    return "producing" if raw.get("IsProducing") else "idle"


@callback
def remove_stale_buildings(
    hass: HomeAssistant, entry: FRMConfigEntry, save: str, machines: dict[str, dict[str, Any]]
) -> None:
    """Remove entities for demolished buildings and recipes no longer in use."""
    reg = er.async_get(hass)
    prefix = f"{entry.entry_id}|save:{save}|"
    recipes = {
        recipe_slug(recipe_of(r)) for r in machines.values() if recipe_of(r) not in NO_GROUP_SWITCH
    }
    for ent in er.async_entries_for_config_entry(reg, entry.entry_id):
        uid = ent.unique_id or ""
        if not uid.startswith(prefix):
            continue
        rest = uid[len(prefix):]
        if rest.startswith("building:"):
            bid = rest[len("building:"):].rsplit(":", 1)[0]
            if bid not in machines:
                reg.async_remove(ent.entity_id)
        elif rest.startswith("recipe:"):
            slug = rest[len("recipe:"):].rsplit(":", 1)[0]
            if slug not in recipes:
                reg.async_remove(ent.entity_id)


@callback
def remove_all_building_entities(hass: HomeAssistant, entry: FRMConfigEntry) -> None:
    """Used when the "Create building entities" option is switched off."""
    reg = er.async_get(hass)
    for ent in er.async_entries_for_config_entry(reg, entry.entry_id):
        uid = ent.unique_id or ""
        if "|building:" in uid or "|recipe:" in uid:
            reg.async_remove(ent.entity_id)
