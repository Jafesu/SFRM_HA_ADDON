"""A text box that sends whatever you type into in-game chat (needs the FRM token)."""

from __future__ import annotations

from homeassistant.components.text import TextEntity
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .api import FRMError
from .const import CONF_CHAT_SENDER, DEFAULT_CHAT_SENDER
from .coordinator import FRMFastCoordinator
from .entity import FRMConfigEntry, FRMServerEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: FRMConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    sender = entry.options.get(CONF_CHAT_SENDER, DEFAULT_CHAT_SENDER)
    async_add_entities([ChatMessageText(entry.runtime_data.fast, sender)])


class ChatMessageText(FRMServerEntity, TextEntity):
    _attr_native_max = 200
    _attr_native_value = ""
    _attr_icon = "mdi:message-text-outline"

    def __init__(self, coordinator: FRMFastCoordinator, sender: str) -> None:
        super().__init__(coordinator, "chat_message")
        self._sender = sender

    @property
    def available(self) -> bool:
        data = self.coordinator.data
        return bool(data and data.world_ready and self.coordinator.client.has_token)

    async def async_set_value(self, value: str) -> None:
        if not value.strip():
            return
        try:
            await self.coordinator.client.send_chat(value.strip(), self._sender)
        except FRMError as err:
            raise HomeAssistantError(str(err)) from err
        # Clear the box after sending.
        self._attr_native_value = ""
        self.async_write_ha_state()
