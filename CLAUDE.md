# Project context for Claude Code

Home Assistant custom integration + Lovelace map card for Satisfactory, using the
Ficsit Remote Monitoring (FRM) mod's HTTP API. Planned and v1 written in a claude.ai
chat; this file carries over the decisions and findings from that chat.

## Test server

- FRM web server: `http://108.181.98.149:42000` (dedicated server, always on; the
  port has changed before, which is why the reconfigure flow exists).
- FRM web UI version seen: 1.5.0-dev.6 (Next.js app; map is deck.gl).
- This port is publicly reachable. The user was advised to firewall it to HA's IP.
- Never commit the FRM token.

## Architecture (v1)

- `api.py`: FRMClient. Reads need no auth. Writes send header `X-FRM-Authorization`.
  "World not ready" in a response body raises FRMNotReady.
- `coordinator.py`:
  - FRMFastCoordinator (default 15 s): getSessionInfo, getPower, getSwitches.
    Never raises on outages; reports `reachable` / `world_ready` /
    `not_ready_since` so status entities stay available.
  - FRMSlowCoordinator (default 60 s): getProdStats, getFactory summary. Only
    polls while the world is ready. Fast coordinator triggers it immediately on
    becoming ready or on a save change.
- Unique ID scheme (the purge action and map card depend on it):
  - server-level: `<entry_id>|server|<key>`
  - save-level: `<entry_id>|save:<slugify(SessionName)>|<key>`
    (circuits: `circuit:<id>:<key>`, switches: `switch:<FRM ID>`,
    items: `item:<ClassName or Name>:<key>`, factory: `factory:<key>`)
- Save-level entities are added dynamically per (save, object) and are only
  available while their save is loaded. Switching back restores them with history.
- Device names use the entry title (user-editable display name, defaults to the
  session name at setup). Names never change automatically.
- `__init__.py` one-time setup: serves `frontend/satisfactory-map-card.js` and
  auto-registers it (`add_extra_js_url`), asset proxy view
  `/api/satisfactory_frm/<entry_id>/asset/map/...` (auth required, only `map/`
  prefix), websocket commands `satisfactory_frm/servers`, `/map_info`,
  `/map_layer`, and the `purge_inactive_saves` action.
- Map card: vanilla web component, canvas, no dependencies. Fetches via
  `hass.callWS` and `hass.fetchWithAuth`. Polls only while visible; fast layers
  5 s, slow layers 60 s, hidden layers not polled.

## Confirmed FRM facts (from docs and the live web UI source)

- Map image: `/map/map.avif`, one image. deck.gl BitmapLayer bounds
  `[-324698.16796875, -375000, 425301.83203125, 375000]` in deck space where
  deck = (x, -y) of game coordinates (cm). View is OrthographicView, flipY false.
- Icons ship with the web UI (work on dedicated servers without copying Icons/):
  - markers `/map/normal/markers/<name>.avif` (player, player_dead, player_offline,
    train, train_station, drone, drone_station, truck, truck_station, explorer,
    tractor, factory_cart, hub, power, space_elevator, radar_tower, ...)
  - by class name `/map/classnamed/<ClassName>.avif` (e.g. Desc_OreIron_C)
  - status badges `/map/utils/templates/extra/misc/<status>.avif`
- Footprints: rotate BoundingBox corners `[min.x,-min.y],[max.x,-min.y],
  [max.x,-max.y],[min.x,-max.y]` about `[loc.x,-loc.y]` by
  `rad((-rotation % 360) + 90)` (copied from FRM's own UI).
- Layer endpoints: getPlayer, getTrains, getTrainStation, getTrainRails, getDrone,
  getDroneStation, getVehicles, getTruckStation, getBelts, getLifts,
  getSplitterMerger, getPipes, getPipeJunctions, getHypertube, getHyperEntrance,
  getHyperJunctions, getCables, getFactory, getGenerators, getExtractor,
  getFrackingActivator, getStorageInv, getSpaceElevator, getRadarTower,
  getHUBTerminal, getPortal, getSwitches, getResourceNode, getPowerSlug,
  getArtifacts, getDropPod, getUnlockItems, getDoggo, getMapMarkers,
  getChatMessages.
- Fields used by the card: `location{x,y,z,rotation}`, `SplineData[{x,y}]` (belts,
  pipes, rails), cables `location0/location1`, trains `Derailed`, `Status`
  ("Parked" / "Manual Driving" / "Self-Driving" / "Derailed"), `TimeTable`;
  drones `CurrentFlyingMode`, `CurrentDestination`, `HasPairedStation`; vehicles
  `HasFuel`, `HasFuelForRoundtrip`, `Autopilot`, `ForwardSpeed`; machines
  `PowerInfo.CircuitGroupID` (-1 = disconnected), `IsProducing`, `IsPaused`,
  `IsConfigured`, `Productivity`, `ManuSpeed`, `Recipe`; map markers `IconID`,
  `ColorSlot` (hex).
- Chat: `POST /sendChatMessage` body `{"message": ..., "sender": ...}` with auth
  header. `GET /getChatMessages` returns messages with Type, Sender, Message,
  ServerTimeStamp, Color.
- getPower: PowerProduction, PowerConsumed, PowerCapacity, PowerMaxConsumed,
  BatteryDifferential, BatteryPercent, BatteryCapacity, BatteryTimeEmpty,
  BatteryTimeFull, FuseTriggered, CircuitGroupID. Duplicate circuit IDs have been
  reported, so the first one wins.
- getProdStats works on the test server (user confirmed). Fields: CurrentProd,
  CurrentConsumed, MaxProd, MaxConsumed (per minute).
- Known FRM bug: after the server's nightly session reload FRM can stay on
  "World not ready" until the server process is restarted.

## Verify against the live server (assumptions in v1)

1. setSwitches priority field name: v1 sends `{"ID": id, "priority": n}`
   (`api.set_switch_priority`). On/off sends `{"ID": id, "status": bool}`.
2. getSwitches field names: v1 reads `IsOn` (falls back to SwitchOn/Status),
   `Priority` (or PriorityGroup), `Name` (or SwitchTag).
3. getSessionInfo field names: SessionName, IsPaused, PassedDays,
   NumberOfDaysSinceLastDeath, Hours, Minutes, TotalPlayDuration (seconds).
4. getProdStats: whether `ClassName` is present (v1 keys by ClassName, else Name).
5. getFactory `Productivity` scale (assumed 0–100).
6. Battery time strings assumed `HH:MM:SS`.

## Not in v1 (planned, deliberately deferred)

- Building pause/resume via `setEnabled`: request format not confirmed yet.
- AWESOME Sink and Dimensional Depot sensors: field names not confirmed yet.
- Player count / server name via the official dedicated server API
  (`https://<ip>:7777/api/v1/`).
- v2: read in-game chat (`getChatMessages`) as HA events, e.g. `!status`
  commands answered in chat; map pings via `createPing`; trains/drones as
  entities; height slider in the card UI.

## User preferences from the planning chat

- Plan before building; v1 scope was agreed item by item.
- Multi-server support with editable display names.
- Save switches must not break automations (hence save-scoped unique IDs).
