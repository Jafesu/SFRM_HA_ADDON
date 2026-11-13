"""Automatic removal of entities for things dismantled in game.

Circuits, power switches, buildings and production lines get entities as they
appear. When one disappears from FRM's lists while its save is loaded, its
entities are removed once it has been missing for a while, and devices left
with no entities are removed too.

To ride out FRM glitches, an object is only removed after it has been missing
from MIN_MISSES consecutive successful polls AND for at least GRACE. Building
and circuit lists that come back completely empty are ignored: losing every
building at once is far more likely a glitch than a demolished factory.
"""

from __future__ import annotations

from datetime import datetime, timedelta
import logging
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .const import DOMAIN

if TYPE_CHECKING:
    from .entity import FRMConfigEntry

_LOGGER = logging.getLogger(__name__)

GRACE = timedelta(minutes=5)
MIN_MISSES = 3
# Object kinds this module cleans up, by the first part of the unique ID key.
KINDS = ("circuit", "switch", "building", "recipe", "pipeline")


def object_key(rest: str) -> str | None:
    """'circuit:3:power_produced' -> 'circuit:3', 'switch:<id>:priority' -> 'switch:<id>'.

    `rest` is the part of a save-level unique ID after "<entry_id>|save:<save>|".
    """
    kind, sep, tail = rest.partition(":")
    if not sep or kind not in KINDS:
        return None
    if kind == "switch":
        return f"switch:{tail.split(':', 1)[0]}"
    return f"{kind}:{tail.rsplit(':', 1)[0]}" if ":" in tail else f"{kind}:{tail}"


class StaleCleaner:
    """Tracks missing objects per save and removes their entities when stale."""

    def __init__(self, hass: HomeAssistant, entry: FRMConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        # (save, object key) -> (first time seen missing, consecutive misses)
        self._missing: dict[tuple[str, str], tuple[datetime, int]] = {}

    @callback
    def sweep(
        self, save: str, kinds: set[str], present: set[str], now: datetime | None = None
    ) -> list[str]:
        """Compare registry entities of `kinds` with the objects FRM reports now.

        Returns the object keys removed in this sweep.
        """
        if not kinds:
            return []
        now = now or dt_util.utcnow()
        reg = er.async_get(self.hass)
        prefix = f"{self.entry.entry_id}|save:{save}|"
        by_object: dict[str, list[er.RegistryEntry]] = {}
        for ent in er.async_entries_for_config_entry(reg, self.entry.entry_id):
            uid = ent.unique_id or ""
            if not uid.startswith(prefix):
                continue
            okey = object_key(uid[len(prefix):])
            if okey and okey.split(":", 1)[0] in kinds:
                by_object.setdefault(okey, []).append(ent)

        removed: list[str] = []
        for okey, ents in by_object.items():
            track = (save, okey)
            if okey in present:
                self._missing.pop(track, None)
                continue
            first, misses = self._missing.get(track, (now, 0))
            misses += 1
            if misses < MIN_MISSES or now - first < GRACE:
                self._missing[track] = (first, misses)
                continue
            self._missing.pop(track, None)
            for ent in ents:
                reg.async_remove(ent.entity_id)
            self.forget(save, okey)
            removed.append(okey)

        # Objects that came back or whose entities are gone no longer need tracking.
        for track in [t for t in self._missing if t[0] == save and t[1].split(":", 1)[0] in kinds]:
            if track[1] not in by_object:
                self._missing.pop(track, None)

        if removed:
            _LOGGER.info(
                "%s: removed entities for %d dismantled object(s): %s",
                self.entry.title, len(removed), ", ".join(sorted(removed)),
            )
            self.remove_empty_devices(save)
        return removed

    @callback
    def forget(self, save: str, okey: str) -> None:
        """Let the platforms create entities for this object again if it comes back
        (circuit IDs and recipes get reused)."""
        added = self.entry.runtime_data.added
        for item in [
            a for a in added if a[1] == save and (a[2] == okey or a[2].startswith(f"{okey}:"))
        ]:
            added.discard(item)

    @callback
    def remove_empty_devices(self, save: str) -> None:
        """Remove this save's devices that have no entities left."""
        ent_reg, dev_reg = er.async_get(self.hass), dr.async_get(self.hass)
        prefix = f"{self.entry.entry_id}|save:{save}|"
        for dev in dr.async_entries_for_config_entry(dev_reg, self.entry.entry_id):
            if not any(d == DOMAIN and i.startswith(prefix) for d, i in dev.identifiers):
                continue
            if not er.async_entries_for_device(ent_reg, dev.id, include_disabled_entities=True):
                dev_reg.async_remove_device(dev.id)


@callback
def sweep_fast(entry: FRMConfigEntry) -> None:
    """Circuits and power switches, after each fast poll."""
    data = entry.runtime_data.fast.data
    if not data or not data.save:
        return
    kinds: set[str] = set()
    present: set[str] = set()
    if data.circuits:
        kinds.add("circuit")
        present |= {f"circuit:{cid}" for cid in data.circuits}
    if data.switches_ok:
        # An empty switch list is normal (none built), unlike circuits.
        kinds.add("switch")
        present |= {f"switch:{sid}" for sid in data.switches}
    entry.runtime_data.cleaner.sweep(data.save, kinds, present)


@callback
def sweep_slow(entry: FRMConfigEntry) -> None:
    """Buildings, production lines and pipe networks, after each slow poll."""
    from .buildings import NO_GROUP_SWITCH, recipe_of, recipe_slug  # noqa: PLC0415
    from .const import CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES  # noqa: PLC0415

    rt = entry.runtime_data
    data, fdata = rt.slow.data, rt.fast.data
    if not data or not fdata or not fdata.save or data.session_name != fdata.session_name:
        return
    kinds: set[str] = set()
    present: set[str] = set()
    buildings_on = entry.options.get(CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES)
    if buildings_on and data.machines_ok and data.machines:
        kinds |= {"building", "recipe"}
        present |= {f"building:{bid}" for bid in data.machines}
        present |= {
            f"recipe:{recipe_slug(recipe_of(raw))}"
            for raw in data.machines.values()
            if recipe_of(raw) not in NO_GROUP_SWITCH
        }
    if data.networks_ok and data.networks:
        kinds.add("pipeline")
        present |= {f"pipeline:{key}" for key in data.networks}
    rt.cleaner.sweep(fdata.save, kinds, present)
