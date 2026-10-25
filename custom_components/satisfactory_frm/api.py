"""Async client for the Ficsit Remote Monitoring (FRM) web server."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import aiohttp

from .const import AUTH_HEADER, REQUEST_TIMEOUT


class FRMError(Exception):
    """Generic FRM error."""


class FRMConnectionError(FRMError):
    """FRM could not be reached (server down, network issue)."""


class FRMAuthError(FRMError):
    """The auth token was missing or rejected."""


class FRMNotReady(FRMError):
    """FRM is reachable but the world is not loaded ("World not ready")."""


class FRMClient:
    """Talks to FRM's HTTP API."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        host: str,
        port: int,
        token: str | None = None,
    ) -> None:
        self.base_url = f"http://{host}:{port}"
        self._session = session
        self._token = token or None

    @property
    def has_token(self) -> bool:
        return self._token is not None

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self._token:
            headers[AUTH_HEADER] = self._token
        return headers

    async def _request(
        self, method: str, endpoint: str, payload: Any | None = None
    ) -> Any:
        url = f"{self.base_url}/{endpoint}"
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT):
                async with self._session.request(
                    method, url, headers=self._headers(), json=payload
                ) as resp:
                    text = await resp.text()
                    status = resp.status
        except (aiohttp.ClientError, TimeoutError) as err:
            raise FRMConnectionError(f"Cannot reach FRM at {self.base_url}: {err}") from err

        if "World not ready" in text:
            raise FRMNotReady("FRM is running but the world is not loaded")
        if status in (401, 403):
            raise FRMAuthError(f"FRM rejected {endpoint} (HTTP {status}); check the token")
        if status >= 400:
            raise FRMError(f"FRM returned HTTP {status} for {endpoint}: {text[:200]}")
        if not text.strip():
            return None
        try:
            return json.loads(text)
        except ValueError as err:
            raise FRMError(f"Non-JSON response from {endpoint}: {text[:200]}") from err

    async def get(self, endpoint: str) -> Any:
        return await self._request("GET", endpoint)

    async def get_list(self, endpoint: str) -> list[dict[str, Any]]:
        data = await self.get(endpoint)
        return data if isinstance(data, list) else []

    async def get_session_info(self) -> dict[str, Any]:
        data = await self.get("getSessionInfo")
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    async def get_asset(self, path: str) -> tuple[bytes, str]:
        """Fetch a static web-UI asset (map image, icons)."""
        url = f"{self.base_url}/{path}"
        try:
            async with asyncio.timeout(REQUEST_TIMEOUT * 2):
                async with self._session.get(url) as resp:
                    if resp.status >= 400:
                        raise FRMError(f"Asset {path} returned HTTP {resp.status}")
                    return await resp.read(), resp.content_type
        except (aiohttp.ClientError, TimeoutError) as err:
            raise FRMConnectionError(f"Cannot fetch asset {path}: {err}") from err

    # --- Write calls (need the token) ----------------------------------

    def _require_token(self) -> None:
        if not self._token:
            raise FRMAuthError("This action needs the FRM auth token (set it in the integration options)")

    async def set_switch(self, switch_id: str, status: bool) -> Any:
        self._require_token()
        return await self._request("POST", "setSwitches", {"ID": switch_id, "status": status})

    async def set_switch_priority(self, switch_id: str, priority: int) -> Any:
        # VERIFY: field name for priority against a live server (see CLAUDE.md).
        self._require_token()
        return await self._request("POST", "setSwitches", {"ID": switch_id, "priority": priority})

    async def set_enabled(self, building_id: str, enabled: bool) -> Any:
        """Run (True) or stand by (False) a factory building.

        VERIFY: payload assumed to mirror setSwitches ({"ID", "status"}); see CLAUDE.md.
        """
        self._require_token()
        return await self._request("POST", "setEnabled", {"ID": building_id, "status": enabled})

    async def send_chat(self, message: str, sender: str) -> Any:
        self._require_token()
        return await self._request("POST", "sendChatMessage", {"message": message, "sender": sender})
