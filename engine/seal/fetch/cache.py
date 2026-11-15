# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Caché en disco por (fuente, parámetros). Guarda JSON en engine/cache/<fuente>/<hash>.json."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Callable

ENGINE = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(os.environ.get("SEAL_CACHE", ENGINE / "cache"))


def _key(params: dict) -> str:
    return hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]


def path_for(source: str, params: dict) -> Path:
    return CACHE_DIR / source / f"{_key(params)}.json"


def get(source: str, params: dict) -> Any | None:
    p = path_for(source, params)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))["data"]
        except (json.JSONDecodeError, KeyError):
            return None
    return None


def put(source: str, params: dict, data: Any) -> None:
    p = path_for(source, params)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"params": params, "data": data}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


def cached(source: str, params: dict, compute: Callable[[], Any]) -> Any:
    """Devuelve lo guardado o calcula y guarda. No guarda resultados con error (para reintentar en otra corrida)."""
    hit = get(source, params)
    if hit is not None:
        return hit
    data = compute()
    if not (isinstance(data, dict) and (data.get("error") or data.get("error_transient"))):
        put(source, params, data)
    return data
