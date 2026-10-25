"""In-game chat as an HA notify entity (needs the FRM token)."""

from __future__ import annotations

from homeassistant.components.notify import NotifyEntity
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
    async_add_entities([GameChat(entry.runtime_data.fast, sender)])


class GameChat(FRMServerEntity, NotifyEntity):
    """Use with notify.send_message; the title (if any) is prefixed to the message."""

    def __init__(self, coordinator: FRMFastCoordinator, sender: str) -> None:
        super().__init__(coordinator, "game_chat")
        self._sender = sender

    @property
    def available(self) -> bool:
        data = self.coordinator.data
        return bool(data and data.world_ready and self.coordinator.client.has_token)

    async def async_send_message(self, message: str, title: str | None = None) -> None:
        text = f"{title}: {message}" if title else message
        try:
            await self.coordinator.client.send_chat(text, self._sender)
        except FRMError as err:
            raise HomeAssistantError(str(err)) from err
