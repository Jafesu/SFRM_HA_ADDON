/*
 * Satisfactory live map card for Home Assistant.
 * Shipped with the satisfactory_frm integration and loaded automatically.
 *
 * All data goes through Home Assistant:
 *   - websocket satisfactory_frm/map_info, /map_layer, /ping, /markers/*
 *   - map image + icons proxied from FRM via /api/satisfactory_frm/<entry>/asset/map/...
 *
 * Coordinates: FRM gives game units (cm). Like FRM's own web UI we work in
 * "deck" space (x, -y), with the map image spanning MAP_BOUNDS = [left, bottom, right, top].
 *
 * Layer visibility and filters are remembered per HA user (frontend user data,
 * falling back to this browser's localStorage).
 */

const VERSION = "0.5.0";

const LAYERS = {
  // id: [label, default visible]
  players: ["Players", true],
  trains: ["Trains", true],
  train_rails: ["Rails", true],
  train_stations: ["Train stations", true],
  drones: ["Drones", true],
  drone_stations: ["Drone ports", true],
  vehicles: ["Vehicles", true],
  truck_stations: ["Truck stations", false],
  factory: ["Machines", true],
  generators: ["Generators", true],
  extractors: ["Extractors", false],
  storage: ["Storage", false],
  switches: ["Power switches", true],
  belts: ["Belts", false],
  pipes: ["Pipes", false],
  cables: ["Power lines", false],
  hub: ["HUB", true],
  space_elevator: ["Space elevator", true],
  radar: ["Radar towers", false],
  resource_nodes: ["Resource nodes", false],
  slugs: ["Power slugs", false],
  artifacts: ["Somersloops & spheres", false],
  drop_pods: ["Drop pods", false],
  unlock_items: ["Tapes & unlocks", false],
  map_markers: ["Game markers", true],
  my_markers: ["My markers", true],
};
const LOCAL_LAYERS = new Set(["my_markers"]); // not fetched from FRM

// Draw order: lines first, then footprints, then icons on top.
const DRAW_ORDER = [
  "cables", "pipes", "belts", "train_rails",
  "storage", "extractors", "generators", "factory",
  "train_stations", "drone_stations", "truck_stations", "switches",
  "resource_nodes", "drop_pods", "unlock_items", "artifacts", "slugs",
  "map_markers", "hub", "space_elevator", "radar",
  "vehicles", "drones", "trains", "players", "my_markers",
];

const C = {
  green: "hsl(96,44%,62%)",
  yellow: "hsl(40,72%,62%)",
  orange: "hsl(20,79%,64%)",
  red: "hsl(359,68%,62%)",
  grey: "hsl(229,10%,55%)",
  white: "hsl(227,30%,88%)",
  rail: "#8839ef",
  belt: "rgb(153,209,219)",
  pipe: "rgb(255,204,153)",
  cable: "rgb(44,117,255)",
};
const PURITY = { Pure: C.green, Normal: C.orange, Impure: C.red };
const SLUG = {
  BP_Crystal_C: ["Blue (Mk.1)", "hsl(200,61%,55%)"],
  BP_Crystal_mk2_C: ["Yellow (Mk.2)", "hsl(42,80%,58%)"],
  BP_Crystal_mk3_C: ["Purple (Mk.3)", "hsl(288,61%,62%)"],
};
const ARTIFACT = {
  BP_WAT1_C: ["Somersloop", "hsl(347,82%,60%)"],
  BP_WAT2_C: ["Mercer Sphere", "hsl(290,49%,66%)"],
};
const MARKER_COLORS = ["#f99b38", "#e5534b", "#57ab5a", "#539bf5", "#b083f0", "#eac55f"];
const MARKER = "map/normal/markers/";
const VEHICLE_ICON = {
  BP_Truck_C: "truck", BP_Explorer_C: "explorer",
  BP_Tractor_C: "tractor", BP_Golfcart_C: "factory_cart",
};

const dropState = (o) => (o.Looted ? "Looted" : o.Opened ? "Opened" : "Unopened");
const unlockType = (o) =>
  o.features?.properties?.type || (String(o.ClassName || "").includes("Tape") ? "Cassette Tape" : "Other");

// Detailed filters. Each group hides the values the user switched off.
const FILTER_DEFS = {
  resource_nodes: [
    { key: "resource", label: "Resource", value: (o) => o.Name || o.ClassName || "Unknown" },
    { key: "purity", label: "Purity", value: (o) => o.Purity || "Unknown", order: ["Pure", "Normal", "Impure"] },
    { key: "state", label: "Status", value: (o) => (o.Exploited ? "In use" : "Free"), order: ["Free", "In use"] },
  ],
  slugs: [{ key: "type", label: "Type", value: (o) => SLUG[o.ClassName]?.[0] || o.ClassName, order: Object.values(SLUG).map((s) => s[0]) }],
  artifacts: [{ key: "type", label: "Type", value: (o) => ARTIFACT[o.ClassName]?.[0] || o.Name || o.ClassName }],
  drop_pods: [{ key: "state", label: "Status", value: dropState, order: ["Unopened", "Opened", "Looted"] }],
  unlock_items: [{ key: "type", label: "Type", value: unlockType }],
  map_markers: [{ key: "category", label: "Category", value: (o) => o.Category || "Uncategorised" }],
};

const toDeck = (loc) => [loc.x, -loc.y];
const rad = (d) => (d * Math.PI) / 180;

function rotate([px, py], [cx, cy], a) {
  const dx = px - cx, dy = py - cy, c = Math.cos(a), s = Math.sin(a);
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

// Same footprint math as FRM's web UI (BoundingBox rotated about the location).
function footprint(o) {
  const b = o.BoundingBox, l = o.location;
  if (!b || !b.min || !b.max || !l) return null;
  const pts = [
    [b.min.x, -b.min.y], [b.max.x, -b.min.y],
    [b.max.x, -b.max.y], [b.min.x, -b.max.y],
  ];
  const a = rad((-(l.rotation || 0) % 360) + 90);
  return pts.map((p) => rotate(p, [l.x, -l.y], a));
}

function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const yes = (v) => (v ? "Yes" : "No");

class SatisfactoryMapCard extends HTMLElement {
  static getStubConfig() {
    return { height: 420 };
  }

  setConfig(config) {
    this._config = { height: 420, fast_interval: 5, slow_interval: 60, ...config };
    const want = config.layers;
    this._visible = Object.fromEntries(
      Object.entries(LAYERS).map(([id, [, def]]) => [id, want ? want.includes(id) : def])
    );
    this._filters = this._filters || {};
    if (this._root) this._renderShell();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
  }

  getCardSize() {
    return Math.ceil((this._config?.height || 420) / 50) + 1;
  }

  connectedCallback() {
    this._connected = true;
    this._schedule();
  }

  disconnectedCallback() {
    this._connected = false;
    clearTimeout(this._fastTimer);
    clearTimeout(this._slowTimer);
    this._io?.disconnect();
    if (this._expanded) this._setExpanded(false);
  }

  // ---------------------------------------------------------------- setup

  async _init() {
    this._root = this.attachShadow({ mode: "open" });
    this._data = {};
    this._markers = [];
    this._icons = {};
    this._view = null;
    this._pointers = new Map();
    this._renderShell();
    try {
      const servers = await this._hass.callWS({ type: "satisfactory_frm/servers" });
      const want = this._config.server;
      const s = want ? servers.find((x) => x.entry_id === want || x.title === want) : servers[0];
      if (!s) throw new Error(want ? `No server called "${want}"` : "No Satisfactory server is set up");
      this._entry = s.entry_id;
      this._title = this._config.title || s.title;
      await this._loadPrefs();
      this._renderChips();
      await this._refreshInfo();
      this._loadMap();
      this._observeVisibility();
      this._schedule(true);
    } catch (e) {
      this._status(e.message || String(e));
    }
  }

  _renderShell() {
    const h = this._config.height;
    this._root.innerHTML = `
      <style>
        :host { --sf-accent: #f99b38; }
        ha-card { overflow: hidden; position: relative; }
        ha-card.expanded { position: fixed; inset: 0; z-index: 9; border-radius: 0; margin: 0; }
        ha-card:fullscreen { border-radius: 0; background: var(--ha-card-background, var(--card-background-color, #1c1c1c)); }
        .wrap { position: relative; height: ${h}px; background: #0e1420; touch-action: none; user-select: none; -webkit-user-select: none; }
        ha-card.expanded .wrap, ha-card:fullscreen .wrap { height: calc(100dvh - 47px); }
        canvas { width: 100%; height: 100%; display: block; cursor: grab; -webkit-touch-callout: none; }
        canvas.drag { cursor: grabbing; }
        .head { position: absolute; top: 8px; left: 10px; right: 50px; display: flex; gap: 8px;
          align-items: baseline; pointer-events: none; color: #fff; text-shadow: 0 1px 3px #000; }
        .head b { font-size: 15px; font-weight: 600; }
        .head span { font-size: 12px; opacity: .8; }
        .status { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
          color: #fff; background: rgba(14,20,32,.75); font-size: 14px; text-align: center; padding: 20px; }
        .status.on { display: flex; }
        .toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); padding: 7px 14px;
          border-radius: 999px; background: rgba(20,26,40,.92); color: #fff; font-size: 13px; pointer-events: none;
          opacity: 0; transition: opacity .2s; white-space: nowrap; max-width: calc(100% - 40px); overflow: hidden; text-overflow: ellipsis; }
        .toast.on { opacity: 1; }
        .zoom { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; gap: 4px; }
        .zoom button { width: 32px; height: 32px; border-radius: 6px; border: 1px solid rgba(255,255,255,.25);
          background: rgba(20,26,40,.85); color: #fff; font-size: 16px; cursor: pointer; padding: 0; }
        .zoom .gap { height: 6px; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--sf-accent); outline-offset: 1px; }
        .chips { display: flex; gap: 6px; overflow-x: auto; padding: 8px 10px; align-items: center;
          border-top: 1px solid var(--divider-color, #333); scrollbar-width: thin; }
        .chip { flex: none; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
          border: 1px solid var(--divider-color, #555); background: transparent; color: var(--secondary-text-color); }
        .chip[aria-pressed="true"] { border-color: var(--sf-accent); color: var(--primary-text-color);
          background: color-mix(in srgb, var(--sf-accent) 16%, transparent); }
        .chip.filters { border-style: dashed; }
        .chip.filters.active { border-style: solid; border-color: var(--sf-accent); color: var(--primary-text-color); }
        .pop { position: absolute; left: 10px; bottom: 10px; max-width: min(330px, calc(100% - 20px)); max-height: calc(100% - 20px);
          overflow-y: auto; background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          color: var(--primary-text-color); border-radius: 10px; padding: 10px 12px; font-size: 13px; z-index: 2;
          box-shadow: 0 4px 16px rgba(0,0,0,.45); border-left: 4px solid var(--pop-color, var(--sf-accent)); display: none; }
        .pop.on { display: block; }
        .pop h3 { margin: 0 24px 6px 0; font-size: 14px; font-weight: 600; }
        .pop dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
        .pop dt { color: var(--secondary-text-color); }
        .pop dd { margin: 0; }
        .pop .acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .pop button, .panel button.small { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
          border: 1px solid var(--sf-accent); background: transparent; color: var(--primary-text-color); }
        .pop button.danger { border-color: hsl(359,68%,62%); }
        .pop .x { position: absolute; top: 4px; right: 6px; border: 0; padding: 2px 6px; font-size: 16px; }
        .pop input { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; padding: 6px 8px; margin: 4px 0 8px;
          border-radius: 6px; border: 1px solid var(--divider-color, #555); background: var(--secondary-background-color, transparent);
          color: var(--primary-text-color); }
        .swatches { display: flex; gap: 8px; }
        .swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
        .swatch[aria-pressed="true"] { border-color: var(--primary-text-color); }
        .muted { color: var(--secondary-text-color); font-size: 12px; }
        .panel { position: absolute; inset: 8px; z-index: 3; display: none; flex-direction: column;
          background: var(--ha-card-background, var(--card-background-color, #1c1c1c)); color: var(--primary-text-color);
          border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.45); }
        .panel.on { display: flex; }
        .panel header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--divider-color, #333); }
        .panel header b { flex: 1; font-size: 15px; }
        .panel .body { overflow-y: auto; padding: 4px 12px 12px; }
        .panel section { padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--divider-color, #333) 60%, transparent); }
        .panel h4 { display: flex; align-items: center; gap: 8px; margin: 4px 0 6px; font-size: 14px; }
        .panel h4 span { flex: 1; }
        .group { margin: 6px 0; }
        .group .gl { display: flex; align-items: center; gap: 10px; font-size: 12px; color: var(--secondary-text-color); margin-bottom: 4px; }
        .group .gl button { border: 0; background: none; color: var(--sf-accent); font: inherit; font-size: 12px; cursor: pointer; padding: 0; }
        .opts { display: flex; flex-wrap: wrap; gap: 6px; }
      </style>
      <ha-card>
        <div class="wrap">
          <canvas aria-label="Factory map. Drag to pan, scroll or pinch to zoom, long-press to ping or add a marker."></canvas>
          <div class="head"><b></b><span></span></div>
          <div class="zoom">
            <button data-act="fullscreen" aria-label="Full screen" title="Full screen">⛶</button>
            <div class="gap"></div>
            <button data-z="1.5" aria-label="Zoom in">+</button>
            <button data-z="0.667" aria-label="Zoom out">−</button>
            <button data-z="fit" aria-label="Show whole map" title="Show whole map">⤢</button>
          </div>
          <div class="pop" role="dialog"></div>
          <div class="panel" role="dialog" aria-label="Map filters"></div>
          <div class="toast" role="status" aria-live="polite"></div>
          <div class="status on">Loading map…</div>
        </div>
        <div class="chips" role="toolbar" aria-label="Map layers"></div>
      </ha-card>`;
    this._card = this._root.querySelector("ha-card");
    this._canvas = this._root.querySelector("canvas");
    this._ctx = this._canvas.getContext("2d");
    this._pop = this._root.querySelector(".pop");
    this._panel = this._root.querySelector(".panel");
    this._statusEl = this._root.querySelector(".status");
    this._toastEl = this._root.querySelector(".toast");

    this._root.querySelectorAll(".zoom [data-z]").forEach((b) => {
      b.onclick = () => (b.dataset.z === "fit" ? this._fit() : this._zoomAt(+b.dataset.z));
    });
    this._root.querySelector('[data-act="fullscreen"]').onclick = () => this._toggleFullscreen();
    if (!this._fsBound) {
      this._fsBound = true;
      document.addEventListener("fullscreenchange", () => setTimeout(() => this._resize(), 50));
    }
    this._renderChips();
    this._bindPointer();
    new ResizeObserver(() => this._resize()).observe(this._canvas);
    this._updateHead();
  }

  _renderChips() {
    const chips = this._root?.querySelector(".chips");
    if (!chips) return;
    chips.innerHTML = "";
    const fb = document.createElement("button");
    fb.className = "chip filters";
    fb.onclick = () => this._openFilters();
    chips.appendChild(fb);
    this._filtersChip = fb;
    this._updateFiltersChip();
    for (const [id, [label]] of Object.entries(LAYERS)) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = label;
      b.dataset.layer = id;
      b.setAttribute("aria-pressed", String(!!this._visible[id]));
      b.onclick = () => this._setLayer(id, !this._visible[id]);
      chips.appendChild(b);
    }
  }

  _setLayer(id, on) {
    this._visible[id] = on;
    this._root.querySelector(`.chip[data-layer="${id}"]`)?.setAttribute("aria-pressed", String(on));
    this._savePrefs();
    if (on) (LOCAL_LAYERS.has(id) ? this._fetchMarkers() : this._fetchLayer(id)).then(() => this._draw());
    else this._draw();
  }

  _activeFilterCount() {
    return Object.values(this._filters).reduce(
      (n, groups) => n + Object.values(groups || {}).filter((v) => v && v.length).length, 0
    );
  }

  _updateFiltersChip() {
    if (!this._filtersChip) return;
    const n = this._activeFilterCount();
    this._filtersChip.textContent = n ? `Filters (${n})` : "Filters";
    this._filtersChip.classList.toggle("active", n > 0);
  }

  _status(text) {
    if (!this._statusEl) return;
    this._statusEl.textContent = text || "";
    this._statusEl.classList.toggle("on", !!text);
  }

  _toast(text) {
    if (!this._toastEl) return;
    this._toastEl.textContent = text;
    this._toastEl.classList.add("on");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this._toastEl.classList.remove("on"), 2800);
  }

  _updateHead() {
    const head = this._root?.querySelector(".head");
    if (!head) return;
    head.querySelector("b").textContent = this._title || "Satisfactory";
    head.querySelector("span").textContent = this._info?.session_name || "";
  }

  // ---------------------------------------------------------------- preferences

  _prefsKey() {
    return `satisfactory_frm_map_${this._entry}`;
  }

  async _loadPrefs() {
    if (this._config.remember === false) return;
    const key = this._prefsKey();
    let value = null;
    try {
      value = (await this._hass.callWS({ type: "frontend/get_user_data", key }))?.value;
    } catch (e) { /* older HA or no permission: fall back to this browser */ }
    if (!value) {
      try { value = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { value = null; }
    }
    if (!value) return;
    for (const [id, on] of Object.entries(value.visible || {})) if (id in LAYERS) this._visible[id] = !!on;
    this._filters = value.filters && typeof value.filters === "object" ? value.filters : {};
  }

  _savePrefs() {
    this._updateFiltersChip();
    if (this._config.remember === false) return;
    clearTimeout(this._prefsTimer);
    this._prefsTimer = setTimeout(() => {
      const key = this._prefsKey();
      const value = { visible: this._visible, filters: this._filters };
      this._hass.callWS({ type: "frontend/set_user_data", key, value }).catch(() => {});
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    }, 600);
  }

  // ---------------------------------------------------------------- data

  _observeVisibility() {
    this._onScreen = true;
    this._io = new IntersectionObserver((e) => {
      this._onScreen = e[0]?.isIntersecting ?? true;
      if (this._onScreen) this._schedule(true);
    });
    this._io.observe(this);
  }

  _active() {
    return this._connected && (this._onScreen !== false || this._expanded) && document.visibilityState !== "hidden";
  }

  _schedule(now = false) {
    if (!this._entry) return;
    clearTimeout(this._fastTimer);
    clearTimeout(this._slowTimer);
    const fast = async () => {
      if (this._active()) {
        await this._refreshInfo();
        if (this._info?.world_ready) {
          await Promise.all(this._layerIds(true).map((id) => this._fetchLayer(id)));
          this._draw();
        }
      }
      this._fastTimer = setTimeout(fast, this._config.fast_interval * 1000);
    };
    const slow = async () => {
      if (this._active() && this._info?.world_ready) {
        await Promise.all([
          ...this._layerIds(false).map((id) => this._fetchLayer(id)),
          this._visible.my_markers ? this._fetchMarkers() : null,
        ]);
        this._draw();
      }
      this._slowTimer = setTimeout(slow, this._config.slow_interval * 1000);
    };
    const d = now ? 0 : 50;
    this._fastTimer = setTimeout(fast, d);
    this._slowTimer = setTimeout(slow, d + 200);
  }

  _layerIds(fast) {
    const meta = this._info?.layers || {};
    return Object.keys(LAYERS).filter((id) => this._visible[id] && id in meta && !!meta[id] === fast);
  }

  async _refreshInfo() {
    try {
      this._info = await this._hass.callWS({ type: "satisfactory_frm/map_info", entry_id: this._entry });
      this._fused = new Set(this._info.fused_circuits || []);
      this._updateHead();
      if (!this._info.reachable) this._status("Server unreachable");
      else if (!this._info.world_ready) this._status("World not ready — waiting for the server to finish loading");
      else if (this._mapImg !== undefined) this._status("");
    } catch (e) {
      this._status(e.message || "Can't reach Home Assistant");
    }
  }

  async _fetchLayer(id) {
    if (!this._info?.world_ready || !(id in (this._info.layers || {}))) return;
    try {
      this._data[id] = await this._hass.callWS({ type: "satisfactory_frm/map_layer", entry_id: this._entry, layer: id });
    } catch (e) {
      // Layer endpoints can be missing on older FRM versions; keep the last data.
    }
  }

  async _fetchMarkers() {
    try {
      this._markers = await this._hass.callWS({ type: "satisfactory_frm/markers/list", entry_id: this._entry });
    } catch (e) { /* world not ready */ }
  }

  async _asset(path) {
    if (this._icons[path] !== undefined) return this._icons[path];
    this._icons[path] = null; // in flight
    try {
      const r = await this._hass.fetchWithAuth(`/api/satisfactory_frm/${this._entry}/asset/${path}`);
      if (!r.ok) throw new Error(r.status);
      const img = await createImageBitmap(await r.blob());
      this._icons[path] = img;
      this._draw();
      return img;
    } catch (e) {
      this._icons[path] = false;
      return false;
    }
  }

  async _loadMap() {
    const img = await this._asset("map/map.avif");
    this._mapImg = img || null;
    if (!img) this._status("Couldn't load the map image from FRM. Markers still work.");
    else if (this._info?.world_ready) this._status("");
    this._fit();
  }

  // ---------------------------------------------------------------- view

  _resize() {
    const r = this._canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = Math.max(1, r.width * dpr);
    this._canvas.height = Math.max(1, r.height * dpr);
    this._dpr = dpr;
    if (!this._view) this._fit();
    else this._draw();
  }

  _bounds() {
    return this._info?.bounds || [-324698.17, -375000, 425301.83, 375000];
  }

  _fit() {
    const [l, b, r, t] = this._bounds();
    const w = this._canvas.width / (this._dpr || 1), h = this._canvas.height / (this._dpr || 1);
    if (!w || !h) return;
    const s = Math.min(w / (r - l), h / (t - b));
    this._view = { s, ox: (w - (r - l) * s) / 2, oy: (h - (t - b) * s) / 2 };
    this._draw();
  }

  // deck -> screen (CSS px)
  _sx(dx) { return (dx - this._bounds()[0]) * this._view.s + this._view.ox; }
  _sy(dy) { return (this._bounds()[3] - dy) * this._view.s + this._view.oy; }
  _toDeck(px, py) {
    const [l, , , t] = this._bounds();
    return [(px - this._view.ox) / this._view.s + l, t - (py - this._view.oy) / this._view.s];
  }

  _zoomAt(f, px, py) {
    if (!this._view) return;
    const w = this._canvas.width / this._dpr, h = this._canvas.height / this._dpr;
    px ??= w / 2;
    py ??= h / 2;
    const minS = Math.min(w, h) / 900000, maxS = 0.05;
    const s = Math.min(maxS, Math.max(minS, this._view.s * f));
    const k = s / this._view.s;
    this._view.ox = px - (px - this._view.ox) * k;
    this._view.oy = py - (py - this._view.oy) * k;
    this._view.s = s;
    this._draw();
  }

  async _toggleFullscreen() {
    if (document.fullscreenElement) return document.exitFullscreen();
    if (this._expanded) return this._setExpanded(false);
    if (this._card.requestFullscreen) {
      try {
        await this._card.requestFullscreen();
        return;
      } catch (e) { /* e.g. iPhone Safari: fall through to an expanded overlay */ }
    }
    this._setExpanded(true);
  }

  _setExpanded(on) {
    this._expanded = on;
    this._card.classList.toggle("expanded", on);
    if (on) {
      this._escHandler = (e) => e.key === "Escape" && this._setExpanded(false);
      document.addEventListener("keydown", this._escHandler);
    } else if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler);
    }
    setTimeout(() => this._resize(), 30);
  }

  _bindPointer() {
    const cv = this._canvas;
    let moved = 0, pinch = null, pressTimer = null, longPressed = false;
    const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      moved = 0;
      longPressed = false;
      cv.classList.add("drag");
      cancelPress();
      if (this._pointers.size === 1 && e.button === 0) {
        const [x, y] = [e.offsetX, e.offsetY];
        pressTimer = setTimeout(() => {
          if (moved < 8 && this._pointers.size === 1) {
            longPressed = true;
            this._showSpot(x, y);
          }
        }, 550);
      }
    });
    cv.addEventListener("pointermove", (e) => {
      const prev = this._pointers.get(e.pointerId);
      if (!prev || !this._view) return;
      const cur = [e.offsetX, e.offsetY];
      this._pointers.set(e.pointerId, cur);
      if (this._pointers.size === 2) {
        cancelPress();
        const [a, b] = [...this._pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) this._zoomAt(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = d;
        moved += 10;
        return;
      }
      this._view.ox += cur[0] - prev[0];
      this._view.oy += cur[1] - prev[1];
      moved += Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]);
      if (moved >= 8) cancelPress();
      this._draw();
    });
    const up = (e) => {
      cancelPress();
      const tap = this._pointers.size === 1 && moved < 6 && !longPressed;
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) pinch = null;
      if (!this._pointers.size) cv.classList.remove("drag");
      if (tap && e.type === "pointerup") this._pick(e.offsetX, e.offsetY);
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      cancelPress();
      if (!longPressed) this._showSpot(e.offsetX, e.offsetY);
      longPressed = true;
    });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      this._zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY);
    }, { passive: false });
  }

  // ---------------------------------------------------------------- styling per object

  _iconFor(layer, o) {
    switch (layer) {
      case "players": return MARKER + (o.Dead ? "player_dead" : o.Online ? "player" : "player_offline") + ".avif";
      case "trains": return MARKER + "train.avif";
      case "drones": return MARKER + "drone.avif";
      case "vehicles": return MARKER + (VEHICLE_ICON[o.ClassName] || "truck") + ".avif";
      case "train_stations": return MARKER + "train_station.avif";
      case "drone_stations": return MARKER + "drone_station.avif";
      case "truck_stations": return MARKER + "truck_station.avif";
      case "switches": return MARKER + "power.avif";
      case "hub": return MARKER + "hub.avif";
      case "space_elevator": return MARKER + "space_elevator.avif";
      case "radar": return MARKER + "radar_tower.avif";
      case "drop_pods": return MARKER + "drop_pod.avif";
      case "unlock_items": return MARKER + "tape.avif";
      case "resource_nodes": case "slugs": case "artifacts":
        return o.ClassName ? `map/classnamed/${o.ClassName}.avif` : null;
      default: return null;
    }
  }

  _colorFor(layer, o) {
    switch (layer) {
      case "players": return o.Dead ? C.orange : o.Online ? C.green : C.grey;
      case "trains":
        if (o.Derailed || o.Status === "Derailed") return C.red;
        if (o.Status === "Parked" || (o.Status === "Self-Driving" && !(o.TimeTable || []).length)) return C.yellow;
        return C.green;
      case "drones":
        if (o.CurrentFlyingMode === "Flying" || o.CurrentFlyingMode === "Travelling") return C.green;
        if (o.CurrentDestination === "No Destination" || o.HasPairedStation === false) return C.red;
        return C.yellow;
      case "vehicles":
        if (o.HasFuel === false) return C.red;
        if (o.HasFuelForRoundtrip === false) return C.yellow;
        if (!o.Autopilot && Math.round(o.ForwardSpeed || 0) === 0) return C.yellow;
        return C.green;
      case "switches": return (o.IsOn ?? o.SwitchOn) ? C.green : C.red;
      case "resource_nodes": return PURITY[o.Purity] || C.grey;
      case "slugs": return SLUG[o.ClassName]?.[1] || C.grey;
      case "artifacts": return ARTIFACT[o.ClassName]?.[1] || C.grey;
      case "drop_pods":
        if (o.Looted) return C.green;
        if (o.Opened) return C.white;
        return o.RequiredPower ? C.yellow : C.red;
      case "unlock_items": return C.yellow;
      case "factory": case "extractors": case "generators": {
        const cid = o.PowerInfo?.CircuitGroupID;
        if (cid !== undefined && this._fused?.has(cid)) return C.red;
        if (o.IsPaused) return C.grey;
        if (layer === "generators") return o.CanStart === false ? C.yellow : C.green;
        if (o.IsConfigured === false || !o.IsProducing) return C.yellow;
        return C.green;
      }
      case "map_markers": return o.ColorSlot ? "#" + String(o.ColorSlot).replace(/^#/, "").slice(0, 6) : C.yellow;
      default: return C.grey;
    }
  }

  _inZ(o) {
    const z = o.location?.z;
    if (z === undefined) return true;
    const { min_z, max_z } = this._config;
    return (min_z === undefined || z >= min_z) && (max_z === undefined || z <= max_z);
  }

  _passes(layer, o) {
    const defs = FILTER_DEFS[layer];
    if (!defs) return true;
    const hidden = this._filters[layer];
    if (!hidden) return true;
    return defs.every((g) => !(hidden[g.key] || []).includes(g.value(o)));
  }

  // ---------------------------------------------------------------- draw

  _draw() {
    if (!this._view || !this._ctx) return;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._paint();
    });
  }

  _paint() {
    const ctx = this._ctx, dpr = this._dpr || 1;
    const w = this._canvas.width / dpr, h = this._canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this._hits = [];

    const [l, b, r, t] = this._bounds();
    if (this._mapImg) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this._mapImg, this._sx(l), this._sy(t), (r - l) * this._view.s, (t - b) * this._view.s);
    }
    const zoomed = this._view.s > 0.006; // roughly "close enough to see buildings"

    for (const layer of DRAW_ORDER) {
      if (!this._visible[layer]) continue;
      if (layer === "my_markers") { this._drawMarkers(); continue; }
      const items = this._data[layer];
      if (!Array.isArray(items)) continue;
      if (["belts", "pipes", "train_rails"].includes(layer)) this._drawSplines(layer, items);
      else if (layer === "cables") this._drawCables(items);
      else this._drawObjects(layer, items, zoomed);
    }
  }

  _drawSplines(layer, items) {
    const ctx = this._ctx;
    ctx.strokeStyle = layer === "train_rails" ? C.rail : layer === "belts" ? C.belt : C.pipe;
    ctx.lineWidth = layer === "train_rails" ? 2 : 1.25;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    for (const o of items) {
      const pts = o.SplineData;
      if (!Array.isArray(pts) || pts.length < 2 || !this._inZ(o)) continue;
      ctx.moveTo(this._sx(pts[0].x), this._sy(-pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(this._sx(pts[i].x), this._sy(-pts[i].y));
    }
    ctx.stroke();
  }

  _drawCables(items) {
    const ctx = this._ctx;
    ctx.strokeStyle = C.cable;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const o of items) {
      if (!o.location0 || !o.location1) continue;
      ctx.moveTo(this._sx(o.location0.x), this._sy(-o.location0.y));
      ctx.lineTo(this._sx(o.location1.x), this._sy(-o.location1.y));
    }
    ctx.stroke();
  }

  _drawObjects(layer, items, zoomed) {
    const ctx = this._ctx;
    const iconSize = layer === "players" ? 26 : ["slugs", "artifacts", "resource_nodes"].includes(layer) ? 20 : 22;
    for (const o of items) {
      if (!o.location || !this._inZ(o) || !this._passes(layer, o)) continue;
      const color = this._colorFor(layer, o);
      const poly = zoomed ? footprint(o) : null;
      const [dx, dy] = toDeck(o.location);
      const x = this._sx(dx), y = this._sy(dy);

      if (poly) {
        const sp = poly.map(([px, py]) => [this._sx(px), this._sy(py)]);
        ctx.beginPath();
        sp.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        this._hits.push({ layer, o, poly: sp, color });
      }

      const iconPath = this._iconFor(layer, o);
      if (iconPath) {
        const img = this._icons[iconPath];
        if (img === undefined) this._asset(iconPath);
        ctx.beginPath();
        ctx.arc(x, y, iconSize / 2 + 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(14,20,32,.85)";
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = color;
        ctx.stroke();
        if (img) ctx.drawImage(img, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
        this._hits.push({ layer, o, x, y, r: iconSize / 2 + 4, color });
      } else if (!poly) {
        const rr = layer === "map_markers" ? 5 : 3;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        this._hits.push({ layer, o, x, y, r: rr + 5, color });
      }
    }
  }

  _drawMarkers() {
    const ctx = this._ctx;
    const showLabels = this._view.s > 0.0012;
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const m of this._markers || []) {
      const x = this._sx(m.x), y = this._sy(-m.y);
      // Teardrop pin with its tip on the spot.
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 4, y - 8, x - 10, y - 12, x - 10, y - 19);
      ctx.arc(x, y - 19, 10, Math.PI, 0);
      ctx.bezierCurveTo(x + 10, y - 12, x + 4, y - 8, x, y);
      ctx.closePath();
      ctx.fillStyle = m.color || "#f99b38";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - 19, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      if (showLabels && m.name) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(14,20,32,.9)";
        ctx.strokeText(m.name, x + 14, y - 19);
        ctx.fillStyle = "#fff";
        ctx.fillText(m.name, x + 14, y - 19);
      }
      this._hits.push({ layer: "my_markers", o: m, x, y: y - 16, r: 14, color: m.color });
    }
  }

  // ---------------------------------------------------------------- picking + popups

  _pick(px, py) {
    if (this._panel.classList.contains("on")) return;
    const hits = this._hits || [];
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      const ok = h.poly ? pointInPoly([px, py], h.poly) : Math.hypot(px - h.x, py - h.y) <= h.r;
      if (ok) return this._showPopup(h);
    }
    this._closePopup();
  }

  _closePopup() {
    this._pop.classList.remove("on");
  }

  _rows(layer, o) {
    const pct = (v) => (typeof v === "number" ? `${Math.round(v * 100) / 100}%` : v);
    switch (layer) {
      case "players": return [["Status", o.Dead ? "Dead" : o.Online ? "Online" : "Offline"]];
      case "trains": return [["Status", o.Derailed ? "Derailed" : o.Status], ["Speed", o.ForwardSpeed], ["Station", o.TrainStation]];
      case "drones": return [["Mode", o.CurrentFlyingMode], ["Destination", o.CurrentDestination], ["Speed", Math.round(o.FlyingSpeed || 0)]];
      case "vehicles": return [["Autopilot", yes(o.Autopilot)], ["Fuel", o.HasFuel === false ? "Empty" : o.HasFuelForRoundtrip === false ? "Low" : "OK"], ["Speed", o.ForwardSpeed]];
      case "factory": case "extractors": return [
        ["Recipe", o.Recipe], ["Producing", yes(o.IsProducing)], ["Standby", yes(o.IsPaused)],
        ["Productivity", pct(o.Productivity)], ["Clock", pct(o.ManuSpeed)],
        ["Circuit", o.PowerInfo?.CircuitGroupID === -1 ? "Disconnected" : o.PowerInfo?.CircuitGroupID],
      ];
      case "generators": return [["Base output", o.BaseProd != null ? `${o.BaseProd} MW` : null], ["Fuel", o.FuelAmount], ["Full speed", yes(o.IsFullSpeed)], ["Standby", yes(o.IsPaused)]];
      case "switches": return [["State", (o.IsOn ?? o.SwitchOn) ? "On" : "Off"], ["Priority", o.Priority]];
      case "train_stations": return [["Transfer rate", o.TransferRate], ["Inflow", o.InflowRate], ["Outflow", o.OutflowRate]];
      case "drone_stations": return [["Paired with", o.PairedStation]];
      case "storage": return (o.Inventory || []).slice(0, 8).map((i) => [i.Name, i.Amount]);
      case "resource_nodes": return [["Purity", o.Purity], ["In use", yes(o.Exploited)]];
      case "slugs": return [["Type", SLUG[o.ClassName]?.[0] || o.ClassName]];
      case "artifacts": return [["Type", ARTIFACT[o.ClassName]?.[0] || o.Name]];
      case "drop_pods": {
        const item = o.RequiredItem?.Name && o.RequiredItem.Name !== "N/A" ? `${o.RequiredItem.Amount ?? ""} × ${o.RequiredItem.Name}` : null;
        return [["Status", dropState(o)], ["Needs", o.RequiredPower ? `${o.RequiredPower} MW power` : item]];
      }
      case "unlock_items": return [["Type", unlockType(o)], ["Unlocks", (o.Unlocks || []).map((u) => u.Name).join(", ")]];
      case "hub": return [["Milestone", o.SchNam], ["Ship back in", o.ShipReturn]];
      case "space_elevator": return [["Upgrade ready", yes(o.UpgradeReady)], ["Fully upgraded", yes(o.FullyUpgraded)]];
      case "map_markers": return [["Category", o.Category]];
      case "my_markers": return [["Added by", o.created_by]];
      default: return [];
    }
  }

  _titleFor(layer, o) {
    if (layer === "resource_nodes") return `${o.Purity ? o.Purity + " " : ""}${o.Name} node`;
    if (layer === "slugs") return `${(SLUG[o.ClassName]?.[0] || "").split(" ")[0]} power slug`;
    if (layer === "drop_pods") return "Drop pod";
    return o.Name || LAYERS[layer]?.[0] || "Object";
  }

  _openPopup(color, html) {
    this._pop.style.setProperty("--pop-color", color || "var(--sf-accent)");
    this._pop.innerHTML = `<button class="x" aria-label="Close">×</button>${html}`;
    this._pop.querySelector(".x").onclick = () => this._closePopup();
    this._pop.classList.add("on");
  }

  _showPopup({ layer, o, color }) {
    if (layer === "my_markers") return this._showMarker(o);
    const rows = this._rows(layer, o).filter(([, v]) => v !== undefined && v !== null && v !== "");
    const isBuilding = ["factory", "extractors", "generators"].includes(layer);
    const entityId =
      layer === "switches" ? this._info?.switch_entities?.[o.ID]
        : isBuilding ? this._info?.building_entities?.[o.ID] : null;
    const acts = [];
    if (entityId && isBuilding) acts.push(`<button data-act="${o.IsPaused ? "on" : "off"}">${o.IsPaused ? "Run" : "Stand by"}</button>`);
    else if (entityId) acts.push(`<button data-act="toggle">Toggle switch</button>`);
    if (entityId) acts.push(`<button data-act="more">Details</button>`);
    if (o.location) acts.push(`<button data-act="ping">Ping in game</button>`);
    this._openPopup(color, `
      <h3>${esc(this._titleFor(layer, o))}</h3>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${acts.length ? `<div class="acts">${acts.join("")}</div>` : ""}`);

    const run = async (service, btn) => {
      btn.disabled = true;
      try {
        await this._hass.callService("switch", service, { entity_id: entityId });
        setTimeout(() => this._fetchLayer(layer).then(() => this._draw()), 1500);
        this._closePopup();
      } catch (e) {
        btn.disabled = false;
        this._toast(`Couldn't change it: ${e.message || e}`);
      }
    };
    for (const [act, service] of [["toggle", "toggle"], ["on", "turn_on"], ["off", "turn_off"]]) {
      const btn = this._pop.querySelector(`[data-act="${act}"]`);
      if (btn) btn.addEventListener("click", () => run(service, btn));
    }
    this._pop.querySelector('[data-act="more"]')?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }));
    });
    this._pop.querySelector('[data-act="ping"]')?.addEventListener("click", () =>
      this._ping(o.location.x, o.location.y, o.location.z ?? 0)
    );
  }

  // Long-press / right-click on the map.
  _showSpot(px, py) {
    if (!this._view || !this._info?.world_ready) return;
    const [dx, dy] = this._toDeck(px, py);
    const gx = dx, gy = -dy;
    const z = this._nearestZ(gx, gy);
    this._openPopup(null, `
      <h3>This spot</h3>
      <div class="muted">X ${Math.round(gx / 100)} m · Y ${Math.round(gy / 100)} m</div>
      <div class="acts">
        <button data-act="ping">Ping in game</button>
        <button data-act="add">Add marker</button>
      </div>`);
    this._pop.querySelector('[data-act="ping"]').onclick = () => this._ping(gx, gy, z);
    this._pop.querySelector('[data-act="add"]').onclick = () => this._markerForm({ x: gx, y: gy });
  }

  // Height for a ping on an empty spot: borrow it from the nearest known object.
  _nearestZ(x, y) {
    let best = null, bestD = 5000 * 5000;
    for (const items of Object.values(this._data)) {
      if (!Array.isArray(items)) continue;
      for (const o of items) {
        const l = o.location;
        if (!l || l.z === undefined) continue;
        const d = (l.x - x) ** 2 + (l.y - y) ** 2;
        if (d < bestD) { bestD = d; best = l.z; }
      }
    }
    return best ?? 0;
  }

  async _ping(x, y, z) {
    try {
      await this._hass.callWS({ type: "satisfactory_frm/ping", entry_id: this._entry, x, y, z });
      this._toast("Pinged in game");
      this._closePopup();
    } catch (e) {
      this._toast(`Ping failed: ${e.message || e}`);
    }
  }

  _showMarker(m) {
    const when = m.created ? new Date(m.created * 1000).toLocaleDateString() : "";
    this._openPopup(m.color, `
      <h3>${esc(m.name)}</h3>
      <div class="muted">${m.created_by ? `Added by ${esc(m.created_by)}` : "Marker"}${when ? ` · ${esc(when)}` : ""}</div>
      <div class="acts">
        <button data-act="edit">Edit</button>
        <button data-act="ping">Ping in game</button>
        <button data-act="del" class="danger">Delete</button>
      </div>`);
    this._pop.querySelector('[data-act="edit"]').onclick = () => this._markerForm(m);
    this._pop.querySelector('[data-act="ping"]').onclick = () => this._ping(m.x, m.y, this._nearestZ(m.x, m.y));
    const del = this._pop.querySelector('[data-act="del"]');
    del.onclick = async () => {
      if (!del.dataset.confirm) {
        del.dataset.confirm = "1";
        del.textContent = "Tap again to delete";
        return;
      }
      try {
        await this._hass.callWS({ type: "satisfactory_frm/markers/delete", entry_id: this._entry, marker_id: m.id });
        this._markers = this._markers.filter((x) => x.id !== m.id);
        this._closePopup();
        this._draw();
        this._toast("Marker deleted");
      } catch (e) {
        this._toast(`Couldn't delete: ${e.message || e}`);
      }
    };
  }

  _markerForm(m) {
    const editing = !!m.id;
    let color = m.color || MARKER_COLORS[0];
    this._openPopup(color, `
      <h3>${editing ? "Edit marker" : "New marker"}</h3>
      <label class="muted" for="mname">Name</label>
      <input id="mname" maxlength="60" placeholder="e.g. Oil outpost" value="${esc(m.name || "")}">
      <div class="muted" id="clabel">Colour</div>
      <div class="swatches" role="radiogroup" aria-labelledby="clabel">
        ${MARKER_COLORS.map((c) => `<button class="swatch" role="radio" data-c="${c}" aria-label="${c}"
          aria-pressed="${c === color}" style="background:${c}"></button>`).join("")}
      </div>
      <div class="acts"><button data-act="save">Save</button><button data-act="cancel">Cancel</button></div>`);
    const input = this._pop.querySelector("#mname");
    setTimeout(() => input.focus(), 50);
    this._pop.querySelectorAll(".swatch").forEach((b) => {
      b.onclick = () => {
        color = b.dataset.c;
        this._pop.querySelectorAll(".swatch").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        this._pop.style.setProperty("--pop-color", color);
      };
    });
    const save = async () => {
      const name = input.value.trim() || "Marker";
      try {
        const payload = editing
          ? { type: "satisfactory_frm/markers/update", entry_id: this._entry, marker_id: m.id, name, color }
          : { type: "satisfactory_frm/markers/add", entry_id: this._entry, x: m.x, y: m.y, name, color };
        const saved = await this._hass.callWS(payload);
        this._markers = [...(this._markers || []).filter((x) => x.id !== saved.id), saved];
        if (!this._visible.my_markers) this._setLayer("my_markers", true);
        this._closePopup();
        this._draw();
        this._toast(editing ? "Marker updated" : "Marker added");
      } catch (e) {
        this._toast(`Couldn't save: ${e.message || e}`);
      }
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && save());
    this._pop.querySelector('[data-act="save"]').onclick = save;
    this._pop.querySelector('[data-act="cancel"]').onclick = () => this._closePopup();
  }

  // ---------------------------------------------------------------- filters panel

  async _openFilters() {
    this._closePopup();
    this._panel.classList.add("on");
    this._renderFilters(true);
    // Load filterable layers that are switched off so their options can be listed.
    const missing = Object.keys(FILTER_DEFS).filter((id) => !Array.isArray(this._data[id]));
    if (missing.length && this._info?.world_ready) {
      await Promise.all(missing.map((id) => this._fetchLayer(id)));
      if (this._panel.classList.contains("on")) this._renderFilters(false);
    }
  }

  _options(layer, group) {
    const values = new Set((this._data[layer] || []).map((o) => group.value(o)));
    for (const v of this._filters[layer]?.[group.key] || []) values.add(v); // keep hidden ones listed
    const order = group.order || [];
    return [...values].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return String(a).localeCompare(String(b));
    });
  }

  _renderFilters(loading) {
    const sections = Object.entries(FILTER_DEFS).map(([layer, groups]) => {
      const on = !!this._visible[layer];
      const body = groups.map((g) => {
        const opts = this._options(layer, g);
        if (!opts.length) return "";
        const hidden = this._filters[layer]?.[g.key] || [];
        return `<div class="group" data-layer="${layer}" data-key="${g.key}">
          <div class="gl"><span>${esc(g.label)}</span>
            <button data-all="1">All</button><button data-all="0">None</button></div>
          <div class="opts">${opts.map((v) => `<button class="chip" data-v="${esc(v)}"
            aria-pressed="${!hidden.includes(v)}">${esc(v)}</button>`).join("")}</div></div>`;
      }).join("");
      return `<section>
        <h4><span>${esc(LAYERS[layer][0])}</span>
          <button class="chip" data-layer-toggle="${layer}" aria-pressed="${on}">${on ? "Shown" : "Hidden"}</button></h4>
        ${body || `<div class="muted">${loading ? "Loading…" : "Nothing found on this save."}</div>`}
      </section>`;
    }).join("");
    this._panel.innerHTML = `
      <header><b>Filters</b>
        <button class="small" data-act="reset">Reset all</button>
        <button class="small" data-act="close">Done</button></header>
      <div class="body">
        <p class="muted">Tap a value to hide or show it. Combine groups, e.g. only <b>Limestone</b> + only <b>Pure</b> shows pure limestone nodes. Your choices are remembered.</p>
        ${sections}
      </div>`;
    this._panel.querySelector('[data-act="close"]').onclick = () => this._panel.classList.remove("on");
    this._panel.querySelector('[data-act="reset"]').onclick = () => {
      this._filters = {};
      this._savePrefs();
      this._renderFilters(false);
      this._draw();
    };
    this._panel.querySelectorAll("[data-layer-toggle]").forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.layerToggle;
        this._setLayer(id, !this._visible[id]);
        b.setAttribute("aria-pressed", String(this._visible[id]));
        b.textContent = this._visible[id] ? "Shown" : "Hidden";
      };
    });
    this._panel.querySelectorAll(".group").forEach((g) => {
      const layer = g.dataset.layer, key = g.dataset.key;
      const group = FILTER_DEFS[layer].find((x) => x.key === key);
      const setHidden = (list) => {
        this._filters[layer] = { ...(this._filters[layer] || {}), [key]: list };
        if (!list.length) delete this._filters[layer][key];
        if (!Object.keys(this._filters[layer]).length) delete this._filters[layer];
        // Filtering something implies you want to see it.
        if (!this._visible[layer]) {
          this._setLayer(layer, true);
          const t = this._panel.querySelector(`[data-layer-toggle="${layer}"]`);
          if (t) { t.setAttribute("aria-pressed", "true"); t.textContent = "Shown"; }
        }
        this._savePrefs();
        this._draw();
      };
      g.querySelectorAll(".opts .chip").forEach((b) => {
        b.onclick = () => {
          const v = b.dataset.v;
          const hidden = new Set(this._filters[layer]?.[key] || []);
          if (hidden.has(v)) hidden.delete(v); else hidden.add(v);
          b.setAttribute("aria-pressed", String(!hidden.has(v)));
          setHidden([...hidden]);
        };
      });
      g.querySelectorAll("[data-all]").forEach((b) => {
        b.onclick = () => {
          const all = b.dataset.all === "1";
          setHidden(all ? [] : this._options(layer, group));
          g.querySelectorAll(".opts .chip").forEach((c) => c.setAttribute("aria-pressed", String(all)));
        };
      });
    });
  }
}

SatisfactoryMapCard.FILTER_DEFS = FILTER_DEFS; // for tests and debugging
if (!customElements.get("satisfactory-map-card")) customElements.define("satisfactory-map-card", SatisfactoryMapCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "satisfactory-map-card")) window.customCards.push({
  type: "satisfactory-map-card",
  name: "Satisfactory map",
  description: "Live factory map from Ficsit Remote Monitoring",
});
console.info(`%c satisfactory-map-card ${VERSION} `, "background:#f99b38;color:#000");
