"""Satisfactory (Ficsit Remote Monitoring) integration."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from aiohttp import web
import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.http import KEY_HASS, HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT, Platform
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from .api import FRMClient, FRMError
from .const import (
    ASSET_PREFIXES,
    CARD_URL,
    DASHBOARD_URL,
    PRODUCTION_CARD_URL,
    CONF_SCAN_INTERVAL,
    CONF_SLOW_INTERVAL,
    CONF_TOKEN,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_SLOW_INTERVAL,
    DOMAIN,
    MAP_BOUNDS,
    MAP_LAYERS,
)
from .coordinator import FRMFastCoordinator, FRMSlowCoordinator, is_produced
from .entity import FRMConfigEntry, FRMRuntime, server_device

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [
    Platform.BINARY_SENSOR,
    Platform.NOTIFY,
    Platform.NUMBER,
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.TEXT,
]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
CARD_VERSION = "0.4.0"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """One-time setup: map card, asset proxy, websocket API, purge action."""
    card_path = Path(__file__).parent / "frontend" / "satisfactory-map-card.js"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL, str(card_path), cache_headers=False)]
    )
    from homeassistant.components.frontend import add_extra_js_url  # noqa: PLC0415

    add_extra_js_url(hass, f"{CARD_URL}?v={CARD_VERSION}")
    await hass.http.async_register_static_paths(
        [StaticPathConfig(DASHBOARD_URL, str(Path(__file__).parent / "frontend" / "satisfactory-dashboard.js"), cache_headers=False)]
    )
    add_extra_js_url(hass, f"{DASHBOARD_URL}?v={CARD_VERSION}")
    await hass.http.async_register_static_paths(
        [StaticPathConfig(PRODUCTION_CARD_URL, str(Path(__file__).parent / "frontend" / "satisfactory-production-card.js"), cache_headers=False)]
    )
    add_extra_js_url(hass, f"{PRODUCTION_CARD_URL}?v={CARD_VERSION}")
    hass.http.register_view(FRMAssetView())

    websocket_api.async_register_command(hass, ws_servers)
    websocket_api.async_register_command(hass, ws_map_info)
    websocket_api.async_register_command(hass, ws_map_layer)
    websocket_api.async_register_command(hass, ws_production)

    async def _purge(call: ServiceCall) -> None:
        await async_purge_inactive_saves(hass, call.data.get("entry_id"))

    hass.services.async_register(
        DOMAIN,
        "purge_inactive_saves",
        _purge,
        schema=vol.Schema({vol.Optional("entry_id"): cv.string}),
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: FRMConfigEntry) -> bool:
    token = entry.options.get(CONF_TOKEN, entry.data.get(CONF_TOKEN)) or None
    client = FRMClient(
        async_get_clientsession(hass), entry.data[CONF_HOST], entry.data[CONF_PORT], token
    )
    fast = FRMFastCoordinator(
        hass, entry, client, int(entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL))
    )
    slow = FRMSlowCoordinator(
        hass, entry, client, fast, int(entry.options.get(CONF_SLOW_INTERVAL, DEFAULT_SLOW_INTERVAL))
    )
    fast.slow = slow
    # The fast coordinator never raises on outages, so setup succeeds even when the
    # server is down; entities appear once the world is ready.
    await fast.async_config_entry_first_refresh()
    await slow.async_config_entry_first_refresh()

    entry.runtime_data = FRMRuntime(client=client, fast=fast, slow=slow, asset_cache={})
    # Make sure the server device exists before save-level devices link to it.
    dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id, **server_device(entry, client.base_url)
    )
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: FRMConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: FRMConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


# --- Stale-save cleanup -------------------------------------------------------

async def async_purge_inactive_saves(hass: HomeAssistant, entry_id: str | None) -> None:
    entries = [
        e for e in hass.config_entries.async_entries(DOMAIN)
        if e.state is ConfigEntryState.LOADED and (entry_id is None or e.entry_id == entry_id)
    ]
    if not entries:
        raise ServiceValidationError("No loaded Satisfactory server matches that entry_id")

    ent_reg, dev_reg = er.async_get(hass), dr.async_get(hass)
    for entry in entries:
        current = entry.runtime_data.fast.data.save if entry.runtime_data.fast.data else None
        if not current:
            raise ServiceValidationError(
                f"{entry.title}: the world is not ready, so the active save is unknown. "
                "Try again once the server is up."
            )
        keep = f"{entry.entry_id}|save:{current}|"
        removed = 0
        for ent in er.async_entries_for_config_entry(ent_reg, entry.entry_id):
            uid = ent.unique_id or ""
            if "|save:" in uid and not uid.startswith(keep):
                ent_reg.async_remove(ent.entity_id)
                removed += 1
        for dev in dr.async_entries_for_config_entry(dev_reg, entry.entry_id):
            ids = [i for d, i in dev.identifiers if d == DOMAIN]
            if any("|save:" in i and not i.startswith(keep) for i in ids):
                dev_reg.async_remove_device(dev.id)
        _LOGGER.info("%s: removed %d entities from inactive saves", entry.title, removed)


# --- Map card backend -----------------------------------------------------------

def _loaded_entry(hass: HomeAssistant, entry_id: str) -> FRMConfigEntry | None:
    entry = hass.config_entries.async_get_entry(entry_id)
    if entry and entry.domain == DOMAIN and entry.state is ConfigEntryState.LOADED:
        return entry
    return None


class FRMAssetView(HomeAssistantView):
    """Proxies FRM web-UI assets (map image, icons) so the browser never talks to FRM.

    Requires HA auth; the card fetches with hass.fetchWithAuth.
    """

    url = "/api/satisfactory_frm/{entry_id}/asset/{path:.+}"
    name = "api:satisfactory_frm:asset"
    requires_auth = True

    async def get(self, request: web.Request, entry_id: str, path: str) -> web.Response:
        hass = request.app[KEY_HASS]
        entry = _loaded_entry(hass, entry_id)
        if entry is None:
            return web.Response(status=404)
        if ".." in path or not path.startswith(ASSET_PREFIXES):
            return web.Response(status=403)
        cache = entry.runtime_data.asset_cache
        if path not in cache:
            try:
                cache[path] = await entry.runtime_data.client.get_asset(path)
            except FRMError as err:
                _LOGGER.debug("Asset %s unavailable: %s", path, err)
                return web.Response(status=502)
        body, content_type = cache[path]
        return web.Response(
            body=body,
            content_type=content_type or "application/octet-stream",
            headers={"Cache-Control": "private, max-age=86400"},
        )


@websocket_api.websocket_command({vol.Required("type"): "satisfactory_frm/servers"})
@callback
def ws_servers(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    connection.send_result(
        msg["id"],
        [
            {"entry_id": e.entry_id, "title": e.title}
            for e in hass.config_entries.async_entries(DOMAIN)
            if e.state is ConfigEntryState.LOADED
        ],
    )


@websocket_api.websocket_command(
    {vol.Required("type"): "satisfactory_frm/map_info", vol.Required("entry_id"): str}
)
@callback
def ws_map_info(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    entry = _loaded_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Server not loaded")
        return
    data = entry.runtime_data.fast.data
    save = data.save if data else None

    switch_entities: dict[str, str] = {}
    building_entities: dict[str, str] = {}
    if save:
        sw_prefix = f"{entry.entry_id}|save:{save}|switch:"
        b_prefix = f"{entry.entry_id}|save:{save}|building:"
        for ent in er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id):
            uid = ent.unique_id or ""
            if ent.domain != "switch":
                continue
            if uid.startswith(sw_prefix):
                switch_entities[uid[len(sw_prefix):]] = ent.entity_id
            elif uid.startswith(b_prefix) and uid.endswith(":switch"):
                building_entities[uid[len(b_prefix):-len(":switch")]] = ent.entity_id

    fused = [
        cid for cid, raw in (data.circuits.items() if data else [])
        if raw.get("FuseTriggered")
    ]
    connection.send_result(
        msg["id"],
        {
            "title": entry.title,
            "session_name": data.session_name if data else None,
            "reachable": bool(data and data.reachable),
            "world_ready": bool(data and data.world_ready),
            "bounds": MAP_BOUNDS,
            "layers": {k: fast for k, (_, fast) in MAP_LAYERS.items()},
            "fused_circuits": fused,
            "switch_entities": switch_entities,
            "building_entities": building_entities,
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "satisfactory_frm/map_layer",
        vol.Required("entry_id"): str,
        vol.Required("layer"): vol.In(list(MAP_LAYERS)),
    }
)
@websocket_api.async_response
async def ws_map_layer(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict
) -> None:
    entry = _loaded_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Server not loaded")
        return
    data = entry.runtime_data.fast.data
    if not data or not data.world_ready:
        connection.send_error(msg["id"], "not_ready", "World not ready")
        return
    endpoint, _ = MAP_LAYERS[msg["layer"]]
    try:
        result: Any = await entry.runtime_data.client.get_list(endpoint)
    except FRMError as err:
        connection.send_error(msg["id"], "frm_error", str(err))
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): "satisfactory_frm/production", vol.Required("entry_id"): str}
)
@callback
def ws_production(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """All items from the last production poll (no extra FRM request)."""
    entry = _loaded_entry(hass, msg["entry_id"])
    if entry is None:
        connection.send_error(msg["id"], "not_found", "Server not loaded")
        return
    fast, slow = entry.runtime_data.fast.data, entry.runtime_data.slow.data
    ready = bool(fast and fast.world_ready and slow and slow.session_name == fast.session_name)
    save = fast.save if fast else None

    # item key -> net sensor entity, so the card can open history on tap.
    net_entities: dict[str, str] = {}
    if save:
        prefix = f"{entry.entry_id}|save:{save}|item:"
        for ent in er.async_entries_for_config_entry(er.async_get(hass), entry.entry_id):
            uid = ent.unique_id or ""
            if uid.startswith(prefix) and uid.endswith(":item_net"):
                net_entities[uid[len(prefix):-len(":item_net")]] = ent.entity_id

    def f(v: Any) -> float:
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return 0.0

    items = []
    if ready:
        for key, raw in slow.prod.items():
            items.append(
                {
                    "key": key,
                    "class_name": raw.get("ClassName"),
                    "name": raw.get("Name") or key,
                    "produced": f(raw.get("CurrentProd")),
                    "consumed": f(raw.get("CurrentConsumed")),
                    "max_produced": f(raw.get("MaxProd")),
                    "max_consumed": f(raw.get("MaxConsumed")),
                    "is_produced": is_produced(raw),
                    "net_entity": net_entities.get(key),
                }
            )
    connection.send_result(
        msg["id"],
        {
            "title": entry.title,
            "world_ready": bool(fast and fast.world_ready),
            "session_name": fast.session_name if fast else None,
            "items": items,
        },
    )
