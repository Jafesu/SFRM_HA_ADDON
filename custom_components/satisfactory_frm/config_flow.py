"""Config flow: add a server, reconfigure host/port, and options."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_HOST, CONF_NAME, CONF_PORT
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import FRMClient, FRMConnectionError, FRMError, FRMNotReady
from homeassistant.helpers.selector import BooleanSelector

from .const import (
    CONF_BUILDING_ENTITIES,
    DEFAULT_BUILDING_ENTITIES,
    CONF_AUTO_TRACK,
    CONF_EXCLUDED_ITEMS,
    DEFAULT_AUTO_TRACK,
    CONF_CHAT_SENDER,
    CONF_SCAN_INTERVAL,
    CONF_SLOW_INTERVAL,
    CONF_TOKEN,
    CONF_TRACKED_ITEMS,
    DEFAULT_CHAT_SENDER,
    DEFAULT_PORT,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SLOW_INTERVAL,
    DOMAIN,
    MIN_SCAN_INTERVAL,
)
from .coordinator import item_key

PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


async def _probe(hass: HomeAssistant, host: str, port: int) -> str | None:
    """Return the session name (None if the world is still loading). Raises on no connection."""
    client = FRMClient(async_get_clientsession(hass), host, port)
    try:
        return (await client.get_session_info()).get("SessionName")
    except FRMNotReady:
        return None


class FRMConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            host, port = user_input[CONF_HOST].strip(), int(user_input[CONF_PORT])
            await self.async_set_unique_id(f"{host}:{port}")
            self._abort_if_unique_id_configured()
            try:
                session_name = await _probe(self.hass, host, port)
            except FRMConnectionError:
                errors["base"] = "cannot_connect"
            except FRMError:
                errors["base"] = "unknown"
            else:
                title = (user_input.get(CONF_NAME) or "").strip() or session_name or host
                return self.async_create_entry(
                    title=title,
                    data={
                        CONF_HOST: host,
                        CONF_PORT: port,
                        CONF_TOKEN: (user_input.get(CONF_TOKEN) or "").strip(),
                    },
                )

        schema = vol.Schema(
            {
                vol.Required(CONF_HOST): str,
                vol.Required(CONF_PORT, default=DEFAULT_PORT): int,
                vol.Optional(CONF_TOKEN): PASSWORD,
                vol.Optional(CONF_NAME): str,
            }
        )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(schema, user_input or {}),
            errors=errors,
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Change host/port (e.g. when the server host moves the port)."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            host, port = user_input[CONF_HOST].strip(), int(user_input[CONF_PORT])
            try:
                await _probe(self.hass, host, port)
            except FRMError:
                errors["base"] = "cannot_connect"
            else:
                new_uid = f"{host}:{port}"
                clash = any(
                    other.entry_id != entry.entry_id and other.unique_id == new_uid
                    for other in self._async_current_entries(include_ignore=False)
                )
                if clash:
                    errors["base"] = "already_configured"
                else:
                    return self.async_update_reload_and_abort(
                        entry, unique_id=new_uid,
                        data_updates={CONF_HOST: host, CONF_PORT: port},
                    )
        schema = vol.Schema(
            {
                vol.Required(CONF_HOST, default=entry.data[CONF_HOST]): str,
                vol.Required(CONF_PORT, default=entry.data[CONF_PORT]): int,
            }
        )
        return self.async_show_form(step_id="reconfigure", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return FRMOptionsFlow()


class FRMOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self.config_entry
        if user_input is not None:
            return self.async_create_entry(data=user_input)

        opts = entry.options
        tracked: list[str] = list(opts.get(CONF_TRACKED_ITEMS, []))
        excluded: list[str] = list(opts.get(CONF_EXCLUDED_ITEMS, []))
        choices: dict[str, str] = {k: k for k in tracked + excluded}
        runtime = getattr(entry, "runtime_data", None)
        if runtime and runtime.slow.data:
            for key, raw in runtime.slow.data.prod.items():
                choices[key] = raw.get("Name") or key
        else:
            client = FRMClient(
                async_get_clientsession(self.hass), entry.data[CONF_HOST], entry.data[CONF_PORT]
            )
            try:
                for raw in await client.get_list("getProdStats"):
                    key = item_key(raw)
                    if key:
                        choices[key] = raw.get("Name") or key
            except FRMError:
                pass

        item_options = [
            SelectOptionDict(value=k, label=v)
            for k, v in sorted(choices.items(), key=lambda kv: kv[1].lower())
        ]
        token_default = opts.get(CONF_TOKEN, entry.data.get(CONF_TOKEN, ""))

        item_select = SelectSelector(
            SelectSelectorConfig(options=item_options, multiple=True, custom_value=True)
        )
        schema = vol.Schema(
            {
                vol.Optional(
                    CONF_AUTO_TRACK, default=opts.get(CONF_AUTO_TRACK, DEFAULT_AUTO_TRACK)
                ): BooleanSelector(),
                vol.Optional(CONF_TRACKED_ITEMS, default=tracked): item_select,
                vol.Optional(CONF_EXCLUDED_ITEMS, default=excluded): item_select,
                vol.Optional(
                    CONF_BUILDING_ENTITIES,
                    default=opts.get(CONF_BUILDING_ENTITIES, DEFAULT_BUILDING_ENTITIES),
                ): BooleanSelector(),
                vol.Optional(CONF_TOKEN, default=token_default): PASSWORD,
                vol.Optional(
                    CONF_CHAT_SENDER, default=opts.get(CONF_CHAT_SENDER, DEFAULT_CHAT_SENDER)
                ): str,
                vol.Optional(
                    CONF_SCAN_INTERVAL, default=opts.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
                ): NumberSelector(
                    NumberSelectorConfig(min=MIN_SCAN_INTERVAL, max=300, step=1,
                                         unit_of_measurement="s", mode=NumberSelectorMode.BOX)
                ),
                vol.Optional(
                    CONF_SLOW_INTERVAL, default=opts.get(CONF_SLOW_INTERVAL, DEFAULT_SLOW_INTERVAL)
                ): NumberSelector(
                    NumberSelectorConfig(min=15, max=900, step=5,
                                         unit_of_measurement="s", mode=NumberSelectorMode.BOX)
                ),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
