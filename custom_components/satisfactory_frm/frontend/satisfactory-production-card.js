/*
 * Satisfactory production table card.
 *
 *   type: custom:satisfactory-production-card
 *   server: My Server     # optional, display name or entry ID (default: first)
 *   sort: net             # net | name | produced | consumed  (net = shortfalls first)
 *   filter: all           # all | deficit | surplus | stopped
 *   show_all: false       # include items with no machines making or using them
 *   max_height: 520       # px before the list scrolls
 *   title: Production
 *
 * Reads the integration's last production poll over the websocket, so it adds
 * no entities and no extra requests to FRM.
 */

const PVERSION = "0.3.0";
const FILTERS = { all: "All", deficit: "Short", surplus: "Surplus", stopped: "Stopped" };
const SORTS = { name: "Item", produced: "Made", consumed: "Used", net: "Net" };

const fmt = (v) => {
  const a = Math.abs(v);
  return a >= 1000 ? `${(v / 1000).toFixed(1)}k` : a >= 100 ? v.toFixed(0) : v.toFixed(1);
};
const escp = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

class SatisfactoryProductionCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  setConfig(config) {
    this._config = { sort: "net", filter: "all", show_all: false, max_height: 520, ...config };
    if (!SORTS[this._config.sort]) this._config.sort = "net";
    if (!FILTERS[this._config.filter]) this._config.filter = "all";
    this._sort = this._config.sort;
    this._dir = this._sort === "name" ? 1 : this._sort === "net" ? 1 : -1;
    this._filter = this._config.filter;
    this._query = "";
    if (this._root) this._shell();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
  }

  getCardSize() {
    return Math.ceil((this._config?.max_height || 520) / 50) + 2;
  }

  connectedCallback() {
    this._connected = true;
    if (this._entry) this._poll();
  }

  disconnectedCallback() {
    this._connected = false;
    clearTimeout(this._timer);
    this._io?.disconnect();
  }

  async _init() {
    this._root = this.attachShadow({ mode: "open" });
    this._icons = {};
    this._shell();
    try {
      const servers = await this._hass.callWS({ type: "satisfactory_frm/servers" });
      const want = this._config.server;
      const s = want ? servers.find((x) => x.entry_id === want || x.title === want) : servers[0];
      if (!s) throw new Error(want ? `No server called "${want}"` : "No Satisfactory server is set up");
      this._entry = s.entry_id;
      this._io = new IntersectionObserver((e) => {
        this._visible = e[0]?.isIntersecting ?? true;
        if (this._visible) this._poll();
      });
      this._io.observe(this);
      this._poll();
    } catch (e) {
      this._message(e.message || String(e));
    }
  }

  _shell() {
    const c = this._config;
    this._root.innerHTML = `
      <style>
        :host { --sf-accent: #f99b38; --ok: hsl(96,44%,55%); --bad: hsl(359,68%,62%); }
        ha-card { padding: 12px 0 6px; }
        .top { padding: 0 16px 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .title { flex: 1 1 auto; min-width: 0; }
        .title b { font-size: 16px; font-weight: 600; color: var(--primary-text-color); }
        .title span { display: block; font-size: 12px; color: var(--secondary-text-color); }
        input { flex: 1 1 140px; min-width: 0; font: inherit; font-size: 14px; padding: 7px 10px; border-radius: 8px;
          border: 1px solid var(--divider-color, #444); background: var(--secondary-background-color, transparent);
          color: var(--primary-text-color); }
        input:focus-visible, button:focus-visible, .row:focus-visible { outline: 2px solid var(--sf-accent); outline-offset: 1px; }
        .filters { display: flex; gap: 6px; padding: 0 16px 8px; overflow-x: auto; }
        .chip { flex: none; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
          border: 1px solid var(--divider-color, #555); background: transparent; color: var(--secondary-text-color); }
        .chip[aria-pressed="true"] { border-color: var(--sf-accent); color: var(--primary-text-color);
          background: color-mix(in srgb, var(--sf-accent) 16%, transparent); }
        .grid { display: grid; grid-template-columns: 28px minmax(0,1fr) 64px 64px 72px; column-gap: 10px; align-items: center; }
        .head { padding: 6px 16px; border-bottom: 1px solid var(--divider-color, #333); font-size: 12px;
          color: var(--secondary-text-color); }
        .head button { font: inherit; background: none; border: 0; padding: 2px 0; color: inherit; cursor: pointer; text-align: right; }
        .head button.name { text-align: left; }
        .head button[aria-sort] { color: var(--primary-text-color); font-weight: 600; }
        .list { max-height: ${c.max_height}px; overflow-y: auto; }
        .row { padding: 7px 16px; border-bottom: 1px solid color-mix(in srgb, var(--divider-color, #333) 50%, transparent);
          font-size: 14px; color: var(--primary-text-color); }
        .row[data-entity] { cursor: pointer; }
        .row[data-entity]:hover { background: color-mix(in srgb, var(--sf-accent) 7%, transparent); }
        .icon { width: 28px; height: 28px; border-radius: 6px; background: var(--secondary-background-color, #2a2a2a);
          display: grid; place-items: center; font-size: 11px; color: var(--secondary-text-color); overflow: hidden; }
        .icon img { width: 26px; height: 26px; }
        .name { min-width: 0; }
        .name .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .bar { height: 3px; border-radius: 2px; margin-top: 4px; background: var(--divider-color, #333); overflow: hidden; }
        .bar i { display: block; height: 100%; background: var(--sf-accent); }
        .sub { display: none; font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
        .num { text-align: right; font-variant-numeric: tabular-nums; }
        .net.pos { color: var(--ok); } .net.neg { color: var(--bad); font-weight: 600; }
        .net.zero { color: var(--secondary-text-color); }
        .msg { padding: 16px; color: var(--secondary-text-color); font-size: 14px; }
        .foot { padding: 6px 16px 0; font-size: 11px; color: var(--secondary-text-color); }
        @container (max-width: 440px) {
          .grid { grid-template-columns: 28px minmax(0,1fr) 72px; }
          .col-made, .col-used { display: none; }
          .sub { display: block; }
        }
        .wrap { container-type: inline-size; }
      </style>
      <ha-card>
        <div class="wrap">
          <div class="top">
            <div class="title"><b></b><span></span></div>
            <input type="search" placeholder="Search items" aria-label="Search items">
          </div>
          <div class="filters" role="toolbar" aria-label="Filter"></div>
          <div class="grid head" role="row">
            <span></span>
            <button class="name" data-sort="name">Item</button>
            <button class="col-made" data-sort="produced">Made/min</button>
            <button class="col-used" data-sort="consumed">Used/min</button>
            <button data-sort="net">Net/min</button>
          </div>
          <div class="list" role="list"><div class="msg">Loading production…</div></div>
          <div class="foot"></div>
        </div>
      </ha-card>`;
    this._root.querySelector(".title b").textContent = c.title || "Production";
    const input = this._root.querySelector("input");
    input.addEventListener("input", () => {
      this._query = input.value.trim().toLowerCase();
      this._renderRows();
    });
    const filters = this._root.querySelector(".filters");
    for (const [id, label] of Object.entries(FILTERS)) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = label;
      b.dataset.filter = id;
      b.onclick = () => {
        this._filter = id;
        this._renderRows();
      };
      filters.appendChild(b);
    }
    this._root.querySelectorAll(".head button").forEach((b) => {
      b.onclick = () => {
        const s = b.dataset.sort;
        if (this._sort === s) this._dir = -this._dir;
        else {
          this._sort = s;
          this._dir = s === "name" || s === "net" ? 1 : -1;
        }
        this._renderRows();
      };
    });
    this._list = this._root.querySelector(".list");
    this._list.addEventListener("click", (e) => this._open(e));
    this._list.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") this._open(e);
    });
    if (this._data) this._renderRows();
  }

  _open(e) {
    const row = e.target.closest(".row[data-entity]");
    if (!row) return;
    e.preventDefault();
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: row.dataset.entity } })
    );
  }

  _message(text) {
    if (this._list) this._list.innerHTML = `<div class="msg">${escp(text)}</div>`;
  }

  async _poll() {
    clearTimeout(this._timer);
    if (!this._connected || this._visible === false || document.visibilityState === "hidden") return;
    try {
      this._data = await this._hass.callWS({ type: "satisfactory_frm/production", entry_id: this._entry });
      this._renderRows();
    } catch (e) {
      this._message(e.message || "Couldn't load production data");
    }
    this._timer = setTimeout(() => this._poll(), 15000);
  }

  _rows() {
    const d = this._data;
    let items = d.items.filter((i) => this._config.show_all || i.is_produced || i.max_consumed > 0);
    if (this._query) items = items.filter((i) => i.name.toLowerCase().includes(this._query));
    const net = (i) => i.produced - i.consumed;
    if (this._filter === "deficit") items = items.filter((i) => net(i) < -0.005);
    if (this._filter === "surplus") items = items.filter((i) => net(i) > 0.005);
    if (this._filter === "stopped") items = items.filter((i) => i.is_produced && i.produced === 0);
    const key = { name: (i) => i.name.toLowerCase(), produced: (i) => i.produced, consumed: (i) => i.consumed, net }[this._sort];
    const dir = this._dir;
    return items.sort((a, b) => {
      const x = key(a), y = key(b);
      return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * dir;
    });
  }

  _renderRows() {
    if (!this._data || !this._list) return;
    const d = this._data;
    this._root.querySelector(".title span").textContent = d.session_name || "";
    this._root.querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === this._filter)));
    this._root.querySelectorAll(".head button").forEach((b) => {
      if (b.dataset.sort === this._sort) b.setAttribute("aria-sort", this._dir > 0 ? "ascending" : "descending");
      else b.removeAttribute("aria-sort");
    });

    if (!d.world_ready) return this._message("The world isn't ready yet. Production appears once the server finishes loading.");
    if (!d.items.length) return this._message("No production data yet. It refreshes about once a minute.");

    const rows = this._rows();
    if (!rows.length) {
      this._message(this._query ? `Nothing matches "${this._query}".` : "No items in this view.");
    } else {
      this._list.innerHTML = rows
        .map((i) => {
          const n = i.produced - i.consumed;
          const cls = n > 0.005 ? "pos" : n < -0.005 ? "neg" : "zero";
          const eff = i.max_produced > 0 ? Math.min(100, (i.produced / i.max_produced) * 100) : null;
          const icon = i.class_name ? `map/classnamed/${i.class_name}.avif` : null;
          const label = `${i.name}: made ${fmt(i.produced)}, used ${fmt(i.consumed)}, net ${n > 0 ? "+" : ""}${fmt(n)} per minute`;
          return `
            <div class="grid row" role="listitem" aria-label="${escp(label)}"
              ${i.net_entity ? `data-entity="${escp(i.net_entity)}" tabindex="0"` : ""}>
              <div class="icon" data-icon="${escp(icon || "")}">${escp(i.name.slice(0, 2))}</div>
              <div class="name"><div class="n">${escp(i.name)}</div>
                <div class="sub">${fmt(i.produced)} made · ${fmt(i.consumed)} used</div>
                ${eff !== null ? `<div class="bar" title="${eff.toFixed(0)}% of capacity"><i style="width:${eff}%"></i></div>` : ""}</div>
              <div class="num col-made">${fmt(i.produced)}</div>
              <div class="num col-used">${fmt(i.consumed)}</div>
              <div class="num net ${cls}">${n > 0.005 ? "+" : ""}${fmt(n)}</div>
            </div>`;
        })
        .join("");
      this._list.querySelectorAll("[data-icon]").forEach((el) => this._icon(el));
    }
    const shown = rows.length, total = d.items.filter((i) => i.is_produced).length;
    this._root.querySelector(".foot").textContent =
      `${shown} shown · ${total} items produced · bar = output vs capacity` +
      (rows.some((r) => r.net_entity) ? " · tap a row for history" : "");
  }

  async _icon(el) {
    const path = el.dataset.icon;
    if (!path) return;
    let url = this._icons[path];
    if (url === undefined) {
      this._icons[path] = null;
      try {
        const r = await this._hass.fetchWithAuth(`/api/satisfactory_frm/${this._entry}/asset/${path}`);
        if (!r.ok) throw new Error(r.status);
        url = this._icons[path] = URL.createObjectURL(await r.blob());
      } catch (e) {
        this._icons[path] = false;
        return;
      }
      // Fill every placeholder waiting for this icon.
      this._list?.querySelectorAll(`[data-icon="${CSS.escape(path)}"]`).forEach((n) => this._icon(n));
      return;
    }
    if (url) el.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
  }
}

if (!customElements.get("satisfactory-production-card")) {
  customElements.define("satisfactory-production-card", SatisfactoryProductionCard);
}
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "satisfactory-production-card")) {
  window.customCards.push({
    type: "satisfactory-production-card",
    name: "Satisfactory production",
    description: "Every item your factory makes, live, with search and sorting",
  });
}
console.info(`%c satisfactory-production-card ${PVERSION} `, "background:#f99b38;color:#000");
