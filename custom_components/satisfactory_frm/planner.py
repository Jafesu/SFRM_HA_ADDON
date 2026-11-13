"""Factory planner: game model from the live save, and the production solver.

GameModel is built from three FRM endpoints:
  getRecipes     every recipe (ingredients, products, rates, which building)
  getSchematics  purchased schematics -> which recipes and buildings are unlocked
  getResourceNode  every node with purity, height and whether it's taken

solve() finds the cheapest set of recipes that makes the requested items, as a
linear program: one variable per recipe (machines at 100 %), raw resources
weighted by how scarce they are on the map, and an "import" per item with a
huge cost so impossible plans still return an answer that says what's missing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
import random
from typing import Any

from .lp import LPError, solve as lp_solve
from .planner_const import (
    BELT_SPEEDS,
    BUILDING_POWER,
    CLOCK_POWER_EXPONENT,
    FLUIDS,
    MINER_RATE,
    OIL_EXTRACTOR_RATE,
    PIPE_SPEEDS,
    PURITY_FACTOR,
    RAW_RESOURCES,
    UNLIMITED_RESOURCES,
    WATER_EXTRACTOR_RATE,
    WELL_SATELLITE_RATE,
)

IMPORT_COST = 1e4
SURPLUS_COST = 1e-5
MACHINE_COST = 1e-4  # tie-breaker: fewer machines
POWER_COST = 1e-6  # per MW: tie-breaker, less power
EPS = 1e-6
PERTURB = 1e-8
REPORT = 1e-3  # smallest rate shown in a plan


def build_class(desc: str) -> str:
    """Desc_ConstructorMk1_C -> Build_ConstructorMk1_C"""
    return "Build_" + desc[len("Desc_"):] if desc.startswith("Desc_") else desc


@dataclass
class Recipe:
    cls: str
    name: str
    building: str  # Build_..._C
    duration: float
    inputs: dict[str, float]  # item -> per minute at 100 %
    outputs: dict[str, float]
    unlocked: bool
    alternate: bool
    event: bool

    @property
    def power(self) -> float:
        return BUILDING_POWER.get(self.building, 0.0)


@dataclass
class GameModel:
    items: dict[str, dict[str, Any]] = field(default_factory=dict)  # cls -> {name, fluid}
    recipes: dict[str, Recipe] = field(default_factory=dict)
    buildings: dict[str, dict[str, Any]] = field(default_factory=dict)  # Build cls -> {name, unlocked, cost}
    resources: dict[str, dict[str, Any]] = field(default_factory=dict)  # raw item -> node stats
    weights: dict[str, float] = field(default_factory=dict)  # raw item -> cost per unit/min
    # Every raw resource node: {id, item, purity, free, type ("Node" or
    # "Fracking Satellite"), x, y, z} in game units.
    nodes: list[dict[str, Any]] = field(default_factory=list)

    # --- building the model from FRM data --------------------------------------

    @classmethod
    def from_frm(
        cls,
        recipes: list[dict[str, Any]],
        schematics: list[dict[str, Any]],
        nodes: list[dict[str, Any]],
    ) -> GameModel:
        model = cls()
        unlocked: set[str] = set()
        for s in schematics or []:
            if s.get("Purchased"):
                for r in s.get("Recipes") or []:
                    unlocked.add(r.get("ClassName") if isinstance(r, dict) else str(r))

        for raw in recipes or []:
            for part in (raw.get("Ingredients") or []) + (raw.get("Products") or []):
                c = part.get("ClassName")
                if c and c not in model.items:
                    model.items[c] = {"name": part.get("Name") or c, "fluid": c in FLUIDS}
            produced_in = raw.get("ProducedIn") or []
            rcls = raw.get("ClassName") or raw.get("ID")
            if produced_in == ["BP_BuildGun_C"]:
                # A building: its build cost, and whether it's unlocked.
                prods = raw.get("Products") or []
                if prods:
                    b = build_class(prods[0].get("ClassName", ""))
                    model.buildings[b] = {
                        "name": raw.get("Name") or b,
                        "unlocked": rcls in unlocked,
                        "cost": {
                            i["ClassName"]: float(i.get("Amount") or 0)
                            for i in raw.get("Ingredients") or []
                            if i.get("ClassName")
                        },
                    }
                continue
            factory = [b for b in produced_in if b.startswith("Build_")]
            if not factory or not rcls:
                continue
            name = raw.get("Name") or rcls
            model.recipes[rcls] = Recipe(
                cls=rcls,
                name=name,
                building=factory[0],
                duration=float(raw.get("FactoryDuration") or 0),
                inputs=_rates(raw.get("Ingredients")),
                outputs=_rates(raw.get("Products")),
                unlocked=rcls in unlocked,
                alternate=name.startswith("Alternate") or "_Alternate_" in rcls,
                event=bool(raw.get("Events")),
            )

        for n in nodes or []:
            item = n.get("ClassName")
            if item not in RAW_RESOURCES:
                continue
            purity = PURITY_FACTOR.get(n.get("Purity"), 1.0)
            st = model.resources.setdefault(
                item, {"nodes": 0, "free": 0, "capacity": 0.0, "free_capacity": 0.0,
                       "free_by_purity": {"Impure": 0, "Normal": 0, "Pure": 0}}
            )
            st["nodes"] += 1
            st["capacity"] += purity
            loc = n.get("location") or {}
            model.nodes.append({
                "id": n.get("ID"), "item": item, "purity": n.get("Purity") or "Normal",
                "free": not n.get("Exploited"), "type": n.get("NodeType") or "Node",
                "x": round(float(loc.get("x") or 0)), "y": round(float(loc.get("y") or 0)),
                "z": round(float(loc.get("z") or 0)),
            })
            if not n.get("Exploited"):
                st["free"] += 1
                st["free_capacity"] += purity
                if n.get("Purity") in st["free_by_purity"]:
                    st["free_by_purity"][n["Purity"]] += 1
            model.items.setdefault(item, {"name": n.get("Name") or item, "fluid": item in FLUIDS})
        for item in RAW_RESOURCES:
            model.items.setdefault(item, {"name": item, "fluid": item in FLUIDS})

        # Scarcer resources cost more: weight = (average capacity) / capacity.
        caps = {i: st["capacity"] for i, st in model.resources.items() if st["capacity"] > 0}
        avg = sum(caps.values()) / len(caps) if caps else 1.0
        for item in RAW_RESOURCES:
            if item in UNLIMITED_RESOURCES:
                model.weights[item] = 0.001
            else:
                model.weights[item] = avg / caps[item] if item in caps else 10.0
        return model

    # --- helpers -----------------------------------------------------------------

    def item_name(self, item: str) -> str:
        return self.items.get(item, {}).get("name", item)

    def building_name(self, b: str) -> str:
        return self.buildings.get(b, {}).get("name") or b.removeprefix("Build_").removesuffix("_C")

    def unlocked_buildings(self, prefix_map: dict[str, float]) -> list[tuple[str, float]]:
        return [(b, v) for b, v in prefix_map.items() if self.buildings.get(b, {}).get("unlocked")]

    def best_belt(self) -> tuple[str, float] | None:
        belts = self.unlocked_buildings(BELT_SPEEDS)
        return max(belts, key=lambda kv: kv[1]) if belts else None

    def best_pipe(self) -> tuple[str, float] | None:
        pipes = self.unlocked_buildings(PIPE_SPEEDS)
        return max(pipes, key=lambda kv: kv[1]) if pipes else None

    def best_miner(self) -> tuple[str, float]:
        miners = self.unlocked_buildings(MINER_RATE)
        return max(miners, key=lambda kv: kv[1]) if miners else ("Build_MinerMk1_C", 60)

    def producible(self) -> list[str]:
        """Items any factory recipe makes (for the item picker)."""
        out = {i for r in self.recipes.values() for i in r.outputs}
        return sorted(out, key=self.item_name)


def _rates(parts: list[dict[str, Any]] | None) -> dict[str, float]:
    out: dict[str, float] = {}
    for p in parts or []:
        c = p.get("ClassName")
        if c:
            out[c] = out.get(c, 0.0) + float(p.get("FactoryRate") or 0)
    return out


# --- solving -----------------------------------------------------------------------

@dataclass
class PlanOptions:
    recipes: str = "unlocked"  # "unlocked" | "all"
    disabled: set[str] = field(default_factory=set)  # recipe classes never to use
    enabled: set[str] = field(default_factory=set)  # extra recipes (e.g. locked alternates)
    surplus: dict[str, float] = field(default_factory=dict)  # item -> free items/min available
    include_events: bool = False


def candidate_recipes(model: GameModel, opts: PlanOptions) -> list[Recipe]:
    out = []
    for r in model.recipes.values():
        if r.cls in opts.disabled:
            continue
        if r.cls in opts.enabled or r.unlocked:
            out.append(r)
        elif opts.recipes == "all" and (opts.include_events or not r.event):
            out.append(r)
    return out


def relevant(recipes: list[Recipe], targets: dict[str, float]) -> list[Recipe]:
    """Recipes that can contribute to the targets (walking back from them)."""
    by_output: dict[str, list[Recipe]] = {}
    for r in recipes:
        for i in r.outputs:
            by_output.setdefault(i, []).append(r)
    needed, seen, keep = list(targets), set(targets), {}
    while needed:
        item = needed.pop()
        for r in by_output.get(item, []):
            if r.cls in keep:
                continue
            keep[r.cls] = r
            for i in r.inputs:
                if i not in seen:
                    seen.add(i)
                    needed.append(i)
    return list(keep.values())


def solve(model: GameModel, targets: dict[str, float], opts: PlanOptions | None = None) -> dict[str, Any]:
    opts = opts or PlanOptions()
    targets = {i: float(v) for i, v in targets.items() if float(v) > 0}
    recipes = relevant(candidate_recipes(model, opts), targets)

    items: list[str] = list(dict.fromkeys(
        list(targets) + [i for r in recipes for i in (*r.inputs, *r.outputs)]
    ))
    row_of = {item: k for k, item in enumerate(items)}
    m = len(items)

    # Columns: imports (basis) | recipes | raw | surplus | excess | surplus slacks
    c: list[float] = []
    rows: list[dict[int, float]] = [dict() for _ in range(m)]
    b = [targets.get(i, 0.0) for i in items]
    cols: list[tuple[str, str]] = []

    def col(kind: str, key: str, cost: float) -> int:
        cols.append((kind, key))
        c.append(cost)
        return len(c) - 1

    for item in items:
        rows[row_of[item]][col("import", item, IMPORT_COST)] = 1.0
    basis = list(range(m))
    for r in recipes:
        j = col("recipe", r.cls, MACHINE_COST + POWER_COST * r.power)
        for i, v in r.outputs.items():
            rows[row_of[i]][j] = rows[row_of[i]].get(j, 0.0) + v
        for i, v in r.inputs.items():
            rows[row_of[i]][j] = rows[row_of[i]].get(j, 0.0) - v
    for item in items:
        if item in RAW_RESOURCES:
            rows[row_of[item]][col("raw", item, model.weights.get(item, 1.0))] = 1.0
    surplus_cols = []
    for item in items:
        avail = opts.surplus.get(item, 0.0)
        if avail > EPS:
            j = col("surplus", item, SURPLUS_COST)
            rows[row_of[item]][j] = 1.0
            surplus_cols.append((j, avail))
    for item in items:
        rows[row_of[item]][col("excess", item, 0.0)] = -1.0
    # Surplus upper bounds: e + slack = available
    for j, avail in surplus_cols:
        s = col("slack", str(j), 0.0)
        rows.append({j: 1.0, s: 1.0})
        b.append(avail)
        basis.append(s)

    # Anti-degeneracy: most rows need exactly 0 (intermediate items), which
    # makes the simplex stall on ties. A tiny deterministic nudge breaks them;
    # it's far below anything that's reported.
    rng = random.Random(len(b))
    b = [v + PERTURB * (1 + rng.random()) for v in b]
    try:
        result = lp_solve(c, rows, b, basis)
    except LPError as err:
        return {"ok": False, "error": str(err)}
    return _report(model, targets, recipes, cols, result.x)


def _report(
    model: GameModel,
    targets: dict[str, float],
    recipes: list[Recipe],
    cols: list[tuple[str, str]],
    x: list[float],
) -> dict[str, Any]:
    by_cls = {r.cls: r for r in recipes}
    vals: dict[tuple[str, str], float] = {}
    for (kind, key), v in zip(cols, x):
        if v > REPORT and kind != "slack":
            vals[(kind, key)] = vals.get((kind, key), 0.0) + v

    steps = []
    produced: dict[str, list[tuple[str, float]]] = {}
    consumed: dict[str, list[tuple[str, float]]] = {}
    power = 0.0
    buildings: dict[str, int] = {}
    cost: dict[str, float] = {}
    for (kind, key), v in sorted(vals.items()):
        if kind != "recipe":
            continue
        r = by_cls[key]
        count = max(1, math.ceil(v - 1e-4))
        clock = v / count * 100
        mw = r.power * count * (clock / 100) ** CLOCK_POWER_EXPONENT
        power += mw
        buildings[r.building] = buildings.get(r.building, 0) + count
        for item, amt in model.buildings.get(r.building, {}).get("cost", {}).items():
            cost[item] = cost.get(item, 0.0) + amt * count
        node = f"recipe:{r.cls}"
        steps.append({
            "id": node,
            "recipe": r.cls,
            "name": r.name,
            "alternate": r.alternate,
            "unlocked": r.unlocked,
            "building": r.building,
            "building_name": model.building_name(r.building),
            "building_unlocked": bool(model.buildings.get(r.building, {}).get("unlocked")),
            "machines": round(v, 3),
            "count": count,
            "clock": round(clock, 2),
            "power": round(mw, 2),
            "inputs": [{"item": i, "name": model.item_name(i), "rate": round(a * v, 3)} for i, a in r.inputs.items()],
            "outputs": [{"item": i, "name": model.item_name(i), "rate": round(a * v, 3)} for i, a in r.outputs.items()],
        })
        for i, a in r.outputs.items():
            produced.setdefault(i, []).append((node, a * v))
        for i, a in r.inputs.items():
            consumed.setdefault(i, []).append((node, a * v))

    raw, surplus_used, missing, byproducts = [], [], [], []
    miner, miner_rate = model.best_miner()
    for (kind, item), v in vals.items():
        name = model.item_name(item)
        if kind == "raw":
            node = f"raw:{item}"
            produced.setdefault(item, []).append((node, v))
            raw.append({"id": node, "item": item, "name": name, "rate": round(v, 3),
                        **_extraction(model, item, v, miner, miner_rate)})
        elif kind == "surplus":
            node = f"surplus:{item}"
            produced.setdefault(item, []).append((node, v))
            surplus_used.append({"id": node, "item": item, "name": name, "rate": round(v, 3)})
        elif kind == "import":
            node = f"import:{item}"
            produced.setdefault(item, []).append((node, v))
            missing.append({"id": node, "item": item, "name": name, "rate": round(v, 3)})
        elif kind == "excess" and item not in targets:
            node = f"byproduct:{item}"
            consumed.setdefault(item, []).append((node, v))
            byproducts.append({"id": node, "item": item, "name": name, "rate": round(v, 3)})
    outputs = []
    for item, rate in targets.items():
        node = f"target:{item}"
        total = rate + vals.get(("excess", item), 0.0)
        consumed.setdefault(item, []).append((node, total))
        outputs.append({"id": node, "item": item, "name": model.item_name(item), "rate": round(total, 3),
                        "requested": rate})

    # Edges: each producer of an item feeds each consumer in proportion.
    belt, pipe = model.best_belt(), model.best_pipe()
    edges = []
    for item, prods in produced.items():
        total = sum(a for _, a in prods)
        if total <= EPS:
            continue
        for src, pa in prods:
            for dst, ca in consumed.get(item, []):
                rate = pa * ca / total
                if rate > EPS:
                    edges.append({"from": src, "to": dst, "item": item, "name": model.item_name(item),
                                  "rate": round(rate, 3), **_transport(model, item, rate, belt, pipe)})

    return {
        "ok": True,
        "outputs": outputs,
        "steps": steps,
        "raw": sorted(raw, key=lambda r: -r["rate"]),
        "surplus": surplus_used,
        "missing": missing,
        "byproducts": byproducts,
        "edges": edges,
        "totals": {
            "power": round(power, 2),
            "buildings": [{"building": b, "name": model.building_name(b), "count": n}
                          for b, n in sorted(buildings.items(), key=lambda kv: -kv[1])],
            "machines": sum(buildings.values()),
            "cost": [{"item": i, "name": model.item_name(i), "amount": round(a, 2)}
                     for i, a in sorted(cost.items(), key=lambda kv: -kv[1])],
        },
        "transport": {
            "belt": {"building": belt[0], "name": model.building_name(belt[0]), "rate": belt[1]} if belt else None,
            "pipe": {"building": pipe[0], "name": model.building_name(pipe[0]), "rate": pipe[1]} if pipe else None,
        },
    }


def _extraction(model: GameModel, item: str, rate: float, miner: str, miner_rate: float) -> dict[str, Any]:
    """Rough extractor count for the summary: on Normal nodes at 100 %."""
    kind = RAW_RESOURCES.get(item)
    st = model.resources.get(item, {})
    if kind == "water":
        return {"extractor": "Build_WaterPump_C", "extractor_name": model.building_name("Build_WaterPump_C"),
                "extractors": math.ceil(rate / WATER_EXTRACTOR_RATE - EPS)}
    per = {"miner": miner_rate, "oil": OIL_EXTRACTOR_RATE, "well": WELL_SATELLITE_RATE}.get(kind, miner_rate)
    ext = {"miner": miner, "oil": "Build_OilPump_C", "well": "Build_FrackingExtractor_C"}.get(kind, miner)
    return {
        "extractor": ext,
        "extractor_name": model.building_name(ext),
        "normal_nodes": round(rate / per, 2),
        "free_nodes": st.get("free", 0),
        "free_by_purity": st.get("free_by_purity", {}),
        # What all free nodes could give with the best unlocked extractor at 100 %.
        "free_capacity": round(st.get("free_capacity", 0.0) * per, 1),
    }


def _transport(model: GameModel, item: str, rate: float,
               belt: tuple[str, float] | None, pipe: tuple[str, float] | None) -> dict[str, Any]:
    """Cheapest unlocked belt or pipe for this flow, and how many if one isn't enough."""
    fluid = model.items.get(item, {}).get("fluid", item in FLUIDS)
    speeds = PIPE_SPEEDS if fluid else BELT_SPEEDS
    best = pipe if fluid else belt
    if best is None:
        return {"carrier": None, "lanes": None}
    fits = sorted((v, b) for b, v in model.unlocked_buildings(speeds) if v + EPS >= rate)
    if fits:
        v, b = fits[0]
        return {"carrier": b, "carrier_name": model.building_name(b), "lanes": 1}
    b, v = best
    return {"carrier": b, "carrier_name": model.building_name(b), "lanes": math.ceil(rate / v - EPS)}
