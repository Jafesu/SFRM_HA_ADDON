"""A small dense simplex solver (no dependencies).

Solves   minimise c·x   subject to   A x = b,  x >= 0,  b >= 0
given a starting basis of identity columns. The planner always has one (an
"import" variable per item), so no phase 1 is needed: infeasibility shows up as
imports in the answer instead.

Problem sizes are small (tens of items, up to a few hundred recipes), so a
dense tableau in plain Python is fast enough.
"""

from __future__ import annotations

from dataclasses import dataclass

EPS = 1e-9
IMPROVE = 1e-7  # a reduced cost must be below -IMPROVE to be worth pivoting on
HARRIS = 1e-9  # feasibility tolerance for the ratio test
NOISE = 1e-4  # an "unbounded" column with a reduced cost above -NOISE is rounding noise


class LPError(Exception):
    """The problem is unbounded or the solver didn't converge."""


@dataclass
class LPResult:
    x: list[float]
    objective: float
    iterations: int


def solve(
    c: list[float],
    rows: list[dict[int, float]],
    b: list[float],
    basis: list[int],
    max_iter: int = 20000,
) -> LPResult:
    """`rows[i]` is a sparse row {column: coefficient}; `basis[i]` is the column
    that is the identity for row i (coefficient 1 in row i, 0 elsewhere)."""
    m, n = len(rows), len(c)
    if any(v < -EPS for v in b):
        raise LPError("right-hand side must be non-negative")
    t = [[0.0] * (n + 1) for _ in range(m)]
    for i, row in enumerate(rows):
        for j, v in row.items():
            t[i][j] = v
        t[i][n] = b[i]
    basis = list(basis)
    # Reduced costs: r = c - c_B · T
    r = list(c) + [0.0]
    for i in range(m):
        cb = c[basis[i]]
        if cb:
            ti = t[i]
            for j in range(n + 1):
                if ti[j]:
                    r[j] -= cb * ti[j]

    degenerate = 0
    skip: set[int] = set()  # columns ruled out as noise until the next pivot
    it = 0
    while it < max_iter:
        # Entering column: most negative reduced cost (Dantzig); Bland's rule
        # after a run of degenerate pivots, to avoid cycling.
        enter = -1
        if degenerate > 50:
            for j in range(n):
                if r[j] < -IMPROVE and j not in skip:
                    enter = j
                    break
        else:
            best = -IMPROVE
            for j in range(n):
                if r[j] < best and j not in skip:
                    best, enter = r[j], j
        if enter < 0:
            x = [0.0] * n
            for i in range(m):
                x[basis[i]] = t[i][n]
            return LPResult(x=x, objective=-r[n], iterations=it)

        # Harris two-pass ratio test: among rows whose ratio is within a small
        # tolerance of the minimum, pivot on the largest element. Tiny pivots
        # are what make a dense tableau numerically unstable.
        col = [t[i][enter] for i in range(m)]
        cmax = max((abs(v) for v in col), default=0.0)
        piv_tol = max(EPS, 1e-9 * cmax)
        bound = float("inf")
        for i in range(m):
            a = col[i]
            if a > piv_tol:
                bound = min(bound, (max(t[i][n], 0.0) + HARRIS) / a)
        leave, best_a, best_ratio = -1, 0.0, float("inf")
        if bound < float("inf"):
            for i in range(m):
                a = col[i]
                if a > piv_tol:
                    ratio = max(t[i][n], 0.0) / a
                    if ratio <= bound and (a > best_a or (a == best_a and basis[i] < basis[leave])):
                        leave, best_a, best_ratio = i, a, ratio
        if leave < 0:
            if r[enter] > -NOISE:
                skip.add(enter)
                continue
            raise LPError("unbounded")
        skip.clear()
        it += 1
        degenerate = degenerate + 1 if best_ratio <= EPS else 0

        # Pivot on (leave, enter).
        prow = t[leave]
        p = prow[enter]
        if p != 1.0:
            inv = 1.0 / p
            for j in range(n + 1):
                if prow[j]:
                    prow[j] *= inv
        nz = [j for j in range(n + 1) if prow[j]]
        for i in range(m):
            if i == leave:
                continue
            f = t[i][enter]
            if f:
                ti = t[i]
                for j in nz:
                    ti[j] -= f * prow[j]
                ti[enter] = 0.0
        f = r[enter]
        if f:
            for j in nz:
                r[j] -= f * prow[j]
            r[enter] = 0.0
        basis[leave] = enter
        for i in range(m):
            if t[i][n] < 0.0:  # rounding: a basic variable can't go below zero
                t[i][n] = 0.0
    raise LPError("did not converge")
