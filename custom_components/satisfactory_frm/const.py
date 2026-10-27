"""Constants for the Satisfactory (Ficsit Remote Monitoring) integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "satisfactory_frm"

CONF_TOKEN: Final = "token"
CONF_SCAN_INTERVAL: Final = "scan_interval"
CONF_SLOW_INTERVAL: Final = "slow_interval"
CONF_TRACKED_ITEMS: Final = "tracked_items"  # always track, all sensors
CONF_AUTO_TRACK: Final = "auto_track"
CONF_EXCLUDED_ITEMS: Final = "excluded_items"
DEFAULT_AUTO_TRACK: Final = True
CONF_BUILDING_ENTITIES: Final = "building_entities"
DEFAULT_BUILDING_ENTITIES: Final = True
ALL_ITEM_SENSORS: Final = ("item_produced", "item_consumed", "item_net", "item_efficiency")
AUTO_ITEM_SENSORS: Final = ("item_net", "item_efficiency")
CONF_CHAT_SENDER: Final = "chat_sender"

DEFAULT_PORT: Final = 8080
DEFAULT_SCAN_INTERVAL: Final = 15  # seconds: session, power, switches
DEFAULT_SLOW_INTERVAL: Final = 60  # seconds: production + factory summary
MIN_SCAN_INTERVAL: Final = 5
DEFAULT_CHAT_SENDER: Final = "Home Assistant"
REQUEST_TIMEOUT: Final = 15

AUTH_HEADER: Final = "X-FRM-Authorization"

# Map card
CARD_URL: Final = f"/{DOMAIN}/satisfactory-map-card.js"
DASHBOARD_URL: Final = f"/{DOMAIN}/satisfactory-dashboard.js"
PRODUCTION_CARD_URL: Final = f"/{DOMAIN}/satisfactory-production-card.js"
CONTROL_ROOM_URL: Final = f"/{DOMAIN}/sfrm-control-room.js"
# World bounds of /map/map.avif in game units (cm), taken from FRM's web UI.
MAP_BOUNDS: Final = (-324698.16796875, -375000.0, 425301.83203125, 375000.0)
# Only these web-UI asset prefixes may be proxied through HA.
ASSET_PREFIXES: Final = ("map/",)

# Map layers the card may request: layer id -> FRM endpoint.
# "fast" layers move and are polled often; the rest change rarely.
MAP_LAYERS: Final[dict[str, tuple[str, bool]]] = {
    "players": ("getPlayer", True),
    "trains": ("getTrains", True),
    "drones": ("getDrone", True),
    "vehicles": ("getVehicles", True),
    "train_stations": ("getTrainStation", False),
    "train_rails": ("getTrainRails", False),
    "drone_stations": ("getDroneStation", False),
    "truck_stations": ("getTruckStation", False),
    "factory": ("getFactory", False),
    "generators": ("getGenerators", False),
    "extractors": ("getExtractor", False),
    "storage": ("getStorageInv", False),
    "switches": ("getSwitches", False),
    "belts": ("getBelts", False),
    "pipes": ("getPipes", False),
    "cables": ("getCables", False),
    "hub": ("getHUBTerminal", False),
    "space_elevator": ("getSpaceElevator", False),
    "radar": ("getRadarTower", False),
    "resource_nodes": ("getResourceNode", False),
    "map_markers": ("getMapMarkers", False),
    # Collectibles
    "artifacts": ("getArtifacts", False),
    "slugs": ("getPowerSlug", False),
    "drop_pods": ("getDropPod", False),
    "unlock_items": ("getUnlockItems", False),
}
