/*
 * SFRM Factory planner: a Home Assistant sidebar page.
 * Shipped with the satisfactory_frm integration and registered automatically.
 *
 * Pick what to make and how fast; the integration solves it against the live
 * save (unlocked recipes, factory surplus, power headroom, free resource nodes)
 * and this page draws the result as an editable flowchart with a summary.
 * No third-party dependencies.
 */

const PLANNER_VERSION = "0.9.0";

(() => {
  if (document.querySelector("link[data-sfrm-fonts]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.dataset.sfrmFonts = "1";
  l.href = "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap";
  document.head.appendChild(l);
})();

const PC = {
  bg: "#0b0e13", panel: "#141922", well: "#0f1319", deep: "#07090d",
  line: "#262e3b", line2: "#222a36", text: "#e6eaf0", text2: "#c5cdd8", dim: "#9aa6b8",
  orange: "#f99b38", cyan: "#5ad1e6", green: "#57d48a", amber: "#f5b740", red: "#ff5a4e", grey: "#3a4250",
};
const NODE_W = 210;
const COL_GAP = 150;
const ROW_GAP = 34;

const pesc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 1) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "–";
  const n = Number(v);
  return Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(d).replace(/\.?0+$/, "");
};
const tierShort = (name) => String(name || "").replace(/^Conveyor Belt /, "").replace(/^Pipeline /, "Pipe ");

const PLANNER_CSS = `
:host{display:block;height:100%;font-family:'Chakra Petch',system-ui,sans-serif;color:${PC.text};background:${PC.bg}}
*{box-sizing:border-box}
button,input,select{font-family:inherit;color:inherit}
button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid ${PC.orange};outline-offset:2px}
.app{display:flex;flex-direction:column;height:100%;min-height:100vh;background:${PC.bg};background-image:radial-gradient(circle at 1px 1px,#161c25 1px,transparent 0);background-size:22px 22px}
.top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid ${PC.line};background:#0d1117}
.brand{font-size:15px;font-weight:700;letter-spacing:.22em;color:${PC.orange};margin-right:8px;white-space:nowrap}
.top .grow{flex:1}
.status{font-size:12px;color:${PC.dim};min-width:90px}
.status.dirty{color:${PC.amber}}
select,input[type=text],input[type=number]{background:${PC.well};border:1px solid ${PC.line};border-radius:6px;min-height:40px;padding:0 10px;font-size:14px}
input[type=number]{width:96px;font-family:'JetBrains Mono',monospace}
.btn{font-size:12px;font-weight:600;letter-spacing:.12em;color:${PC.orange};background:transparent;border:1px solid ${PC.orange};border-radius:6px;padding:0 14px;min-height:40px;cursor:pointer;white-space:nowrap}
.btn:hover{background:#2a2216}
.btn.solid{background:${PC.orange};color:#14100a;border:0}
.btn.ghost{color:${PC.text};border-color:#3a4454}
.btn.ghost:hover{background:#1a212c}
.btn.icon{min-width:40px;padding:0 10px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.tabs{display:none;gap:6px;padding:8px 12px;border-bottom:1px solid ${PC.line}}
.tab{flex:1;min-height:44px;border-radius:22px;border:1px solid #2a3240;background:transparent;font-size:12px;font-weight:600;letter-spacing:.14em;cursor:pointer;color:#b6c0ce}
.tab[aria-selected="true"]{background:${PC.orange};color:#14100a;border-color:${PC.orange}}
.body{flex:1;display:grid;grid-template-columns:320px 1fr 320px;min-height:0}
.pane{min-height:0;overflow:auto}
.side{padding:14px;display:flex;flex-direction:column;gap:14px;border-right:1px solid ${PC.line};background:rgba(13,17,23,.6)}
.side.right{border-right:0;border-left:1px solid ${PC.line}}
.panel{background:${PC.panel};border:1px solid ${PC.line};border-radius:10px;padding:14px}
h2{margin:0 0 10px;font-size:12px;letter-spacing:.22em;color:${PC.dim};font-weight:600}
.lbl{font-size:10px;letter-spacing:.16em;color:${PC.dim}}
.mono{font-family:'JetBrains Mono',ui-monospace,monospace}
.muted{color:${PC.dim};font-size:12px}
.row{display:flex;align-items:center;gap:8px}
.row.sp{justify-content:space-between}
.target{display:grid;grid-template-columns:1fr 96px 40px;gap:6px;align-items:center;margin-bottom:8px}
.target .name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.add{display:grid;grid-template-columns:1fr 40px;gap:6px}
.opt{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px;font-size:13px}
.seg{display:inline-flex;border:1px solid #2a3240;border-radius:22px;overflow:hidden}
.seg button{border:0;background:transparent;min-height:36px;padding:0 12px;font-size:11px;font-weight:600;letter-spacing:.12em;cursor:pointer;color:#b6c0ce}
.seg button[aria-pressed="true"]{background:${PC.orange};color:#14100a}
.switch{width:52px;height:30px;border-radius:15px;border:1px solid #2f3846;background:#2a2f38;position:relative;cursor:pointer;flex:none}
.switch[aria-checked="true"]{background:#16404a}
.switch span{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#6d7686;transition:transform .2s}
.switch[aria-checked="true"] span{transform:translateX(22px);background:${PC.cyan}}
.rlist{display:flex;flex-direction:column;gap:6px}
.ritem{display:flex;align-items:center;gap:8px;font-size:13px;background:${PC.well};border:1px solid ${PC.line2};border-radius:8px;padding:6px 6px 6px 10px}
.ritem .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:9px;font-weight:700;letter-spacing:.12em;padding:2px 6px;border-radius:4px;white-space:nowrap}
.badge.alt{background:#123a44;color:${PC.cyan}}
.badge.lock{background:#3d2c0b;color:${PC.amber}}
.badge.miss{background:#3a1416;color:#ffc9c4}
.flow{position:relative;overflow:hidden;touch-action:none;cursor:grab}
.flow.panning{cursor:grabbing}
.flow svg{width:100%;height:100%;display:block}
.tools{position:absolute;right:12px;top:12px;display:flex;flex-direction:column;gap:6px}
.tools .btn{background:rgba(13,17,23,.85)}
.emptyflow{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;color:${PC.dim};font-size:14px;line-height:1.6;pointer-events:none}
.detail{position:absolute;left:12px;bottom:12px;width:min(340px,calc(100% - 24px));background:#121822;border:1px solid ${PC.line};border-radius:10px;padding:12px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.detail table{width:100%;border-collapse:collapse;margin-top:6px}
.detail td{padding:3px 0;border-top:1px solid ${PC.line2}}
.detail td.r{text-align:right;font-family:'JetBrains Mono',monospace}
.kpis{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.kpi{background:${PC.well};border:1px solid ${PC.line2};border-radius:8px;padding:10px}
.kpi .v{font-family:'JetBrains Mono',monospace;font-size:22px;font-weight:700}
.bar{height:8px;background:${PC.deep};border-radius:4px;overflow:hidden;margin-top:8px}
.bar span{display:block;height:100%}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t td{padding:5px 0;border-top:1px solid ${PC.line2};vertical-align:top}
table.t td.r{text-align:right;font-family:'JetBrains Mono',monospace;white-space:nowrap;padding-left:8px}
.warn{border:1px solid #6b5224;background:#221a0b;color:#fbe2b0;border-radius:8px;padding:10px;font-size:13px;line-height:1.45}
.err{border:1px solid #6e2a26;background:#2a1012;color:#ffc9c4;border-radius:8px;padding:10px;font-size:13px;line-height:1.45}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1d2430;border:1px solid ${PC.amber};color:#fff;padding:10px 16px;border-radius:12px;font-size:13px;z-index:30;max-width:min(560px,calc(100vw - 32px))}
.palist{display:flex;flex-direction:column;gap:4px;max-height:42vh;overflow:auto}
.pal{display:flex;align-items:center;gap:6px;flex-wrap:wrap;text-align:left;background:${PC.well};border:1px solid ${PC.line2};border-radius:8px;padding:8px 10px;min-height:44px;cursor:grab;touch-action:none}
.pal:hover{border-color:#3a4454}
.pal .t{font-size:13px;font-weight:600;flex:1 1 auto}
.pal .muted{flex:1 1 100%;font-size:11px}
.dragghost{position:fixed;z-index:40;pointer-events:none;background:#1d2430;border:1px solid ${PC.orange};color:#fff;border-radius:8px;padding:6px 10px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.cmenu{position:absolute;z-index:10;width:260px;max-height:320px;overflow:auto;background:#121822;border:1px solid ${PC.orange};border-radius:10px;padding:4px;box-shadow:0 10px 30px rgba(0,0,0,.6)}
.mi{display:block;width:100%;text-align:left;background:transparent;border:0;border-radius:6px;padding:8px;min-height:40px;font-size:13px;cursor:pointer}
.mi:hover,.mi:focus-visible{background:#1d2633}
.fld{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.fld input,.fld select{width:100%}
.port{cursor:crosshair}
.port:hover{stroke:${PC.orange};stroke-width:2.5}
.narrow-only,.mid-only{display:none}
@media (max-width:1100px) and (min-width:761px){.mid-only{display:inline-block}}
.node{cursor:pointer}
.node:focus{outline:none}
.node:focus-visible rect.box{stroke:${PC.orange};stroke-width:2}
@media (max-width:1100px){.body{grid-template-columns:300px 1fr}.side.right{display:none}.body.show-sum .side.right{display:flex;position:absolute;right:0;top:0;bottom:0;width:320px;z-index:5}}
@media (max-width:760px){
  .tabs{display:flex}
  .body{grid-template-columns:1fr;position:relative}
  .pane{display:none!important}
  .body[data-tab="plan"] #planPane,.body[data-tab="flow"] #flowPane,.body[data-tab="summary"] #sumPane{display:flex!important}
  #flowPane{display:block}
  .body[data-tab="flow"] #flowPane{display:block!important}
  .side,.side.right{border:0;position:static;width:auto}
  .top{padding:8px 10px}
  .wide-only{display:none!important}
  .narrow-only{display:block}
  .brand{flex:1 1 auto}
  #planSel{flex:1 1 120px;min-width:0;order:2}
  .top .btn{order:3}
  .top .grow,.top .status{display:none}
  .top{row-gap:8px}
  .brand{font-size:13px}
}
@media (prefers-reduced-motion: reduce){.switch span{transition:none}}
`;

class SfrmPlannerPanel extends HTMLElement {
  constructor() {
    super();
    this._plan = blankPlan();
    this._result = null;
    this._tab = "plan";
    this._view = { k: 1, x: 40, y: 40 };
    this._sel = null;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._init();
    if (this._menu) this._menu.hass = hass;
  }
  set narrow(n) {
    this._narrow = n;
    if (this._menu) this._menu.narrow = n;
    if (this._menuWrap) this._menuWrap.style.display = n ? "" : "none";
  }
  set panel(p) { this._panel = p; }
  set route(r) { this._route = r; }

  // ------------------------------------------------------------- setup
  _init() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${PLANNER_CSS}</style>
      <div class="app">
        <header class="top">
          <span id="menu"></span>
          <span class="brand">FACTORY PLANNER</span>
          <select id="server" aria-label="Server"></select>
          <select id="planSel" aria-label="Saved plans"></select>
          <input id="planName" class="wide-only" data-planname type="text" aria-label="Plan name" placeholder="Plan name" style="width:180px">
          <button class="btn solid" data-act="save">SAVE</button>
          <button class="btn ghost" data-act="new">NEW</button>
          <button class="btn ghost icon" data-act="delete" aria-label="Delete plan" title="Delete plan">✕</button>
          <span class="status" id="status" role="status"></span>
          <span class="grow"></span>
          <button class="btn ghost wide-only" data-act="refresh" title="Re-read recipes and unlocks from the game">RELOAD GAME DATA</button>
          <button class="btn ghost mid-only" data-act="toggle-sum" id="sumBtn">SUMMARY</button>
        </header>
        <nav class="tabs" role="tablist">
          <button class="tab" role="tab" data-act="tab" data-arg="plan">PLAN</button>
          <button class="tab" role="tab" data-act="tab" data-arg="flow">FLOW</button>
          <button class="tab" role="tab" data-act="tab" data-arg="summary">SUMMARY</button>
        </nav>
        <div class="body" id="body" data-tab="plan">
          <aside class="pane side" id="planPane" aria-label="Plan"></aside>
          <main class="pane flow" id="flowPane" aria-label="Production flowchart">
            <svg id="svg" role="img" aria-label="Production flowchart"><g id="vp"></g></svg>
            <div class="emptyflow" id="emptyFlow"></div>
            <div class="tools">
              <button class="btn ghost icon" data-act="zoom" data-arg="1.25" aria-label="Zoom in">+</button>
              <button class="btn ghost icon" data-act="zoom" data-arg="0.8" aria-label="Zoom out">−</button>
              <button class="btn ghost icon" data-act="fit" aria-label="Fit to screen" title="Fit">⤢</button>
              <button class="btn ghost icon" data-act="relayout" aria-label="Reset layout" title="Reset layout">↺</button>
            </div>
            <div class="detail" id="detail" hidden></div>
            <div class="cmenu" id="cmenu" hidden role="menu"></div>
          </main>
          <aside class="pane side right" id="sumPane" aria-label="Summary"></aside>
        </div>
      </div>
      <datalist id="items"></datalist><datalist id="allitems"></datalist>`;
    this.$ = (id) => root.getElementById(id);
    // HA's own menu button (opens the sidebar on narrow screens), if available.
    if (customElements.get("ha-menu-button")) {
      this._menu = document.createElement("ha-menu-button");
      this._menu.hass = this._hass;
      this._menu.narrow = this._narrow;
      this._menuWrap = this.$("menu");
      this._menuWrap.appendChild(this._menu);
      this._menuWrap.style.display = this._narrow ? "" : "none";
    }
    root.addEventListener("click", (e) => {
      const el = e.target.closest("[data-act]");
      if (el && !el.disabled) this._act(el.dataset.act, el.dataset.arg, el, e);
    });
    root.addEventListener("change", (e) => this._onChange(e));
    root.addEventListener("input", (e) => this._onInput(e));
    root.addEventListener("keydown", (e) => {
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || "");
      if (this._isDesign() && !typing) {
        if ((e.key === "Delete" || e.key === "Backspace") && this._sel) { e.preventDefault(); this._deleteSel(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); this._undoRedo(e.shiftKey ? 1 : -1); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this._undoRedo(1); return; }
        if (e.key === "Escape") { this.$("cmenu").hidden = true; this._selectDesign(null); return; }
      }
      if (e.key === "Enter" && e.target.id === "addItem") this._addTarget();
      const node = e.target.closest?.(".node");
      if (node && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); this._select(node.dataset.id); }
    });
    this._initFlow();
    this._initPalette();
    this._setTab("plan");
    this._loadServers();
  }

  async _loadServers() {
    try {
      this._servers = await this._hass.callWS({ type: "satisfactory_frm/servers" });
    } catch (e) {
      this._servers = [];
    }
    const sel = this.$("server");
    sel.innerHTML = this._servers.map((s) => `<option value="${pesc(s.entry_id)}">${pesc(s.title)}</option>`).join("");
    sel.style.display = this._servers.length > 1 ? "" : "none";
    if (!this._servers.length) {
      this._renderPlanPane("No Satisfactory server is set up, or none is loaded right now.");
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem("sfrm_planner_server"); } catch (_) {}
    this._entry = this._servers.some((s) => s.entry_id === saved) ? saved : this._servers[0].entry_id;
    sel.value = this._entry;
    await this._loadModel();
  }

  async _loadModel(refresh = false) {
    this._status(refresh ? "Reloading game data…" : "Loading game data…");
    try {
      this._model = await this._hass.callWS({ type: "satisfactory_frm/planner/model", entry_id: this._entry, refresh });
    } catch (e) {
      this._model = null;
      this._status("");
      this._renderPlanPane(e.code === "not_ready"
        ? "The world isn't loaded on the server right now. The planner needs the live save for recipes and unlocks."
        : `Couldn't load game data: ${e.message || e}`);
      return;
    }
    this._items = this._model.items || {};
    this._recipeByCls = Object.fromEntries((this._model.recipes || []).map((r) => [r.cls, r]));
    this.$("items").innerHTML = (this._model.producible || [])
      .map((c) => `<option value="${pesc(this._items[c]?.name || c)}"></option>`).join("");
    this._allNameToCls = {};
    const allItems = Object.keys(this._items).sort((a, b) => (this._items[a].name || a).localeCompare(this._items[b].name || b));
    for (const c of allItems) this._allNameToCls[(this._items[c].name || c).toLowerCase()] = c;
    this.$("allitems").innerHTML = allItems.map((c) => `<option value="${pesc(this._items[c].name || c)}"></option>`).join("");
    this._nameToCls = {};
    for (const c of this._model.producible || []) this._nameToCls[(this._items[c]?.name || c).toLowerCase()] = c;
    await this._loadPlans();
    this._status(refresh ? "Game data reloaded" : "");
    this._renderPlanPane();
    this._solveSoon(0);
  }

  async _loadPlans(selectId) {
    try {
      this._plans = await this._hass.callWS({ type: "satisfactory_frm/planner/plans", entry_id: this._entry });
    } catch (e) {
      this._plans = [];
    }
    const want = selectId || this._plan.id;
    const found = this._plans.find((p) => p.id === want);
    if (found) this._plan = clonePlan(found);
    else if (!this._plan.id && this._plans.length && !this._dirty) this._plan = clonePlan(this._plans[0]);
    this._renderPlanSelect();
  }

  _renderPlanSelect() {
    const sel = this.$("planSel");
    sel.innerHTML = `<option value="">${this._plan.id ? "+ New plan" : "Unsaved plan"}</option>` +
      this._plans.map((p) => `<option value="${pesc(p.id)}">${pesc(p.name)}</option>`).join("");
    sel.value = this._plan.id || "";
    this.$("planName").value = this._plan.name || "";
  }

  // ------------------------------------------------------------- events
  _act(act, arg, el, e) {
    switch (act) {
      case "tab": this._setTab(arg); break;
      case "toggle-sum": this.$("body").classList.toggle("show-sum"); break;
      case "save": this._savePlan(); break;
      case "new": this._newPlan(); break;
      case "delete": this._deletePlan(); break;
      case "refresh": this._loadModel(true); break;
      case "add": this._addTarget(); break;
      case "remove": this._plan.targets.splice(Number(arg), 1); this._changed(true); break;
      case "recipes": this._plan.options.recipes = arg; this._changed(true); break;
      case "surplus": this._plan.options.use_surplus = !this._plan.options.use_surplus; this._changed(true); break;
      case "exclude": this._toggleRecipe(arg, false); break;
      case "include": this._toggleRecipe(arg, true); break;
      case "zoom": this._zoomBy(Number(arg)); break;
      case "fit": if (this._isDesign()) this._fitDesign(); else this._fit(); break;
      case "relayout":
        if (this._isDesign()) { this._fitDesign(); break; }
        this._plan.positions = {}; this._markDirty(); this._renderFlow(true); break;
      case "close-detail": this._select(null); break;
      case "mode": this._setMode(arg); break;
      case "to-design": this._toDesign(); break;
      case "undo": this._undoRedo(-1); break;
      case "redo": this._undoRedo(1); break;
      case "fill": this._fill(); break;
      case "clear-design": if (confirm("Remove everything from this design?")) this._mutate((g) => { g.nodes = []; g.links = []; }, { pane: true }); break;
      case "del-sel": this._deleteSel(); break;
      case "dup": this._duplicate(); break;
      case "balance": this._balance(); break;
      case "menu-pick": this._menuPick(arg); break;
      case "menu-close": this.$("cmenu").hidden = true; this._pendingWire = null; break;
      case "goto": {
        const pr = this._ev?.problems?.[Number(arg)];
        const id = pr?.node || pr?.link;
        if (id) { if (matchMedia("(max-width:760px)").matches) this._setTab("flow"); this._selectDesign(id); this._centerOn(id); }
        break;
      }
      default: break;
    }
  }

  _onChange(e) {
    const t = e.target;
    if (t.dataset.field && this._isDesign()) { this._designField(t.dataset.field, t.value); return; }
    if (t.id === "server") {
      this._entry = t.value;
      try { localStorage.setItem("sfrm_planner_server", t.value); } catch (_) {}
      this._plan = blankPlan();
      this._dirty = false;
      this._loadModel();
    } else if (t.id === "planSel") {
      if (this._dirty && !confirm("Discard unsaved changes to this plan?")) { this._renderPlanSelect(); return; }
      const p = this._plans.find((x) => x.id === t.value);
      this._plan = p ? clonePlan(p) : blankPlan();
      this._dirty = false;
      this._status("");
      this._renderPlanSelect();
      this._renderPlanPane();
      this._solveSoon(0, true);
    } else if (t.dataset.rate !== undefined) {
      const v = Math.max(0, Number(t.value) || 0);
      this._plan.targets[Number(t.dataset.rate)].rate = v;
      this._changed(false);
    }
  }

  _onInput(e) {
    const t = e.target;
    if (t.id === "palQ") {
      this._paletteQ = t.value;
      clearTimeout(this._palT);
      this._palT = setTimeout(() => {
        const pos = t.selectionStart;
        this._renderPlanPane();
        const q = this.shadowRoot.getElementById("palQ");
        if (q) { q.focus(); q.setSelectionRange(pos, pos); }
      }, 150);
      return;
    }
    if (t.dataset.planname !== undefined) {
      this._plan.name = t.value;
      this.shadowRoot.querySelectorAll("[data-planname]").forEach((el) => { if (el !== t) el.value = t.value; });
      this._markDirty();
    }
    else if (t.dataset.rate !== undefined) {
      const v = Number(t.value);
      if (Number.isFinite(v) && v >= 0) { this._plan.targets[Number(t.dataset.rate)].rate = v; this._changed(false); }
    }
  }

  _addTarget() {
    const input = this.$("addItem") || this.shadowRoot.getElementById("addItem");
    if (!input) return;
    const cls = this._nameToCls?.[input.value.trim().toLowerCase()];
    if (!cls) { this._toast(input.value ? `No item called “${input.value}”.` : "Type an item name first."); return; }
    const existing = this._plan.targets.find((t) => t.item === cls);
    if (existing) existing.rate += 10;
    else this._plan.targets.push({ item: cls, rate: 10 });
    input.value = "";
    this._changed(true);
  }

  _toggleRecipe(cls, include) {
    const o = this._plan.options;
    o.disabled = (o.disabled || []).filter((c) => c !== cls);
    o.enabled = (o.enabled || []).filter((c) => c !== cls);
    if (!include) o.disabled.push(cls);
    else if (!this._recipeByCls[cls]?.unlocked && o.recipes !== "all") o.enabled.push(cls);
    this._changed(true);
  }

  _changed(structural) {
    this._markDirty();
    if (structural) this._renderPlanPane();
    this._solveSoon(350);
  }
  _markDirty() {
    this._dirty = true;
    this._status("Unsaved changes", true);
  }

  async _savePlan() {
    if (!this._entry) return;
    const plan = { ...this._plan, name: (this._plan.name || "").trim() || defaultName(this._plan, this._items) };
    try {
      const saved = await this._hass.callWS({ type: "satisfactory_frm/planner/plans/save", entry_id: this._entry, plan: toWire(plan) });
      this._plan = clonePlan(saved);
      this._dirty = false;
      this._status("Saved");
      await this._loadPlans(saved.id);
    } catch (e) {
      this._toast(`Couldn't save: ${e.message || e}`);
    }
  }

  _newPlan() {
    if (this._dirty && !confirm("Discard unsaved changes to this plan?")) return;
    this._plan = blankPlan();
    this._dirty = false;
    this._status("");
    this._renderPlanSelect();
    this._renderPlanPane();
    this._solveSoon(0, true);
  }

  async _deletePlan() {
    if (!this._plan.id) { this._newPlan(); return; }
    if (!confirm(`Delete the plan “${this._plan.name}”? Everyone using this Home Assistant loses it.`)) return;
    try {
      await this._hass.callWS({ type: "satisfactory_frm/planner/plans/delete", entry_id: this._entry, plan_id: this._plan.id });
    } catch (e) {
      this._toast(`Couldn't delete: ${e.message || e}`);
      return;
    }
    this._plan = blankPlan();
    this._dirty = false;
    this._status("Deleted");
    await this._loadPlans();
    this._renderPlanPane();
    this._solveSoon(0, true);
  }

  // ------------------------------------------------------------- solving
  _solveSoon(ms, fit = false) {
    clearTimeout(this._solveT);
    this._fitNext = this._fitNext || fit;
    this._solveT = setTimeout(() => this._solve(), ms);
  }

  async _solve() {
    if (!this._model) return;
    if (this._isDesign()) { this._renderDesignFlow(this._fitNext || !this._laidOut); this._fitNext = false; this._renderSummary(); this._renderPlanPane(); return; }
    const targets = this._plan.targets.filter((t) => t.rate > 0);
    if (!targets.length) {
      this._result = null;
      this._renderFlow();
      this._renderSummary();
      this._renderPlanPane();
      return;
    }
    const seq = (this._seq = (this._seq || 0) + 1);
    try {
      const r = await this._hass.callWS({
        type: "satisfactory_frm/planner/solve", entry_id: this._entry,
        targets: targets.map((t) => ({ item: t.item, rate: t.rate })), options: this._plan.options,
      });
      if (seq !== this._seq) return; // a newer solve is on its way
      this._result = r;
    } catch (e) {
      if (seq !== this._seq) return;
      this._result = { ok: false, error: e.message || String(e) };
    }
    const fit = this._fitNext || !this._laidOut;
    this._fitNext = false;
    this._renderFlow(fit);
    this._renderSummary();
    this._renderPlanPane();
  }

  // ------------------------------------------------------------- plan pane
  _renderPlanPane(message) {
    const pane = this.$("planPane");
    if (!message && this._model && this._isDesign()) { this._renderDesignPane(); return; }
    if (message) { pane.innerHTML = `<div class="panel"><div class="muted" style="font-size:14px;line-height:1.5">${pesc(message)}</div></div>`; return; }
    if (!this._model) { pane.innerHTML = `<div class="panel"><div class="muted">Loading…</div></div>`; return; }
    const focusId = this.shadowRoot.activeElement?.dataset?.rate;
    const p = this._plan, o = p.options, r = this._result;
    const targets = p.targets.map((t, i) => `
      <div class="target">
        <span class="name" title="${pesc(this._name(t.item))}">${pesc(this._name(t.item))}</span>
        <input type="number" min="0" step="any" value="${fmt(t.rate, 3)}" data-rate="${i}" aria-label="${pesc(this._name(t.item))} per minute">
        <button class="btn ghost icon" data-act="remove" data-arg="${i}" aria-label="Remove ${pesc(this._name(t.item))}">✕</button>
      </div>`).join("");
    const used = (r?.steps || []).map((s) => s.recipe);
    const usedHtml = (r?.steps || []).map((s) => `
      <div class="ritem"><span class="t" title="${pesc(s.name)}">${pesc(s.name.replace(/^Alternate: /, ""))}</span>
        ${s.alternate ? `<span class="badge alt">ALT</span>` : ""}${!s.unlocked ? `<span class="badge lock">LOCKED</span>` : ""}
        <button class="btn ghost icon" data-act="exclude" data-arg="${pesc(s.recipe)}" aria-label="Don't use ${pesc(s.name)}" title="Don't use this recipe">✕</button></div>`).join("");
    const excluded = (o.disabled || []).map((c) => this._recipeByCls[c]).filter(Boolean);
    const exclHtml = excluded.map((rc) => `
      <div class="ritem"><span class="t" style="color:${PC.dim};text-decoration:line-through">${pesc(rc.name.replace(/^Alternate: /, ""))}</span>
        <button class="btn ghost" data-act="include" data-arg="${pesc(rc.cls)}" aria-label="Use ${pesc(rc.name)} again">USE</button></div>`).join("");
    // Alternates that could make something in this plan but aren't used.
    const planItems = new Set([...(r?.steps || []).flatMap((s) => s.outputs.map((x) => x.item)), ...p.targets.map((t) => t.item)]);
    const altChoices = (this._model.recipes || []).filter((rc) =>
      rc.alternate && !used.includes(rc.cls) && !(o.disabled || []).includes(rc.cls) &&
      Object.keys(rc.outputs).some((i) => planItems.has(i)) && (rc.unlocked || o.recipes === "all"))
      .slice(0, 12);
    const surplusN = Object.keys(this._model.surplus || {}).length;
    pane.innerHTML = `
      ${this._modeSwitch()}
      <section class="panel narrow-only" aria-label="Plan name">
        <h2>PLAN</h2>
        <div class="add"><input type="text" data-planname value="${pesc(p.name || "")}" placeholder="Plan name" aria-label="Plan name" style="grid-column:1/-1"></div>
        <button class="btn ghost" data-act="refresh" style="margin-top:8px;width:100%">RELOAD GAME DATA</button>
      </section>
      <section class="panel" aria-label="Products">
        <h2>PRODUCTS · PER MINUTE</h2>
        ${targets || `<div class="muted" style="margin-bottom:10px">Add what you want this factory to make.</div>`}
        <div class="add"><input id="addItem" type="text" list="items" placeholder="Add a product…" aria-label="Add a product">
          <button class="btn icon" data-act="add" aria-label="Add product">+</button></div>
      </section>
      <section class="panel" aria-label="Options">
        <h2>OPTIONS</h2>
        <div class="opt"><span>Recipes</span><span class="seg" role="group" aria-label="Recipes to use">
          <button data-act="recipes" data-arg="unlocked" aria-pressed="${o.recipes !== "all"}">UNLOCKED</button>
          <button data-act="recipes" data-arg="all" aria-pressed="${o.recipes === "all"}">ALL</button></span></div>
        <div class="opt"><span>Use factory surplus<br><span class="muted">${surplusN ? `${surplusN} items in surplus right now` : "No surplus right now"}</span></span>
          <button class="switch" role="switch" aria-checked="${!!o.use_surplus}" data-act="surplus" aria-label="Use factory surplus"><span></span></button></div>
        ${o.recipes === "all" ? `<div class="muted">Plans with ALL recipes can use ones you haven't unlocked; they're marked LOCKED.</div>` : ""}
      </section>
      ${r?.ok && r.steps.length ? `<button class="btn" data-act="to-design" style="width:100%">EDIT AS DESIGN</button>` : ""}
      ${usedHtml ? `<section class="panel" aria-label="Recipes used"><h2>RECIPES USED</h2><div class="rlist">${usedHtml}</div>
        <div class="muted" style="margin-top:8px">✕ stops the planner using a recipe.</div></section>` : ""}
      ${altChoices.length ? `<section class="panel" aria-label="Alternates available"><h2>ALTERNATES AVAILABLE</h2><div class="rlist">${altChoices.map((rc) =>
        `<div class="ritem"><span class="t" title="${pesc(rc.name)}">${pesc(rc.name.replace(/^Alternate: /, ""))}</span>${!rc.unlocked ? `<span class="badge lock">LOCKED</span>` : ""}</div>`).join("")}</div>
        <div class="muted" style="margin-top:8px">The planner already picks the cheapest; to force one, exclude the recipe it replaces.</div></section>` : ""}
      ${exclHtml ? `<section class="panel" aria-label="Excluded recipes"><h2>EXCLUDED</h2><div class="rlist">${exclHtml}</div></section>` : ""}
      <div class="muted" style="text-align:center">Game data from ${pesc(this._model.session_name || "the live save")} · ${(this._model.recipes || []).filter((x) => x.unlocked).length} recipes unlocked</div>`;
    if (focusId !== undefined) {
      const el = pane.querySelector(`[data-rate="${focusId}"]`);
      if (el) { el.focus(); const v = el.value; el.value = ""; el.value = v; }
    }
  }

  // ------------------------------------------------------------- flowchart
  _initFlow() {
    const svg = this.$("svg"), pane = this.$("flowPane");
    const pointers = new Map();
    let drag = null, pinch = null, moved = false;
    const toWorld = (cx, cy) => {
      const r = svg.getBoundingClientRect();
      return [(cx - r.left - this._view.x) / this._view.k, (cy - r.top - this._view.y) / this._view.k];
    };
    svg.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      svg.setPointerCapture(e.pointerId);
      moved = false;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: this._view.k, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
        drag = null;
        return;
      }
      if (this._isDesign()) {
        this.$("cmenu").hidden = true;
        const port = e.target.closest(".port");
        if (port) { drag = this._startWire(port, e); moved = false; return; }
        const lk = e.target.closest(".linkhit, .linklabel");
        if (lk) { drag = { kind: "link", id: lk.dataset.link }; return; }
        const dn = e.target.closest(".node");
        if (dn) {
          const n = this._plan.graph.nodes.find((x) => x.id === dn.dataset.id);
          const [wx, wy] = toWorld(e.clientX, e.clientY);
          drag = { kind: "dnode", n, dx: wx - n.x, dy: wy - n.y, before: JSON.stringify(this._plan.graph) };
          return;
        }
      }
      const node = e.target.closest(".node");
      if (node) {
        const id = node.dataset.id, pos = this._pos[id];
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        drag = { kind: "node", id, dx: wx - pos[0], dy: wy - pos[1] };
      } else {
        drag = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: this._view.x, vy: this._view.y };
        pane.classList.add("panning");
      }
    });
    svg.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this._zoomAt(pinch.k * (d / pinch.d), pinch.cx, pinch.cy);
        moved = true;
        return;
      }
      if (!drag) return;
      if (drag.kind === "wire") { moved = true; this._moveWire(drag, e.clientX, e.clientY); return; }
      if (drag.kind === "link") return;
      if (drag.kind === "dnode") {
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        const nx = Math.round(wx - drag.dx), ny = Math.round(wy - drag.dy);
        if (Math.abs(nx - drag.n.x) + Math.abs(ny - drag.n.y) > 2 || moved) {
          moved = true;
          drag.n.x = nx;
          drag.n.y = ny;
          this._drawDesign();
        }
        return;
      }
      if (drag.kind === "pan") {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        this._view.x = drag.vx + dx;
        this._view.y = drag.vy + dy;
        this._applyView();
      } else {
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        const nx = Math.round(wx - drag.dx), ny = Math.round(wy - drag.dy);
        const old = this._pos[drag.id];
        if (Math.abs(nx - old[0]) + Math.abs(ny - old[1]) > 2) moved = true;
        if (moved) {
          this._pos[drag.id] = [nx, ny];
          this._plan.positions[drag.id] = [nx, ny];
          this._drawGraph();
        }
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag?.kind === "wire") { if (e.type === "pointerup") this._endWire(drag, e.clientX, e.clientY); else this.shadowRoot.getElementById("wire")?.setAttribute("d", ""); drag = null; return; }
      if (drag?.kind === "link") { this._selectDesign(drag.id); drag = null; return; }
      if (drag?.kind === "dnode") {
        if (moved) {
          (this._undo ||= []).push(drag.before);
          this._redo = [];
          this._markDirty();
          this._renderProblems();
        } else this._selectDesign(drag.n.id);
        drag = null;
        return;
      }
      if (drag?.kind === "node") {
        if (moved) this._markDirty();
        else this._select(drag.id);
      } else if (drag?.kind === "pan" && !moved) this._select(null);
      drag = null;
      pane.classList.remove("panning");
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      this._zoomAt(this._view.k * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
  }

  _zoomAt(k, cx, cy) {
    const svg = this.$("svg"), r = svg.getBoundingClientRect();
    k = Math.min(3, Math.max(0.15, k));
    const px = cx - r.left, py = cy - r.top;
    this._view.x = px - ((px - this._view.x) * k) / this._view.k;
    this._view.y = py - ((py - this._view.y) * k) / this._view.k;
    this._view.k = k;
    this._applyView();
  }
  _zoomBy(f) {
    const r = this.$("svg").getBoundingClientRect();
    this._zoomAt(this._view.k * f, r.left + r.width / 2, r.top + r.height / 2);
  }
  _applyView() {
    this.$("vp").setAttribute("transform", `translate(${this._view.x},${this._view.y}) scale(${this._view.k})`);
  }
  _fit() {
    const nodes = this._nodes || [];
    const svg = this.$("svg"), r = svg.getBoundingClientRect();
    if (!nodes.length || !r.width) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const [x, y] = this._pos[n.id];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + (n.w || NODE_W)); y1 = Math.max(y1, y + n.h);
    }
    const pad = 40;
    // Don't shrink below readable: big plans start at the left edge, pan for the rest.
    const minK = r.width < 600 ? 0.4 : 0.62;
    const k = Math.min(1.1, Math.max(minK, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
    const fitsX = (x1 - x0) * k <= r.width - pad * 2, fitsY = (y1 - y0) * k <= r.height - pad * 2;
    this._view = {
      k,
      x: fitsX ? (r.width - (x1 - x0) * k) / 2 - x0 * k : pad - x0 * k,
      y: fitsY ? (r.height - (y1 - y0) * k) / 2 - y0 * k : pad - y0 * k,
    };
    this._applyView();
  }

  _renderFlow(fit) {
    if (this._isDesign()) { this._renderDesignFlow(fit); return; }
    const empty = this.$("emptyFlow");
    const r = this._result;
    if (!r || !r.ok) {
      this._nodes = [];
      this.$("vp").innerHTML = "";
      empty.hidden = false;
      empty.innerHTML = !this._model ? "" : r && !r.ok
        ? `The planner couldn't solve this: ${pesc(r.error || "unknown error")}`
        : `Add a product on the left to see how to make it.<br><span style="font-size:12px">Drag to pan · scroll or pinch to zoom · drag boxes to arrange them</span>`;
      this._select(null);
      return;
    }
    empty.hidden = true;
    const { nodes, edges } = graphFromResult(r, this._items);
    this._nodes = nodes;
    this._edges = edges;
    this._pos = layout(nodes, edges, this._plan.positions || {});
    this._laidOut = true;
    this._drawGraph();
    if (fit) { requestAnimationFrame(() => this._fit()); setTimeout(() => this._fit(), 120); }
    else this._applyView();
    if (this._sel && !nodes.some((n) => n.id === this._sel)) this._select(null);
    else if (this._sel) this._select(this._sel);
  }

  _drawGraph() {
    if (this._isDesign()) { this._drawDesign(); return; }
    const nodes = this._nodes, edges = this._edges, pos = this._pos;
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    // Ports: spread each node's outgoing and incoming edges along its sides.
    const outs = {}, ins = {};
    for (const e of edges) { (outs[e.from] ||= []).push(e); (ins[e.to] ||= []).push(e); }
    const portY = (list, e, id) => {
      const n = byId[id], i = list.indexOf(e), k = list.length;
      return pos[id][1] + (n.h * (i + 1)) / (k + 1);
    };
    for (const id of Object.keys(outs)) outs[id].sort((a, b) => pos[a.to][1] - pos[b.to][1]);
    for (const id of Object.keys(ins)) ins[id].sort((a, b) => pos[a.from][1] - pos[b.from][1]);
    let edgeSvg = "", labelSvg = "";
    for (const e of edges) {
      if (!byId[e.from] || !byId[e.to]) continue;
      const x1 = pos[e.from][0] + NODE_W, y1 = portY(outs[e.from], e, e.from);
      const x2 = pos[e.to][0], y2 = portY(ins[e.to], e, e.to);
      const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
      const back = x2 < x1 + 20; // loops (e.g. recycled plastic) go backwards
      const path = back
        ? `M${x1},${y1} C${x1 + 80},${y1} ${x1 + 80},${Math.max(y1, y2) + 90} ${(x1 + x2) / 2},${Math.max(y1, y2) + 90} S${x2 - 80},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      const color = e.lanes > 1 ? PC.amber : e.fluid ? PC.cyan : "#7f8ba0";
      const w = Math.max(1.5, Math.min(7, 1.2 + Math.log2(1 + e.rate / 15)));
      edgeSvg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${w.toFixed(1)}" stroke-opacity=".75"${e.dashed ? ` stroke-dasharray="6 5"` : ""}/>`;
      const mx = back ? (x1 + x2) / 2 : (x1 + x2) / 2, my = back ? Math.max(y1, y2) + 90 : (y1 + y2) / 2;
      const txt = `${e.name.length > 16 ? e.name.slice(0, 15) + "…" : e.name} · ${fmt(e.rate, 2)}`;
      const tier = e.carrier ? `${e.lanes > 1 ? `${e.lanes}× ` : ""}${tierShort(e.carrier_name || e.carrier)}` : "";
      const tw = Math.max(txt.length * 6.4, tier.length * 6) + 16;
      labelSvg += `<g transform="translate(${mx - tw / 2},${my - 17})"><rect width="${tw}" height="${tier ? 34 : 20}" rx="5" fill="#0d1117" stroke="${PC.line}"/>
        <text x="${tw / 2}" y="14" text-anchor="middle" font-size="11" fill="${PC.text2}" font-family="JetBrains Mono, monospace">${pesc(txt)}</text>
        ${tier ? `<text x="${tw / 2}" y="28" text-anchor="middle" font-size="10" fill="${e.lanes > 1 ? PC.amber : PC.dim}" font-family="JetBrains Mono, monospace">${pesc(tier)}</text>` : ""}</g>`;
    }
    let nodeSvg = "";
    for (const n of nodes) {
      const [x, y] = pos[n.id];
      nodeSvg += `<g class="node" data-id="${pesc(n.id)}" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="${pesc(n.aria)}">${nodeBody(n, n.id === this._sel)}</g>`;
    }
    this.$("vp").innerHTML = `<g>${edgeSvg}</g><g>${labelSvg}</g><g>${nodeSvg}</g>`;
  }

  _select(id) {
    if (this._isDesign()) { this._selectDesign(id); return; }
    this._sel = id;
    const box = this.$("detail");
    const n = (this._nodes || []).find((x) => x.id === id);
    if (!n) { box.hidden = true; if (this._nodes?.length) this._drawGraph(); return; }
    const rows = (list) => list.map((x) => `<tr><td>${pesc(x.name)}</td><td class="r">${fmt(x.rate, 3)}/min</td></tr>`).join("");
    let html = `<div class="row sp"><strong style="font-size:15px">${pesc(n.title)}</strong>
      <button class="btn ghost icon" data-act="close-detail" aria-label="Close details">✕</button></div>`;
    if (n.step) {
      const s = n.step;
      html += `<div class="muted">${s.count} × ${pesc(s.building_name)} at ${fmt(s.clock, 2)}% · ${fmt(s.power, 1)} MW · exact ${fmt(s.machines, 3)} machines</div>
        ${!s.unlocked ? `<div class="warn" style="margin-top:8px">This recipe isn't unlocked in your save yet.</div>` : ""}
        ${!s.building_unlocked ? `<div class="warn" style="margin-top:8px">You haven't unlocked the ${pesc(s.building_name)} yet.</div>` : ""}
        <div class="lbl" style="margin-top:10px">IN</div><table>${rows(s.inputs)}</table>
        <div class="lbl" style="margin-top:10px">OUT</div><table>${rows(s.outputs)}</table>
        <div style="margin-top:10px"><button class="btn ghost" data-act="exclude" data-arg="${pesc(s.recipe)}">DON'T USE THIS RECIPE</button></div>`;
    } else if (n.raw) {
      const x = n.raw, fb = x.free_by_purity || {};
      html += `<div class="muted" style="margin-top:4px">${fmt(x.rate, 2)}/min from the map.</div>
        ${x.normal_nodes !== undefined ? `<table><tr><td>${pesc(x.extractor_name)} on Normal nodes</td><td class="r">${fmt(x.normal_nodes, 2)}</td></tr>
        <tr><td>Free nodes (pure · normal · impure)</td><td class="r">${fb.Pure ?? 0} · ${fb.Normal ?? 0} · ${fb.Impure ?? 0}</td></tr>
        <tr><td>All free nodes could give</td><td class="r">${fmt(x.free_capacity, 0)}/min</td></tr></table>` : ""}
        ${x.extractors !== undefined ? `<table><tr><td>${pesc(x.extractor_name)}s at 100%</td><td class="r">${x.extractors}</td></tr></table>` : ""}`;
    } else {
      html += `<div class="muted" style="margin-top:4px">${pesc(n.sub)}</div>`;
    }
    box.innerHTML = html;
    box.hidden = false;
    this._drawGraph();
  }

  // ------------------------------------------------------------- summary
  _renderSummary() {
    if (this._isDesign() && this._model) { this._renderDesignSummary(); return; }
    const pane = this.$("sumPane");
    const r = this._result;
    if (!r || !r.ok) {
      pane.innerHTML = `<div class="panel"><h2>SUMMARY</h2><div class="muted">${r && !r.ok ? pesc(r.error) : "Nothing planned yet."}</div></div>`;
      return;
    }
    const t = r.totals;
    const head = (r.power_headroom || []).filter((c) => !c.fuse);
    const best = head.length ? Math.max(...head.map((c) => c.headroom)) : null;
    const over = best !== null && t.power > best;
    const pct = best ? Math.min(100, (t.power / Math.max(best, 1)) * 100) : 0;
    const multi = (r.edges || []).filter((e) => e.lanes > 1);
    pane.innerHTML = `
      ${r.missing.length ? `<div class="err"><strong>Can't make everything.</strong> No usable recipe for: ${r.missing.map((m) => `${pesc(m.name)} (${fmt(m.rate, 2)}/min)`).join(", ")}.
        ${this._plan.options.recipes !== "all" ? "Switch Recipes to ALL to plan with ones you haven't unlocked." : ""}</div>` : ""}
      <section class="panel" aria-label="Totals"><h2>TOTALS</h2>
        <div class="kpis">
          <div class="kpi"><div class="lbl">POWER</div><div class="v" style="color:${over ? PC.red : PC.text}">${fmt(t.power, 1)}<span style="font-size:12px"> MW</span></div></div>
          <div class="kpi"><div class="lbl">MACHINES</div><div class="v">${t.machines}</div></div>
        </div>
        ${best !== null ? `<div class="muted" style="margin-top:10px">${over ? `Needs ${fmt(t.power - best, 1)} MW more than your best grid has spare (${fmt(best, 0)} MW).` : `Fits in your grid's spare ${fmt(best, 0)} MW.`}</div>
          <div class="bar"><span style="width:${pct.toFixed(0)}%;background:${over ? PC.red : pct > 85 ? PC.amber : PC.cyan}"></span></div>` : ""}
      </section>
      <section class="panel" aria-label="Buildings"><h2>BUILDINGS</h2><table class="t">${t.buildings.map((b) =>
        `<tr><td>${pesc(b.name)}</td><td class="r">${b.count}</td></tr>`).join("")}</table></section>
      <section class="panel" aria-label="Raw resources"><h2>RAW RESOURCES</h2><table class="t">${r.raw.map((x) => {
        const fb = x.free_by_purity || {};
        const note = x.normal_nodes !== undefined
          ? `${fmt(x.normal_nodes, 2)} normal node${x.normal_nodes === 1 ? "" : "s"} (${x.extractor_name}) · free ${fb.Pure ?? 0}P ${fb.Normal ?? 0}N ${fb.Impure ?? 0}I`
          : x.extractors !== undefined ? `${x.extractors} × ${x.extractor_name}` : "";
        return `<tr><td>${pesc(x.name)}<div class="muted">${pesc(note)}</div></td><td class="r">${fmt(x.rate, 2)}</td></tr>`;
      }).join("") || `<tr><td class="muted">None</td></tr>`}</table>
        ${r.raw.some((x) => x.normal_nodes !== undefined) ? `<div class="muted" style="margin-top:6px">Node counts assume your best unlocked extractor at 100%. P / N / I = free pure, normal and impure nodes.</div>` : ""}</section>
      ${r.surplus.length ? `<section class="panel" aria-label="From factory surplus"><h2>FROM YOUR SURPLUS</h2><table class="t">${r.surplus.map((x) =>
        `<tr><td>${pesc(x.name)}</td><td class="r">${fmt(x.rate, 2)}</td></tr>`).join("")}</table></section>` : ""}
      ${r.byproducts.length ? `<section class="panel" aria-label="Byproducts"><h2>BYPRODUCTS</h2><table class="t">${r.byproducts.map((x) =>
        `<tr><td>${pesc(x.name)}</td><td class="r">${fmt(x.rate, 2)}</td></tr>`).join("")}</table>
        <div class="muted" style="margin-top:6px">Made but not used: sink them or plan something that uses them.</div></section>` : ""}
      <section class="panel" aria-label="Transport"><h2>TRANSPORT</h2>
        <div class="muted">Fastest unlocked: ${pesc(r.transport.belt?.name || "no belts")} (${fmt(r.transport.belt?.rate, 0)}/min)${r.transport.pipe ? ` · ${pesc(r.transport.pipe.name)} (${fmt(r.transport.pipe.rate, 0)} m³/min)` : ""}</div>
        ${multi.length ? `<div class="warn" style="margin-top:8px">${multi.length} link${multi.length === 1 ? " needs" : "s need"} more than one belt or pipe: ${multi.slice(0, 4).map((e) => `${pesc(e.name)} ${fmt(e.rate, 0)}/min → ${e.lanes}× ${pesc(tierShort(e.carrier_name))}`).join(", ")}</div>` : ""}
      </section>
      <section class="panel" aria-label="Build cost"><h2>BUILD COST</h2><table class="t">${t.cost.map((c) =>
        `<tr><td>${pesc(c.name)}</td><td class="r">${fmt(c.amount, 0)}</td></tr>`).join("")}</table>
        <div class="muted" style="margin-top:6px">Machines only; belts, pipes, power and foundations not included.</div></section>`;
  }

  // ------------------------------------------------------------- misc
  _setTab(tab) {
    this._tab = tab;
    this.$("body").dataset.tab = tab;
    this.shadowRoot.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.arg === tab)));
    if (tab === "flow") requestAnimationFrame(() => (!this._laidOut ? null : this._isDesign() ? this._fitDesign() : this._fit()));
  }
  _name(cls) { return this._items?.[cls]?.name || cls; }
  _status(msg, dirty = false) {
    const s = this.$("status");
    s.textContent = msg;
    s.classList.toggle("dirty", dirty);
  }
  _toast(msg) {
    let el = this.shadowRoot.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); this.shadowRoot.querySelector(".app").appendChild(el); }
    el.textContent = msg;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.remove(), Math.max(3000, msg.length * 60));
  }
}

// ------------------------------------------------------------------ plan helpers
function blankPlan() {
  return { id: null, name: "", mode: "solve", graph: { nodes: [], links: [] }, targets: [], options: { recipes: "unlocked", disabled: [], enabled: [], use_surplus: false }, positions: {} };
}
function clonePlan(p) {
  const b = blankPlan();
  return {
    ...b, ...JSON.parse(JSON.stringify(p)),
    options: { ...b.options, ...(p.options || {}) },
    positions: { ...(p.positions || {}) },
    targets: (p.targets || []).map((t) => ({ item: t.item, rate: Number(t.rate) || 0 })),
    mode: p.mode === "design" ? "design" : "solve",
    graph: { nodes: [...(p.graph?.nodes || [])].map((n) => ({ ...n })), links: [...(p.graph?.links || [])].map((l) => ({ ...l })) },
  };
}
function toWire(p) {
  const out = { name: p.name, targets: p.targets, options: p.options, positions: p.positions, notes: p.notes || "", mode: p.mode, graph: p.graph };
  if (p.id) out.id = p.id;
  return out;
}
function defaultName(p, items) {
  const t = p.targets[0];
  return t ? `${items?.[t.item]?.name || t.item}${p.targets.length > 1 ? ` + ${p.targets.length - 1}` : ""}` : "New plan";
}

// ------------------------------------------------------------------ graph
function graphFromResult(r, items) {
  const nodes = [];
  const fluid = (c) => !!items?.[c]?.fluid;
  for (const x of r.raw) nodes.push({ id: x.id, kind: "raw", raw: x, title: x.name, sub: `${fmt(x.rate, 2)}/min`, h: 64, aria: `Raw ${x.name}, ${fmt(x.rate, 2)} per minute` });
  for (const x of r.surplus) nodes.push({ id: x.id, kind: "surplus", title: x.name, sub: `${fmt(x.rate, 2)}/min from your factory's surplus`, h: 64, aria: `${x.name} from surplus` });
  for (const x of r.missing) nodes.push({ id: x.id, kind: "missing", title: x.name, sub: `${fmt(x.rate, 2)}/min · no usable recipe`, h: 64, aria: `${x.name} can't be made` });
  for (const s of r.steps) nodes.push({ id: s.id, kind: "step", step: s, title: s.name.replace(/^Alternate: /, ""), sub: "", h: 84,
    aria: `${s.count} ${s.building_name} making ${s.name} at ${fmt(s.clock, 1)} percent` });
  for (const x of r.outputs) nodes.push({ id: x.id, kind: "target", title: x.name, sub: `${fmt(x.rate, 2)}/min`, h: 64, aria: `Output ${x.name}, ${fmt(x.rate, 2)} per minute` });
  for (const x of r.byproducts) nodes.push({ id: x.id, kind: "byproduct", title: x.name, sub: `${fmt(x.rate, 2)}/min spare`, h: 64, aria: `Byproduct ${x.name}` });
  const edges = (r.edges || []).map((e) => ({ ...e, fluid: fluid(e.item), dashed: e.to.startsWith("byproduct:") }));
  return { nodes, edges };
}

/** Layered layout: columns by longest path from the sources, rows ordered to
 *  reduce crossings (barycenter sweeps). Saved positions win. Handles loops. */
function layout(nodes, edges, saved) {
  const ids = nodes.map((n) => n.id);
  const preds = {}, succs = {};
  for (const id of ids) { preds[id] = []; succs[id] = []; }
  for (const e of edges) {
    if (!(e.from in preds) || !(e.to in preds) || e.from === e.to) continue;
    succs[e.from].push(e.to);
    preds[e.to].push(e.from);
  }
  // Topological order, breaking cycles at the node with the fewest open inputs.
  const indeg = Object.fromEntries(ids.map((id) => [id, new Set(preds[id]).size]));
  const done = new Set(), order = [];
  while (order.length < ids.length) {
    let next = ids.find((id) => !done.has(id) && indeg[id] === 0);
    if (!next) next = ids.filter((id) => !done.has(id)).sort((a, b) => indeg[a] - indeg[b])[0];
    done.add(next);
    order.push(next);
    for (const s of new Set(succs[next])) if (!done.has(s)) indeg[s]--;
  }
  const rank = {};
  const pos = Object.fromEntries(order.map((id, i) => [id, i]));
  for (const id of order) {
    const p = preds[id].filter((u) => pos[u] < pos[id]);
    rank[id] = p.length ? Math.max(...p.map((u) => rank[u])) + 1 : 0;
  }
  // Outputs line up in the last column.
  const maxRank = Math.max(0, ...ids.map((id) => rank[id]));
  for (const n of nodes) if (n.kind === "target") rank[n.id] = maxRank + (nodes.some((m) => m.kind !== "target" && rank[m.id] === maxRank) ? 1 : 0);
  const cols = [];
  for (const n of nodes) (cols[rank[n.id]] ||= []).push(n);
  const kindOrder = { missing: 0, raw: 1, surplus: 2, step: 3, byproduct: 4, target: 5 };
  cols.forEach((c) => c && c.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]));
  const idx = {};
  const reindex = () => cols.forEach((c) => c && c.forEach((n, i) => (idx[n.id] = i)));
  reindex();
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const range = down ? cols.map((_, i) => i) : cols.map((_, i) => i).reverse();
    for (const ci of range) {
      const c = cols[ci];
      if (!c) continue;
      const bary = (n) => {
        const nb = (down ? preds[n.id] : succs[n.id]).filter((u) => idx[u] !== undefined);
        return nb.length ? nb.reduce((s, u) => s + idx[u], 0) / nb.length : idx[n.id];
      };
      c.sort((a, b) => bary(a) - bary(b));
      c.forEach((n, i) => (idx[n.id] = i));
    }
  }
  const out = {};
  const heights = cols.map((c) => (c || []).reduce((s, n) => s + n.h + ROW_GAP, 0));
  const tallest = Math.max(0, ...heights);
  cols.forEach((c, ci) => {
    if (!c) return;
    let y = (tallest - heights[ci]) / 2;
    for (const n of c) {
      out[n.id] = [ci * (NODE_W + COL_GAP), Math.round(y)];
      y += n.h + ROW_GAP;
    }
  });
  for (const id of ids) if (Array.isArray(saved[id]) && saved[id].length === 2) out[id] = saved[id].map(Number);
  return out;
}

function nodeBody(n, selected) {
  const W = NODE_W, H = n.h;
  const theme = {
    raw: { fill: "#0f1a1e", stroke: "#2a5662", tag: "RAW", tagc: PC.cyan },
    surplus: { fill: "#0f1a14", stroke: "#2c5a3e", tag: "SURPLUS", tagc: PC.green },
    missing: { fill: "#2a1012", stroke: "#6e2a26", tag: "CAN'T MAKE", tagc: "#ff8a80" },
    step: { fill: PC.panel, stroke: PC.line, tag: "", tagc: PC.orange },
    target: { fill: "#221a0e", stroke: PC.orange, tag: "OUTPUT", tagc: PC.orange },
    byproduct: { fill: "#141922", stroke: "#3a4454", tag: "BYPRODUCT", tagc: PC.dim },
  }[n.kind];
  const stroke = selected ? PC.orange : theme.stroke;
  const sw = selected ? 2 : 1;
  const clip = (s, max) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  let body = `<rect class="box" width="${W}" height="${H}" rx="8" fill="${theme.fill}" stroke="${stroke}" stroke-width="${sw}"${n.kind === "byproduct" ? ` stroke-dasharray="5 4"` : ""}/>`;
  if (n.kind === "step") {
    const s = n.step;
    const clockC = s.clock < 99.9 ? PC.cyan : PC.text2;
    body += `<rect width="6" height="${H}" rx="3" fill="${s.unlocked ? PC.orange : PC.amber}"/>
      <text x="16" y="21" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="${PC.orange}">${s.count} × ${pesc(clip(s.building_name.toUpperCase(), 16))}</text>
      <text x="16" y="42" font-size="14" font-weight="600" fill="${PC.text}">${pesc(clip(n.title, 24))}</text>
      <text x="16" y="66" font-family="JetBrains Mono, monospace" font-size="11" fill="${clockC}">${fmt(s.clock, 2)}%</text>
      <text x="${W - 12}" y="66" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" fill="${PC.dim}">${fmt(s.power, 1)} MW</text>`;
    let bx = W - 12;
    const badge = (label, fg, bg) => {
      const w = label.length * 6.2 + 10;
      bx -= w;
      const out = `<rect x="${bx}" y="8" width="${w}" height="16" rx="3" fill="${bg}"/><text x="${bx + w / 2}" y="20" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="1" fill="${fg}">${label}</text>`;
      bx -= 4;
      return out;
    };
    if (!s.unlocked) body += badge("LOCKED", PC.amber, "#3d2c0b");
    if (s.alternate) body += badge("ALT", PC.cyan, "#123a44");
  } else {
    body += `<text x="12" y="19" font-size="10" font-weight="700" letter-spacing="1.6" fill="${theme.tagc}">${theme.tag}</text>
      <text x="12" y="39" font-size="14" font-weight="600" fill="${PC.text}">${pesc(clip(n.title, 24))}</text>
      <text x="12" y="56" font-family="JetBrains Mono, monospace" font-size="11" fill="${PC.text2}">${pesc(clip(n.sub, 30))}</text>`;
  }
  return body;
}

// ================================================================== design mode
// A plan in design mode is a graph you build by hand:
//   nodes: machine {recipe, count, clock} | supply {item, rate, label}
//          | output {item, want} | hub (splitter/merger, one item)
//   links: {from, to, item}  (from = output side, to = input side)
// evaluateDesign() works out what actually flows, live, in the browser.

const DW = 290; // design machine width
const HUB_W = 130;
const PORT_ROW = 20;
const PORT_TOP = 52;
let _idSeq = 0;
const newId = (p) => `${p}${Date.now().toString(36)}${(_idSeq++).toString(36)}`;
const scaleOf = (n) => (n.count || 1) * (n.clock ?? 100) / 100;
const POWER_EXP = 1.321928;
// Rounded clocks make "40 of 40.0002" common; ignore gaps below 0.1 % (min 0.01/min).
const isShort = (got, want) => got < want - Math.max(0.01, want * 0.001);
const isSpare = (spare, make) => spare > Math.max(0.05, make * 0.005);

/** Ports of a design node: inputs on the left, outputs on the right. */
function designPorts(n, ctx, graph) {
  if (n.type === "machine") {
    const r = ctx.recipes[n.recipe];
    const ins = Object.keys(r?.inputs || {}), outs = Object.keys(r?.outputs || {});
    return {
      ins: ins.map((item, i) => ({ item, y: PORT_TOP + PORT_ROW * i + 10 })),
      outs: outs.map((item, i) => ({ item, y: PORT_TOP + PORT_ROW * i + 10 })),
    };
  }
  if (n.type === "supply") return { ins: [], outs: [{ item: n.item, y: 40 }] };
  if (n.type === "output") return { ins: [{ item: n.item, y: 40 }], outs: [] };
  const item = hubItem(n, graph);
  return { ins: [{ item, y: 30, any: true }], outs: [{ item, y: 30, any: true }] };
}
function hubItem(n, graph) {
  if (n.item) return n.item;
  const l = graph.links.find((x) => x.from === n.id || x.to === n.id);
  return l ? l.item : null;
}
function designSize(n, ctx, graph) {
  if (n.type === "hub") return [HUB_W, 60];
  if (n.type !== "machine") return [NODE_W, 80];
  const p = designPorts(n, ctx, graph);
  return [DW, PORT_TOP + PORT_ROW * Math.max(1, p.ins.length, p.outs.length) + 30];
}

/** Can `from` send `item` to `to`? */
function canLink(graph, ctx, fromId, toId, item) {
  if (fromId === toId || !item) return false;
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const a = byId[fromId], b = byId[toId];
  if (!a || !b) return false;
  const outs = designPorts(a, ctx, graph).outs, ins = designPorts(b, ctx, graph).ins;
  const okOut = outs.some((p) => p.item === item || (p.any && !p.item) || (a.type === "supply" && !a.item));
  const okIn = ins.some((p) => p.item === item || (p.any && !p.item) || (b.type === "output" && !b.item));
  if (!okOut || !okIn) return false;
  return !graph.links.some((l) => l.from === fromId && l.to === toId && l.item === item);
}

/** Live evaluation: machine efficiency, link flows, shortages and overflows. */
function evaluateDesign(graph, ctx) {
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const links = graph.links.filter((l) => byId[l.from] && byId[l.to]);
  const outL = {}, inL = {};
  for (const l of links) { (outL[l.from] ||= []).push(l); (inL[l.to] ||= []).push(l); }
  const recipe = (n) => ctx.recipes[n.recipe];
  const need = (n, item) => {
    if (n.type === "machine") return { fin: (recipe(n)?.inputs?.[item] || 0) * scaleOf(n), inf: false };
    if (n.type === "output") return n.want > 0 ? { fin: n.want, inf: false } : { fin: 0, inf: true };
    return { fin: 0, inf: false };
  };
  // Demand seen through hubs (sum of what's downstream).
  const demand = (id, item, seen = new Set()) => {
    const n = byId[id];
    if (n.type !== "hub") return need(n, item);
    if (seen.has(id)) return { fin: 0, inf: false };
    seen.add(id);
    let fin = 0, inf = false;
    for (const l of outL[id] || []) {
      if (l.item !== item) continue;
      const d = demand(l.to, item, seen);
      fin += d.fin;
      inf = inf || d.inf;
    }
    return { fin, inf };
  };
  const eff = {};
  for (const n of graph.nodes) if (n.type === "machine") eff[n.id] = 1;
  let flow = Object.fromEntries(links.map((l) => [l.id, 0]));
  let overflow = {};
  const received = (id, item, f) => (inL[id] || []).filter((l) => l.item === item).reduce((s, l) => s + f[l.id], 0);
  const producerItems = (n) => {
    if (n.type === "machine") return Object.keys(recipe(n)?.outputs || {});
    if (n.type === "supply") return n.item ? [n.item] : [];
    if (n.type === "hub") return [...new Set((outL[n.id] || []).map((l) => l.item))];
    return [];
  };
  const supplyOf = (n, item, f) => {
    if (n.type === "machine") return (recipe(n)?.outputs?.[item] || 0) * scaleOf(n) * eff[n.id];
    if (n.type === "supply") return n.item === item ? Number(n.rate) || 0 : 0;
    if (n.type === "hub") return received(n.id, item, f);
    return 0;
  };
  for (let iter = 0; iter < 200; iter++) {
    const nf = {}, of = {};
    for (const n of graph.nodes) {
      for (const item of producerItems(n)) {
        const ls = (outL[n.id] || []).filter((l) => l.item === item);
        const S = supplyOf(n, item, flow);
        const ds = ls.map((l) => demand(l.to, item));
        const finTotal = ds.reduce((s, d) => s + d.fin, 0);
        const infN = ds.filter((d) => d.inf).length;
        let rest = S;
        if (S <= finTotal + 1e-9) {
          ls.forEach((l, i) => (nf[l.id] = finTotal > 0 ? (S * ds[i].fin) / finTotal : 0));
          rest = finTotal > 0 ? 0 : S;
        } else {
          ls.forEach((l, i) => (nf[l.id] = ds[i].fin));
          rest = S - finTotal;
        }
        if (rest > 1e-9) {
          if (infN) ls.forEach((l, i) => { if (ds[i].inf) nf[l.id] += rest / infN; });
          else of[`${n.id}|${item}`] = rest;
        }
      }
    }
    let delta = 0;
    for (const n of graph.nodes) {
      if (n.type !== "machine") continue;
      const r = recipe(n);
      let e = 1;
      for (const [item, per] of Object.entries(r?.inputs || {})) {
        const want = per * scaleOf(n);
        if (want > 0) e = Math.min(e, received(n.id, item, nf) / want);
      }
      e = Math.max(0, Math.min(1, e));
      delta = Math.max(delta, Math.abs(e - eff[n.id]));
      eff[n.id] = e;
    }
    for (const l of links) delta = Math.max(delta, Math.abs((nf[l.id] || 0) - flow[l.id]));
    flow = Object.fromEntries(links.map((l) => [l.id, nf[l.id] || 0]));
    overflow = of;
    if (delta < 1e-7) break;
  }

  // Report.
  const tier = (item, rate) => {
    const list = ctx.items[item]?.fluid ? ctx.pipes : ctx.belts;
    if (!list?.length) return { carrier: null, lanes: null };
    const fit = list.find((t) => t[2] + 1e-6 >= rate);
    const best = list[list.length - 1];
    return fit ? { carrier: fit[1], lanes: 1, cap: fit[2] } : { carrier: best[1], lanes: Math.ceil(rate / best[2] - 1e-6), cap: best[2] };
  };
  const nodes = {}, problems = [];
  let power = 0;
  const buildings = {}, cost = {}, supplies = [], outputs = [];
  const name = (i) => ctx.items[i]?.name || i || "nothing yet";
  for (const n of graph.nodes) {
    if (n.type === "machine") {
      const r = recipe(n);
      if (!r) { problems.push({ node: n.id, level: "err", text: "Recipe not found in this save's game data" }); nodes[n.id] = { eff: 0, ins: [], outs: [] }; continue; }
      const sc = scaleOf(n), e = eff[n.id];
      const ins = Object.entries(r.inputs).map(([item, per]) => {
        const want = per * sc, got = received(n.id, item, flow);
        return { item, name: name(item), want, got, linked: (inL[n.id] || []).some((l) => l.item === item) };
      });
      const outs = Object.entries(r.outputs).map(([item, per]) => {
        const make = per * sc * e;
        const used = (outL[n.id] || []).filter((l) => l.item === item).reduce((s, l) => s + flow[l.id], 0);
        return { item, name: name(item), make, used, spare: Math.max(0, make - used), linked: (outL[n.id] || []).some((l) => l.item === item) };
      });
      const mw = (r.power || 0) * (n.count || 1) * Math.pow((n.clock ?? 100) / 100, POWER_EXP);
      power += mw;
      buildings[r.building] = (buildings[r.building] || 0) + (n.count || 1);
      for (const [item, amt] of Object.entries(ctx.buildings?.[r.building]?.cost || {})) cost[item] = (cost[item] || 0) + amt * (n.count || 1);
      nodes[n.id] = { eff: e, ins, outs, power: mw, recipe: r };
      for (const i of ins) {
        if (!i.linked) problems.push({ node: n.id, level: "err", text: `${i.name} isn't connected (needs ${fmt(i.want, 2)}/min)` });
        else if (isShort(i.got, i.want)) problems.push({ node: n.id, level: "warn", text: `Short of ${i.name}: ${fmt(i.got, 2)} of ${fmt(i.want, 2)}/min` });
      }
      for (const o of outs) {
        if (!o.linked && o.make > 1e-6) problems.push({ node: n.id, level: "warn", text: `${o.name} output isn't connected; the machine will back up` });
        else if (isSpare(o.spare, o.make)) problems.push({ node: n.id, level: "warn", text: `${fmt(o.spare, 2)}/min of ${o.name} has nowhere to go` });
      }
      if (!r.unlocked) problems.push({ node: n.id, level: "info", text: `${r.name} isn't unlocked yet` });
    } else if (n.type === "supply") {
      const used = (outL[n.id] || []).reduce((s, l) => s + flow[l.id], 0);
      nodes[n.id] = { used, spare: Math.max(0, (Number(n.rate) || 0) - used) };
      supplies.push({ id: n.id, item: n.item, name: name(n.item), rate: Number(n.rate) || 0, used, label: n.label || "" });
      if (!n.item) problems.push({ node: n.id, level: "err", text: "Supply has no item" });
      else if (!(outL[n.id] || []).length) problems.push({ node: n.id, level: "warn", text: `${name(n.item)} supply isn't connected` });
    } else if (n.type === "output") {
      const got = n.item ? received(n.id, n.item, flow) : 0;
      nodes[n.id] = { got };
      outputs.push({ id: n.id, item: n.item, name: name(n.item), got, want: n.want || null });
      if (n.want > 0 && isShort(got, n.want)) problems.push({ node: n.id, level: "warn", text: `${name(n.item)} output gets ${fmt(got, 2)} of ${fmt(n.want, 2)}/min` });
    } else {
      const item = hubItem(n, graph);
      const through = item ? received(n.id, item, flow) : 0;
      nodes[n.id] = { item, through };
      if (new Set(links.filter((l) => l.from === n.id || l.to === n.id).map((l) => l.item)).size > 1) problems.push({ node: n.id, level: "err", text: "A splitter/merger can only carry one item" });
    }
  }
  const linkInfo = {};
  for (const l of links) {
    const t = tier(l.item, flow[l.id]);
    linkInfo[l.id] = { flow: flow[l.id], ...t };
    if (t.lanes > 1) problems.push({ link: l.id, level: "warn", text: `${name(l.item)} link carries ${fmt(flow[l.id], 1)}/min: needs ${t.lanes}× ${t.carrier}` });
  }
  return {
    nodes, links: linkInfo, problems, overflow,
    totals: {
      power, machines: Object.values(buildings).reduce((s, v) => s + v, 0),
      buildings: Object.entries(buildings).map(([b, c]) => ({ building: b, name: ctx.buildings?.[b]?.name || b, count: c })).sort((a, b) => b.count - a.count),
      cost: Object.entries(cost).map(([i, a]) => ({ item: i, name: name(i), amount: a })).sort((a, b) => b.amount - a.amount),
    },
    supplies, outputs,
  };
}

/** Turn a solver result into a design graph (positions from the current layout). */
function designFromResult(r, pos, items) {
  const nodes = [], links = [], idMap = {};
  // Design boxes are wider and taller than solve boxes: spread the layout out.
  const sx = (DW + COL_GAP) / (NODE_W + COL_GAP), sy = 1.35;
  const at = (id) => { const p = pos?.[id] || [0, 0]; return [Math.round(p[0] * sx), Math.round(p[1] * sy)]; };
  for (const s of r.steps) {
    const id = newId("m");
    idMap[s.id] = id;
    nodes.push({ id, type: "machine", recipe: s.recipe, count: s.count, clock: Math.round(s.machines / s.count * 1e6) / 1e4, x: at(s.id)[0], y: at(s.id)[1] });
  }
  const sup = (x, label) => {
    const id = newId("s");
    idMap[x.id] = id;
    nodes.push({ id, type: "supply", item: x.item, rate: Math.ceil(x.rate * 100 + 1e-9) / 100, label, x: at(x.id)[0], y: at(x.id)[1] });
  };
  r.raw.forEach((x) => sup(x, "Raw"));
  r.surplus.forEach((x) => sup(x, "From surplus"));
  r.missing.forEach((x) => sup(x, "Missing"));
  for (const x of [...r.outputs, ...r.byproducts]) {
    const id = newId("o");
    idMap[x.id] = id;
    nodes.push({ id, type: "output", item: x.item, want: x.requested ?? null, label: x.id.startsWith("byproduct:") ? "Byproduct" : "", x: at(x.id)[0], y: at(x.id)[1] });
  }
  const seen = new Set();
  for (const e of r.edges) {
    const a = idMap[e.from], b = idMap[e.to], k = `${a}|${b}|${e.item}`;
    if (a && b && !seen.has(k)) { seen.add(k); links.push({ id: newId("l"), from: a, to: b, item: e.item }); }
  }
  return { nodes, links };
}

function designNodeBody(n, ev, ctx, graph, selected) {
  const [W, H] = designSize(n, ctx, graph);
  const info = ev.nodes[n.id] || {};
  const bad = ev.problems.some((p) => p.node === n.id && p.level === "err");
  const warn = ev.problems.some((p) => p.node === n.id && p.level === "warn");
  const stroke = selected ? PC.orange : bad ? "#ff6b5e" : warn ? "#8a6a26" : PC.line;
  const name = (i) => ctx.items[i]?.name || i || "—";
  const clip = (s, m) => (String(s).length > m ? String(s).slice(0, m - 1) + "…" : String(s));
  let b = "";
  const port = (x, y, item, dir, ok) =>
    `<circle class="port" data-node="${pesc(n.id)}" data-item="${pesc(item || "")}" data-dir="${dir}" cx="${x}" cy="${y}" r="7" fill="${ok ? "#1d2633" : "#3a1416"}" stroke="${ok ? PC.dim : PC.red}" stroke-width="1.5"/>`;
  if (n.type === "machine") {
    const r = ctx.recipes[n.recipe];
    const e = info.eff ?? 1;
    const effC = e >= 0.995 ? PC.green : e > 0.5 ? PC.amber : PC.red;
    b += `<rect class="box" width="${W}" height="${H}" rx="8" fill="${PC.panel}" stroke="${stroke}" stroke-width="${selected || bad ? 2 : 1}"/>
      <rect width="6" height="${H}" rx="3" fill="${r?.unlocked === false ? PC.amber : PC.orange}"/>
      <text x="16" y="20" font-family="JetBrains Mono, monospace" font-size="12" font-weight="700" fill="${PC.orange}">${n.count || 1} × ${pesc(clip((r?.building_name || "?").toUpperCase(), 14))} @ ${fmt(n.clock ?? 100, 2)}%</text>
      <text x="16" y="40" font-size="14" font-weight="600" fill="${PC.text}">${pesc(clip((r?.name || n.recipe).replace(/^Alternate: /, ""), 26))}</text>`;
    (info.ins || []).forEach((p, i) => {
      const y = PORT_TOP + PORT_ROW * i + 10, short = isShort(p.got, p.want);
      b += `<text x="14" y="${y + 4}" font-family="JetBrains Mono, monospace" font-size="10" fill="${short ? (p.linked ? PC.amber : "#ff8a80") : PC.text2}">${pesc(clip(name(p.item), 13))} ${fmt(p.got, 1)}/${fmt(p.want, 1)}</text>`;
      b += port(0, y, p.item, "in", p.linked);
    });
    (info.outs || []).forEach((p, i) => {
      const y = PORT_TOP + PORT_ROW * i + 10;
      b += `<text x="${W - 14}" y="${y + 4}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="${isSpare(p.spare, p.make) || !p.linked ? PC.amber : PC.text2}">${pesc(clip(name(p.item), 13))} ${fmt(p.make, 1)}</text>`;
      b += port(W, y, p.item, "out", p.linked || p.make < 1e-6);
    });
    b += `<text x="16" y="${H - 9}" font-family="JetBrains Mono, monospace" font-size="11" fill="${effC}">running ${fmt(e * 100, 1)}%</text>
      <text x="${W - 12}" y="${H - 9}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="11" fill="${PC.dim}">${fmt(info.power, 1)} MW</text>`;
  } else if (n.type === "supply" || n.type === "output") {
    const isS = n.type === "supply";
    const tag = isS ? (n.label || "SUPPLY").toUpperCase() : (n.label || "OUTPUT").toUpperCase();
    const fill = isS ? "#0f1a1e" : "#221a0e", st = selected ? PC.orange : bad ? "#ff6b5e" : isS ? "#2a5662" : PC.orange;
    const line = isS ? `${fmt(info.used, 2)} of ${fmt(n.rate, 2)}/min used` : `${fmt(info.got, 2)}${n.want ? ` of ${fmt(n.want, 2)}` : ""}/min`;
    b += `<rect class="box" width="${W}" height="${H}" rx="8" fill="${fill}" stroke="${st}" stroke-width="${selected ? 2 : 1}"/>
      <text x="14" y="20" font-size="10" font-weight="700" letter-spacing="1.6" fill="${isS ? PC.cyan : PC.orange}">${pesc(clip(tag, 22))}</text>
      <text x="14" y="42" font-size="14" font-weight="600" fill="${PC.text}">${pesc(clip(name(n.item), 22))}</text>
      <text x="14" y="62" font-family="JetBrains Mono, monospace" font-size="11" fill="${PC.text2}">${pesc(line)}</text>`;
    b += isS ? port(W, 40, n.item, "out", true) : port(0, 40, n.item, "in", true);
  } else {
    const item = info.item;
    b += `<rect class="box" width="${W}" height="${H}" rx="30" fill="#141922" stroke="${stroke}" stroke-width="${selected || bad ? 2 : 1}"/>
      <text x="${W / 2}" y="24" text-anchor="middle" font-size="10" font-weight="700" letter-spacing="1.4" fill="${PC.dim}">SPLIT / MERGE</text>
      <text x="${W / 2}" y="42" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="11" fill="${PC.text2}">${pesc(clip(item ? `${name(item)} ${fmt(info.through, 1)}` : "no item yet", 18))}</text>`;
    b += port(0, 30, item, "in", true) + port(W, 30, item, "out", true);
  }
  return b;
}

const DesignMixin = {
  _dctx() {
    const m = this._model || {};
    return { recipes: this._recipeByCls || {}, items: this._items || {}, belts: m.belts || [], pipes: m.pipes || [], buildings: m.buildings || {} };
  },
  _isDesign() { return this._plan.mode === "design"; },
  _setMode(mode) {
    if (mode === this._plan.mode) return;
    if (mode === "design" && !this._plan.graph.nodes.length && this._result?.ok && this._result.steps.length) {
      this._toDesign();
      return;
    }
    this._plan.mode = mode;
    this._sel = null;
    this.$("detail").hidden = true;
    this.$("cmenu").hidden = true;
    this._markDirty();
    this._renderPlanPane();
    this._solveSoon(0, true);
  },
  _centerOn(id) {
    const n = this._plan.graph.nodes.find((x) => x.id === id);
    const l = !n && this._plan.graph.links.find((x) => x.id === id);
    const t = n || (l && this._plan.graph.nodes.find((x) => x.id === l.to));
    if (!t) return;
    const r = this.$("svg").getBoundingClientRect();
    this._view.x = r.width / 2 - (t.x + 100) * this._view.k;
    this._view.y = r.height / 2 - (t.y + 40) * this._view.k;
    this._applyView();
  },
  _evalDesign() {
    this._ev = evaluateDesign(this._plan.graph, this._dctx());
    return this._ev;
  },
  // Every edit goes through here: undo history, dirty flag, re-evaluate, redraw.
  _mutate(fn, { pane = false } = {}) {
    this._undo = this._undo || [];
    this._undo.push(JSON.stringify(this._plan.graph));
    if (this._undo.length > 80) this._undo.shift();
    this._redo = [];
    fn(this._plan.graph);
    this._afterGraphChange(pane);
  },
  _afterGraphChange(pane) {
    this._markDirty();
    this._evalDesign();
    this._drawDesign();
    this._renderSummary();
    if (pane) this._renderPlanPane();
    else this._renderProblems();
    if (this._sel) this._selectDesign(this._sel, true);
  },
  _undoRedo(dir) {
    const from = dir < 0 ? (this._undo ||= []) : (this._redo ||= []);
    const to = dir < 0 ? (this._redo ||= []) : (this._undo ||= []);
    if (!from.length) return;
    to.push(JSON.stringify(this._plan.graph));
    this._plan.graph = JSON.parse(from.pop());
    this._sel = null;
    this.$("detail").hidden = true;
    this._afterGraphChange(true);
  },

  // ----------------------------------------------------------- left pane
  _renderDesignPane() {
    const pane = this.$("planPane");
    const g = this._plan.graph;
    const q = (this._paletteQ || "").trim().toLowerCase();
    const allowAll = this._plan.options.recipes === "all";
    const recipes = (this._model.recipes || [])
      .filter((r) => (r.unlocked || allowAll) && (!r.event || r.unlocked))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.building_name.toLowerCase().includes(q) ||
        Object.keys(r.outputs).some((i) => (this._items[i]?.name || "").toLowerCase().includes(q)))
      .slice(0, q ? 60 : 40);
    const row = (kind, arg, title, sub, badge = "") => `<button class="pal" data-pal="${kind}" data-arg="${pesc(arg)}" aria-label="Add ${pesc(title)}">
        <span class="t">${pesc(title)}</span>${badge}<span class="muted">${pesc(sub)}</span></button>`;
    pane.innerHTML = `
      ${this._modeSwitch()}
      <section class="panel narrow-only" aria-label="Plan name"><h2>PLAN</h2>
        <input type="text" data-planname value="${pesc(this._plan.name || "")}" placeholder="Plan name" aria-label="Plan name" style="width:100%"></section>
      <section class="panel" aria-label="Edit">
        <div class="row" style="flex-wrap:wrap;gap:6px">
          <button class="btn ghost" data-act="undo" ${this._undo?.length ? "" : "disabled"} aria-label="Undo">↶ UNDO</button>
          <button class="btn ghost" data-act="redo" ${this._redo?.length ? "" : "disabled"} aria-label="Redo">↷ REDO</button>
          <button class="btn" data-act="fill" ${this._ev?.problems?.some((p) => /isn't connected \(needs|Short of/.test(p.text)) ? "" : "disabled"}>FILL SHORTAGES</button>
          <button class="btn ghost" data-act="clear-design" ${g.nodes.length ? "" : "disabled"}>CLEAR</button>
        </div>
        <div class="muted" style="margin-top:8px">Drag from a port to connect; drop on empty space for matching buildings. Select and press Delete to remove.</div>
      </section>
      <section class="panel" aria-label="Add buildings"><h2>ADD</h2>
        <input id="palQ" type="text" placeholder="Search recipes, items, buildings…" aria-label="Search recipes" value="${pesc(this._paletteQ || "")}" style="width:100%;margin-bottom:8px">
        <div class="palist">
          ${row("supply", "", "Supply", "Raw resource or incoming items")}
          ${row("output", "", "Output", "Where the finished items go")}
          ${row("hub", "", "Splitter / merger", "Split or join one item")}
          ${recipes.map((r) => row("machine", r.cls, r.name.replace(/^Alternate: /, ""), r.building_name,
            `${r.alternate ? `<span class="badge alt">ALT</span>` : ""}${!r.unlocked ? `<span class="badge lock">LOCKED</span>` : ""}`)).join("")}
        </div>
        <div class="muted" style="margin-top:8px">Drag onto the canvas, or tap to add in the middle.</div>
      </section>
      <section class="panel" aria-label="Problems" id="problems"></section>`;
    this._renderProblems();
  },
  _modeSwitch() {
    const d = this._isDesign();
    return `<section class="panel" aria-label="Mode"><div class="opt" style="min-height:0"><span>Mode</span>
      <span class="seg" role="group" aria-label="Planner mode">
        <button data-act="mode" data-arg="solve" aria-pressed="${!d}">SOLVE</button>
        <button data-act="mode" data-arg="design" aria-pressed="${d}">DESIGN</button></span></div>
      <div class="muted" style="margin-top:6px">${d ? "You place the buildings and connections; the maths updates as you go." : "Say what to make; the planner picks buildings and connections."}</div></section>`;
  },
  _renderProblems() {
    const box = this.shadowRoot.getElementById("problems");
    if (!box) return;
    const ps = this._ev?.problems || [];
    const col = { err: "#ff8a80", warn: PC.amber, info: PC.dim };
    box.innerHTML = `<h2>${ps.length ? `ISSUES · ${ps.length}` : "ISSUES"}</h2>${ps.length ? `<div class="rlist">${ps.slice(0, 40).map((p, i) =>
      `<button class="ritem" data-act="goto" data-arg="${i}" style="text-align:left;cursor:pointer"><span class="lamp" style="width:8px;height:8px;border-radius:50%;background:${col[p.level]};flex:none"></span><span class="t" style="white-space:normal">${pesc(p.text)}</span></button>`).join("")}</div>`
      : `<div class="muted">${this._plan.graph.nodes.length ? "Everything is connected and balanced." : "Add buildings to start."}</div>`}`;
    const fill = this.shadowRoot.querySelector('[data-act="fill"]');
    if (fill) fill.disabled = !ps.some((p) => /isn't connected \(needs|Short of/.test(p.text));
    const u = this.shadowRoot.querySelector('[data-act="undo"]'), r = this.shadowRoot.querySelector('[data-act="redo"]');
    if (u) u.disabled = !this._undo?.length;
    if (r) r.disabled = !this._redo?.length;
  },

  // ----------------------------------------------------------- adding nodes
  _addNode(kind, arg, at) {
    const [x, y] = at || this._viewCenter();
    const node = { id: newId(kind[0]), type: kind, x: Math.round(x), y: Math.round(y) };
    if (kind === "machine") Object.assign(node, { recipe: arg, count: 1, clock: 100 });
    if (kind === "supply") Object.assign(node, { item: arg || null, rate: 60, label: "" });
    if (kind === "output") Object.assign(node, { item: arg || null, want: null, label: "" });
    if (kind === "hub") node.item = arg || null;
    this._mutate((g) => g.nodes.push(node));
    this._selectDesign(node.id);
    return node;
  },
  _viewCenter() {
    const r = this.$("svg").getBoundingClientRect();
    return [(r.width / 2 - this._view.x) / this._view.k - 100, (r.height / 2 - this._view.y) / this._view.k - 40];
  },
  _worldAt(cx, cy) {
    const r = this.$("svg").getBoundingClientRect();
    return [(cx - r.left - this._view.x) / this._view.k, (cy - r.top - this._view.y) / this._view.k];
  },
  // Palette rows: tap to add in the middle, or drag onto the canvas.
  _initPalette() {
    const root = this.shadowRoot;
    root.addEventListener("pointerdown", (e) => {
      const row = e.target.closest?.(".pal");
      if (!row) return;
      const start = [e.clientX, e.clientY];
      let ghost = null;
      const move = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 8) {
          ghost = document.createElement("div");
          ghost.className = "dragghost";
          ghost.textContent = row.querySelector(".t").textContent;
          root.querySelector(".app").appendChild(ghost);
        }
        if (ghost) { ghost.style.left = `${ev.clientX + 10}px`; ghost.style.top = `${ev.clientY + 10}px`; }
      };
      const up = (ev) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (!ghost) return; // a tap: handled by click
        ghost.remove();
        this._palDragged = true;
        const fr = this.$("flowPane").getBoundingClientRect();
        if (ev.clientX >= fr.left && ev.clientX <= fr.right && ev.clientY >= fr.top && ev.clientY <= fr.bottom) {
          const [x, y] = this._worldAt(ev.clientX, ev.clientY);
          this._addNode(row.dataset.pal, row.dataset.arg, [x - 60, y - 30]);
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    root.addEventListener("click", (e) => {
      const row = e.target.closest?.(".pal");
      if (!row) return;
      if (this._palDragged) { this._palDragged = false; return; }
      this._addNode(row.dataset.pal, row.dataset.arg);
      if (this._tab === "plan" && matchMedia("(max-width:760px)").matches) this._setTab("flow");
    });
  },

  // ----------------------------------------------------------- flow canvas
  _renderDesignFlow(fit) {
    const g = this._plan.graph;
    const empty = this.$("emptyFlow");
    this._evalDesign();
    if (!g.nodes.length) {
      empty.hidden = false;
      empty.innerHTML = `Design mode: drag buildings from the left onto this canvas, then drag between ports to connect them.<br>
        <span style="font-size:12px">Or switch to SOLVE, plan something, and use EDIT AS DESIGN.</span>`;
    } else empty.hidden = true;
    this._laidOut = true;
    this._drawDesign();
    if (fit && g.nodes.length) { requestAnimationFrame(() => this._fitDesign()); setTimeout(() => this._fitDesign(), 120); }
    else this._applyView();
  },
  _fitDesign() {
    const g = this._plan.graph, ctx = this._dctx();
    if (!g.nodes.length) return;
    this._nodes = g.nodes.map((n) => { const [w, h] = designSize(n, ctx, g); return { id: n.id, w, h }; });
    this._pos = Object.fromEntries(g.nodes.map((n) => [n.id, [n.x, n.y]]));
    this._fit();
  },
  _drawDesign() {
    const g = this._plan.graph, ctx = this._dctx(), ev = this._ev || this._evalDesign();
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    const portXY = (n, dir, item) => {
      const [W] = designSize(n, ctx, g);
      const ps = designPorts(n, ctx, g)[dir === "out" ? "outs" : "ins"];
      const p = ps.find((x) => x.item === item) || ps[0];
      return [n.x + (dir === "out" ? W : 0), n.y + (p ? p.y : 30)];
    };
    let edges = "", labels = "";
    for (const l of g.links) {
      const a = byId[l.from], b = byId[l.to];
      if (!a || !b) continue;
      const [x1, y1] = portXY(a, "out", l.item), [x2, y2] = portXY(b, "in", l.item);
      const info = ev.links[l.id] || {};
      const back = x2 < x1 + 20;
      const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
      const d = back
        ? `M${x1},${y1} C${x1 + 80},${y1} ${x1 + 80},${Math.max(y1, y2) + 90} ${(x1 + x2) / 2},${Math.max(y1, y2) + 90} S${x2 - 80},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      const sel = this._sel === l.id;
      const col = sel ? PC.orange : info.lanes > 1 ? PC.amber : (info.flow || 0) < 1e-6 ? "#5a3236" : ctx.items[l.item]?.fluid ? PC.cyan : "#7f8ba0";
      const w = Math.max(1.5, Math.min(7, 1.2 + Math.log2(1 + (info.flow || 0) / 15)));
      edges += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w.toFixed(1)}" stroke-opacity=".8"/>
        <path class="linkhit" data-link="${pesc(l.id)}" d="${d}" fill="none" stroke="transparent" stroke-width="16" style="cursor:pointer"/>`;
      const mx = (x1 + x2) / 2, my = back ? Math.max(y1, y2) + 90 : (y1 + y2) / 2;
      const nm = ctx.items[l.item]?.name || l.item;
      const txt = `${nm.length > 14 ? nm.slice(0, 13) + "…" : nm} · ${fmt(info.flow, 2)}`;
      const tier = info.carrier ? `${info.lanes > 1 ? `${info.lanes}× ` : ""}${tierShort(info.carrier)}` : "";
      const tw = Math.max(txt.length * 6.4, tier.length * 6) + 16;
      labels += `<g class="linklabel" data-link="${pesc(l.id)}" transform="translate(${mx - tw / 2},${my - 17})" style="cursor:pointer"><rect width="${tw}" height="${tier ? 34 : 20}" rx="5" fill="#0d1117" stroke="${sel ? PC.orange : PC.line}"/>
        <text x="${tw / 2}" y="14" text-anchor="middle" font-size="11" fill="${PC.text2}" font-family="JetBrains Mono, monospace">${pesc(txt)}</text>
        ${tier ? `<text x="${tw / 2}" y="28" text-anchor="middle" font-size="10" fill="${info.lanes > 1 ? PC.amber : PC.dim}" font-family="JetBrains Mono, monospace">${pesc(tier)}</text>` : ""}</g>`;
    }
    let nodes = "";
    for (const n of g.nodes) {
      nodes += `<g class="node" data-id="${pesc(n.id)}" transform="translate(${n.x},${n.y})" tabindex="0" role="button" aria-label="${pesc(this._designAria(n))}">${designNodeBody(n, ev, ctx, g, this._sel === n.id)}</g>`;
    }
    this.$("vp").innerHTML = `<g>${edges}</g><g>${labels}</g><g>${nodes}</g><path id="wire" fill="none" stroke="${PC.orange}" stroke-width="2" stroke-dasharray="6 4" d=""/>`;
  },
  _designAria(n) {
    const ctx = this._dctx(), name = (i) => ctx.items[i]?.name || i || "nothing";
    if (n.type === "machine") { const r = ctx.recipes[n.recipe]; return `${n.count} ${r?.building_name || ""} making ${r?.name || n.recipe} at ${n.clock} percent`; }
    if (n.type === "supply") return `Supply of ${name(n.item)}, ${n.rate} per minute`;
    if (n.type === "output") return `Output for ${name(n.item)}`;
    return "Splitter or merger";
  },

  // Dragging a wire from a port.
  _startWire(port, e) {
    const node = this._plan.graph.nodes.find((n) => n.id === port.dataset.node);
    if (!node) return null;
    const dir = port.dataset.dir, item = port.dataset.item || null;
    const ctx = this._dctx(), [W] = designSize(node, ctx, this._plan.graph);
    const ps = designPorts(node, ctx, this._plan.graph)[dir === "out" ? "outs" : "ins"];
    const p = ps.find((x) => (x.item || null) === item) || ps[0];
    return { kind: "wire", node, dir, item, x0: node.x + (dir === "out" ? W : 0), y0: node.y + (p ? p.y : 30) };
  },
  _moveWire(w, cx, cy) {
    const [x, y] = this._worldAt(cx, cy);
    const dx = Math.max(50, Math.abs(x - w.x0) * 0.5) * (w.dir === "out" ? 1 : -1);
    this.shadowRoot.getElementById("wire")?.setAttribute("d", `M${w.x0},${w.y0} C${w.x0 + dx},${w.y0} ${x - dx},${y} ${x},${y}`);
  },
  _endWire(w, cx, cy) {
    this.shadowRoot.getElementById("wire")?.setAttribute("d", "");
    const el = this.shadowRoot.elementFromPoint(cx, cy);
    const g = this._plan.graph, ctx = this._dctx();
    const targetPort = el?.closest?.(".port");
    const targetNode = el?.closest?.(".node");
    const link = (fromId, toId, item) => {
      if (!item) { this._toast("Connect something with an item first."); return false; }
      if (!canLink(g, ctx, fromId, toId, item)) { this._toast("Those can't be connected."); return false; }
      this._mutate((gr) => {
        gr.links.push({ id: newId("l"), from: fromId, to: toId, item });
        for (const id of [fromId, toId]) {
          const n = gr.nodes.find((x) => x.id === id);
          if ((n.type === "supply" || n.type === "output" || n.type === "hub") && !n.item) n.item = item;
        }
      });
      return true;
    };
    if (targetNode && targetNode.dataset.id !== w.node.id) {
      const other = g.nodes.find((n) => n.id === targetNode.dataset.id);
      const want = w.dir === "out" ? "in" : "out";
      const tItem = targetPort && targetPort.dataset.dir === want ? targetPort.dataset.item || null : null;
      const item = w.item || tItem || (() => {
        // Pick the first item both sides share.
        const mine = designPorts(w.node, ctx, g)[w.dir === "out" ? "outs" : "ins"].map((p) => p.item).filter(Boolean);
        const theirs = designPorts(other, ctx, g)[want === "out" ? "outs" : "ins"].map((p) => p.item).filter(Boolean);
        return mine.find((i) => theirs.includes(i)) || theirs[0] || mine[0] || null;
      })();
      if (w.dir === "out") link(w.node.id, other.id, item); else link(other.id, w.node.id, item);
      return;
    }
    if (!targetNode && !el?.closest?.(".tools, .detail, .cmenu")) this._connectMenu(w, cx, cy);
  },
  // Dropped a wire on empty canvas: offer things that fit.
  _connectMenu(w, cx, cy) {
    const item = w.item;
    if (!item) return;
    const name = this._items[item]?.name || item;
    const allowAll = this._plan.options.recipes === "all";
    const ok = (r) => r.unlocked || allowAll;
    const list = (this._model.recipes || []).filter((r) => ok(r) && (w.dir === "out" ? item in r.inputs : item in r.outputs))
      .sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || a.name.localeCompare(b.name)).slice(0, 14);
    const special = w.dir === "out"
      ? [["output", `Output: ${name}`], ["hub", "Splitter"]]
      : [["supply", `Supply: ${name}`], ["hub", "Merger"]];
    const menu = this.$("cmenu");
    const fr = this.$("flowPane").getBoundingClientRect();
    menu.style.left = `${Math.min(cx - fr.left, fr.width - 270)}px`;
    menu.style.top = `${Math.min(cy - fr.top, fr.height - 320)}px`;
    menu.innerHTML = `<div class="lbl" style="padding:6px 8px">${w.dir === "out" ? "SEND" : "GET"} ${pesc(name.toUpperCase())} ${w.dir === "out" ? "TO" : "FROM"}</div>
      ${special.map(([k, t]) => `<button class="mi" data-act="menu-pick" data-arg="${k}|">${pesc(t)}</button>`).join("")}
      ${list.map((r) => `<button class="mi" data-act="menu-pick" data-arg="machine|${pesc(r.cls)}">${pesc(r.name.replace(/^Alternate: /, ""))}<span class="muted"> · ${pesc(r.building_name)}${r.unlocked ? "" : " · locked"}</span></button>`).join("")}
      ${list.length ? "" : `<div class="muted" style="padding:6px 8px">No ${allowAll ? "" : "unlocked "}recipe ${w.dir === "out" ? "uses" : "makes"} ${pesc(name)}.</div>`}
      <button class="mi" data-act="menu-close" style="color:${PC.dim}">Cancel</button>`;
    menu.hidden = false;
    const [x, y] = this._worldAt(cx, cy);
    this._pendingWire = { ...w, at: [x, w.dir === "out" ? y - 30 : y - 30] };
    menu.querySelector(".mi")?.focus();
  },
  _menuPick(arg) {
    const w = this._pendingWire;
    this.$("cmenu").hidden = true;
    if (!w) return;
    const [kind, cls] = arg.split("|");
    const g = this._plan.graph, ctx = this._dctx();
    const node = { id: newId(kind[0]), type: kind, x: Math.round(w.dir === "out" ? w.at[0] + 20 : w.at[0] - 260), y: Math.round(w.at[1]) };
    if (kind === "machine") {
      const r = ctx.recipes[cls];
      // Size it to match: enough machines (at 100 %, or less) for this item.
      const port = w.dir === "out"
        ? (this._ev.nodes[w.node.id]?.outs || []).find((p) => p.item === w.item)
        : (this._ev.nodes[w.node.id]?.ins || []).find((p) => p.item === w.item);
      const rate = w.dir === "out" ? (port?.spare ?? port?.make ?? 0) : Math.max(0, (port?.want ?? 0) - (port?.got ?? 0)) || (port?.want ?? 0);
      const per = w.dir === "out" ? r.inputs[w.item] : r.outputs[w.item];
      const exact = per > 0 && rate > 0 ? rate / per : 1;
      const count = Math.max(1, Math.ceil(exact - 1e-6));
      Object.assign(node, { recipe: cls, count, clock: Math.round(Math.min(250, Math.max(1, (exact / count) * 100)) * 1000) / 1000 });
    } else if (kind === "supply") {
      const port = (this._ev.nodes[w.node.id]?.ins || []).find((p) => p.item === w.item);
      Object.assign(node, { item: w.item, rate: Math.round(Math.max(0, (port?.want ?? 60) - (port?.got ?? 0)) * 1000) / 1000 || 60, label: "" });
    } else if (kind === "output") Object.assign(node, { item: w.item, want: null, label: "" });
    else node.item = w.item;
    this._mutate((gr) => {
      gr.nodes.push(node);
      gr.links.push(w.dir === "out" ? { id: newId("l"), from: w.node.id, to: node.id, item: w.item } : { id: newId("l"), from: node.id, to: w.node.id, item: w.item });
    });
    this._pendingWire = null;
    void g;
  },

  // ----------------------------------------------------------- details
  _selectDesign(id, keep) {
    this._sel = id;
    const box = this.$("detail");
    const g = this._plan.graph, ctx = this._dctx(), ev = this._ev || this._evalDesign();
    const n = g.nodes.find((x) => x.id === id), l = !n && g.links.find((x) => x.id === id);
    if (!keep) this._drawDesign();
    if (!n && !l) { box.hidden = true; return; }
    const name = (i) => ctx.items[i]?.name || i || "—";
    const head = (t) => `<div class="row sp"><strong style="font-size:15px">${pesc(t)}</strong><button class="btn ghost icon" data-act="close-detail" aria-label="Close details">✕</button></div>`;
    let html = "";
    if (l) {
      const info = ev.links[l.id] || {};
      html = head(`${name(l.item)} link`) + `<div class="muted">${fmt(info.flow, 3)}/min${info.carrier ? ` · ${info.lanes > 1 ? `${info.lanes}× ` : ""}${pesc(info.carrier)}` : ""}</div>
        <div style="margin-top:10px"><button class="btn ghost" data-act="del-sel">DELETE LINK</button></div>`;
    } else if (n.type === "machine") {
      const r = ctx.recipes[n.recipe], info = ev.nodes[n.id] || {};
      const alts = (this._model.recipes || []).filter((x) => x.building === r?.building && (x.unlocked || this._plan.options.recipes === "all" || x.cls === n.recipe));
      const rows = (list, f) => list.map(f).join("");
      html = head(r ? r.name : n.recipe) + `
        <label class="fld"><span class="lbl">RECIPE</span><select data-field="recipe">${alts.map((x) => `<option value="${pesc(x.cls)}" ${x.cls === n.recipe ? "selected" : ""}>${pesc(x.name)}${x.unlocked ? "" : " (locked)"}</option>`).join("")}</select></label>
        <div class="row" style="gap:8px;margin-top:8px">
          <label class="fld" style="flex:1"><span class="lbl">MACHINES</span><input type="number" min="1" max="1000" step="1" data-field="count" value="${n.count || 1}"></label>
          <label class="fld" style="flex:1"><span class="lbl">CLOCK %</span><input type="number" min="1" max="250" step="any" data-field="clock" value="${fmt(n.clock ?? 100, 3)}"></label>
        </div>
        <div class="muted" style="margin-top:6px">Running at ${fmt((info.eff ?? 1) * 100, 1)}% of that · ${fmt(info.power, 1)} MW</div>
        <table>${rows(info.ins || [], (p) => `<tr><td>${pesc(p.name)}</td><td class="r" style="color:${isShort(p.got, p.want) ? PC.amber : PC.text2}">${fmt(p.got, 2)} / ${fmt(p.want, 2)}</td></tr>`)}
        ${rows(info.outs || [], (p) => `<tr><td>→ ${pesc(p.name)}</td><td class="r">${fmt(p.make, 2)}${isSpare(p.spare, p.make) ? ` <span style="color:${PC.amber}">(${fmt(p.spare, 2)} spare)</span>` : ""}</td></tr>`)}</table>
        <div class="row" style="gap:6px;margin-top:10px;flex-wrap:wrap"><button class="btn ghost" data-act="balance">MATCH INPUTS</button><button class="btn ghost" data-act="dup">DUPLICATE</button><button class="btn ghost" data-act="del-sel">DELETE</button></div>`;
    } else if (n.type === "supply" || n.type === "output") {
      const s = n.type === "supply", info = ev.nodes[n.id] || {};
      const res = s && n.item ? this._model.resources?.[n.item] : null;
      html = head(s ? "Supply" : "Output") + `
        <label class="fld"><span class="lbl">ITEM</span><input type="text" list="allitems" data-field="item" value="${pesc(n.item ? name(n.item) : "")}" placeholder="Item name"></label>
        <div class="row" style="gap:8px;margin-top:8px">
          <label class="fld" style="flex:1"><span class="lbl">${s ? "PER MINUTE" : "WANT PER MINUTE"}</span><input type="number" min="0" step="any" data-field="${s ? "rate" : "want"}" value="${s ? fmt(n.rate, 3) : n.want ?? ""}" placeholder="${s ? "" : "any"}"></label>
          <label class="fld" style="flex:1"><span class="lbl">LABEL</span><input type="text" data-field="label" value="${pesc(n.label || "")}" placeholder="${s ? "e.g. Raw" : "e.g. To storage"}"></label>
        </div>
        <div class="muted" style="margin-top:6px">${s ? `${fmt(info.used, 2)}/min used` : `${fmt(info.got, 2)}/min arriving`}</div>
        ${res ? `<div class="muted" style="margin-top:4px">Free nodes: ${res.free_by_purity?.Pure ?? 0} pure · ${res.free_by_purity?.Normal ?? 0} normal · ${res.free_by_purity?.Impure ?? 0} impure</div>` : ""}
        <div class="row" style="gap:6px;margin-top:10px"><button class="btn ghost" data-act="dup">DUPLICATE</button><button class="btn ghost" data-act="del-sel">DELETE</button></div>`;
    } else {
      html = head("Splitter / merger") + `<div class="muted">${fmt(ev.nodes[n.id]?.through, 2)}/min of ${pesc(name(ev.nodes[n.id]?.item))}. It splits what comes in by what's downstream needs.</div>
        <div style="margin-top:10px"><button class="btn ghost" data-act="del-sel">DELETE</button></div>`;
    }
    box.innerHTML = html;
    box.hidden = false;
  },
  _designField(field, value) {
    const n = this._plan.graph.nodes.find((x) => x.id === this._sel);
    if (!n) return;
    this._mutate(() => {
      if (field === "count") n.count = Math.max(1, Math.min(1000, Math.round(Number(value) || 1)));
      else if (field === "clock") n.clock = Math.max(1, Math.min(250, Number(value) || 100));
      else if (field === "rate") n.rate = Math.max(0, Number(value) || 0);
      else if (field === "want") n.want = value === "" ? null : Math.max(0, Number(value) || 0);
      else if (field === "label") n.label = String(value).slice(0, 80);
      else if (field === "recipe") {
        n.recipe = value;
        const r = this._recipeByCls[value];
        // Drop links for items the new recipe doesn't use.
        this._plan.graph.links = this._plan.graph.links.filter((l) =>
          (l.from !== n.id || l.item in (r?.outputs || {})) && (l.to !== n.id || l.item in (r?.inputs || {})));
      } else if (field === "item") {
        const cls = this._allNameToCls?.[String(value).trim().toLowerCase()];
        if (!cls) { this._toast(`No item called “${value}”.`); return; }
        n.item = cls;
        this._plan.graph.links = this._plan.graph.links.filter((l) => (l.from !== n.id && l.to !== n.id) || l.item === cls);
      }
    });
  },
  _deleteSel() {
    const id = this._sel;
    if (!id) return;
    this._mutate((g) => {
      g.nodes = g.nodes.filter((n) => n.id !== id);
      g.links = g.links.filter((l) => l.id !== id && l.from !== id && l.to !== id);
    });
    this._sel = null;
    this.$("detail").hidden = true;
  },
  _duplicate() {
    const n = this._plan.graph.nodes.find((x) => x.id === this._sel);
    if (!n) return;
    const copy = { ...JSON.parse(JSON.stringify(n)), id: newId(n.type[0]), x: n.x + 30, y: n.y + 30 };
    this._mutate((g) => g.nodes.push(copy));
    this._selectDesign(copy.id);
  },
  // Set count/clock so the machine uses exactly what reaches it.
  _balance() {
    const n = this._plan.graph.nodes.find((x) => x.id === this._sel);
    const info = this._ev?.nodes[n?.id];
    if (!n || !info?.ins?.length) { this._toast("This machine has no inputs to match."); return; }
    const r = this._recipeByCls[n.recipe];
    const exact = Math.min(...info.ins.map((p) => p.got / (r.inputs[p.item] || 1)));
    if (!(exact > 0)) { this._toast("Nothing is arriving yet."); return; }
    // Keep the machine count unless that would need more than 250 %.
    const count = Math.max(n.count || 1, Math.ceil(exact / 2.5 - 1e-9));
    this._mutate(() => {
      n.count = count;
      n.clock = Math.round(Math.max(1, Math.min(250, (exact / count) * 100)) * 1000) / 1000;
    });
  },

  // ----------------------------------------------------------- bridges
  _toDesign() {
    const r = this._result;
    if (!r?.ok || !r.steps.length) { this._toast("Plan something first, then turn it into a design."); return; }
    if (this._plan.graph.nodes.length && !confirm("Replace the current design with this plan?")) return;
    const g = designFromResult(r, this._pos, this._items);
    this._undo = [JSON.stringify(this._plan.graph)];
    this._redo = [];
    this._plan.graph = g;
    this._plan.mode = "design";
    this._sel = null;
    this.$("detail").hidden = true;
    this._markDirty();
    this._renderPlanPane();
    this._renderDesignFlow(true);
    this._renderSummary();
  },
  async _fill() {
    const ev = this._ev;
    const short = {};
    const needers = {};
    for (const n of this._plan.graph.nodes) {
      for (const p of ev.nodes[n.id]?.ins || []) {
        const gap = p.want - p.got;
        if (isShort(p.got, p.want)) { short[p.item] = (short[p.item] || 0) + gap; (needers[p.item] ||= []).push(n.id); }
      }
    }
    const targets = Object.entries(short).map(([item, rate]) => ({ item, rate: Math.round(rate * 1000) / 1000 }));
    if (!targets.length) return;
    let r;
    try {
      r = await this._hass.callWS({ type: "satisfactory_frm/planner/solve", entry_id: this._entry, targets, options: this._plan.options });
    } catch (e) { this._toast(`Couldn't plan the shortages: ${e.message || e}`); return; }
    if (!r.ok) { this._toast(`Couldn't plan the shortages: ${r.error}`); return; }
    // Lay the new part out to the left of the design.
    const { nodes, edges } = graphFromResult(r, this._items);
    const pos = layout(nodes, edges, {});
    const g = this._plan.graph;
    const minX = Math.min(...g.nodes.map((n) => n.x)), minY = Math.min(...g.nodes.map((n) => n.y));
    const part = designFromResult(r, pos, this._items);
    const width = Math.max(0, ...part.nodes.map((n) => n.x)) + DW + COL_GAP;
    for (const n of part.nodes) { n.x += minX - width; n.y += minY; }
    // Outputs of the new part become links straight to the machines that were short.
    const outIds = new Set(part.nodes.filter((n) => n.type === "output" && n.label !== "Byproduct").map((n) => n.id));
    const links = [];
    for (const l of part.links) {
      if (!outIds.has(l.to)) { links.push(l); continue; }
      for (const nid of needers[l.item] || []) links.push({ id: newId("l"), from: l.from, to: nid, item: l.item });
    }
    this._mutate((gr) => {
      gr.nodes.push(...part.nodes.filter((n) => !outIds.has(n.id)));
      gr.links.push(...links);
    }, { pane: true });
    this._toast(`Added ${r.steps.length} building group${r.steps.length === 1 ? "" : "s"} for ${targets.map((t) => this._items[t.item]?.name || t.item).join(", ")}.`);
    this._fitDesign();
  },

  // ----------------------------------------------------------- summary
  _renderDesignSummary() {
    const pane = this.$("sumPane");
    const ev = this._ev || this._evalDesign();
    const t = ev.totals;
    const head = (this._model?.power || []).filter((c) => !c.fuse);
    const best = head.length ? Math.max(...head.map((c) => c.headroom)) : null;
    const over = best !== null && t.power > best;
    const pct = best ? Math.min(100, (t.power / Math.max(best, 1)) * 100) : 0;
    const errs = ev.problems.filter((p) => p.level === "err").length, warns = ev.problems.filter((p) => p.level === "warn").length;
    pane.innerHTML = `
      ${errs || warns ? `<div class="${errs ? "err" : "warn"}">${errs ? `${errs} problem${errs === 1 ? "" : "s"}` : ""}${errs && warns ? " and " : ""}${warns ? `${warns} warning${warns === 1 ? "" : "s"}` : ""}: see Issues on the left.</div>` : ""}
      <section class="panel" aria-label="Totals"><h2>TOTALS</h2>
        <div class="kpis"><div class="kpi"><div class="lbl">POWER</div><div class="v" style="color:${over ? PC.red : PC.text}">${fmt(t.power, 1)}<span style="font-size:12px"> MW</span></div></div>
          <div class="kpi"><div class="lbl">MACHINES</div><div class="v">${t.machines}</div></div></div>
        ${best !== null ? `<div class="muted" style="margin-top:10px">${over ? `Needs ${fmt(t.power - best, 1)} MW more than your best grid has spare (${fmt(best, 0)} MW).` : `Fits in your grid's spare ${fmt(best, 0)} MW.`}</div>
          <div class="bar"><span style="width:${pct.toFixed(0)}%;background:${over ? PC.red : pct > 85 ? PC.amber : PC.cyan}"></span></div>` : ""}
      </section>
      <section class="panel" aria-label="Outputs"><h2>OUTPUTS</h2><table class="t">${ev.outputs.map((o) =>
        `<tr><td>${pesc(o.name)}${o.want ? `<div class="muted">wanted ${fmt(o.want, 2)}</div>` : ""}</td><td class="r" style="color:${o.want && isShort(o.got, o.want) ? PC.amber : PC.text}">${fmt(o.got, 2)}</td></tr>`).join("") || `<tr><td class="muted">No outputs yet</td></tr>`}</table></section>
      <section class="panel" aria-label="Supplies"><h2>SUPPLIES</h2><table class="t">${ev.supplies.map((s) =>
        `<tr><td>${pesc(s.name)}${s.label ? `<div class="muted">${pesc(s.label)}</div>` : ""}</td><td class="r">${fmt(s.used, 2)} / ${fmt(s.rate, 2)}</td></tr>`).join("") || `<tr><td class="muted">No supplies yet</td></tr>`}</table></section>
      <section class="panel" aria-label="Buildings"><h2>BUILDINGS</h2><table class="t">${t.buildings.map((b) => `<tr><td>${pesc(b.name)}</td><td class="r">${b.count}</td></tr>`).join("") || `<tr><td class="muted">None</td></tr>`}</table></section>
      <section class="panel" aria-label="Build cost"><h2>BUILD COST</h2><table class="t">${t.cost.map((c) => `<tr><td>${pesc(c.name)}</td><td class="r">${fmt(c.amount, 0)}</td></tr>`).join("") || `<tr><td class="muted">—</td></tr>`}</table>
        <div class="muted" style="margin-top:6px">Machines only.</div></section>`;
  },
};

Object.assign(SfrmPlannerPanel.prototype, DesignMixin);

if (!customElements.get("sfrm-planner-panel")) customElements.define("sfrm-planner-panel", SfrmPlannerPanel);
console.info(`%c SFRM factory planner ${PLANNER_VERSION} `, "background:#f99b38;color:#000");
