"""Planner backend: game model cache, plan storage and websocket API.

Plans are stored in .storage/satisfactory_frm.plans.<entry_id>, per save, so
every Home Assistant user sees the same plans (like map markers).

Websocket commands (all take entry_id):
  satisfactory_frm/planner/model   items, recipes, buildings, resources, live
                                   surplus and power headroom for the loaded save
  satisfactory_frm/planner/solve   targets + options -> plan result
  satisfactory_frm/planner/plans          list saved plans for the loaded save
  satisfactory_frm/planner/plans/save     create or update a plan
  satisfactory_frm/planner/plans/delete   delete a plan
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import logging
import time
from typing import Any
import uuid

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .api import FRMError
from .const import DOMAIN
from .planner import GameModel, PlanOptions, solve
from .planner_const import BELT_SPEEDS, PIPE_SPEEDS

_LOGGER = logging.getLogger(__name__)
MODEL_MAX_AGE = timedelta(minutes=10)
MAX_TARGETS = 30
MAX_PLANS = 200


class PlannerData:
    """Per-entry planner state: cached game model and stored plans."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self._store: Store[dict[str, dict[str, dict[str, Any]]]] = Store(
            hass, 1, f"{DOMAIN}.plans.{entry_id}"
        )
        self._plans: dict[str, dict[str, dict[str, Any]]] = {}
        self._model: GameModel | None = None
        self._model_key: str | None = None
        self._model_at: datetime | None = None
        self._lock = asyncio.Lock()

    async def async_load(self) -> None:
        self._plans = await self._store.async_load() or {}

    async def model(self, entry: Any, save: str, refresh: bool = False) -> GameModel:
        """The game model for the loaded save, rebuilt every MODEL_MAX_AGE (unlocks
        change as you progress) or on request."""
        async with self._lock:
            now = dt_util.utcnow()
            if (
                not refresh
                and self._model is not None
                and self._model_key == save
                and self._model_at is not None
                and now - self._model_at < MODEL_MAX_AGE
            ):
                return self._model
            client = entry.runtime_data.client
            recipes, schematics, nodes = await asyncio.gather(
                client.get("getRecipes"), client.get("getSchematics"), client.get("getResourceNode")
            )
            model = await self.hass.async_add_executor_job(
                GameModel.from_frm,
                recipes if isinstance(recipes, list) else [],
                schematics if isinstance(schematics, list) else [],
                nodes if isinstance(nodes, list) else [],
            )
            self._model, self._model_key, self._model_at = model, save, now
            return model

    # --- plans ---------------------------------------------------------------

    def list(self, save: str) -> list[dict[str, Any]]:
        return sorted(self._plans.get(save, {}).values(), key=lambda p: p.get("updated", 0), reverse=True)

    async def save(self, save: str, plan: dict[str, Any], user: str | None) -> dict[str, Any]:
        plans = self._plans.setdefault(save, {})
        pid = plan.get("id") or uuid.uuid4().hex[:12]
        if pid not in plans and len(plans) >= MAX_PLANS:
            raise ValueError(f"At most {MAX_PLANS} plans per save")
        old = plans.get(pid, {})
        stored = {
            **old,
            "id": pid,
            "name": str(plan.get("name") or old.get("name") or "New plan")[:80],
            "targets": plan.get("targets", old.get("targets", [])),
            "options": plan.get("options", old.get("options", {})),
            "positions": plan.get("positions", old.get("positions", {})),
            "mode": plan.get("mode", old.get("mode", "solve")),
            "graph": plan.get("graph", old.get("graph", {"nodes": [], "links": []})),
            "notes": str(plan.get("notes", old.get("notes", "")))[:2000],
            "created": old.get("created", time.time()),
            "created_by": old.get("created_by", user),
            "updated": time.time(),
            "updated_by": user,
        }
        plans[pid] = stored
        await self._store.async_save(self._plans)
        return stored

    async def delete(self, save: str, pid: str) -> bool:
        if pid in self._plans.get(save, {}):
            del self._plans[save][pid]
            await self._store.async_save(self._plans)
            return True
        return False


# --- helpers --------------------------------------------------------------------

def _entry(hass: HomeAssistant, connection: Any, msg: dict) -> tuple[Any, str] | None:
    entry = hass.config_entries.async_get_entry(msg["entry_id"])
    if not entry or entry.domain != DOMAIN or entry.state is not ConfigEntryState.LOADED:
        connection.send_error(msg["id"], "not_found", "Server not loaded")
        return None
    data = entry.runtime_data.fast.data
    if not data or not data.save:
        connection.send_error(msg["id"], "not_ready", "World not ready")
        return None
    return entry, data.save


def live_surplus(entry: Any) -> dict[str, float]:
    """Items the factory makes more of than it uses right now (items/min)."""
    slow = entry.runtime_data.slow.data
    out: dict[str, float] = {}
    for key, raw in (slow.prod.items() if slow else []):
        try:
            net = float(raw.get("CurrentProd") or 0) - float(raw.get("CurrentConsumed") or 0)
        except (TypeError, ValueError):
            continue
        cls = raw.get("ClassName") or key
        if net > 0.01:
            out[cls] = round(net, 3)
    return out


def power_headroom(entry: Any) -> list[dict[str, Any]]:
    fast = entry.runtime_data.fast.data
    out = []
    for cid, raw in sorted((fast.circuits.items() if fast else []), key=lambda kv: kv[0]):
        try:
            cap = float(raw.get("PowerCapacity") or 0)
            used = float(raw.get("PowerConsumed") or 0)
        except (TypeError, ValueError):
            continue
        out.append({"circuit": cid, "capacity": round(cap, 1), "consumed": round(used, 1),
                    "headroom": round(cap - used, 1), "fuse": bool(raw.get("FuseTriggered"))})
    return out


def model_summary(model: GameModel) -> dict[str, Any]:
    """What the panel needs to build a plan (compact: no full recipe database)."""
    used = {i for r in model.recipes.values() for i in (*r.inputs, *r.outputs)}
    return {
        "items": {c: v for c, v in model.items.items() if c in used},
        "producible": model.producible(),
        "recipes": [
            {
                "cls": r.cls,
                "name": r.name,
                "building": r.building,
                "building_name": model.building_name(r.building),
                "unlocked": r.unlocked,
                "alternate": r.alternate,
                "event": r.event,
                "power": r.power,
                "inputs": r.inputs,
                "outputs": r.outputs,
            }
            for r in sorted(model.recipes.values(), key=lambda r: r.name)
        ],
        "buildings": {
            b: {"name": v["name"], "unlocked": v["unlocked"], "cost": v.get("cost", {})}
            for b, v in model.buildings.items()
            if b in {r.building for r in model.recipes.values()} or b in BELT_SPEEDS or b in PIPE_SPEEDS
        },
        "resources": model.resources,
        "weights": model.weights,
        "belt": model.best_belt(),
        # Unlocked transport tiers, slowest first: [class, name, per minute].
        "belts": sorted(([b, model.building_name(b), v] for b, v in model.unlocked_buildings(BELT_SPEEDS)), key=lambda x: x[2]),
        "pipes": sorted(([b, model.building_name(b), v] for b, v in model.unlocked_buildings(PIPE_SPEEDS)), key=lambda x: x[2]),
        "pipe": model.best_pipe(),
        "miner": model.best_miner(),
    }


def _options(raw: dict[str, Any], entry: Any) -> PlanOptions:
    return PlanOptions(
        recipes="all" if raw.get("recipes") == "all" else "unlocked",
        disabled=set(raw.get("disabled") or []),
        enabled=set(raw.get("enabled") or []),
        surplus=live_surplus(entry) if raw.get("use_surplus") else {},
        include_events=bool(raw.get("include_events")),
    )


# --- websocket commands -----------------------------------------------------------

@websocket_api.websocket_command(
    {
        vol.Required("type"): "satisfactory_frm/planner/model",
        vol.Required("entry_id"): str,
        vol.Optional("refresh", default=False): bool,
    }
)
@websocket_api.async_response
async def ws_model(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    found = _entry(hass, connection, msg)
    if not found:
        return
    entry, save = found
    try:
        model = await entry.runtime_data.planner.model(entry, save, msg["refresh"])
    except FRMError as err:
        connection.send_error(msg["id"], "frm_error", str(err))
        return
    connection.send_result(msg["id"], {
        "title": entry.title,
        "save": save,
        "session_name": entry.runtime_data.fast.data.session_name,
        **model_summary(model),
        "surplus": live_surplus(entry),
        "power": power_headroom(entry),
    })


# Design-mode graph (see sfrm-planner.js). Kept loose but bounded.
_NODE = vol.Schema(
    {
        vol.Required("id"): vol.All(str, vol.Length(max=40)),
        vol.Required("type"): vol.In(["machine", "supply", "output", "hub"]),
        vol.Optional("recipe"): vol.All(str, vol.Length(max=120)),
        vol.Optional("count"): vol.All(vol.Coerce(int), vol.Range(min=1, max=1000)),
        vol.Optional("clock"): vol.All(vol.Coerce(float), vol.Range(min=1, max=250)),
        vol.Optional("item"): vol.Any(None, vol.All(str, vol.Length(max=120))),
        vol.Optional("rate"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1e6)),
        vol.Optional("want"): vol.Any(None, vol.All(vol.Coerce(float), vol.Range(min=0, max=1e6))),
        vol.Optional("label"): vol.All(str, vol.Length(max=80)),
        vol.Required("x"): vol.Coerce(float),
        vol.Required("y"): vol.Coerce(float),
    }
)
_LINK = vol.Schema(
    {
        vol.Required("id"): vol.All(str, vol.Length(max=40)),
        vol.Required("from"): vol.All(str, vol.Length(max=40)),
        vol.Required("to"): vol.All(str, vol.Length(max=40)),
        vol.Required("item"): vol.All(str, vol.Length(max=120)),
    }
)
GRAPH_SCHEMA = vol.Schema(
    {
        vol.Required("nodes"): vol.All([_NODE], vol.Length(max=500)),
        vol.Required("links"): vol.All([_LINK], vol.Length(max=2000)),
    }
)

TARGET_SCHEMA = vol.All(
    [{vol.Required("item"): str, vol.Required("rate"): vol.All(vol.Coerce(float), vol.Range(min=0, max=1e6))}],
    vol.Length(max=MAX_TARGETS),
)
OPTIONS_SCHEMA = vol.Schema(
    {
        vol.Optional("recipes"): vol.In(["unlocked", "all"]),
        vol.Optional("disabled"): [str],
        vol.Optional("enabled"): [str],
        vol.Optional("use_surplus"): bool,
        vol.Optional("include_events"): bool,
    },
    extra=vol.REMOVE_EXTRA,
)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "satisfactory_frm/planner/solve",
        vol.Required("entry_id"): str,
        vol.Required("targets"): TARGET_SCHEMA,
        vol.Optional("options", default={}): OPTIONS_SCHEMA,
    }
)
@websocket_api.async_response
async def ws_solve(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    found = _entry(hass, connection, msg)
    if not found:
        return
    entry, save = found
    try:
        model = await entry.runtime_data.planner.model(entry, save)
    except FRMError as err:
        connection.send_error(msg["id"], "frm_error", str(err))
        return
    targets: dict[str, float] = {}
    for t in msg["targets"]:
        targets[t["item"]] = targets.get(t["item"], 0.0) + t["rate"]
    opts = _options(msg["options"], entry)
    result = await hass.async_add_executor_job(solve, model, targets, opts)
    result["surplus_available"] = opts.surplus
    result["power_headroom"] = power_headroom(entry)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {vol.Required("type"): "satisfactory_frm/planner/plans", vol.Required("entry_id"): str}
)
@callback
def ws_plans(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    found = _entry(hass, connection, msg)
    if found:
        entry, save = found
        connection.send_result(msg["id"], entry.runtime_data.planner.list(save))


@websocket_api.websocket_command(
    {
        vol.Required("type"): "satisfactory_frm/planner/plans/save",
        vol.Required("entry_id"): str,
        vol.Required("plan"): vol.Schema(
            {
                vol.Optional("id"): str,
                vol.Optional("name"): str,
                vol.Optional("targets"): TARGET_SCHEMA,
                vol.Optional("options"): OPTIONS_SCHEMA,
                vol.Optional("positions"): vol.Schema({str: [vol.Coerce(float)]}),
                vol.Optional("notes"): str,
                vol.Optional("mode"): vol.In(["solve", "design"]),
                vol.Optional("graph"): GRAPH_SCHEMA,
            }
        ),
    }
)
@websocket_api.async_response
async def ws_plan_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    found = _entry(hass, connection, msg)
    if not found:
        return
    entry, save = found
    user = connection.user.name if connection.user else None
    try:
        plan = await entry.runtime_data.planner.save(save, msg["plan"], user)
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return
    connection.send_result(msg["id"], plan)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "satisfactory_frm/planner/plans/delete",
        vol.Required("entry_id"): str,
        vol.Required("plan_id"): str,
    }
)
@websocket_api.async_response
async def ws_plan_delete(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    found = _entry(hass, connection, msg)
    if not found:
        return
    entry, save = found
    ok = await entry.runtime_data.planner.delete(save, msg["plan_id"])
    connection.send_result(msg["id"], {"deleted": ok})


COMMANDS = (ws_model, ws_solve, ws_plans, ws_plan_save, ws_plan_delete)
