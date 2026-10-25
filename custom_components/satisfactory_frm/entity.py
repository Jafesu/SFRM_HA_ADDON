"""Base entities.

Unique ID scheme (relied on by the purge action and the map card):
  server-level: "<entry_id>|server|<key>"
  save-level:   "<entry_id>|save:<save_slug>|<key>"
Save-level entities are only available while their save is loaded, and come back
with their history when that save is loaded again.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN

if TYPE_CHECKING:
    from .api import FRMClient
    from .coordinator import FRMFastCoordinator, FRMSlowCoordinator


@dataclass
class FRMRuntime:
    client: FRMClient
    fast: FRMFastCoordinator
    slow: FRMSlowCoordinator
    asset_cache: dict[str, tuple[bytes, str]]


type FRMConfigEntry = ConfigEntry[FRMRuntime]


def server_device(entry: ConfigEntry, base_url: str) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, entry.entry_id)},
        name=entry.title,
        manufacturer="Coffee Stain Studios",
        model="Satisfactory server (Ficsit Remote Monitoring)",
        configuration_url=base_url,
    )


def save_device(
    entry: ConfigEntry, save: str, key: str, name: str, model: str
) -> DeviceInfo:
    return DeviceInfo(
        identifiers={(DOMAIN, f"{entry.entry_id}|save:{save}|{key}")},
        name=f"{entry.title} {name}",
        manufacturer="Coffee Stain Studios",
        model=model,
        via_device=(DOMAIN, entry.entry_id),
    )


def save_uid(entry: ConfigEntry, save: str, key: str) -> str:
    return f"{entry.entry_id}|save:{save}|{key}"


class FRMServerEntity(CoordinatorEntity["FRMFastCoordinator"]):
    """Entity that belongs to the server, regardless of which save is loaded."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: FRMFastCoordinator, key: str) -> None:
        super().__init__(coordinator)
        entry = coordinator.config_entry
        self._attr_unique_id = f"{entry.entry_id}|server|{key}"
        self._attr_translation_key = key
        self._attr_device_info = server_device(entry, coordinator.client.base_url)


class FRMSaveEntityMixin:
    """Availability rule shared by all save-level entities."""

    _save: str

    def _save_loaded(self, fast_coordinator: FRMFastCoordinator) -> bool:
        data = fast_coordinator.data
        return bool(data and data.world_ready and data.save == self._save)
