"""Map markers stored in Home Assistant (FRM can't create in-game markers).

Stored per server and per save in .storage/satisfactory_frm.markers.<entry_id>,
so every HA user sees the same markers on the map card.
"""

from __future__ import annotations

import re
import time
import uuid
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ICONS = ("pin", "star", "flag", "warning", "home", "resource")


class MarkerStore:
    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, list[dict[str, Any]]]] = Store(
            hass, 1, f"{DOMAIN}.markers.{entry_id}"
        )
        self._data: dict[str, list[dict[str, Any]]] = {}

    async def async_load(self) -> None:
        self._data = await self._store.async_load() or {}

    def list(self, save: str) -> list[dict[str, Any]]:
        return list(self._data.get(save, []))

    async def add(self, save: str, x: float, y: float, name: str, color: str, icon: str, user: str | None) -> dict[str, Any]:
        marker = {
            "id": uuid.uuid4().hex[:12],
            "x": float(x),
            "y": float(y),
            "name": clean_name(name),
            "color": color if COLOR_RE.match(color or "") else "#f99b38",
            "icon": icon if icon in ICONS else "pin",
            "created_by": user,
            "created": int(time.time()),
        }
        self._data.setdefault(save, []).append(marker)
        await self._store.async_save(self._data)
        return marker

    async def update(self, save: str, marker_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        for marker in self._data.get(save, []):
            if marker["id"] != marker_id:
                continue
            if "name" in changes:
                marker["name"] = clean_name(changes["name"])
            if COLOR_RE.match(changes.get("color") or ""):
                marker["color"] = changes["color"]
            if changes.get("icon") in ICONS:
                marker["icon"] = changes["icon"]
            for key in ("x", "y"):
                if isinstance(changes.get(key), (int, float)):
                    marker[key] = float(changes[key])
            await self._store.async_save(self._data)
            return marker
        return None

    async def delete(self, save: str, marker_id: str) -> bool:
        markers = self._data.get(save, [])
        kept = [m for m in markers if m["id"] != marker_id]
        if len(kept) == len(markers):
            return False
        self._data[save] = kept
        await self._store.async_save(self._data)
        return True


def clean_name(name: Any) -> str:
    text = " ".join(str(name or "").split())[:60]
    return text or "Marker"
