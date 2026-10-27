<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="custom_components/satisfactory_frm/brand/dark_logo@2x.png">
    <img src="custom_components/satisfactory_frm/brand/logo@2x.png" alt="SFRM: Satisfactory factory monitoring" width="420">
  </picture>
</p>

# Satisfactory for Home Assistant (Ficsit Remote Monitoring)

Monitor and control Satisfactory servers from Home Assistant using the
[Ficsit Remote Monitoring](https://github.com/porisius/FicsitRemoteMonitoring) (FRM) mod:
power grids, fuses, batteries, production, power switches, in-game chat
notifications and a live factory map card.

## Requirements

- Home Assistant 2025.3 or newer
- FRM installed on the server with its web server running (autostart it in
  `GameUserSettings.ini` on dedicated servers)
- Optional: the FRM auth token, for switch control and chat messages. Reading data
  needs no token. Since Satisfactory 1.2, FRM keeps its settings (including the
  token) in the game's user settings rather than the old
  `Configs/FicsitRemoteMonitoring/WebServer.cfg`, which is now reference-only.

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
- Production sensors, chosen in the integration's **Configure** options:
  - **Auto-track produced items** (on by default): every item your factory has
    machines making gets **net** and **efficiency** sensors. New production lines
    are picked up automatically.
  - **Always track**: items that get all four sensors (produced, consumed, net,
    efficiency). Overrides Never track.
  - **Never track**: items auto-track should skip.
- Factory summary: machines producing, idle, paused, average productivity
- Buildings (option **Create building entities**, on by default), grouped into one
  device per building type:
  - a **status** sensor per machine, extractor and generator: Producing, Idle,
    Standby, No power or Not configured, with recipe, productivity, clock speed,
    power draw, circuit, shards and somersloops as attributes
  - a **run/standby switch** per building (needs the token). Buildings in standby
    draw no power, so these work well for load shedding
  - an **All &lt;recipe&gt;** switch per recipe that puts every building on it into
    standby or back to work at once (none for generators, on purpose)
  - names look like "Constructor Iron Plate 3", numbered in build order; rename
    freely in HA. Demolished buildings' entities are removed automatically

When a different save loads, the old save's entities go unavailable and come back
with their history if you load that save again. To remove them for good, run the
**Remove inactive save entities** action (`satisfactory_frm.purge_inactive_saves`).

## Ready-made dashboard: the Control Room

The integration ships a control-room dashboard that builds itself from your servers.

1. **Settings → Dashboards → Add dashboard → New dashboard from scratch**, name it.
2. Open it, then **⋮ → Edit dashboard → ⋮ → Raw configuration editor**.
3. Replace everything with:

```yaml
strategy:
  type: custom:satisfactory
```

You get five views per server, with tabs in the control-room header:

- **Control Room**: status lamps and in-game clock, an alarm panel (fuses, dead grids,
  overload, draining batteries, shortfalls, idle machines; alarms flash until
  acknowledged, and acknowledgements are remembered per user), factory status, a dial
  per power circuit and a watchlist of the biggest shortfalls and surpluses.
- **Power**: per circuit a load dial, circuit-breaker indicator, battery tank, stats
  and a 2-hour load trend, plus the generator bank with run/standby switches.
- **Production**: a lever per production line (confirms before stopping a line) and a
  throughput board with filters and trends; tap a row for its history.
- **Machines**: every machine as a rack module with status LED, clock speed,
  productivity and its own run/standby switch, grouped by type with status filters.
- **Map**: the live map.

Options:

```yaml
strategy:
  type: custom:satisfactory
  circuit_names: {2: Main grid, 0: Biomass grid}   # name your circuits
  hide: [map]              # any of power, production, machines, map
  map_height: 720
  layout: classic          # the earlier auto-built layout with standard HA cards
```

The control-room cards keep their own dark industrial look regardless of your HA theme.
They load the Chakra Petch and JetBrains Mono fonts from Google Fonts, falling back to
system fonts offline.

**Using the cards on your own dashboards.** Every part is also a card you can place
anywhere (all accept `server:` and `circuit_names:`): `custom:sfrm-page-card`
(`page: control | power | production | machines | map`), `custom:sfrm-header-card`,
`custom:sfrm-alarms-card`, `custom:sfrm-status-card`, `custom:sfrm-grid-card`,
`custom:sfrm-power-card`, `custom:sfrm-generators-card`, `custom:sfrm-watchlist-card`,
`custom:sfrm-levers-card`, `custom:sfrm-throughput-card`, `custom:sfrm-rack-card`.
For a full-page look, put `sfrm-page-card` in a **Panel** view.

### Sidebar icon

The integration adds its own icons. In **Settings → Dashboards**, open your
Satisfactory dashboard's settings and set its icon to `sfrm:factory` (factory with a
pulse line) or `sfrm:logo` (the hex badge). They work anywhere HA asks for an icon.

### If the dashboard says "Timeout waiting for strategy element"

The browser hasn't loaded the dashboard script, usually because of a cached page
after an update or restart. Hard-refresh (Ctrl+Shift+R), or in the companion app
use **Settings → Companion app → Debugging → Reset frontend cache**. If that
doesn't help, add it as a resource manually: **Settings → Dashboards → ⋮ →
Resources → Add resource**, URL `/satisfactory_frm/satisfactory-dashboard.js`,
type JavaScript module. (Do the same with `/satisfactory_frm/satisfactory-map-card.js`
if the map card ever shows as a custom element error.)

## Production table card

Every item your factory makes, live, with search, sorting and filters
(All / Short / Surplus / Stopped). It creates no entities and makes no extra requests
to FRM. Tap a row to open that item's history (when it has a net sensor).

```yaml
type: custom:satisfactory-production-card
server: My Server   # optional
sort: net           # net (shortfalls first) | name | produced | consumed
filter: all         # all | deficit | surplus | stopped
show_all: false     # also list items nothing makes or uses
max_height: 520
```

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

Tap a marker for details. Power switches can be toggled from the map, and machines,
extractors and generators can be put into standby or set running again.

**Layers and filters are remembered** per Home Assistant user (across devices),
falling back to the browser if needed. Tap **Filters** for detailed filtering:
resource nodes by resource, purity and free/in use (e.g. only Limestone + only Pure),
power slugs by colour, Somersloops vs Mercer Spheres, drop pods by status, tapes by
type, and game markers by category.

**Collectibles:** power slugs, Somersloops and Mercer Spheres, drop pods (colour
shows unopened, needs power, opened, looted) and tapes/unlocks.

**Full screen:** the ⛶ button. Uses real full screen where the browser allows it,
otherwise expands the card over the page (Esc or ⛶ again to close).

**Pings and markers:** long-press (or right-click) anywhere on the map:
- **Ping in game** drops a ping at that spot for players (needs the FRM token). Any
  object's popup also has a Ping button.
- **Add marker** saves a named, coloured pin. FRM can't create in-game map markers, so
  these live in Home Assistant: every HA user sees them on the map card, per save.
  Tap a marker to edit, ping or delete it.

Options: `layers` (default layers before anything is remembered), `remember: false`
(don't remember layers/filters), `fast_interval`, `slow_interval`,
`min_z` / `max_z` (height filter in cm), `title`.

## Security

Anyone who can reach the FRM port can read your factory, and anyone with the token
can control it. Keep the port off the public internet where possible (firewall it to
Home Assistant's IP). The token stays in Home Assistant and is never sent to the
browser.

## Examples

See `examples/` for a dashboard and automations (fuse alerts, stuck "world not
ready" alerts, load shedding on low battery).
