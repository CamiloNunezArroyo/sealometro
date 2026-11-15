# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Validación de data/shared/ranking.json contra el esquema de MOTOR_SIMILITUD.md §7 + regla de honestidad:
todo número que no sea 'pending' tiene status y source. Devuelve la lista de errores (vacía = válido)."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ValidationError

from ..schema import Status


class _Val(BaseModel):
    auc: Optional[float]
    n_pos: Optional[int]
    n_rand: Optional[int]
    note: Optional[str]


class _Target(BaseModel):
    id: str
    body: str
    name: str


class _Robust(BaseModel):
    median_rank: Optional[float]
    p90: Optional[list[int]]
    p_top3: float


class _V(BaseModel):
    value: Optional[float] = None
    unit: str
    status: Status
    source: Optional[str] = None


class _Dim(BaseModel):
    id: str
    s: Optional[float]
    po: Optional[float]
    pct_earth: Optional[float]
    site: Optional[_V]
    target: Optional[_V]


class _Gap(BaseModel):
    id: str
    earth: Any
    target: Any
    unit: Optional[str]
    text_key: str


class _Story(BaseModel):
    explorador: str
    cadete: str
    cientifico: str


class _Result(BaseModel):
    site_id: str
    target_id: str
    ifa: Optional[float]
    coverage: float
    profiles: dict[str, Optional[float]]
    limiting: Optional[str]
    robust: Optional[_Robust]
    dims: list[_Dim]
    gaps: list[_Gap]
    story: _Story


class _Ranking(BaseModel):
    generated: str
    engine_version: str
    validation: _Val
    targets: list[_Target]
    results: list[_Result]


def check_ranking(data: dict) -> list[str]:
    errs: list[str] = []
    try:
        r = _Ranking(**data)
    except ValidationError as e:
        return [f"esquema: {x['loc']}: {x['msg']}" for x in e.errors()[:20]]
    tids = {t.id for t in r.targets}
    for res in r.results:
        key = f"{res.site_id}×{res.target_id}"
        if res.target_id not in tids:
            errs.append(f"{key}: objetivo desconocido")
        if res.ifa is not None and not 0 <= res.ifa <= 100:
            errs.append(f"{key}: IFA fuera de 0–100")
        if not 0 <= res.coverage <= 1:
            errs.append(f"{key}: cobertura fuera de 0–1")
        for d in res.dims:
            for side, v in (("site", d.site), ("target", d.target)):
                if v is not None and v.status != "pending" and not (v.source or "").strip():
                    errs.append(f"{key}.{d.id}.{side}: número sin fuente")
            if d.s is not None and (d.site is None or d.target is None):
                errs.append(f"{key}.{d.id}: s calculada sin valores")
    return errs
