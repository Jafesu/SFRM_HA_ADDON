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
    draw no power, so these work well for load shedding. FRM doesn't report whether
    a generator is in standby, so generator switches show the last state set from
    HA (shown with separate on/off buttons)
  - an **All &lt;recipe&gt;** switch per recipe that puts every building on it into
    standby or back to work at once (none for generators, on purpose)
  - names look like "Constructor Iron Plate 3", numbered in build order; rename
    freely in HA. The HUB's built-in burners are named "HUB Biomass Burner"
  - a **tank** sensor (%) for every machine that takes a fluid from a pipe, e.g.
    a coal generator's water tank. A tank running low is the live sign that its
    line can't keep up
- Pipe networks: pipes are traced into connected lines ("Water line 1", ...), one
  device each, with sensors for **status** (OK, short on supply, over pipe capacity,
  starving, no source, no consumers), **supply** (rated output of its extractors),
  **output now**, **demand** (what its consumers need at full speed), **pipe
  capacity** (what the pipes can carry from sources to consumers, worked out from
  the pipe layout and tiers), **pipe usage**, **shortfall** and **lowest tank**, plus
  a **problem** binary sensor to automate on. FRM reports no live flow in pipes, so
  supply, demand and capacity are rated numbers; *starving* comes from the consumers'
  tanks. Pump head lift isn't modelled. The pipe list is re-read every 5 minutes or
  when buildings change. A line keeps its entities when you rebuild the extractor
  it's named after

Things you dismantle in game (buildings, power circuits, power switches, pipe
networks, and production lines with no buildings left) have their entities and empty devices
removed automatically, once they've been gone for 5 minutes while their save is
loaded.

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
  overload, draining batteries, shortfalls, fluid line problems, idle machines; alarms flash until
  acknowledged, and acknowledgements are remembered per user), factory status, a dial
  per power circuit and a watchlist of the biggest shortfalls and surpluses.
- **Power**: per circuit a load dial, circuit-breaker indicator, battery tank, stats
  and a 2-hour load trend, fluid lines (supply, demand, pipe capacity and every
  consumer's tank level), plus the generator bank with run/standby switches and
  water tank levels.
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
  hide: [map]              # any of power, production, machines, map, planner
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

## Factory planner

A **Factory planner** page appears in the Home Assistant sidebar, and the Control Room
dashboard has a **Planner** tab that opens it. Pick what you
want to make and how fast, and it works out the cheapest way to do it from your
live save:

- only recipes you've **unlocked** (milestones, M.A.M., AWESOME Shop, hard drives,
  including alternates), or **all** recipes to plan ahead (locked ones are marked)
- optionally **uses your factory's current surplus** as free input
- choose which **miner tier** and **node purity** to assume for raw resources
- shows **building counts and clock speeds**, **power** against your grid's spare
  capacity, **raw resources** with how many nodes that takes and how many free
  nodes of each purity your map has left, the **belt or pipe tier** each link needs
  (and when one isn't enough), **byproducts**, and the **build cost** of the machines
- draws it all as a **flowchart** you can pan, zoom and rearrange; tap a box for
  details, or tell the planner not to use a recipe
- **plans are saved in Home Assistant** per save and shared by everyone using it

**Design mode** lets you build the factory yourself instead:

- drag buildings (any recipe you've unlocked), **miners / extractors**, **supplies**,
  **outputs** and **splitter/mergers** from the palette onto the canvas, or tap to add
- a **miner / extractor** box takes the resource, the extractor (Miner Mk.1/2/3, Water
  Extractor, Oil Extractor, Resource Well Extractor), node purity, count and clock;
  you can also **pick the actual free nodes** from your save, and it then uses each
  node's real purity. It warns when a plan needs more nodes of a purity than are free
- drag from a port to another box to **connect** them; drop a connection on empty
  space to pick a building that uses (or makes) that item, sized to match
- set **machine count and clock speed**, change recipe, duplicate, delete, undo/redo
- the maths updates live: each machine's real speed from what actually reaches it
  (shortages ripple downstream), the flow on every link and the belt or pipe tier it
  needs, and an **issues** list (unconnected or short inputs, outputs with nowhere to
  go, overloaded links)
- **Match inputs** sets a machine's clock to use exactly what arrives; **Fill
  shortages** asks the solver for whatever the design is missing and wires it in
- **Edit as design** turns a solved plan into a design you can adjust

Raw resources are weighted by how scarce they are on the map, so it prefers
abundant ores. Recipes, unlocks and nodes come from FRM (`getRecipes`,
`getSchematics`, `getResourceNode`) and are re-read every 10 minutes or with
**Reload game data**. Power use, extractor rates and belt speeds are built into the
integration. Next up: placing plans on the map, transport routes, and a tilted 3D
map view.

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
Pipes on a line with a problem are drawn thicker, in red (starving or over capacity)
or amber (short on supply, no source).

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
