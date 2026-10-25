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
- Game chat notify entity: `notify.send_message` posts into in-game chat

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

## Security

Anyone who can reach the FRM port can read your factory, and anyone with the token
can control it. Keep the port off the public internet where possible (firewall it to
Home Assistant's IP). The token stays in Home Assistant and is never sent to the
browser.

## Examples

See `examples/` for a dashboard and automations (fuse alerts, stuck "world not
ready" alerts, load shedding on low battery).
