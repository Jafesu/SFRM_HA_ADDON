"""Pipe networks: trace getPipes into connected networks and work out supply,
demand and what the pipes can carry.

FRM reports no live flow for pipes (getPipes `Speed` is the rated capacity in
m³/s: 5 for Mk.1 = 300 m³/min). So everything here is worked out from rated
numbers of the machines on each network, plus the machines' own tank levels,
which are the live signal that a line is running dry.

Unique IDs (save-level):
  pipeline:<network key>:<sensor key>
The network key is the FRM ID of the network's first-built source (lowest ID
number), so it stays put while that building exists.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
import re
from typing import Any

# Things a fluid flows through. Everything else a pipe connects to is a machine.
PASSTHROUGH_PREFIXES = (
    "Build_Pipeline",  # pipes Mk.1/Mk.2, junctions, pumps
    "Build_Valve",
    "Build_PipeStorageTank",  # fluid buffer
    "Build_IndustrialTank",  # industrial fluid buffer
)
DEFAULT_PIPE_CAPACITY = 300.0  # m³/min, Mk.1
STARVING_TANK_PCT = 25.0
EPS = 0.5  # m³/min: ignore rounding noise in comparisons
INF = float("inf")

STATUSES = ["ok", "short_supply", "over_capacity", "starving", "no_source", "no_consumers"]
PROBLEM_STATUSES = {"short_supply", "over_capacity", "starving", "no_source"}


def is_pipe(obj_id: str) -> bool:
    return obj_id.startswith("Build_Pipeline") and not obj_id.startswith(
        ("Build_PipelineJunction", "Build_PipelinePump")
    )


def is_passthrough(obj_id: str) -> bool:
    return obj_id.startswith(PASSTHROUGH_PREFIXES)


def pipe_capacity(raw: dict[str, Any]) -> float:
    """Rated capacity in m³/min (FRM's Speed is m³/s)."""
    try:
        speed = float(raw.get("Speed"))
    except (TypeError, ValueError):
        return DEFAULT_PIPE_CAPACITY
    return speed * 60 if speed > 0 else DEFAULT_PIPE_CAPACITY


def id_number(obj_id: str) -> int:
    m = re.search(r"(\d+)$", obj_id)
    return int(m.group(1)) if m else 0


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def slim_pipes(pipes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only what the network analysis needs (getPipes is ~3 KB per pipe)."""
    keep = ("ID", "ClassName", "ConnectedTo0", "ConnectedTo1", "Length", "Speed")
    return [{k: p.get(k) for k in keep} for p in pipes if p.get("ID")]


# --- What a machine puts into / takes out of a network -----------------------

def fluid_outputs(raw: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Fluids this machine produces: ClassName -> {name, max, now, tank}.

    Uses each building's `production` list (extractors and factory machines).
    A fluid is recognised by being on a pipe network, so solids are filtered out
    by the caller matching against the network's fluid.
    """
    out = {}
    for p in raw.get("production") or []:
        cls = p.get("ClassName")
        if cls:
            out[cls] = {
                "name": p.get("Name") or cls,
                "max": _f(p.get("MaxProd")),
                "now": _f(p.get("CurrentProd")),
                "tank": _pct(p.get("Amount"), p.get("MaxAmount")),
            }
    return out


def fluid_inputs(raw: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Fluids this machine consumes: ClassName -> {name, max, now, tank}.

    Generators: the `Supplement` (water for coal/nuclear). Factory machines:
    their `ingredients`, with the tank level from `InputInventory`.
    """
    out = {}
    sup = raw.get("Supplement") or {}
    if sup.get("ClassName") and _f(sup.get("MaxConsumed")) > 0:
        out[sup["ClassName"]] = {
            "name": sup.get("Name") or sup["ClassName"],
            "max": _f(sup.get("MaxConsumed")),
            "now": _f(sup.get("CurrentConsumed")),
            "tank": _f(sup.get("PercentFull")) if sup.get("PercentFull") is not None else None,
        }
    inv = {i.get("ClassName"): i for i in raw.get("InputInventory") or []}
    for ing in raw.get("ingredients") or []:
        cls = ing.get("ClassName")
        if cls:
            slot = inv.get(cls) or {}
            out[cls] = {
                "name": ing.get("Name") or cls,
                "max": _f(ing.get("MaxConsumed")),
                "now": _f(ing.get("CurrentConsumed")),
                "tank": _pct(slot.get("Amount"), slot.get("MaxAmount")),
            }
    return out


def _pct(amount: Any, maximum: Any) -> float | None:
    mx = _f(maximum)
    return round(_f(amount) / mx * 100, 1) if mx > 0 else None


# --- Networks ----------------------------------------------------------------

@dataclass
class Network:
    key: str
    fluid: str | None = None
    fluid_name: str | None = None
    pipes: list[str] = field(default_factory=list)
    length_m: float = 0.0
    sources: list[dict[str, Any]] = field(default_factory=list)
    consumers: list[dict[str, Any]] = field(default_factory=list)
    other: list[str] = field(default_factory=list)  # connected but not understood
    supply: float = 0.0  # rated max of all sources, m³/min
    supply_now: float = 0.0
    demand: float = 0.0  # rated need of all consumers at full speed
    demand_now: float = 0.0
    capacity: float = 0.0  # what the pipes alone can carry from sources to consumers
    deliverable: float = 0.0  # what actually reaches consumers given supply and pipes
    lowest_tank: float | None = None
    status: str = "ok"

    @property
    def shortfall(self) -> float:
        return round(max(0.0, self.demand - self.deliverable), 1)

    @property
    def usage(self) -> float | None:
        """Demand as % of pipe capacity; over 100 means the pipes are too small."""
        if self.capacity <= 0 or self.capacity == INF:
            return None
        return round(self.demand / self.capacity * 100, 1)

    @property
    def problem(self) -> bool:
        return self.status in PROBLEM_STATUSES


def build_networks(
    pipes: list[dict[str, Any]], machines: dict[str, dict[str, Any]]
) -> dict[str, Network]:
    """Group pipes into connected networks and analyse each one."""
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    by_id = {p["ID"]: p for p in pipes}
    # adjacency over every node (pipes, junctions, pumps, machines)
    adj: dict[str, set[str]] = {}
    for p in pipes:
        pid = p["ID"]
        find(pid)
        adj.setdefault(pid, set())
        for k in ("ConnectedTo0", "ConnectedTo1"):
            other = p.get(k)
            if not other or other == pid:
                continue
            adj[pid].add(other)
            adj.setdefault(other, set()).add(pid)
            if is_passthrough(other):
                parent[find(pid)] = find(other)

    groups: dict[str, list[str]] = {}
    for pid in by_id:
        groups.setdefault(find(pid), []).append(pid)

    networks: dict[str, Network] = {}
    for members in groups.values():
        member_set = set(members)
        nodes = {n for n in parent if find(n) == find(members[0])}
        endpoints = sorted(
            {o for n in nodes for o in adj.get(n, ()) if not is_passthrough(o)}, key=id_number
        )
        net = _analyse(members, nodes, endpoints, by_id, adj, machines)
        net.pipes = sorted(member_set, key=id_number)
        net.length_m = round(sum(_f(by_id[p].get("Length")) for p in members) / 100, 1)
        networks[net.key] = net
    return networks


def _analyse(
    members: list[str],
    nodes: set[str],
    endpoints: list[str],
    by_id: dict[str, dict[str, Any]],
    adj: dict[str, set[str]],
    machines: dict[str, dict[str, Any]],
) -> Network:
    # Which fluid: the one most of the connected machines produce, else consume.
    produced: dict[str, int] = {}
    consumed: dict[str, int] = {}
    names: dict[str, str] = {}
    for e in endpoints:
        raw = machines.get(e)
        if raw is None:
            continue
        for cls, v in fluid_outputs(raw).items():
            produced[cls] = produced.get(cls, 0) + 1
            names[cls] = v["name"]
        for cls, v in fluid_inputs(raw).items():
            consumed[cls] = consumed.get(cls, 0) + 1
            names[cls] = v["name"]
    # A solid a machine also makes (e.g. a refinery's plastic) shows up in
    # `produced` too; prefer fluids that some consumer here also takes.
    candidates = {c: n + (100 if c in consumed else 0) for c, n in produced.items()} or consumed
    fluid = max(candidates, key=candidates.get) if candidates else None

    sources, consumers, other = [], [], []
    for e in endpoints:
        raw = machines.get(e)
        out = fluid_outputs(raw).get(fluid) if raw and fluid else None
        inp = fluid_inputs(raw).get(fluid) if raw and fluid else None
        label = (raw or {}).get("Name") or e
        if out:
            sources.append({"id": e, "name": label, **out})
        elif inp:
            consumers.append({"id": e, "name": label, **inp})
        else:
            other.append(e)

    key = sources[0]["id"] if sources else min(members, key=id_number)
    net = Network(key=key, fluid=fluid, fluid_name=names.get(fluid) if fluid else None)
    net.sources, net.consumers, net.other = sources, consumers, other
    net.supply = round(sum(s["max"] for s in sources), 1)
    net.supply_now = round(sum(s["now"] for s in sources), 1)
    net.demand = round(sum(c["max"] for c in consumers), 1)
    net.demand_now = round(sum(c["now"] for c in consumers), 1)
    tanks = [c["tank"] for c in consumers if c["tank"] is not None]
    net.lowest_tank = min(tanks) if tanks else None

    if sources and consumers:
        net.capacity = round(_max_flow(nodes, by_id, adj, sources, consumers, limited=False), 1)
        net.deliverable = round(_max_flow(nodes, by_id, adj, sources, consumers, limited=True), 1)

    if not sources:
        net.status = "no_source"
    elif not consumers:
        net.status = "no_consumers"
    elif net.deliverable + EPS < net.demand:
        net.status = (
            "over_capacity" if net.capacity + EPS < min(net.supply, net.demand) else "short_supply"
        )
    elif net.lowest_tank is not None and net.lowest_tank < STARVING_TANK_PCT:
        net.status = "starving"
    else:
        net.status = "ok"
    return net


def _max_flow(
    nodes: set[str],
    by_id: dict[str, dict[str, Any]],
    adj: dict[str, set[str]],
    sources: list[dict[str, Any]],
    consumers: list[dict[str, Any]],
    limited: bool,
) -> float:
    """Edmonds-Karp over the pipe graph.

    Pipes are nodes with a capacity (split into in/out); junctions, pumps and
    valves pass anything; flow can go either way along a pipe. With
    limited=False sources and consumers are unlimited, which gives the pure
    pipe capacity between them. Pump head lift is not modelled.
    """
    cap: dict[tuple[str, str], dict[tuple[str, str], float]] = {}

    def edge(a: tuple[str, str], b: tuple[str, str], c: float) -> None:
        cap.setdefault(a, {})
        cap[a][b] = cap[a].get(b, 0.0) + c
        cap.setdefault(b, {}).setdefault(a, 0.0)

    S, T = ("S", ""), ("T", "")
    for n in nodes:
        edge(("i", n), ("o", n), pipe_capacity(by_id[n]) if n in by_id else INF)
        for m in adj.get(n, ()):
            if m in nodes:
                edge(("o", n), ("i", m), INF)
    for s in sources:
        edge(S, ("o", s["id"]), s["max"] if limited else INF)
        for m in adj.get(s["id"], ()):
            if m in nodes:
                edge(("o", s["id"]), ("i", m), INF)
    for c in consumers:
        edge(("i", c["id"]), T, c["max"] if limited else INF)
        for m in adj.get(c["id"], ()):
            if m in nodes:
                edge(("o", m), ("i", c["id"]), INF)

    total = 0.0
    while True:
        prev: dict[tuple[str, str], tuple[str, str]] = {S: S}
        queue = deque([S])
        while queue and T not in prev:
            u = queue.popleft()
            for v, c in cap[u].items():
                if c > 1e-9 and v not in prev:
                    prev[v] = u
                    queue.append(v)
        if T not in prev:
            return total
        bottleneck, v = INF, T
        while v != S:
            u = prev[v]
            bottleneck = min(bottleneck, cap[u][v])
            v = u
        if bottleneck == INF:
            return INF
        v = T
        while v != S:
            u = prev[v]
            cap[u][v] -= bottleneck
            cap[v][u] += bottleneck
            v = u
        total += bottleneck


def network_names(networks: dict[str, Network]) -> dict[str, str]:
    """'Water line', or 'Water line 1', 'Water line 2'... numbered in build order."""
    by_fluid: dict[str, list[str]] = {}
    for key, net in networks.items():
        by_fluid.setdefault(net.fluid_name or "Pipe", []).append(key)
    names = {}
    for fluid, keys in by_fluid.items():
        keys.sort(key=id_number)
        for n, key in enumerate(keys, start=1):
            names[key] = f"{fluid} line" if len(keys) == 1 else f"{fluid} line {n}"
    return names


def network_summary(net: Network, name: str) -> dict[str, Any]:
    """JSON-friendly view for the websocket API (dashboard panel, map)."""
    return {
        "key": net.key,
        "name": name,
        "fluid": net.fluid,
        "fluid_name": net.fluid_name,
        "status": net.status,
        "problem": net.problem,
        "supply": net.supply,
        "supply_now": net.supply_now,
        "demand": net.demand,
        "demand_now": net.demand_now,
        "capacity": None if net.capacity == INF else net.capacity,
        "deliverable": None if net.deliverable == INF else net.deliverable,
        "shortfall": net.shortfall,
        "usage": net.usage,
        "lowest_tank": net.lowest_tank,
        "length_m": net.length_m,
        "pipe_count": len(net.pipes),
        "sources": net.sources,
        "consumers": net.consumers,
    }


def keep_keys(
    networks: dict[str, Network], previous: dict[str, str]
) -> tuple[dict[str, Network], dict[str, str]]:
    """Give each network the key it had last time, so its entities keep their
    history when you add or remove the building its key came from.

    `previous` maps pipe ID -> network key from the last build. A network takes
    the old key most of its pipes had (largest networks choose first, so after a
    split the bigger half keeps the key). New networks keep their own key.
    Returns the re-keyed networks and the new pipe -> key map.
    """
    result: dict[str, Network] = {}
    for net in sorted(networks.values(), key=lambda n: (-len(n.pipes), id_number(n.key))):
        counts: dict[str, int] = {}
        for p in net.pipes:
            if p in previous:
                counts[previous[p]] = counts.get(previous[p], 0) + 1
        inherited = [k for k, _ in sorted(counts.items(), key=lambda kv: -kv[1]) if k not in result]
        for key in (*inherited, net.key, *net.pipes):
            if key not in result:
                net.key = key
                result[key] = net
                break
    pipe_keys = {p: key for key, net in result.items() for p in net.pipes}
    return result, pipe_keys
