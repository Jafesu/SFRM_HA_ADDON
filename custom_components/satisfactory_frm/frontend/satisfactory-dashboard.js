/*
 * Satisfactory dashboard strategy for Home Assistant.
 *
 * Usage (raw dashboard config):
 *   strategy:
 *     type: custom:satisfactory
 *     # server: My Server        # one server only (display name or entry ID)
 *     # main_circuit: 1          # headline grid; default = largest capacity
 *     # hide: [map, control]     # overview | map | power | production | control
 *     # history_hours: 24
 *     # map_height: 460
 *
 * The dashboard rebuilds itself on every load from the integration's devices and
 * entities, and shows only the save that is currently loaded. Use "Take control"
 * in the dashboard menu to turn it into a normal editable dashboard.
 */

const DOMAIN = "satisfactory_frm";

// translation_key -> English entity-name slug (fallback when the registry
// doesn't expose translation_key).
const SUFFIX = {
  reachable: "server_reachable",
  world_ready: "world_ready",
  paused: "game_paused",
  session_name: "session_name",
  play_time: "play_time",
  game_day: "in_game_day",
  days_since_death: "days_since_last_death",
  game_time: "in_game_time",
  game_chat: "game_chat",
  chat_message: "send_chat_message",
  power_production: "power_production",
  power_consumed: "power_consumed",
  power_capacity: "power_capacity",
  power_max_consumed: "max_power_consumption",
  power_headroom: "power_headroom",
  power_load: "power_load",
  battery_differential: "battery_differential",
  battery_percent: "battery_charge",
  battery_capacity: "battery_capacity",
  battery_time_empty: "battery_time_until_empty",
  battery_time_full: "battery_time_until_full",
  fuse_triggered: "fuse_tripped",
  no_power: "no_power",
  battery_draining: "batteries_draining",
  machines_total: "machines",
  machines_producing: "machines_producing",
  machines_idle: "machines_idle",
  machines_paused: "machines_paused",
  avg_productivity: "average_productivity",
  item_produced: "produced",
  item_consumed: "consumed",
  item_net: "net",
  item_efficiency: "efficiency",
};
const SUFFIX_ORDER = Object.entries(SUFFIX).sort((a, b) => b[1].length - a[1].length);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function keyOf(ent) {
  if (ent.translation_key) return ent.translation_key;
  const objectId = ent.entity_id.split(".")[1];
  for (const [key, suffix] of SUFFIX_ORDER) {
    if (objectId === suffix || objectId.endsWith("_" + suffix)) return key;
  }
  return null;
}

const isUp = (hass, id) => {
  const st = hass.states[id]?.state;
  return st !== undefined && st !== "unavailable";
};
const num = (hass, id) => {
  const v = parseFloat(hass.states[id]?.state);
  return Number.isFinite(v) ? v : null;
};
const md = (content) => ({ type: "markdown", content });
const heading = (text, extra = {}) => ({ type: "heading", heading: text, ...extra });
const whenOn = (entity) => [{ condition: "state", entity, state: "on" }];
const warnTile = (entity, name, color) => ({
  type: "tile", entity, name, color, vertical: false, visibility: whenOn(entity),
});
const pausedNote = (srv) =>
  srv.s.paused
    ? [{
        type: "markdown",
        content: "The server is paused (dedicated servers pause when nobody is online), so power and production read zero until someone joins.",
        visibility: whenOn(srv.s.paused),
      }]
    : [];

function collect(hass) {
  const entities = Object.values(hass.entities || {}).filter((e) => e.platform === DOMAIN);
  const byDevice = new Map();
  for (const e of entities) {
    if (!e.device_id) continue;
    if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
    byDevice.get(e.device_id).push(e);
  }
  const devices = [...byDevice.keys()].map((id) => hass.devices?.[id]).filter(Boolean);
  const servers = devices.filter((d) => !d.via_device_id);

  return servers.map((server) => {
    const keyed = (list) => Object.fromEntries(list.map((e) => [keyOf(e), e.entity_id]).filter(([k]) => k));
    const children = devices.filter((d) => d.via_device_id === server.id);
    // A child device belongs to the loaded save if any of its entities is available.
    const active = children.filter((d) => byDevice.get(d.id).some((e) => isUp(hass, e.entity_id)));
    const name = server.name_by_user || server.name;

    const circuits = active
      .filter((d) => d.model === "Power circuit")
      .map((d) => {
        const ents = keyed(byDevice.get(d.id));
        const m = /circuit (\d+)\s*$/i.exec(d.name || "");
        return { id: m ? +m[1] : null, device: d, e: ents };
      })
      .sort((a, b) => (num(hass, b.e.power_capacity) ?? -1) - (num(hass, a.e.power_capacity) ?? -1));

    const prodDev = active.find((d) => d.model === "Production");
    const prodEnts = prodDev ? byDevice.get(prodDev.id) : [];
    const items = new Map();
    for (const e of prodEnts) {
      const k = keyOf(e);
      if (!k || !k.startsWith("item_")) continue;
      const label = hass.states[e.entity_id]?.attributes?.item || e.entity_id;
      if (!items.has(label)) items.set(label, {});
      items.get(label)[k] = e.entity_id;
    }

    const switchDev = active.find((d) => d.model === "Power switches");
    const switchEnts = switchDev ? byDevice.get(switchDev.id) : [];

    return {
      name,
      entryId: (server.config_entries || [])[0],
      s: keyed(byDevice.get(server.id)),
      circuits,
      factory: keyed(prodEnts),
      items: [...items.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      switches: switchEnts.filter((e) => e.entity_id.startsWith("switch.")).map((e) => e.entity_id).sort(),
      priorities: switchEnts.filter((e) => e.entity_id.startsWith("number.")).map((e) => e.entity_id).sort(),
    };
  });
}

function rows(list) {
  return list.filter(([id]) => id).map(([entity, name]) => (name ? { entity, name } : { entity }));
}

function noSave(hass, srv) {
  const ready = srv.s.world_ready && hass.states[srv.s.world_ready]?.state === "on";
  return md(
    ready
      ? "No data for the loaded save yet. Give it a minute after the world loads, then refresh."
      : "The world isn't ready, so there's nothing to show for the current save. This section fills in once the server finishes loading."
  );
}

function overviewSection(srv, main) {
  const s = srv.s;
  const cards = [
    heading("Overview", {
      badges: s.world_ready ? [{ type: "entity", entity: s.world_ready, state_content: "name" }] : [],
    }),
    {
      type: "entities",
      entities: rows([
        [s.reachable, "Server reachable"],
        [s.world_ready, "World ready"],
        [s.session_name, "Save"],
        [s.game_time, "In-game time"],
        [s.game_day, "In-game day"],
        [s.play_time, "Play time"],
        [s.days_since_death, "Days since last death"],
      ]),
    },
  ];
  if (main) {
    const e = main.e;
    cards.push({
      type: "glance",
      title: main.id !== null ? `Main grid (circuit ${main.id})` : "Main grid",
      columns: 4,
      entities: rows([
        [e.power_production, "Producing"],
        [e.power_consumed, "Using"],
        [e.power_headroom, "Headroom"],
        [e.battery_percent, "Battery"],
      ]),
    });
  }
  return { type: "grid", cards };
}

function mapSection(srv, cfg) {
  return {
    type: "grid",
    column_span: 2,
    cards: [
      heading("Map"),
      {
        type: "custom:satisfactory-map-card",
        server: srv.entryId,
        height: cfg.map_height || 460,
        grid_options: { columns: "full" },
      },
    ],
  };
}

function powerSection(hass, srv) {
  const cards = [heading("Power"), ...pausedNote(srv)];
  if (!srv.circuits.length) return { type: "grid", cards: [...cards, noSave(hass, srv)] };
  for (const c of srv.circuits) {
    const e = c.e;
    const hasBatt = !!num(hass, e.battery_capacity);
    cards.push(heading(c.id !== null ? `Circuit ${c.id}` : c.device.name, { heading_style: "subtitle" }));
    // Warnings only appear while they apply.
    if (e.fuse_triggered) cards.push(warnTile(e.fuse_triggered, "Fuse tripped — reset it in game", "red"));
    if (e.no_power) cards.push(warnTile(e.no_power, "No power — check generators and fuel", "red"));
    if (e.battery_draining && hasBatt) cards.push(warnTile(e.battery_draining, "Batteries draining", "amber"));
    cards.push(
      num(hass, e.power_load) !== null
        ? {
            type: "gauge",
            entity: e.power_load,
            name: "Load",
            min: 0,
            max: 100,
            severity: { green: 0, yellow: 75, red: 90 },
            grid_options: { columns: 4 },
          }
        : { type: "tile", entity: e.power_load, name: "Load", grid_options: { columns: 4 } },
      {
        type: "entities",
        grid_options: { columns: 8 },
        entities: rows([
          [e.power_production, "Producing"],
          [e.power_consumed, "Using"],
          [e.power_capacity, "Capacity"],
          [e.power_headroom, "Headroom"],
          [hasBatt ? e.battery_percent : null, "Battery"],
          [hasBatt ? e.battery_time_empty : null, "Empty in"],
        ]),
      }
    );
  }
  return { type: "grid", cards };
}

function productionSection(hass, srv, cfg) {
  const cards = [heading("Production"), ...pausedNote(srv)];
  const f = srv.factory;
  if (f.machines_total) {
    cards.push({
      type: "glance",
      columns: 4,
      entities: rows([
        [f.machines_producing, "Producing"],
        [f.machines_idle, "Idle"],
        [f.machines_paused, "Paused"],
        [f.avg_productivity, "Productivity"],
      ]),
    });
  }
  if (!srv.items.length) {
    cards.push(
      f.machines_total
        ? md("No items tracked yet. Choose items under **Settings → Devices & services → Satisfactory → Configure**, and each one gets a card here.")
        : noSave(hass, srv)
    );
    return { type: "grid", cards };
  }
  for (const [label, e] of srv.items) {
    cards.push({
      type: "vertical-stack",
      cards: [
        {
          type: "entities",
          title: label,
          entities: rows([
            [e.item_produced, "Produced"],
            [e.item_consumed, "Consumed"],
            [e.item_net, "Net"],
            [e.item_efficiency, "Efficiency"],
          ]),
        },
        ...(e.item_net
          ? [{ type: "history-graph", entities: [{ entity: e.item_net, name: "Net" }], hours_to_show: cfg.history_hours || 24 }]
          : []),
      ],
    });
  }
  return { type: "grid", cards };
}

function controlSection(hass, srv) {
  const cards = [heading("Control")];
  if (srv.switches.length) {
    cards.push({ type: "entities", title: "Power switches", state_color: true, entities: srv.switches });
  }
  if (srv.priorities.length) {
    cards.push({ type: "entities", title: "Switch priority", entities: srv.priorities });
  }
  if (!srv.switches.length) cards.push(srv.circuits.length ? md("No power switches found in this save.") : noSave(hass, srv));
  if (srv.s.chat_message) {
    cards.push({
      type: "entities",
      title: "Game chat",
      entities: rows([[srv.s.chat_message, "Message"]]),
      footer: undefined,
    });
    cards.push(md("Type a message and press Enter to post it in game. Needs the FRM token in the integration options."));
  }
  return { type: "grid", cards };
}

function buildView(hass, srv, cfg) {
  const hide = new Set(cfg.hide || []);
  const main =
    (cfg.main_circuit !== undefined && srv.circuits.find((c) => c.id === Number(cfg.main_circuit))) ||
    srv.circuits[0];
  const sections = [];
  if (!hide.has("overview")) sections.push(overviewSection(srv, main));
  if (!hide.has("map")) sections.push(mapSection(srv, cfg));
  if (!hide.has("power")) sections.push(powerSection(hass, srv));
  if (!hide.has("production")) sections.push(productionSection(hass, srv, cfg));
  if (!hide.has("control")) sections.push(controlSection(hass, srv));
  return {
    title: srv.name,
    path: slug(srv.name) || "satisfactory",
    icon: "mdi:factory",
    type: "sections",
    max_columns: 4,
    sections,
  };
}

class SatisfactoryDashboardStrategy extends HTMLElement {
  static async generate(config, hass) {
    let servers = collect(hass);
    if (config.server) {
      servers = servers.filter((s) => s.name === config.server || s.entryId === config.server);
    }
    if (!servers.length) {
      return {
        title: "Satisfactory",
        views: [
          {
            title: "Satisfactory",
            type: "sections",
            sections: [
              {
                type: "grid",
                cards: [
                  md(
                    config.server
                      ? `No Satisfactory server called **${config.server}** was found.`
                      : "No Satisfactory servers yet. Add one under **Settings → Devices & services → Add integration → Satisfactory**, then reload this dashboard."
                  ),
                ],
              },
            ],
          },
        ],
      };
    }
    return { title: "Satisfactory", views: servers.map((s) => buildView(hass, s, config)) };
  }
}

customElements.define("ll-strategy-dashboard-satisfactory", SatisfactoryDashboardStrategy);
console.info("%c satisfactory dashboard strategy ", "background:#f99b38;color:#000");
