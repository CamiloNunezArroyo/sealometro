# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Lectura/escritura de los productos intermedios en engine/out/ (JSON)."""
from __future__ import annotations

import json
from pathlib import Path

from .schema import Value

ENGINE = Path(__file__).resolve().parents[1]
OUT = ENGINE / "out"
SITE_VALUES = OUT / "site_values.json"
EARTH_SAMPLE = OUT / "earth_sample.json"
SCORES = OUT / "scores.json"


def dump_values(vals: dict[str, Value]) -> dict:
    return {k: v.model_dump(exclude_none=True) for k, v in vals.items()}


def load_values(d: dict) -> dict[str, Value]:
    return {k: Value(**v) for k, v in d.items()}


def write_json(path: Path, data, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) if compact else \
        json.dumps(data, ensure_ascii=False, indent=1)
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def read_site_values(path: Path = SITE_VALUES) -> dict[str, dict[str, Value]]:
    return {sid: load_values(v) for sid, v in read_json(path)["sites"].items()}


def read_earth_sample(path: Path = EARTH_SAMPLE) -> list[dict]:
    return [{**p, "values": load_values(p["values"])} for p in read_json(path)["points"]]
