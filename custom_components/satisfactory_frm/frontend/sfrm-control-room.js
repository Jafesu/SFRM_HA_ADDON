/*
 * SFRM Control Room cards for Home Assistant.
 * Shipped with the satisfactory_frm integration and loaded automatically.
 *
 * Cards (all take an optional `server:` = display name or entry ID):
 *   custom:sfrm-page-card        page: control | power | production | machines | map
 *   custom:sfrm-header-card      header with lamps, clock and view tabs
 *   custom:sfrm-alarms-card      alarm panel with acknowledge
 *   custom:sfrm-status-card      factory status
 *   custom:sfrm-grid-card        power dials (compact)
 *   custom:sfrm-power-card       full circuit panels (breaker, battery, trend)
 *   custom:sfrm-generators-card  generator bank with run/standby rockers
 *   custom:sfrm-watchlist-card   shortfalls and surpluses
 *   custom:sfrm-levers-card      production line levers
 *   custom:sfrm-throughput-card  throughput board
 *   custom:sfrm-rack-card        machine rack
 */

const SFRM_CR_VERSION = "0.6.0";
const DOMAIN = "satisfactory_frm";
const CHILD_MODELS = new Set(["Power circuit", "Production", "Power switches", "Building group", "Production lines"]);

// Fonts: loaded once into the document (shadow roots can't register @font-face).
(() => {
  if (document.querySelector("link[data-sfrm-fonts]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.dataset.sfrmFonts = "1";
  l.href = "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap";
  document.head.appendChild(l);
})();

const LOGO = "M12 0.4 22.05 6.2 22.05 17.8 12 23.6 1.95 17.8 1.95 6.2ZM17.92 17.21 17.92 11.66 15.33 11.66 15.33 7.59 13.85 7.59 13.85 11.66 11.26 9.81 11.26 11.66 8.67 9.81 8.67 11.66 6.08 9.81 6.08 17.21ZM7.26 13.51 8.74 13.51 8.74 15.36 7.26 15.36ZM9.93 13.51 11.41 13.51 11.41 15.36 9.93 15.36ZM12.59 13.51 14.07 13.51 14.07 15.36 12.59 15.36ZM15.26 13.51 16.74 13.51 16.74 15.36 15.26 15.36Z";

const COL = {
  bg: "#0b0e13", panel: "#141922", well: "#0f1319", deep: "#07090d",
  line: "#262e3b", line2: "#222a36", text: "#e6eaf0", text2: "#c5cdd8", dim: "#9aa6b8",
  orange: "#f99b38", cyan: "#5ad1e6", green: "#57d48a", amber: "#f5b740", red: "#ff5a4e", grey: "#3a4250",
  short: "#ff9b45",
};

const BASE_CSS = `
:host{display:block;--o:${COL.orange};--c:${COL.cyan};font-family:'Chakra Petch',system-ui,sans-serif;color:${COL.text}}
*{box-sizing:border-box}
.panel{background:${COL.panel};border:1px solid ${COL.line};border-radius:10px;padding:16px;color:${COL.text};font-family:'Chakra Petch',system-ui,sans-serif}
.standalone{background:${COL.bg};background-image:radial-gradient(circle at 1px 1px,#161c25 1px,transparent 0);background-size:22px 22px;border-radius:12px;padding:12px}
h2.t{margin:0;font-size:13px;letter-spacing:.22em;color:${COL.dim};font-weight:600}
.sub{font-size:13px;color:${COL.text2}}
.lbl{font-size:10px;letter-spacing:.16em;color:${COL.dim}}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.well{background:${COL.well};border:1px solid ${COL.line2};border-radius:8px}
.lamp{display:inline-block;width:10px;height:10px;border-radius:50%;flex:none}
button{font-family:inherit;color:inherit}
button:focus-visible,a:focus-visible{outline:2px solid ${COL.orange};outline-offset:2px}
.btn{font-size:13px;font-weight:600;letter-spacing:.12em;color:${COL.orange};background:transparent;border:1px solid ${COL.orange};border-radius:6px;padding:0 16px;min-height:44px;cursor:pointer}
.btn:hover{background:#2a2216}
.btn.solid{background:${COL.orange};color:#14100a;border:0}
.btn.ghost{color:${COL.text};border-color:#3a4454}
.chip{font-size:12px;font-weight:600;letter-spacing:.12em;min-height:44px;padding:0 14px;border-radius:22px;cursor:pointer;border:1px solid #2a3240;background:transparent;color:#b6c0ce;display:inline-flex;align-items:center;gap:8px;transition:background .2s,color .2s}
.chip[aria-pressed="true"]{background:${COL.orange};color:#14100a;border-color:${COL.orange}}
.needle{transition:transform 1.2s cubic-bezier(.2,.9,.25,1)}
.grow{transition:width 1s ease,height 1s ease}
.blink{animation:sfrm-alarm 1.1s steps(2,jump-none) infinite}
.blinkw{animation:sfrm-warn 1.4s steps(2,jump-none) infinite}
@keyframes sfrm-alarm{0%,49%{box-shadow:0 0 0 1px #ff6b5e inset,0 0 22px rgba(255,90,78,.45)}50%,100%{box-shadow:0 0 0 1px #6e2a26 inset,0 0 0 rgba(0,0,0,0)}}
@keyframes sfrm-warn{0%,49%{box-shadow:0 0 0 1px #f5b740 inset,0 0 20px rgba(245,183,64,.35)}50%,100%{box-shadow:0 0 0 1px #6b5224 inset,0 0 0 rgba(0,0,0,0)}}
.led-on{animation:sfrm-led 2.4s ease-in-out infinite}
@keyframes sfrm-led{0%,100%{opacity:1}50%{opacity:.6}}
.hazard{font-size:12px;font-weight:700;letter-spacing:.14em;color:#fff;background:repeating-linear-gradient(-45deg,#7a221c 0 12px,#4a1512 12px 24px);border-radius:6px;padding:8px 12px;text-align:center}
.hazard.amber{background:repeating-linear-gradient(-45deg,#6b4c12 0 12px,#3d2c0b 12px 24px)}
.empty{font-size:13px;color:${COL.dim};padding:8px 0}
.rocker{flex:none;width:56px;height:44px;border-radius:22px;border:1px solid #2f3846;position:relative;cursor:pointer;padding:0;transition:background .2s}
.rocker .k{position:absolute;top:5px;left:5px;width:32px;height:32px;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.5);transition:transform .25s cubic-bezier(.3,1.4,.5,1),background .2s}
.rocker:disabled{cursor:not-allowed;opacity:.5}
.modal{position:fixed;inset:0;background:rgba(5,7,10,.72);display:flex;align-items:center;justify-content:center;padding:20px;z-index:20}
.modal .box{width:min(460px,100%);background:#161c26;border:1px solid ${COL.orange};border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.modal .stripe{height:8px;margin:-20px -20px 16px;border-radius:12px 12px 0 0;background:repeating-linear-gradient(-45deg,${COL.orange} 0 12px,#14100a 12px 24px)}
.modal h3{margin:0 0 8px;font-size:20px;letter-spacing:.04em}
.modal p{margin:0 0 18px;font-size:14px;color:${COL.text2};line-height:1.5}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1d2430;border:1px solid ${COL.amber};color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;line-height:1.4;z-index:21;max-width:min(560px,calc(100vw - 32px))}
@media (prefers-reduced-motion: reduce){.blink,.blinkw,.led-on{animation:none}.needle,.grow,.rocker .k{transition:none}}
`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (hass, id) => {
  if (!id) return null;
  const v = parseFloat(hass.states[id]?.state);
  return Number.isFinite(v) ? v : null;
};
const isOn = (hass, id) => hass.states[id]?.state === "on";
const isUp = (hass, id) => {
  const st = hass.states[id]?.state;
  return st !== undefined && st !== "unavailable";
};
const f1 = (v) => (v === null || v === undefined ? "–" : Number(v).toFixed(1));
const signed = (v) => `${v > 0.005 ? "+" : ""}${v.toFixed(1)}`;

// ------------------------------------------------------------------ DOM patching
// Re-render by patching in place so CSS transitions (needles, levers, bars) animate.
function morph(root, html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  patchChildren(root, tpl.content);
}
function patchChildren(a, b) {
  const bc = [...b.childNodes], ac = [...a.childNodes];
  bc.forEach((nb, i) => {
    const na = ac[i];
    if (!na) a.appendChild(nb);
    else patchNode(na, nb);
  });
  for (let i = ac.length - 1; i >= bc.length; i--) ac[i].remove();
}
function patchNode(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName || (a.nodeType === 1 && a.dataset.key !== b.dataset?.key)) {
    a.replaceWith(b);
    return;
  }
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  if (a.tagName === "INPUT") return;
  patchChildren(a, b);
}

// ------------------------------------------------------------------ discovery
// Builds a model of each server from the entity and device registries. Cached per hass.states.
let _discCache = { states: null, result: null };
function discoverAll(hass) {
  if (_discCache.states === hass.states && _discCache.entities === hass.entities) return _discCache.result;
  const ents = Object.values(hass.entities || {}).filter((e) => e.platform === DOMAIN);
  const byDevice = new Map();
  for (const e of ents) {
    if (!e.device_id) continue;
    if (!byDevice.has(e.device_id)) byDevice.set(e.device_id, []);
    byDevice.get(e.device_id).push(e);
  }
  const devices = [...byDevice.keys()].map((id) => hass.devices?.[id]).filter(Boolean);
  const keyed = (list) => {
    const out = {};
    for (const e of list) if (e.translation_key) out[e.translation_key] = e.entity_id;
    return out;
  };
  const servers = devices
    .filter((d) => !d.via_device_id && !CHILD_MODELS.has(d.model))
    .map((server) => {
      const name = server.name_by_user || server.name;
      const children = devices.filter((d) => d.via_device_id === server.id);
      const active = children.filter((d) => byDevice.get(d.id).some((e) => isUp(hass, e.entity_id)));
      const circuits = active
        .filter((d) => d.model === "Power circuit")
        .map((d) => {
          const m = /circuit (\d+)\s*$/i.exec(d.name || "");
          return { id: m ? +m[1] : null, e: keyed(byDevice.get(d.id)) };
        })
        .sort((a, b) => (num(hass, b.e.power_capacity) ?? -1) - (num(hass, a.e.power_capacity) ?? -1) || (a.id ?? 0) - (b.id ?? 0));
      const prodDev = active.find((d) => d.model === "Production");
      const buildings = [], buildingSwitch = {};
      for (const d of active.filter((x) => x.model === "Building group")) {
        const dn = d.name_by_user || d.name || "";
        for (const e of byDevice.get(d.id)) {
          const st = hass.states[e.entity_id];
          if (!st) continue;
          const a = st.attributes || {};
          if (e.entity_id.startsWith("switch.") && a.frm_id) buildingSwitch[a.frm_id] = e.entity_id;
          else if (e.entity_id.startsWith("sensor.") && a.frm_id) {
            let label = (a.friendly_name || e.entity_id).replace(/ status$/i, "");
            if (label.startsWith(dn + " ")) label = label.slice(dn.length + 1);
            buildings.push({ entity: e.entity_id, id: a.frm_id, label, state: st.state, a });
          }
        }
      }
      const linesDev = active.find((d) => d.model === "Production lines");
      const lines = linesDev
        ? byDevice.get(linesDev.id)
            .filter((e) => e.entity_id.startsWith("switch."))
            .map((e) => ({ entity: e.entity_id, st: hass.states[e.entity_id] }))
            .filter((l) => l.st)
            .map((l) => ({
              entity: l.entity, on: l.st.state === "on", available: l.st.state !== "unavailable",
              recipe: l.st.attributes.recipe || (l.st.attributes.friendly_name || "").replace(/^.*?\bAll\s+/, ""),
              total: l.st.attributes.buildings ?? 0, running: l.st.attributes.running ?? 0,
              types: l.st.attributes.building_types || [],
            }))
            .sort((a, b) => a.recipe.localeCompare(b.recipe))
        : [];
      return {
        name, entryId: (server.config_entries || [])[0], deviceId: server.id,
        s: keyed(byDevice.get(server.id)), circuits,
        factory: prodDev ? keyed(byDevice.get(prodDev.id)) : {},
        buildings, buildingSwitch, lines,
      };
    });
  _discCache = { states: hass.states, entities: hass.entities, result: servers };
  return servers;
}
function discover(hass, want) {
  const all = discoverAll(hass);
  if (!want) return all[0] || null;
  return all.find((s) => s.name === want || s.entryId === want) || null;
}

// ------------------------------------------------------------------ shared data feeds
// Websocket data shared by every card on the page, refreshed while anything uses it.
const FEEDS = new Map();
function feed(key, fetcher, maxAgeMs, listener) {
  let f = FEEDS.get(key);
  if (!f) FEEDS.set(key, (f = { data: undefined, ts: 0, pending: null, listeners: new Set() }));
  if (listener) f.listeners.add(listener);
  if (!f.pending && Date.now() - f.ts > maxAgeMs) {
    f.pending = fetcher()
      .then((d) => { f.data = d; })
      .catch(() => {})
      .finally(() => {
        f.ts = Date.now();
        f.pending = null;
        f.listeners.forEach((l) => l._dirty());
      });
  }
  return f.data;
}
function invalidate(prefix) {
  FEEDS.forEach((f, key) => { if (key.startsWith(prefix)) f.ts = 0; });
}
function unlisten(listener) {
  FEEDS.forEach((f) => f.listeners.delete(listener));
}
const productionFeed = (hass, srv, card) =>
  feed(`prod:${srv.entryId}`, () => hass.callWS({ type: "satisfactory_frm/production", entry_id: srv.entryId }), 20000, card);
const layerFeed = (hass, srv, layer, card) =>
  feed(`layer:${srv.entryId}:${layer}`, () => hass.callWS({ type: "satisfactory_frm/map_layer", entry_id: srv.entryId, layer }), 20000, card);
const infoFeed = (hass, srv, card) =>
  feed(`info:${srv.entryId}`, () => hass.callWS({ type: "satisfactory_frm/map_info", entry_id: srv.entryId }), 30000, card);
function historyFeed(hass, ids, hours, card) {
  const list = [...new Set(ids.filter(Boolean))].sort();
  if (!list.length) return {};
  return (
    feed(`hist:${hours}:${list.join(",")}`, async () => {
      const end = new Date(), start = new Date(end - hours * 3600e3);
      const res = await hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(), end_time: end.toISOString(),
        entity_ids: list, minimal_response: true, no_attributes: true, significant_changes_only: false,
      });
      const out = {};
      for (const [id, pts] of Object.entries(res || {})) {
        out[id] = pts.map((p) => [Number(p.lu ?? p.lc ?? 0) * 1000, parseFloat(p.s)]).filter((p) => Number.isFinite(p[1]));
      }
      return out;
    }, 300000, card) || {}
  );
}

// Sparkline points (0..w, 0..h) from history samples; null when there's not enough data.
function sparkPoints(samples, w, h, current) {
  const pts = (samples || []).slice(-60);
  if (current !== null && current !== undefined) pts.push([Date.now(), current]);
  if (pts.length < 2) return null;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const vs = pts.map((p) => p[1]);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  return pts
    .map(([t, v]) => `${(((t - t0) / Math.max(1, t1 - t0)) * w).toFixed(1)},${(h - 2 - ((v - lo) / (hi - lo)) * (h - 4)).toFixed(1)}`)
    .join(" ");
}

// ------------------------------------------------------------------ gauges
function gpt(a, r) {
  const rad = (a * Math.PI) / 180;
  return [100 + r * Math.sin(rad), 100 - r * Math.cos(rad)];
}
function garc(v0, v1, r) {
  const a0 = -120 + 240 * v0, a1 = -120 + 240 * v1;
  if (a1 - a0 < 0.5) return "";
  const p0 = gpt(a0, r), p1 = gpt(a1, r);
  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
}
const GAUGE_TICKS = (() => {
  let s = "";
  for (let k = 0; k <= 10; k++) {
    const a = -120 + 24 * k, major = k % 5 === 0;
    const o = gpt(a, 92), n = gpt(a, major ? 76 : 82);
    s += `<line x1="${o[0].toFixed(1)}" y1="${o[1].toFixed(1)}" x2="${n[0].toFixed(1)}" y2="${n[1].toFixed(1)}" stroke="#56627a" stroke-width="${major ? 2.5 : 1.2}"></line>`;
  }
  return s;
})();
function gaugeColor(load, dead) {
  return dead || load >= 0.9 ? COL.red : load >= 0.75 ? COL.amber : COL.cyan;
}
function gaugeSvg(load, dead, maxW = 260) {
  const v = dead ? 1 : Math.max(0, Math.min(1, load));
  const color = gaugeColor(v, dead);
  return `<svg viewBox="0 0 200 150" style="width:100%;max-width:${maxW}px;display:block;margin:0 auto" aria-hidden="true">
    <path d="${garc(0, 1, 70)}" fill="none" stroke="#1e2530" stroke-width="16"></path>
    <path d="${garc(0, 0.75, 70)}" fill="none" stroke="#1f6f7d" stroke-width="16"></path>
    <path d="${garc(0.75, 0.9, 70)}" fill="none" stroke="#8a6620" stroke-width="16"></path>
    <path d="${garc(0.9, 1, 70)}" fill="none" stroke="#8c2f2a" stroke-width="16"></path>
    <path d="${garc(0, v, 70) || "M0 0"}" fill="none" stroke="${color}" stroke-width="16"></path>
    ${GAUGE_TICKS}
    <g class="needle" style="transform:rotate(${(-120 + 240 * v).toFixed(1)}deg);transform-origin:100px 100px">
      <line x1="100" y1="104" x2="100" y2="34" stroke="#f3f5f8" stroke-width="3" stroke-linecap="round"></line>
    </g>
    <circle cx="100" cy="100" r="9" fill="${COL.orange}"></circle><circle cx="100" cy="100" r="3.5" fill="${COL.well}"></circle>
  </svg>`;
}

// Read one circuit's sensors into plain numbers.
function circuitModel(hass, c, names, index) {
  const e = c.e;
  const cap = num(hass, e.power_capacity) ?? 0;
  const used = num(hass, e.power_consumed) ?? 0;
  const max = num(hass, e.power_max_consumed) ?? 0;
  const load = num(hass, e.power_load);
  const fuse = isOn(hass, e.fuse_triggered);
  const noPower = isOn(hass, e.no_power);
  const battCap = num(hass, e.battery_capacity) ?? 0;
  const battPct = battCap > 0 ? num(hass, e.battery_percent) : null;
  const emptyEnt = hass.states[e.battery_time_empty];
  let emptyMin = num(hass, e.battery_time_empty);
  const unit = emptyEnt?.attributes?.unit_of_measurement;
  if (emptyMin !== null && unit === "s") emptyMin /= 60;
  if (emptyMin !== null && unit === "h") emptyMin *= 60;
  const custom = names?.[c.id] ?? names?.[String(c.id)];
  const name = custom || (index === 0 && cap > 0 ? "Main grid" : `Circuit ${c.id}`);
  return {
    id: c.id, e, name, cap, used, max, fuse, noPower, dead: fuse || noPower,
    load: load !== null ? load / 100 : cap ? used / cap : 0,
    battPct, battCap, emptyMin, draining: isOn(hass, e.battery_draining),
  };
}
const fmtMinutes = (m) => (m === null ? "" : m >= 90 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`);

// ------------------------------------------------------------------ navigation
function sfrmNavigate(path) {
  const base = window.location.pathname.split("/").slice(0, 2).join("/");
  window.history.pushState(null, "", `${base}/${path}`);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
}

// ------------------------------------------------------------------ base card
class SfrmBase extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    this._dirty();
  }
  set hass(hass) {
    this._hass = hass;
    this._dirty();
  }
  get hass() {
    return this._hass;
  }
  connectedCallback() {
    this._connected = true;
    clearInterval(this._tick);
    this._tick = setInterval(() => this._dirty(), 10000);
    this._dirty();
  }
  disconnectedCallback() {
    this._connected = false;
    clearInterval(this._tick);
    unlisten(this);
  }
  getCardSize() {
    return 6;
  }
  _dirty() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._render();
    });
  }
  _render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>${BASE_CSS}${this.css ? this.css() : ""}</style><div class="root"></div>`;
      this._root = this.shadowRoot.querySelector(".root");
      this.shadowRoot.addEventListener("click", (e) => {
        const el = e.target.closest("[data-act]");
        if (el && !el.disabled) this._act(el.dataset.act, el.dataset.arg, el, e);
      });
    }
    const srv = discover(this._hass, this._config.server);
    let html;
    if (!srv) {
      html = `<div class="panel"><div class="empty">${this._config.server ? `No Satisfactory server called “${esc(this._config.server)}”.` : "No Satisfactory server is set up yet."}</div></div>`;
    } else {
      try {
        html = this.view(srv);
      } catch (err) {
        console.error("SFRM card error", err);
        html = `<div class="panel"><div class="empty">Couldn't draw this card: ${esc(err.message)}</div></div>`;
      }
    }
    if (this._config.standalone !== false && !this._inPage) html = `<div class="standalone">${html}</div>`;
    if (this._confirm) {
      html += `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="box"><div class="stripe"></div>
        <h3 id="mt">${esc(this._confirm.title)}</h3><p>${esc(this._confirm.body)}</p>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="confirm-cancel">CANCEL</button>
        <button class="btn solid" data-act="confirm-ok">${esc(this._confirm.ok || "CONFIRM")}</button></div></div></div>`;
    }
    if (this._toastMsg) html += `<div class="toast" role="status">${esc(this._toastMsg)}</div>`;
    morph(this._root, html);
  }
  _act(act, arg, el, e) {
    if (act === "confirm-cancel") { this._confirm = null; this._dirty(); return; }
    if (act === "confirm-ok") { const c = this._confirm; this._confirm = null; this._dirty(); c?.run?.(); return; }
    if (act === "nav") { sfrmNavigate(arg); return; }
    if (act === "more") { this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: arg } })); return; }
    this.act?.(act, arg, el, e);
  }
  confirm(title, body, ok, run) {
    this._confirm = { title, body, ok, run };
    this._dirty();
  }
  toast(msg) {
    this._toastMsg = msg;
    this._dirty();
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { this._toastMsg = null; this._dirty(); }, Math.max(3000, msg.length * 60));
  }
  async service(domain, service, entity_id, after) {
    try {
      await this._hass.callService(domain, service, { entity_id });
    } catch (err) {
      if (this._pend) delete this._pend[entity_id]; // show the real state, not the hoped-for one
      this.toast(err.message || String(err));
    } finally {
      after?.();
      this._dirty();
    }
  }
  // Optimistic switch states while a command is in flight.
  pending(entity, value) {
    this._pend = this._pend || {};
    if (value !== undefined) {
      this._pend[entity] = { value, until: Date.now() + 8000 };
      this._dirty();
    }
    const p = this._pend[entity];
    return p && p.until > Date.now() ? p.value : undefined;
  }
}

// ================================================================== header
class SfrmHeaderCard extends SfrmBase {
  getCardSize() { return 2; }
  css() {
    return `.hdr{display:flex;flex-wrap:wrap;align-items:center;gap:16px 24px;padding:12px 16px}
      .brand{display:flex;align-items:center;gap:12px;flex:1 1 240px;min-width:0}
      .nav{display:flex;flex-wrap:wrap;gap:6px}
      .nav button{text-decoration:none;padding:0 14px;min-height:44px;border-radius:6px;font-size:13px;font-weight:600;letter-spacing:.12em;color:#b6c0ce;border:1px solid #2a3240;background:transparent;cursor:pointer;transition:background .2s,color .2s}
      .nav button:hover{background:#232b37;color:#fff}
      .nav button[aria-current="page"]{background:${COL.orange};color:#14100a;border-color:${COL.orange}}
      .lamps{display:flex;gap:14px}
      .lampc{display:flex;flex-direction:column;align-items:center;gap:5px}
      .clock{background:${COL.deep};border:1px solid ${COL.line};border-radius:6px;padding:6px 12px;text-align:right}`;
  }
  view(srv) {
    const h = this._hass, s = srv.s, c = this._config;
    const reach = isOn(h, s.reachable), ready = isOn(h, s.world_ready), paused = isOn(h, s.paused);
    const lamp = (on, warn, label, text) => {
      const col = on ? (warn ? COL.amber : COL.green) : COL.red;
      return `<div class="lampc" role="img" aria-label="${esc(label)}: ${esc(text)}"><span class="lamp" style="width:12px;height:12px;background:${col};box-shadow:0 0 10px ${col}"></span><span class="lbl">${esc(text)}</span></div>`;
    };
    const time = h.states[s.game_time]?.state;
    const day = num(h, s.game_day);
    const nav = (c.nav || [])
      .map((n) => `<button data-act="nav" data-arg="${esc(n.path)}" ${n.page === c.page ? 'aria-current="page"' : ""}>${esc(n.label.toUpperCase())}</button>`)
      .join("");
    const save = h.states[s.session_name]?.state;
    return `<header class="panel hdr">
      <div class="brand">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><path fill="${COL.orange}" d="${LOGO}"></path></svg>
        <div style="min-width:0"><div style="font-size:12px;letter-spacing:.22em;color:${COL.orange};font-weight:600">SFRM CONTROL ROOM</div>
          <div style="font-size:22px;font-weight:700;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.title || srv.name)}</div>
          ${save && save !== "unavailable" && save !== srv.name ? `<div class="lbl">SAVE · ${esc(save)}</div>` : ""}</div>
      </div>
      ${nav ? `<nav class="nav" aria-label="Control room views">${nav}</nav>` : ""}
      <div class="row" style="gap:18px">
        <div class="lamps">
          ${lamp(reach, false, "Server", reach ? "SERVER" : "OFFLINE")}
          ${lamp(ready, false, "World", ready ? "WORLD" : "LOADING")}
          ${lamp(ready && reach, paused, "Game", paused ? "PAUSED" : "RUNNING")}
        </div>
        <div class="clock" role="group" aria-label="In-game clock">
          <div class="lbl">${day !== null ? `DAY ${day}` : "IN-GAME"}</div>
          <div class="mono" style="font-size:24px;font-weight:700;color:${COL.cyan};text-shadow:0 0 12px rgba(90,209,230,.55);line-height:1">${esc(time && time !== "unavailable" && time !== "unknown" ? time : "--:--")}</div>
        </div>
      </div>
    </header>`;
  }
}

// ================================================================== alarms
class SfrmAlarmsCard extends SfrmBase {
  css() {
    return `.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
      .tile{text-align:left;cursor:pointer;min-height:92px;border-radius:8px;padding:12px;border:0;display:flex;flex-direction:column;justify-content:space-between;gap:8px;transition:background .25s,box-shadow .25s}
      .tile:hover{filter:brightness(1.15)}`;
  }
  async _loadAcks(srv) {
    if (this._ackLoaded === srv.entryId) return;
    this._ackLoaded = srv.entryId;
    this._acks = {};
    try {
      const r = await this._hass.callWS({ type: "frontend/get_user_data", key: `sfrm_ack_${srv.entryId}` });
      this._acks = r?.value || {};
    } catch (e) {
      try { this._acks = JSON.parse(localStorage.getItem(`sfrm_ack_${srv.entryId}`) || "{}"); } catch (_) { this._acks = {}; }
    }
    this._dirty();
  }
  _saveAcks() {
    const key = `sfrm_ack_${this._srvId}`;
    this._hass.callWS({ type: "frontend/set_user_data", key, value: this._acks }).catch(() => {});
    try { localStorage.setItem(key, JSON.stringify(this._acks)); } catch (_) {}
  }
  tiles(srv) {
    const h = this._hass, s = srv.s;
    const circuits = srv.circuits.map((c, i) => circuitModel(h, c, this._config.circuit_names, i));
    const reach = isOn(h, s.reachable), ready = isOn(h, s.world_ready);
    const fuses = circuits.filter((c) => c.fuse);
    const dead = circuits.filter((c) => c.noPower && !c.fuse);
    const drain = circuits.filter((c) => c.draining && c.battPct !== null);
    const hot = circuits.filter((c) => !c.dead && c.load >= 0.9);
    const idle = num(h, srv.factory.machines_idle) ?? 0;
    const prod = productionFeed(h, srv, this);
    const shorts = (prod?.items || [])
      .filter((i) => i.produced - i.consumed < -0.05)
      .sort((a, b) => (a.produced - a.consumed) - (b.produced - b.consumed));
    const list = (arr, fn) => arr.slice(0, 2).map(fn).join(", ") + (arr.length > 2 ? ` +${arr.length - 2} more` : "");
    return [
      { id: "link", label: "SERVER LINK", level: "alarm", active: !reach, sub: reach ? "FRM online" : "FRM unreachable", sig: "link" },
      { id: "world", label: "WORLD LOAD", level: "alarm", active: reach && !ready, sub: ready ? "World ready" : "World not ready", sig: "world" },
      { id: "fuse", label: "FUSE TRIPPED", level: "alarm", active: fuses.length > 0,
        sub: fuses.length ? list(fuses, (c) => `${c.name}${c.max ? ` · ${Math.round(c.max)} MW waiting` : ""}`) : "All fuses OK",
        sig: fuses.map((c) => c.id).join(",") },
      { id: "nopower", label: "NO POWER", level: "alarm", active: dead.length > 0,
        sub: dead.length ? list(dead, (c) => `${c.name} · generators stopped`) : "All grids generating", sig: dead.map((c) => c.id).join(",") },
      { id: "load", label: "GRID LOAD", level: "warn", active: hot.length > 0,
        sub: hot.length ? list(hot, (c) => `${c.name} at ${Math.round(c.load * 100)}%`) : "Load normal", sig: hot.map((c) => c.id).join(",") },
      { id: "batt", label: "BATTERIES", level: "warn", active: drain.length > 0,
        sub: drain.length ? list(drain, (c) => `${c.name} draining${c.emptyMin !== null ? ` · ${fmtMinutes(c.emptyMin)} left` : ""}`) : circuits.some((c) => c.battPct !== null) ? "Charging or idle" : "No batteries built",
        sig: drain.map((c) => c.id).join(",") },
      { id: "short", label: "SHORTFALL", level: "warn", active: shorts.length > 0,
        sub: shorts.length ? list(shorts, (i) => `${i.name} ${signed(i.produced - i.consumed)}/min`) : "No shortfalls", sig: shorts.map((i) => i.key).join(",") },
      { id: "idle", label: "MACHINES IDLE", level: "warn", active: idle > 0,
        sub: idle > 0 ? `${idle} waiting on input` : "All machines busy", sig: idle > 0 ? "idle" : "" },
    ];
  }
  view(srv) {
    this._srvId = srv.entryId;
    this._loadAcks(srv);
    const tiles = this.tiles(srv);
    this._tiles = tiles;
    const acks = this._acks || {};
    const active = tiles.filter((t) => t.active);
    const unacked = active.filter((t) => acks[t.id] !== t.sig);
    const body = tiles.map((t) => {
      const isAck = acks[t.id] === t.sig, alarm = t.level === "alarm";
      let bg = "#11161d", bd = "#232b37", fg = "#7d8899", lamp = "#2c3442", sfg = "#8a95a6", anim = "", state = "NORMAL";
      if (t.active) {
        bg = alarm ? "#3a1416" : "#33270f"; bd = alarm ? "#ff6b5e" : COL.amber; fg = "#fff";
        lamp = alarm ? COL.red : COL.amber; sfg = alarm ? "#ffc9c4" : "#fbe2b0";
        anim = isAck ? "" : alarm ? "blink" : "blinkw";
        state = isAck ? "ACKNOWLEDGED" : "ACTIVE · TAP TO ACKNOWLEDGE";
      }
      return `<button class="tile ${anim}" data-act="ack" data-arg="${t.id}" aria-label="${esc(`${t.label}: ${t.sub}. ${t.active ? (isAck ? "Active, acknowledged" : "Active, press to acknowledge") : "Normal"}`)}"
        style="background:${bg};color:${fg};box-shadow:0 0 0 1px ${bd} inset">
        <span class="row" style="gap:8px;flex-wrap:nowrap"><span style="font-size:14px;font-weight:700;letter-spacing:.1em">${t.label}</span>
          <span class="lamp" style="background:${lamp};box-shadow:0 0 8px ${lamp}"></span></span>
        <span style="font-size:12px;color:${sfg}">${esc(t.sub)}</span>
        <span style="font-size:10px;letter-spacing:.16em;color:${sfg}">${state}</span></button>`;
    }).join("");
    return `<section class="panel" aria-label="Alarm panel">
      <div class="row" style="margin-bottom:12px">
        <div><h2 class="t">ALARM PANEL</h2><div class="sub" style="margin-top:2px">${active.length ? `${active.length} active · ${unacked.length ? `${unacked.length} unacknowledged` : "all acknowledged"}` : "All systems normal"}</div></div>
        ${unacked.length ? `<button class="btn" data-act="ackall">ACKNOWLEDGE ALL</button>` : ""}
      </div>
      <div class="tiles">${body}</div></section>`;
  }
  act(act, arg) {
    const tiles = this._tiles || [];
    this._acks = this._acks || {};
    if (act === "ack") {
      const t = tiles.find((x) => x.id === arg);
      if (!t || !t.active) return;
      this._acks[t.id] = t.sig;
    } else if (act === "ackall") {
      tiles.filter((t) => t.active).forEach((t) => (this._acks[t.id] = t.sig));
    } else return;
    this._saveAcks();
    this._dirty();
  }
}

// ================================================================== factory status
class SfrmStatusCard extends SfrmBase {
  getCardSize() { return 4; }
  view(srv) {
    const h = this._hass, f = srv.factory, s = srv.s;
    const prodPct = num(h, f.avg_productivity);
    const p = num(h, f.machines_producing) ?? 0, i = num(h, f.machines_idle) ?? 0, st = num(h, f.machines_paused) ?? 0;
    const np = srv.buildings.filter((b) => b.state === "no_power").length;
    const idle = Math.max(0, i - np);
    const total = Math.max(1, p + i + st);
    const seg = (n, col) => `<span class="grow" style="width:${((n / total) * 100).toFixed(1)}%;background:${col}"></span>`;
    const playH = num(h, s.play_time);
    const playTxt = playH === null ? "–" : `${Math.floor(playH)}h ${String(Math.round((playH % 1) * 60)).padStart(2, "0")}m`;
    const death = num(h, s.days_since_death);
    const box = (label, val, col) => `<div class="well" style="padding:10px"><div class="lbl">${label}</div><div class="mono" style="font-size:24px;font-weight:700;color:${col}">${val}</div></div>`;
    return `<section class="panel" aria-label="Factory status" style="display:flex;flex-direction:column;gap:14px;height:100%">
      <h2 class="t">FACTORY STATUS</h2>
      <div style="display:flex;align-items:baseline;gap:10px">
        <span class="mono" style="font-size:48px;font-weight:700;color:${COL.cyan};text-shadow:0 0 14px rgba(90,209,230,.45);line-height:1">${prodPct === null ? "–" : prodPct.toFixed(1)}%</span>
        <span class="sub">average<br>productivity</span></div>
      <div role="img" aria-label="${p} producing, ${idle} idle, ${np} without power, ${st} in standby" style="display:flex;height:14px;border-radius:4px;overflow:hidden;background:${COL.deep};border:1px solid ${COL.line}">
        ${seg(p, COL.cyan)}${seg(idle, COL.amber)}${seg(np, COL.red)}${seg(st, "#5a6577")}</div>
      <div style="display:grid;grid-template-columns:repeat(${np ? 2 : 3},minmax(0,1fr));gap:8px">
        ${box("PRODUCING", p, COL.cyan)}${box("IDLE", idle, COL.amber)}${np ? box("NO POWER", np, "#ff8a80") : ""}${box("STANDBY", st, "#b6c0ce")}</div>
      <div class="row" style="font-size:12px;color:${COL.dim};border-top:1px solid ${COL.line2};padding-top:12px;margin-top:auto">
        <span>PLAY TIME <b class="mono" style="color:${COL.text}">${playTxt}</b></span>
        <span>SINCE LAST DEATH <b class="mono" style="color:${COL.text}">${death === null ? "–" : `${death} days`}</b></span></div>
    </section>`;
  }
}

// ================================================================== power dials (compact)
class SfrmGridCard extends SfrmBase {
  view(srv) {
    const h = this._hass;
    const cs = srv.circuits.map((c, i) => circuitModel(h, c, this._config.circuit_names, i));
    const prodT = cs.reduce((n, c) => n + (c.dead ? 0 : c.used), 0);
    const capT = cs.reduce((n, c) => n + (c.dead ? 0 : c.cap), 0);
    const target = this._config.power_path;
    const body = cs.map((c) => {
      const color = gaugeColor(c.load, c.dead);
      const read = c.dead ? "0 MW" : `${Math.round(c.load * 100)}%`;
      const cap = c.fuse ? `${Math.round(c.max)} MW waiting for power` : c.noPower ? "No generation" : `${f1(c.used)} of ${f1(c.cap)} MW`;
      const tag = target ? "button" : "div";
      return `<${tag} class="well" ${target ? `data-act="nav" data-arg="${esc(target)}"` : ""} aria-label="${esc(`${c.name}: ${c.dead ? "no power" : `${Math.round(c.load * 100)} percent load`}`)}"
        style="padding:14px;display:flex;flex-direction:column;align-items:center;gap:4px;border-color:${c.dead ? "#6e2a26" : COL.line2};${target ? "cursor:pointer;text-align:center;" : ""}">
        <div class="row" style="width:100%;flex-wrap:nowrap"><span style="font-size:15px;font-weight:700;letter-spacing:.06em">${esc(c.name)}</span><span class="mono lbl">C${c.id}</span></div>
        ${gaugeSvg(c.load, c.dead, 280)}
        <div class="mono" style="font-size:30px;font-weight:700;color:${c.dead ? "#ff7a70" : color};margin-top:-18px">${read}</div>
        <div style="font-size:12px;color:${COL.dim};letter-spacing:.08em">${esc(cap)}</div>
        ${c.fuse ? `<div class="hazard" style="width:100%;margin-top:6px">FUSE TRIPPED: RESET IN GAME</div>` : c.noPower ? `<div class="hazard amber" style="width:100%;margin-top:6px">NO POWER: CHECK GENERATORS</div>` : ""}
      </${tag}>`;
    }).join("");
    return `<section class="panel" aria-label="Power grids">
      <div class="row" style="margin-bottom:8px"><h2 class="t">POWER GRIDS</h2>
        <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:12px;color:${COL.dim}">
          <span>GENERATING <b class="mono" style="color:${COL.text};font-size:15px">${f1(prodT)} MW</b></span>
          <span>CAPACITY <b class="mono" style="color:${COL.text};font-size:15px">${f1(capT)} MW</b></span>
          <span>HEADROOM <b class="mono" style="color:${COL.cyan};font-size:15px">${f1(capT - prodT)} MW</b></span></div></div>
      ${cs.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">${body}</div>` : `<div class="empty">No power circuits in this save yet.</div>`}
    </section>`;
  }
}

// ================================================================== power (full panels)
class SfrmPowerCard extends SfrmBase {
  view(srv) {
    const h = this._hass;
    const cs = srv.circuits.map((c, i) => circuitModel(h, c, this._config.circuit_names, i));
    const hist = historyFeed(h, cs.map((c) => c.e.power_load), 2, this);
    const gens = layerFeed(h, srv, "generators", this) || [];
    const gensBy = {};
    for (const g of gens) {
      const cid = g.PowerInfo?.CircuitGroupID;
      if (cid === undefined || cid === null) continue;
      (gensBy[cid] = gensBy[cid] || {})[g.Name || "Generator"] = ((gensBy[cid] || {})[g.Name || "Generator"] || 0) + 1;
    }
    const panels = cs.map((c) => {
      const color = gaugeColor(c.load, c.dead);
      const gtxt = gensBy[c.id] ? Object.entries(gensBy[c.id]).map(([n, k]) => `${k} ${n}${k > 1 ? "s" : ""}`).join(" · ").toUpperCase() : c.cap > 0 ? "" : "NO GENERATION";
      const brk = c.fuse
        ? { top: 28, col: COL.red, glow: "rgba(255,90,78,.6)", txt: "#ff8a80", label: "FUSE TRIPPED" }
        : { top: 6, col: COL.green, glow: "rgba(87,212,138,.45)", txt: "#8fe3b0", label: "BREAKER CLOSED" };
      const samples = hist[c.e.power_load];
      const line = sparkPointsFixed(samples, 300, 60, c.dead ? 0 : c.load * 100);
      const stat = (k, v, col = COL.text) => `<div class="well" style="padding:8px 10px;border-radius:6px"><dt class="lbl">${k}</dt><dd class="mono" style="margin:2px 0 0;font-size:18px;font-weight:700;color:${col}">${v}</dd></div>`;
      const head = c.dead ? 0 : c.cap - c.used;
      return `<section class="panel" aria-label="${esc(c.name)}" style="display:flex;flex-direction:column;gap:14px;border-color:${c.dead ? "#6e2a26" : COL.line}">
        <div class="row" style="flex-wrap:nowrap">
          <div style="min-width:0"><h2 style="margin:0;font-size:20px;font-weight:700;letter-spacing:.04em">${esc(c.name)}</h2>
            <div class="lbl">CIRCUIT ${c.id}${gtxt ? ` · ${esc(gtxt)}` : ""}</div></div>
          <div role="img" aria-label="${c.fuse ? "Breaker tripped" : "Breaker closed"}" style="display:flex;align-items:center;gap:10px;flex:none">
            <div style="width:34px;height:56px;border-radius:6px;background:${COL.deep};border:1px solid #2a3240;position:relative">
              <div class="grow" style="position:absolute;left:6px;right:6px;height:22px;border-radius:3px;top:${brk.top}px;background:${brk.col};box-shadow:0 0 10px ${brk.glow};transition:top .4s cubic-bezier(.34,1.56,.64,1)"></div></div>
            <div style="font-size:11px;letter-spacing:.14em;color:${brk.txt};font-weight:700;width:70px">${brk.label}</div></div>
        </div>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <div style="flex:1 1 200px;display:flex;flex-direction:column;align-items:center">
            ${gaugeSvg(c.load, c.dead, 250)}
            <div class="mono" style="font-size:34px;font-weight:700;color:${c.dead ? "#ff7a70" : color};margin-top:-20px">${c.fuse ? "TRIPPED" : c.noPower ? "NO POWER" : `${Math.round(c.load * 100)}%`}</div>
            <div class="lbl">LOAD</div></div>
          <div role="img" aria-label="${c.battPct === null ? "No batteries on this circuit" : `Batteries ${Math.round(c.battPct)} percent`}" style="flex:0 0 86px;display:flex;flex-direction:column;align-items:center;gap:6px">
            <div style="width:14px;height:6px;background:#2a3240;border-radius:2px 2px 0 0"></div>
            <div style="width:58px;height:120px;border:2px solid #2f3846;border-radius:8px;background:${COL.deep};position:relative;overflow:hidden">
              <div class="grow" style="position:absolute;left:0;right:0;bottom:0;height:${c.battPct ?? 0}%;background:linear-gradient(${COL.cyan},#1f8ea1)"></div>
              <div style="position:absolute;inset:0;background:repeating-linear-gradient(to top,transparent 0 23px,rgba(11,14,19,.85) 23px 24px)"></div></div>
            <div style="font-size:11px;letter-spacing:.1em;color:${COL.dim};text-align:center">${c.battPct === null ? "NO BATTERIES" : `${Math.round(c.battPct)}%${c.draining && c.emptyMin !== null ? ` · ${fmtMinutes(c.emptyMin)}` : ""}`}</div></div>
        </div>
        ${c.fuse ? `<div class="hazard">FUSE TRIPPED · ${Math.round(c.max)} MW OF MACHINES WAITING · RESET IN GAME</div>` : c.noPower ? `<div class="hazard amber">NO POWER · GENERATORS NOT RUNNING · CHECK FUEL AND WATER</div>` : ""}
        <dl style="margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
          ${stat("PRODUCING", `${f1(c.dead ? 0 : c.used)} MW`)}${stat("CAPACITY", `${f1(c.dead ? 0 : c.cap)} MW`)}
          ${stat("MAX DEMAND", `${f1(c.max)} MW`)}${stat("HEADROOM", `${f1(head)} MW`, head < c.max - c.used ? COL.amber : COL.cyan)}</dl>
        <div><div class="row lbl" style="margin-bottom:4px"><span>LOAD · LAST 2 HOURS</span><span>100%</span></div>
          <svg viewBox="0 0 300 60" preserveAspectRatio="none" style="width:100%;height:60px;background:${COL.deep};border:1px solid ${COL.line2};border-radius:6px;display:block" aria-hidden="true">
            <line x1="0" y1="6" x2="300" y2="6" stroke="#3a2a1a" stroke-dasharray="4 4"></line>
            ${line ? `<polygon points="0,60 ${line} 300,60" fill="${c.dead ? "rgba(255,90,78,.14)" : "rgba(90,209,230,.14)"}"></polygon><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>` : ""}
          </svg>${line ? "" : `<div class="lbl" style="margin-top:4px">Collecting history…</div>`}</div>
      </section>`;
    }).join("");
    return cs.length
      ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px">${panels}</div>`
      : `<div class="panel"><div class="empty">No power circuits in this save yet.</div></div>`;
  }
}
// Fixed-scale (0–100) version of sparkPoints for load history.
function sparkPointsFixed(samples, w, h, current) {
  const pts = (samples || []).slice(-120);
  if (current !== null && current !== undefined) pts.push([Date.now(), current]);
  if (pts.length < 2) return null;
  const t1 = Date.now(), t0 = t1 - 2 * 3600e3;
  return pts
    .map(([t, v]) => `${Math.max(0, ((t - t0) / (t1 - t0)) * w).toFixed(1)},${(h - (Math.max(0, Math.min(110, v)) / 110) * h).toFixed(1)}`)
    .join(" ");
}

// ================================================================== generator bank
class SfrmGeneratorsCard extends SfrmBase {
  view(srv) {
    const h = this._hass;
    this._srvEntry = srv.entryId;
    const gens = layerFeed(h, srv, "generators", this);
    const info = infoFeed(h, srv, this);
    if (gens === undefined) return `<section class="panel"><h2 class="t">GENERATOR BANK</h2><div class="empty">Loading generators…</div></section>`;
    const names = {};
    const rows = [...gens]
      .sort((a, b) => String(a.Name).localeCompare(String(b.Name)) || String(a.ID).localeCompare(String(b.ID), undefined, { numeric: true }))
      .map((g) => {
        const short = String(g.Name || "Generator").replace(/-Powered Generator$/i, " Generator").replace(/^Fuel /, "Fuel ");
        names[short] = (names[short] || 0) + 1;
        const entity = info?.building_entities?.[g.ID] || srv.buildingSwitch[g.ID];
        const pend = entity ? this.pending(entity) : undefined;
        const entState = entity ? this._hass.states[entity]?.state : undefined;
        const on = pend !== undefined ? pend : entState === "on" || entState === "off" ? entState === "on" : !g.IsPaused;
        const base = Number(g.BaseProd) || 0;
        const outMw = Number(g.PowerProduction ?? g.CurrentPowerProduction ?? (on && g.IsFullSpeed ? base : 0)) || 0;
        const outPct = base ? Math.min(100, (outMw / base) * 100) : on && g.IsFullSpeed ? 100 : 0;
        const status = !on ? "STANDBY" : g.IsFullSpeed ? "RUNNING" : g.CanStart === false ? "NO FUEL" : "LOW INPUT";
        const sc = { STANDBY: COL.dim, RUNNING: "#8fe3b0", "NO FUEL": "#ff8a80", "LOW INPUT": COL.amber }[status];
        const label = `${short} ${names[short]}`;
        const fuel = g.FuelAmount;
        return `<div class="well" style="padding:12px;display:flex;flex-direction:column;gap:10px;border-color:${status === "LOW INPUT" ? "#6b5224" : status === "NO FUEL" ? "#6e2a26" : COL.line2}">
          <div class="row" style="flex-wrap:nowrap;gap:8px">
            <div style="min-width:0"><div style="font-size:14px;font-weight:700;line-height:1.2">${esc(label)}</div>
              <div style="font-size:11px;letter-spacing:.12em;color:${sc};font-weight:700">${status}</div></div>
            <button class="rocker" ${entity ? `data-act="gen" data-arg="${esc(entity)}" data-name="${esc(label)}" data-mw="${base}" data-on="${on ? 1 : 0}"` : "disabled"} aria-pressed="${on}"
              aria-label="${esc(`${label}: ${on ? "running" : "standby"}. ${entity ? `Press to ${on ? "put on standby" : "run"}.` : "Turn on building entities to control it."}`)}"
              style="background:${on ? "#16404a" : "#2a2f38"}"><span class="k" style="background:${on ? COL.cyan : "#6d7686"};transform:translateX(${on ? 10 : -2}px)"></span></button>
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:${COL.dim}">
            <span style="width:48px;letter-spacing:.1em">OUTPUT</span>
            <span style="flex:1;height:6px;background:${COL.deep};border-radius:3px;overflow:hidden"><span class="grow" style="display:block;height:100%;width:${outPct.toFixed(0)}%;background:${COL.cyan}"></span></span>
            <span class="mono" style="color:${COL.text};width:52px;text-align:right">${outMw.toFixed(0)} MW</span></div>
          ${fuel !== undefined && fuel !== null ? `<div class="lbl">FUEL <span class="mono" style="color:${COL.text2}">${esc(typeof fuel === "number" ? fuel.toFixed(1) : fuel)}</span></div>` : ""}
        </div>`;
      });
    const genOn = (g) => {
      const ent = info?.building_entities?.[g.ID] || srv.buildingSwitch[g.ID];
      const st = ent ? this._hass.states[ent]?.state : undefined;
      return st === "on" || st === "off" ? st === "on" : !g.IsPaused;
    };
    const running = gens.filter(genOn).length;
    const low = gens.filter((g) => genOn(g) && !g.IsFullSpeed).length;
    return `<section class="panel" aria-label="Generator bank">
      <div class="row" style="margin-bottom:12px"><h2 class="t">GENERATOR BANK</h2>
        <div class="sub">${gens.length ? `${running} of ${gens.length} running${low ? ` · ${low} below full output` : ""}` : ""}</div></div>
      ${gens.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px">${rows.join("")}</div>` : `<div class="empty">No generators in this save.</div>`}
    </section>`;
  }
  act(act, arg, el) {
    if (act !== "gen") return;
    const on = el.dataset.on === "1";
    const refresh = () => invalidate(`layer:${this._srvEntry}:generators`);
    if (!on) {
      this.pending(arg, true);
      this.service("switch", "turn_on", arg, refresh);
      return;
    }
    const mw = Number(el.dataset.mw) || 0;
    this.confirm(`Put ${el.dataset.name} on standby?`,
      `It stops producing and burns no fuel.${mw ? ` Its grid loses up to ${mw} MW of capacity.` : ""} You can run it again from here at any time.`,
      "STANDBY", () => { this.pending(arg, false); this.service("switch", "turn_off", arg, refresh); });
  }
}

// ================================================================== watchlist
class SfrmWatchlistCard extends SfrmBase {
  view(srv) {
    const h = this._hass;
    const prod = productionFeed(h, srv, this);
    const n = this._config.count || 5;
    const items = (prod?.items || []).filter((i) => i.is_produced || i.max_consumed > 0).map((i) => ({ ...i, net: i.produced - i.consumed }));
    const shorts = items.filter((i) => i.net < -0.05).sort((a, b) => a.net - b.net);
    const plus = items.filter((i) => i.net > 0.05).sort((a, b) => b.net - a.net);
    const pick = [...shorts, ...plus].slice(0, n);
    const hist = historyFeed(h, pick.map((i) => i.net_entity), 2, this);
    const target = this._config.production_path;
    const cards = pick.map((i) => {
      const short = i.net < 0;
      const col = short ? COL.short : COL.cyan;
      const spark = sparkPoints(hist[i.net_entity], 120, 28, i.net);
      return `<div class="well" style="padding:12px;display:flex;flex-direction:column;gap:6px;min-width:0;border-color:${short ? "#6b4019" : COL.line2}">
        <div class="row" style="flex-wrap:nowrap;gap:6px;align-items:baseline"><span style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.name)}</span>
          <span style="font-size:10px;letter-spacing:.14em;color:${short ? COL.short : "#7fdcec"};font-weight:700">${short ? "SHORT" : "SURPLUS"}</span></div>
        <div class="mono" style="font-size:26px;font-weight:700;color:${col}">${signed(i.net)}</div>
        <div style="font-size:11px;color:${COL.dim}">per min · made ${f1(i.produced)} · used ${f1(i.consumed)}</div>
        ${spark ? `<svg viewBox="0 0 120 28" style="width:100%;height:28px" aria-hidden="true"><polyline points="${spark}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"></polyline></svg>` : ""}
      </div>`;
    }).join("");
    return `<section class="panel" aria-label="Production watchlist">
      <div class="row" style="margin-bottom:12px"><h2 class="t">WATCHLIST</h2>
        ${target ? `<button class="btn" data-act="nav" data-arg="${esc(target)}" style="border:0">ALL PRODUCTION →</button>` : ""}</div>
      ${prod === undefined ? `<div class="empty">Loading production…</div>` : pick.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">${cards}</div>` : `<div class="empty">Every product is balanced right now.</div>`}
    </section>`;
  }
}

// ================================================================== production levers
class SfrmLeversCard extends SfrmBase {
  css() {
    return `.levers{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px}
      .lever{cursor:pointer;background:${COL.well};border-radius:10px;padding:12px 8px;display:flex;flex-direction:column;align-items:center;gap:10px;min-height:230px;transition:filter .2s}
      .lever:hover{filter:brightness(1.18)}
      .lever:disabled{cursor:not-allowed;opacity:.55}
      .slot{position:relative;width:26px;height:108px;border-radius:13px;background:${COL.deep};box-shadow:inset 0 0 0 1px #2a3240,inset 0 6px 10px rgba(0,0,0,.6)}
      .handle{position:absolute;left:-9px;top:0;width:44px;height:30px;border-radius:8px;box-shadow:0 3px 8px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.35);transition:transform .45s cubic-bezier(.34,1.56,.64,1)}
      @media (prefers-reduced-motion: reduce){.handle{transition:none}}`;
  }
  view(srv) {
    const h = this._hass;
    const counts = {};
    for (const b of srv.buildings) {
      const r = b.a.recipe || "Unconfigured";
      const c = (counts[r] = counts[r] || { producing: 0, idle: 0, paused: 0, no_power: 0, not_configured: 0, total: 0 });
      c[b.state] = (c[b.state] || 0) + 1;
      c.total++;
    }
    const lines = srv.lines.filter((l) => this._config.show_idle !== false || l.total > 0);
    const body = lines.map((l) => {
      const pend = this.pending(l.entity);
      const on = pend !== undefined ? pend : l.on;
      const c = counts[l.recipe] || {};
      const problem = (c.idle || 0) + (c.no_power || 0);
      const state = !l.available ? "OFFLINE" : !on ? "STANDBY" : c.no_power ? "NO POWER" : problem ? "PARTIAL" : "RUNNING";
      const lamp = { OFFLINE: COL.grey, STANDBY: COL.grey, "NO POWER": COL.red, PARTIAL: COL.amber, RUNNING: COL.green }[state];
      const lampText = { OFFLINE: COL.dim, STANDBY: COL.dim, "NO POWER": "#ff8a80", PARTIAL: "#f5c96b", RUNNING: "#8fe3b0" }[state];
      const frame = { OFFLINE: COL.line2, STANDBY: COL.line2, "NO POWER": "#6e2a26", PARTIAL: "#4d3c1c", RUNNING: "#1f3a2c" }[state];
      const types = l.types.length === 1 ? l.types[0] : "building";
      const detail = `${l.total} × ${types} · ${c.producing ?? l.running} producing`;
      return `<button class="lever" data-act="lever" data-arg="${esc(l.entity)}" data-on="${on ? 1 : 0}" data-recipe="${esc(l.recipe)}" data-n="${l.total}" data-types="${esc(types)}"
        ${l.available ? "" : "disabled"} aria-pressed="${on}" aria-label="${esc(`${l.recipe} line, ${detail}, ${state.toLowerCase()}. Press to ${on ? "stop" : "start"} the line.`)}" style="border:1px solid ${frame}">
        <span style="display:flex;align-items:center;gap:6px"><span class="lamp" style="background:${lamp};box-shadow:0 0 8px ${lamp}"></span>
          <span style="font-size:10px;letter-spacing:.14em;color:${lampText};font-weight:700">${state}</span></span>
        <span class="slot" aria-hidden="true"><span style="position:absolute;left:11px;top:10px;bottom:10px;width:4px;border-radius:2px;background:#1b222c"></span>
          <span class="handle" style="background:${on ? "linear-gradient(#ffb766,#f99b38)" : "linear-gradient(#8a93a3,#5d6676)"};transform:translateY(${on ? 6 : 72}px)">
            <span style="position:absolute;left:8px;right:8px;top:13px;height:3px;border-radius:2px;background:rgba(20,16,10,.45)"></span></span></span>
        <span style="font-size:13px;font-weight:700;text-align:center;line-height:1.2">${esc(l.recipe)}</span>
        <span style="font-size:11px;color:${COL.dim};text-align:center">${esc(detail)}</span>
      </button>`;
    }).join("");
    const running = lines.filter((l) => (this.pending(l.entity) ?? l.on)).length;
    return `<section class="panel" aria-label="Production line levers">
      <div class="row" style="margin-bottom:14px"><div><h2 class="t">LINE CONTROL</h2>
        <div class="sub" style="margin-top:2px">Lever up runs every machine on that recipe. Down puts them on standby, so they draw no power.</div></div>
        <div class="mono" style="font-size:14px;color:${COL.text2}">${running}/${lines.length} LINES RUNNING</div></div>
      ${lines.length ? `<div class="levers">${body}</div>` : `<div class="empty">No production lines yet. Turn on <b>Create building entities</b> in the integration's options.</div>`}
    </section>`;
  }
  act(act, arg, el) {
    if (act !== "lever") return;
    const on = el.dataset.on === "1";
    if (!on) {
      this.pending(arg, true);
      this.service("switch", "turn_on", arg);
      return;
    }
    const n = Number(el.dataset.n) || 0, t = el.dataset.types;
    this.confirm(`Stop the ${el.dataset.recipe} line?`,
      `${n === 1 ? `The ${t}` : `All ${n} machines (${t})`} on the ${el.dataset.recipe} recipe go into standby and stop drawing power. Anything that uses ${el.dataset.recipe} downstream will run short.`,
      "STOP LINE", () => { this.pending(arg, false); this.service("switch", "turn_off", arg); });
  }
}

// ================================================================== throughput board
class SfrmThroughputCard extends SfrmBase {
  css() {
    return `.trow{display:grid;grid-template-columns:1.4fr 1fr 1fr 1.1fr 1fr .9fr;gap:12px;align-items:center}
      .dg{width:17px;height:26px;border-radius:3px;background:${COL.deep};border:1px solid ${COL.line2};display:inline-flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700}
      .dg.blank{opacity:.35}`;
  }
  digits(v, color) {
    const s = Math.max(0, v).toFixed(1).padStart(6, " ").slice(-6);
    return s.split("").map((ch) => `<span class="dg${ch === " " ? " blank" : ""}" style="color:${color}">${ch === " " ? "0" : ch}</span>`).join("");
  }
  view(srv) {
    const h = this._hass;
    const prod = productionFeed(h, srv, this);
    const filter = this._filter || this._config.filter || "all";
    const all = (prod?.items || []).filter((i) => this._config.show_all || i.is_produced || i.max_consumed > 0)
      .map((i) => ({ ...i, net: i.produced - i.consumed }));
    const rows = all
      .filter((i) => filter === "all" || (filter === "short" && i.net < -0.05) || (filter === "surplus" && i.net > 0.05))
      .sort((a, b) => ((a.net < -0.05) === (b.net < -0.05) ? a.name.localeCompare(b.name) : a.net < -0.05 ? -1 : 1));
    const hist = historyFeed(h, rows.map((i) => i.net_entity), 2, this);
    const chips = [["all", "ALL"], ["short", "SHORT"], ["surplus", "SURPLUS"]]
      .map(([id, label]) => `<button class="chip" data-act="filter" data-arg="${id}" aria-pressed="${filter === id}">${label}</button>`).join("");
    const body = rows.map((i) => {
      const short = i.net < -0.05, surplus = i.net > 0.05;
      const col = short ? COL.short : surplus ? COL.cyan : "#b6c0ce";
      const eff = i.max_produced > 0 ? Math.min(100, Math.round((i.produced / i.max_produced) * 100)) : null;
      const spark = sparkPoints(hist[i.net_entity], 120, 28, i.net);
      const abbr = i.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      const tag = i.net_entity ? "button" : "div";
      return `<${tag} class="trow well" ${i.net_entity ? `data-act="more" data-arg="${esc(i.net_entity)}" style="cursor:pointer;text-align:left;width:100%;` : `style="`}padding:10px 12px;border-color:${short ? "#6b4019" : COL.line2}" aria-label="${esc(`${i.name}: made ${f1(i.produced)}, used ${f1(i.consumed)}, net ${signed(i.net)} per minute`)}">
        <span style="display:flex;align-items:center;gap:10px;min-width:0">
          ${i.class_name && this._icon(srv, i.class_name) ? `<img src="${this._icon(srv, i.class_name)}" alt="" width="30" height="30" style="border-radius:6px;background:#1b222c;flex:none">` : `<span aria-hidden="true" style="width:30px;height:30px;border-radius:6px;background:#1b222c;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:${COL.dim};flex:none">${abbr}</span>`}
          <span style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.name)}</span></span>
        <span aria-hidden="true" style="display:flex;gap:2px">${this.digits(i.produced, COL.text)}</span>
        <span aria-hidden="true" style="display:flex;gap:2px">${this.digits(i.consumed, "#b6c0ce")}</span>
        <span style="display:flex;align-items:baseline;gap:8px"><span class="mono" style="font-size:20px;font-weight:700;color:${col}">${signed(i.net)}</span>
          <span style="font-size:10px;letter-spacing:.14em;font-weight:700;color:${col}">${short ? "SHORT" : surplus ? "SURPLUS" : "BALANCED"}</span></span>
        <span style="display:flex;align-items:center;gap:8px">${eff === null ? `<span class="lbl">NOT MADE HERE</span>` : `
          <span style="flex:1;height:8px;border-radius:4px;background:${COL.deep};overflow:hidden;border:1px solid ${COL.line2}"><span class="grow" style="display:block;height:100%;width:${eff}%;background:${eff >= 90 ? COL.cyan : eff >= 50 ? "#7fb6c2" : COL.amber}"></span></span>
          <span class="mono" style="font-size:13px;color:${COL.text2};width:40px;text-align:right">${eff}%</span>`}</span>
        ${spark ? `<svg viewBox="0 0 120 28" style="width:100%;height:28px" aria-hidden="true"><polyline points="${spark}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"></polyline></svg>` : `<span></span>`}
      </${tag}>`;
    }).join("");
    return `<section class="panel" aria-label="Throughput board">
      <div class="row" style="margin-bottom:12px"><h2 class="t">THROUGHPUT BOARD · PER MINUTE</h2>
        <div role="toolbar" aria-label="Filter items" style="display:flex;gap:6px;flex-wrap:wrap">${chips}</div></div>
      ${prod === undefined ? `<div class="empty">Loading production…</div>` : !rows.length ? `<div class="empty">${filter === "all" ? "No production data for this save yet." : "Nothing in this view."}</div>` : `
      <div style="overflow-x:auto"><div style="min-width:760px;display:flex;flex-direction:column;gap:6px">
        <div class="trow lbl" style="padding:0 12px"><span>ITEM</span><span>MADE</span><span>USED</span><span>NET</span><span>OUTPUT VS CAPACITY</span><span>TREND</span></div>
        ${body}</div></div>`}
    </section>`;
  }
  // Item icons come from FRM through the integration's authenticated proxy.
  _icon(srv, cls) {
    this._icons = this._icons || {};
    const path = `map/classnamed/${cls}.avif`;
    if (this._icons[path] === undefined) {
      this._icons[path] = "";
      this._hass.fetchWithAuth(`/api/satisfactory_frm/${srv.entryId}/asset/${path}`)
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => { this._icons[path] = URL.createObjectURL(b); this._dirty(); })
        .catch(() => { this._icons[path] = null; });
    }
    return this._icons[path] || null;
  }
  act(act, arg) {
    if (act === "filter") { this._filter = arg; this._dirty(); }
  }
}

// ================================================================== machine rack
class SfrmRackCard extends SfrmBase {
  css() {
    return `.grouphead{width:100%;background:#161c26;border:0;border-bottom:1px solid ${COL.line};padding:12px 16px;min-height:56px;display:flex;align-items:center;gap:14px;cursor:pointer;text-align:left;flex-wrap:wrap}
      .grouphead:hover{background:#1a212c}
      .mods{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;padding:14px}
      .mname{background:none;border:0;padding:0;text-align:left;cursor:pointer;min-width:0;flex:1}
      .mname:hover .n{text-decoration:underline}`;
  }
  view(srv) {
    const h = this._hass;
    const filter = this._filter || "all";
    this._closed = this._closed || {};
    const ST = {
      producing: { label: "PRODUCING", led: COL.green, text: "#8fe3b0", frame: COL.line2 },
      idle: { label: "IDLE", led: COL.amber, text: "#f5c96b", frame: "#4d3c1c" },
      paused: { label: "STANDBY", led: COL.grey, text: COL.dim, frame: COL.line2 },
      no_power: { label: "NO POWER", led: COL.red, text: "#ff8a80", frame: "#6e2a26" },
      not_configured: { label: "NOT CONFIGURED", led: "#5a6577", text: COL.dim, frame: COL.line2 },
    };
    const all = srv.buildings.filter((b) => this._config.include_generators || !/generator|burner/i.test(b.a.building || ""));
    const count = (k) => all.filter((b) => b.state === k).length;
    const groups = {};
    for (const b of all) (groups[b.a.building || "Building"] = groups[b.a.building || "Building"] || []).push(b);
    const chips = [["all", "ALL", "#b6c0ce"], ["producing", "PRODUCING", COL.green], ["idle", "IDLE", COL.amber], ["paused", "STANDBY", "#5a6577"], ["no_power", "NO POWER", COL.red]]
      .map(([id, label, dot]) => `<button class="chip" data-act="filter" data-arg="${id}" aria-pressed="${filter === id}"><span class="lamp" style="width:8px;height:8px;background:${dot}"></span>${label} ${id === "all" ? all.length : count(id)}</button>`).join("");
    const arcFor = (pct) => {
      const v = Math.max(0, Math.min(2.5, pct / 100)) / 2.5;
      if (v < 0.01) return "";
      const pt = (a) => [30 + 22 * Math.sin((a * Math.PI) / 180), 30 - 22 * Math.cos((a * Math.PI) / 180)];
      const a1 = -135 + 270 * v, p0 = pt(-135), p1 = pt(a1);
      return `M${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A22 22 0 ${a1 + 135 > 180 ? 1 : 0} 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
    };
    const sections = Object.keys(groups).sort().map((type) => {
      const list = groups[type].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
      const vis = list.filter((b) => filter === "all" || b.state === filter);
      if (!vis.length) return "";
      const open = !this._closed[type];
      const c = (k) => list.filter((b) => b.state === k).length;
      const mods = vis.map((b) => {
        const st = ST[b.state] || ST.idle;
        const sw = srv.buildingSwitch[b.id];
        const pend = sw ? this.pending(sw) : undefined;
        const on = pend !== undefined ? pend : b.state !== "paused";
        const clock = Number(b.a.clock_speed) || 0;
        const prodv = Math.max(0, Math.min(100, Number(b.a.productivity) || 0));
        const shards = Number(b.a.power_shards) || 0, sloops = Number(b.a.somersloops) || 0;
        const draw = b.a.power_draw_mw;
        return `<div class="well" style="padding:12px;display:flex;flex-direction:column;gap:10px;border-color:${st.frame}">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="lamp ${b.state === "producing" ? "led-on" : ""}" aria-hidden="true" style="width:12px;height:12px;background:${st.led};box-shadow:0 0 10px ${st.led}"></span>
            <button class="mname" data-act="more" data-arg="${esc(b.entity)}" aria-label="${esc(`${b.label} details`)}">
              <div class="n" style="font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(b.label)}</div>
              <div style="font-size:11px;letter-spacing:.12em;color:${st.text};font-weight:700">${st.label}</div></button>
            <button class="rocker" ${sw ? `data-act="mach" data-arg="${esc(sw)}" data-on="${on ? 1 : 0}"` : "disabled"} aria-pressed="${on}"
              aria-label="${esc(`${b.label}: ${on ? "running" : "standby"}. ${sw ? `Press to ${on ? "put on standby" : "run"}.` : ""}`)}"
              style="width:52px;background:${on ? "#16404a" : "#2a2f38"}"><span class="k" style="width:30px;height:30px;top:6px;background:${on ? COL.cyan : "#6d7686"};transform:translateX(${on ? 12 : 0}px)"></span></button>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <svg width="54" height="40" viewBox="0 0 60 44" role="img" aria-label="Clock speed ${clock.toFixed(0)} percent">
              <path d="M8 38 A22 22 0 1 1 52 38" fill="none" stroke="#1e2530" stroke-width="6" stroke-linecap="round"></path>
              ${arcFor(clock) ? `<path d="${arcFor(clock)}" fill="none" stroke="${COL.orange}" stroke-width="6" stroke-linecap="round"></path>` : ""}
              <text x="30" y="34" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" font-weight="700" fill="${COL.text}">${clock.toFixed(0)}%</text></svg>
            <div style="flex:1;display:flex;flex-direction:column;gap:5px">
              <div class="row lbl" style="flex-wrap:nowrap"><span>PRODUCTIVITY</span><span class="mono" style="color:${COL.text}">${prodv.toFixed(0)}%</span></div>
              <div style="height:8px;border-radius:4px;background:${COL.deep};border:1px solid ${COL.line2};overflow:hidden"><span class="grow" style="display:block;height:100%;width:${prodv}%;background:${prodv >= 85 ? COL.cyan : COL.amber}"></span></div>
              <div class="row" style="font-size:11px;color:${COL.dim};flex-wrap:nowrap"><span>${draw !== undefined ? `${Number(draw).toFixed(1)} MW` : ""}</span><span>${b.a.circuit !== undefined && b.a.circuit !== -1 ? `CIRCUIT ${b.a.circuit}` : "NOT CONNECTED"}</span></div>
            </div></div>
          ${shards || sloops ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${shards ? `<span style="font-size:10px;letter-spacing:.12em;font-weight:700;color:#f5c96b;border:1px solid #6b5224;border-radius:4px;padding:3px 6px">${shards} POWER SHARD${shards > 1 ? "S" : ""}</span>` : ""}${sloops ? `<span style="font-size:10px;letter-spacing:.12em;font-weight:700;color:#ff8fa3;border:1px solid #6b2a3a;border-radius:4px;padding:3px 6px">${sloops} SOMERSLOOP${sloops > 1 ? "S" : ""}</span>` : ""}</div>` : ""}
        </div>`;
      }).join("");
      return `<section class="panel" aria-label="${esc(type)}" style="padding:0;overflow:hidden" data-key="g-${esc(type)}">
        <button class="grouphead" data-act="group" data-arg="${esc(type)}" aria-expanded="${open}">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${open ? 90 : 0}deg);transition:transform .2s"><path d="M8 4l8 8-8 8" fill="none" stroke="${COL.dim}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path></svg>
          <span style="font-size:17px;font-weight:700;letter-spacing:.06em;flex:1">${esc(type)} × ${list.length}</span>
          <span class="mono" style="display:flex;gap:12px;font-size:13px;flex-wrap:wrap"><span style="color:${COL.cyan}">${c("producing")} PROD</span><span style="color:#f5c96b">${c("idle")} IDLE</span><span style="color:#b6c0ce">${c("paused")} STBY</span>${c("no_power") ? `<span style="color:#ff8a80">${c("no_power")} NO PWR</span>` : ""}</span>
        </button>
        ${open ? `<div class="mods">${mods}</div>` : ""}
      </section>`;
    }).join("");
    return `<div style="display:flex;flex-direction:column;gap:18px">
      <section class="panel row" aria-label="Machine filters" style="padding:12px 16px">
        <div role="toolbar" aria-label="Filter by status" style="display:flex;gap:6px;flex-wrap:wrap">${chips}</div>
        <div class="mono" style="font-size:14px;color:${COL.text2}">${count("producing")} OF ${all.length} PRODUCING</div></section>
      ${all.length ? sections || `<div class="panel"><div class="empty">Nothing in this view.</div></div>` : `<div class="panel"><div class="empty">No building entities. Turn on <b>Create building entities</b> in the integration's options.</div></div>`}
    </div>`;
  }
  act(act, arg, el) {
    if (act === "filter") { this._filter = arg; this._dirty(); return; }
    if (act === "group") { this._closed[arg] = !this._closed[arg]; this._dirty(); return; }
    if (act === "mach") {
      const on = el.dataset.on === "1";
      this.pending(arg, !on);
      this.service("switch", on ? "turn_off" : "turn_on", arg);
    }
  }
}

// ================================================================== page (assembles a whole view)
const PAGE_LAYOUT = {
  control: [["sfrm-header-card"], ["sfrm-alarms-card", "sfrm-status-card"], ["sfrm-grid-card"], ["sfrm-watchlist-card"]],
  power: [["sfrm-header-card"], ["sfrm-power-card"], ["sfrm-generators-card"]],
  production: [["sfrm-header-card"], ["sfrm-levers-card"], ["sfrm-throughput-card"]],
  machines: [["sfrm-header-card"], ["sfrm-rack-card"]],
  map: [["sfrm-header-card"], ["satisfactory-map-card"]],
};
class SfrmPageCard extends HTMLElement {
  setConfig(config) {
    this._config = { page: "control", ...config };
    this._build();
  }
  set hass(hass) {
    this._hass = hass;
    for (const el of this._els || []) el.hass = hass;
  }
  getCardSize() { return 12; }
  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config;
    const rows = PAGE_LAYOUT[c.page] || PAGE_LAYOUT.control;
    this.shadowRoot.innerHTML = `<style>
      :host{display:block}
      .page{min-height:calc(100vh - var(--header-height, 56px));background:${COL.bg};background-image:radial-gradient(circle at 1px 1px,#161c25 1px,transparent 0);background-size:22px 22px;padding:20px;box-sizing:border-box}
      .wrap{max-width:${c.max_width || 1400}px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
      .row{display:flex;flex-wrap:wrap;gap:18px}
      .row > *{flex:1 1 320px;min-width:0}
      .row > :first-child{flex:999 1 640px}
      @media (max-width:600px){.page{padding:10px}}
    </style><div class="page"><div class="wrap"></div></div>`;
    const wrap = this.shadowRoot.querySelector(".wrap");
    this._els = [];
    const paths = Object.fromEntries((c.nav || []).map((n) => [n.page, n.path]));
    for (const row of rows) {
      const holder = row.length > 1 ? Object.assign(document.createElement("div"), { className: "row" }) : wrap;
      if (holder !== wrap) wrap.appendChild(holder);
      for (const tag of row) {
        const el = document.createElement(tag);
        el._inPage = true;
        const cfg = { server: c.server, circuit_names: c.circuit_names, title: c.title };
        if (tag === "sfrm-header-card") Object.assign(cfg, { nav: c.nav, page: c.page });
        if (tag === "sfrm-grid-card") cfg.power_path = paths.power;
        if (tag === "sfrm-watchlist-card") cfg.production_path = paths.production;
        if (tag === "satisfactory-map-card") Object.assign(cfg, { server: c.server, height: c.map_height || 720 });
        try { el.setConfig(cfg); } catch (e) { console.error(e); }
        if (this._hass) el.hass = this._hass;
        holder.appendChild(el);
        this._els.push(el);
      }
    }
  }
}

// ================================================================== registration
const SFRM_CARDS = [
  ["sfrm-page-card", SfrmPageCard, "SFRM control room page", "A whole control-room view: control, power, production, machines or map"],
  ["sfrm-header-card", SfrmHeaderCard, "SFRM header", "Server and world lamps, in-game clock and view tabs"],
  ["sfrm-alarms-card", SfrmAlarmsCard, "SFRM alarm panel", "Flashing alarms you can acknowledge"],
  ["sfrm-status-card", SfrmStatusCard, "SFRM factory status", "Productivity and machine counts"],
  ["sfrm-grid-card", SfrmGridCard, "SFRM power dials", "A dial per power circuit"],
  ["sfrm-power-card", SfrmPowerCard, "SFRM power grid", "Circuit panels with breaker, battery tank and load trend"],
  ["sfrm-generators-card", SfrmGeneratorsCard, "SFRM generator bank", "Generators with run/standby switches"],
  ["sfrm-watchlist-card", SfrmWatchlistCard, "SFRM watchlist", "Biggest shortfalls and surpluses"],
  ["sfrm-levers-card", SfrmLeversCard, "SFRM production levers", "A lever per production line"],
  ["sfrm-throughput-card", SfrmThroughputCard, "SFRM throughput board", "Made, used and net per item"],
  ["sfrm-rack-card", SfrmRackCard, "SFRM machine rack", "Every machine with status and a run/standby switch"],
];
window.customCards = window.customCards || [];
for (const [tag, cls, name, description] of SFRM_CARDS) {
  if (!customElements.get(tag)) customElements.define(tag, cls);
  if (!window.customCards.some((c) => c.type === tag)) window.customCards.push({ type: tag, name, description, preview: false });
}
console.info(`%c SFRM control room ${SFRM_CR_VERSION} `, "background:#f99b38;color:#000");
