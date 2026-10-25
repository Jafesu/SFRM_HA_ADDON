/*
 * Satisfactory live map card for Home Assistant.
 * Shipped with the satisfactory_frm integration and loaded automatically.
 *
 * All data goes through Home Assistant:
 *   - websocket satisfactory_frm/map_info and satisfactory_frm/map_layer
 *   - map image + icons proxied from FRM via /api/satisfactory_frm/<entry>/asset/map/...
 *
 * Coordinates: FRM gives game units (cm). Like FRM's own web UI we work in
 * "deck" space (x, -y), with the map image spanning MAP_BOUNDS = [left, bottom, right, top].
 */

const VERSION = "0.1.0";

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
  map_markers: ["Map markers", true],
};

// Draw order: lines first, then footprints, then icons on top.
const DRAW_ORDER = [
  "cables", "pipes", "belts", "train_rails",
  "storage", "extractors", "generators", "factory",
  "train_stations", "drone_stations", "truck_stations", "switches",
  "resource_nodes", "map_markers", "hub", "space_elevator", "radar",
  "vehicles", "drones", "trains", "players",
];

const C = {
  green: "hsl(96,44%,62%)",
  yellow: "hsl(40,72%,62%)",
  orange: "hsl(20,79%,64%)",
  red: "hsl(359,68%,62%)",
  grey: "hsl(229,10%,55%)",
  rail: "#8839ef",
  belt: "rgb(153,209,219)",
  pipe: "rgb(255,204,153)",
  cable: "rgb(44,117,255)",
};
const PURITY = { Pure: C.green, Normal: C.orange, Impure: C.red };
const MARKER = "map/normal/markers/";
const VEHICLE_ICON = {
  BP_Truck_C: "truck", BP_Explorer_C: "explorer",
  BP_Tractor_C: "tractor", BP_Golfcart_C: "factory_cart",
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
    this._config = {
      height: 420,
      fast_interval: 5,
      slow_interval: 60,
      ...config,
    };
    const want = config.layers;
    this._visible = Object.fromEntries(
      Object.entries(LAYERS).map(([id, [, def]]) => [id, want ? want.includes(id) : def])
    );
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
  }

  // ---------------------------------------------------------------- setup

  async _init() {
    this._root = this.attachShadow({ mode: "open" });
    this._data = {};
    this._icons = {};
    this._view = null;
    this._pointers = new Map();
    this._renderShell();
    try {
      const servers = await this._hass.callWS({ type: "satisfactory_frm/servers" });
      const want = this._config.server;
      const s = want
        ? servers.find((x) => x.entry_id === want || x.title === want)
        : servers[0];
      if (!s) throw new Error(want ? `No server called "${want}"` : "No Satisfactory server is set up");
      this._entry = s.entry_id;
      this._title = this._config.title || s.title;
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
        .wrap { position: relative; height: ${h}px; background: #0e1420; touch-action: none; }
        canvas { width: 100%; height: 100%; display: block; cursor: grab; }
        canvas.drag { cursor: grabbing; }
        .head { position: absolute; top: 8px; left: 10px; right: 10px; display: flex; gap: 8px;
          align-items: baseline; pointer-events: none; color: #fff; text-shadow: 0 1px 3px #000; }
        .head b { font-size: 15px; font-weight: 600; }
        .head span { font-size: 12px; opacity: .8; }
        .status { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
          color: #fff; background: rgba(14,20,32,.75); font-size: 14px; text-align: center; padding: 20px; }
        .status.on { display: flex; }
        .zoom { position: absolute; right: 8px; top: 34px; display: flex; flex-direction: column; gap: 4px; }
        .zoom button { width: 30px; height: 30px; border-radius: 6px; border: 1px solid rgba(255,255,255,.25);
          background: rgba(20,26,40,.85); color: #fff; font-size: 16px; cursor: pointer; }
        .zoom button:focus-visible, .chip:focus-visible, .pop button:focus-visible { outline: 2px solid var(--sf-accent); }
        .chips { display: flex; gap: 6px; overflow-x: auto; padding: 8px 10px;
          border-top: 1px solid var(--divider-color, #333); scrollbar-width: thin; }
        .chip { flex: none; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
          border: 1px solid var(--divider-color, #555); background: transparent; color: var(--secondary-text-color); }
        .chip[aria-pressed="true"] { border-color: var(--sf-accent); color: var(--primary-text-color);
          background: color-mix(in srgb, var(--sf-accent) 16%, transparent); }
        .pop { position: absolute; left: 10px; bottom: 10px; max-width: min(320px, calc(100% - 20px));
          background: var(--ha-card-background, var(--card-background-color, #1c1c1c));
          color: var(--primary-text-color); border-radius: 10px; padding: 10px 12px; font-size: 13px;
          box-shadow: 0 4px 16px rgba(0,0,0,.45); border-left: 4px solid var(--pop-color, var(--sf-accent)); display: none; }
        .pop.on { display: block; }
        .pop h3 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
        .pop dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
        .pop dt { color: var(--secondary-text-color); }
        .pop dd { margin: 0; }
        .pop .acts { display: flex; gap: 8px; margin-top: 8px; }
        .pop button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 6px; cursor: pointer;
          border: 1px solid var(--sf-accent); background: transparent; color: var(--primary-text-color); }
        .pop .x { position: absolute; top: 4px; right: 6px; border: 0; padding: 2px 6px; font-size: 16px; }
      </style>
      <ha-card>
        <div class="wrap">
          <canvas></canvas>
          <div class="head"><b></b><span></span></div>
          <div class="zoom"><button data-z="1.5" aria-label="Zoom in">+</button>
            <button data-z="0.667" aria-label="Zoom out">−</button>
            <button data-z="fit" aria-label="Show whole map">⤢</button></div>
          <div class="pop" role="dialog"></div>
          <div class="status on">Loading map…</div>
        </div>
        <div class="chips" role="toolbar" aria-label="Map layers"></div>
      </ha-card>`;
    this._canvas = this._root.querySelector("canvas");
    this._ctx = this._canvas.getContext("2d");
    this._pop = this._root.querySelector(".pop");
    this._statusEl = this._root.querySelector(".status");

    const chips = this._root.querySelector(".chips");
    for (const [id, [label]] of Object.entries(LAYERS)) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(!!this._visible[id]));
      b.onclick = () => {
        this._visible[id] = !this._visible[id];
        b.setAttribute("aria-pressed", String(this._visible[id]));
        if (this._visible[id]) this._fetchLayer(id).then(() => this._draw());
        else this._draw();
      };
      chips.appendChild(b);
    }
    this._root.querySelectorAll(".zoom button").forEach((b) => {
      b.onclick = () => (b.dataset.z === "fit" ? this._fit() : this._zoomAt(+b.dataset.z));
    });
    this._bindPointer();
    new ResizeObserver(() => this._resize()).observe(this._canvas);
    this._updateHead();
  }

  _status(text) {
    if (!this._statusEl) return;
    this._statusEl.textContent = text || "";
    this._statusEl.classList.toggle("on", !!text);
  }

  _updateHead() {
    const head = this._root?.querySelector(".head");
    if (!head) return;
    head.querySelector("b").textContent = this._title || "Satisfactory";
    head.querySelector("span").textContent = this._info?.session_name || "";
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
    return this._connected && this._onScreen !== false && document.visibilityState !== "hidden";
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
        await Promise.all(this._layerIds(false).map((id) => this._fetchLayer(id)));
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
    return Object.keys(LAYERS).filter((id) => this._visible[id] && !!meta[id] === fast);
  }

  async _refreshInfo() {
    try {
      this._info = await this._hass.callWS({ type: "satisfactory_frm/map_info", entry_id: this._entry });
      this._fused = new Set(this._info.fused_circuits || []);
      this._updateHead();
      if (!this._info.reachable) this._status("Server unreachable");
      else if (!this._info.world_ready) this._status("World not ready — waiting for the server to finish loading");
      else if (this._mapImg) this._status("");
    } catch (e) {
      this._status(e.message || "Can't reach Home Assistant");
    }
  }

  async _fetchLayer(id) {
    if (!this._info?.world_ready) return;
    try {
      this._data[id] = await this._hass.callWS({
        type: "satisfactory_frm/map_layer", entry_id: this._entry, layer: id,
      });
    } catch (e) {
      // Layer endpoints can be missing on older FRM versions; keep the last data.
    }
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
    if (!img) {
      this._status("Couldn't load the map image from FRM. Markers still work.");
    } else {
      this._mapImg = img;
      if (this._info?.world_ready) this._status("");
    }
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

  _fit() {
    const [l, b, r, t] = this._info?.bounds || [-324698.17, -375000, 425301.83, 375000];
    const w = this._canvas.width / (this._dpr || 1), h = this._canvas.height / (this._dpr || 1);
    if (!w || !h) return;
    const s = Math.min(w / (r - l), h / (t - b));
    this._view = { s, ox: (w - (r - l) * s) / 2, oy: (h - (t - b) * s) / 2 };
    this._draw();
  }

  // deck -> screen (CSS px)
  _sx(dx) {
    const [l] = this._info?.bounds || [-324698.17];
    return (dx - l) * this._view.s + this._view.ox;
  }
  _sy(dy) {
    const t = (this._info?.bounds || [0, 0, 0, 375000])[3];
    return (t - dy) * this._view.s + this._view.oy;
  }
  _toDeck(px, py) {
    const [l, , , t] = this._info?.bounds || [-324698.17, 0, 0, 375000];
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

  _bindPointer() {
    const cv = this._canvas;
    let moved = 0, pinch = null;
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
      moved = 0;
      cv.classList.add("drag");
    });
    cv.addEventListener("pointermove", (e) => {
      const prev = this._pointers.get(e.pointerId);
      if (!prev || !this._view) return;
      const cur = [e.offsetX, e.offsetY];
      this._pointers.set(e.pointerId, cur);
      if (this._pointers.size === 2) {
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
      this._draw();
    });
    const up = (e) => {
      const tap = this._pointers.size === 1 && moved < 6;
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) pinch = null;
      if (!this._pointers.size) cv.classList.remove("drag");
      if (tap && e.type === "pointerup") this._pick(e.offsetX, e.offsetY);
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
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
      case "resource_nodes": return o.ClassName ? `map/classnamed/${o.ClassName}.avif` : null;
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

    const [l, b, r, t] = this._info?.bounds || [-324698.17, -375000, 425301.83, 375000];
    if (this._mapImg) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this._mapImg, this._sx(l), this._sy(t), (r - l) * this._view.s, (t - b) * this._view.s);
    }
    const zoomed = this._view.s > 0.006; // roughly "close enough to see buildings"

    for (const layer of DRAW_ORDER) {
      if (!this._visible[layer]) continue;
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
    const iconSize = layer === "players" ? 26 : 22;
    for (const o of items) {
      if (!o.location || !this._inZ(o)) continue;
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

  // ---------------------------------------------------------------- picking + popup

  _pick(px, py) {
    const hits = this._hits || [];
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      const ok = h.poly ? pointInPoly([px, py], h.poly) : Math.hypot(px - h.x, py - h.y) <= h.r;
      if (ok) return this._showPopup(h);
    }
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
        ["Recipe", o.Recipe], ["Producing", yes(o.IsProducing)], ["Paused", yes(o.IsPaused)],
        ["Productivity", pct(o.Productivity)], ["Clock", pct(o.ManuSpeed)],
        ["Circuit", o.PowerInfo?.CircuitGroupID === -1 ? "Disconnected" : o.PowerInfo?.CircuitGroupID],
      ];
      case "generators": return [["Base output", o.BaseProd != null ? `${o.BaseProd} MW` : null], ["Fuel", o.FuelAmount], ["Full speed", yes(o.IsFullSpeed)]];
      case "switches": return [["State", (o.IsOn ?? o.SwitchOn) ? "On" : "Off"], ["Priority", o.Priority]];
      case "train_stations": return [["Transfer rate", o.TransferRate], ["Inflow", o.InflowRate], ["Outflow", o.OutflowRate]];
      case "drone_stations": return [["Paired with", o.PairedStation]];
      case "storage": return (o.Inventory || []).slice(0, 8).map((i) => [i.Name, i.Amount]);
      case "resource_nodes": return [["Purity", o.Purity], ["Exploited", yes(o.Exploited)]];
      case "hub": return [["Milestone", o.SchNam], ["Ship back in", o.ShipReturn]];
      case "space_elevator": return [["Upgrade ready", yes(o.UpgradeReady)], ["Fully upgraded", yes(o.FullyUpgraded)]];
      case "map_markers": return [["Category", o.Category]];
      default: return [];
    }
  }

  _showPopup({ layer, o, color }) {
    const rows = this._rows(layer, o).filter(([, v]) => v !== undefined && v !== null && v !== "");
    const title = layer === "resource_nodes" ? `${o.Name} node` : o.Name || LAYERS[layer][0];
    const entityId = layer === "switches" ? this._info?.switch_entities?.[o.ID] : null;
    this._pop.style.setProperty("--pop-color", color);
    this._pop.innerHTML = `
      <button class="x" aria-label="Close">×</button>
      <h3>${esc(title)}</h3>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${entityId ? `<div class="acts"><button data-act="toggle">Toggle switch</button>
        <button data-act="more">Details</button></div>` : ""}`;
    this._pop.querySelector(".x").onclick = () => this._pop.classList.remove("on");
    this._pop.querySelector('[data-act="toggle"]')?.addEventListener("click", async () => {
      try {
        await this._hass.callService("switch", "toggle", { entity_id: entityId });
        setTimeout(() => this._fetchLayer("switches").then(() => this._draw()), 1200);
      } catch (e) {
        this._status(`Couldn't toggle: ${e.message || e}`);
        setTimeout(() => this._status(""), 3000);
      }
    });
    this._pop.querySelector('[data-act="more"]')?.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }));
    });
    this._pop.classList.add("on");
  }
}

customElements.define("satisfactory-map-card", SatisfactoryMapCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "satisfactory-map-card",
  name: "Satisfactory map",
  description: "Live factory map from Ficsit Remote Monitoring",
});
console.info(`%c satisfactory-map-card ${VERSION} `, "background:#f99b38;color:#000");
