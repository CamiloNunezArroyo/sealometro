# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""HTTP con User-Agent del proyecto, reintentos con espera y como mucho 4 pedidos a la vez por API."""
from __future__ import annotations

import threading
import time
from collections import defaultdict

import requests

USER_AGENT = "SealHackathonTeam-engine/0.1 (NASA Space Apps Sucre 2026; open-data research, low volume)"
MAX_PER_API = 4
_sems: dict[str, threading.Semaphore] = defaultdict(lambda: threading.Semaphore(MAX_PER_API))
_session = threading.local()


def session() -> requests.Session:
    if not hasattr(_session, "s"):
        s = requests.Session()
        s.headers["User-Agent"] = USER_AGENT
        _session.s = s
    return _session.s


class FatalHTTP(Exception):
    """Error que no se arregla reintentando (400/404/422)."""


def get_json(api: str, url: str, params: dict, retries: int = 4, timeout: float = 90) -> dict:
    last: Exception | None = None
    with _sems[api]:
        for attempt in range(retries):
            try:
                r = session().get(url, params=params, timeout=timeout)
                if r.status_code in (400, 404, 422):
                    raise FatalHTTP(f"HTTP {r.status_code}: {r.text[:300]}")
                r.raise_for_status()
                return r.json()
            except FatalHTTP:
                raise
            except Exception as e:  # red, 429, 5xx, JSON roto
                last = e
                time.sleep(2 ** attempt + 0.5)
    raise RuntimeError(f"{api}: falló tras {retries} intentos: {last}")
