# Satisfactory for Home Assistant (Ficsit Remote Monitoring)

Monitor and control Satisfactory servers from Home Assistant using the
[Ficsit Remote Monitoring](https://github.com/porisius/FicsitRemoteMonitoring) (FRM) mod:
power grids, fuses, batteries, production, power switches, in-game chat
notifications and a live factory map card.

## Requirements

- Home Assistant 2025.3 or newer
- FRM installed on the server with its web server running (autostart it in
  `GameUserSettings.ini` on dedicated servers)
- Optional: the FRM auth token (`Configs/FicsitRemoteMonitoring/WebServer.cfg`) for
  switch control and chat messages. Reading data needs no token.

## Install

**HACS:** add this repository as a custom repository (type: Integration), install,
restart Home Assistant.

**Manual:** copy `custom_components/satisfactory_frm` into your HA `config/custom_components/`
folder and restart.

Then go to **Settings → Devices & services → Add integration → Satisfactory**.
Add one entry per server. If a server's address changes, use **Reconfigure** on
the entry rather than re-adding it.

## What you get

**Per server (survive save changes)**
- Server reachable, world ready (with `not_ready_since`), game paused
- Session name, in-game day and time, days since last death, play time
- Game chat: a notify entity for automations (`notify.send_message`) and a
  "Send chat message" text box for dashboards

**Per save (only available while that save is loaded)**
- One device per power circuit: production, consumption, capacity, max
  consumption, headroom, load %, battery charge/differential/time to empty/full,
  fuse tripped, batteries draining
- Power switches as switch entities; priority switches also get a 0–8 priority number
- Production: pick items in the integration options; each gets produced/min,
  consumed/min, net/min and efficiency %. Plus a factory summary (machines
  producing, idle, paused, average productivity)

When a different save loads, the old save's entities go unavailable and come back
with their history if you load that save again. To remove them for good, run the
**Remove inactive save entities** action (`satisfactory_frm.purge_inactive_saves`).

## Ready-made dashboard

The integration ships a dashboard that builds itself from your servers, circuits,
tracked items and switches, and only shows the save that's currently loaded.

1. **Settings → Dashboards → Add dashboard → New dashboard from scratch**, name it.
2. Open it, then **⋮ → Edit dashboard → ⋮ → Raw configuration editor**.
3. Replace everything with:

```yaml
strategy:
  type: custom:satisfactory
```

You get one tab per server with Overview, Map, Power (a card per circuit, largest
first, fuse and battery badges), Production (factory summary plus a card and 24 h
graph per tracked item) and Control (switches, priorities, game chat box).

Options:

```yaml
strategy:
  type: custom:satisfactory
  server: My Server        # show one server only
  main_circuit: 1          # headline grid (default: largest capacity)
  hide: [map, control]     # any of overview, map, power, production, control
  history_hours: 24
  map_height: 460
```

New circuits and items appear on the next page load. To customise freely, use
**⋮ → Take control** to convert it into a normal dashboard (it then stops
updating itself).

### If the dashboard says "Timeout waiting for strategy element"

The browser hasn't loaded the dashboard script, usually because of a cached page
after an update or restart. Hard-refresh (Ctrl+Shift+R), or in the companion app
use **Settings → Companion app → Debugging → Reset frontend cache**. If that
doesn't help, add it as a resource manually: **Settings → Dashboards → ⋮ →
Resources → Add resource**, URL `/satisfactory_frm/satisfactory-dashboard.js`,
type JavaScript module. (Do the same with `/satisfactory_frm/satisfactory-map-card.js`
if the map card ever shows as a custom element error.)

## Map card

The card is registered automatically. Add it with:

```yaml
type: custom:satisfactory-map-card
server: My Server   # optional; display name or entry ID
height: 480
```

Everything goes through Home Assistant, so it works remotely in the HA app and the
browser never talks to FRM directly. The map image and icons come from your FRM
server. Moving things (players, trains, drones, vehicles) refresh every 5 s;
buildings, belts and rails every 60 s, and only while the card is on screen.

Tap a marker for details. Power switches can be toggled from the map. Machines on a
circuit with a tripped fuse are drawn red. Zoom in to see building footprints.

Options: `layers` (list of layer IDs to show by default), `fast_interval`,
`slow_interval`, `min_z` / `max_z` (height filter in cm), `title`.

## Issues

Report problems at https://github.com/Jafesu/SFRM_HA_ADDON/issues (not on the FRM mod's
repository). Please include your HA version, FRM version, and any log lines from
`custom_components.satisfactory_frm`.

## Security

Anyone who can reach the FRM port can read your factory, and anyone with the token
can control it. Keep the port off the public internet where possible (firewall it to
Home Assistant's IP). The token stays in Home Assistant and is never sent to the
browser.

## Examples

See `examples/` for a dashboard and automations (fuse alerts, stuck "world not
ready" alerts, load shedding on low battery).
