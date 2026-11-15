# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Cuadrante "impostor vs oculto" (MOTOR_SIMILITUD.md §5.6). Funciones PURAS.

Eje Y = parecido FÍSICO (IFA del motor contra el objetivo global del cuerpo).
Eje X = parecido VISUAL. Sin embeddings (T3), es una VOTACIÓN DEL EQUIPO con fotos, 0–10, marcada `estimated`.
       Nunca se inventa: un sitio sin votos no se ubica en el cuadrante.

Umbrales (decisiones de diseño):
- físico alto: IFA ≥ percentil 75 de la muestra terrestre al azar para ese objetivo (umbral sacado de los datos);
- visual alto: promedio de votos ≥ 5 sobre 10.

Cuadrantes: oculto (no parece, pero sí es) · análogo completo (parece y es) · impostor (parece, pero no es) · ninguno.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Optional

import numpy as np

VISUAL_HIGH = 5.0
EARTH_PCT = 75


@dataclass
class VisualScore:
    mean: float
    n: int
    sd: float


def _num(x) -> Optional[float]:
    try:
        v = float(str(x).strip().replace(",", "."))
    except ValueError:
        return None
    return v if 0 <= v <= 10 else None


def votes_from_rows(rows: Iterable[Mapping[str, str]], body: str) -> dict[str, VisualScore]:
    """Acepta dos formatos:
    - largo: columnas site_id, body, votante, puntaje (una fila por votante);
    - ancho (hoja de Google Sheets): columnas site_id, body, votante_1 … votante_N (una columna por votante).
    Celdas vacías, texto o fuera de 0–10 se ignoran."""
    by: dict[str, list[float]] = {}
    for row in rows:
        if (row.get("body") or "").strip().lower() != body or not (row.get("site_id") or "").strip():
            continue
        sid = row["site_id"].strip()
        cols = [k for k in row if k and k.strip().lower().startswith("votante_")]
        vals = [_num(row[k]) for k in cols] if cols else [_num(row.get("puntaje", ""))]
        by.setdefault(sid, []).extend(v for v in vals if v is not None)
    return {k: VisualScore(float(np.mean(v)), len(v), float(np.std(v))) for k, v in by.items() if v}


def read_votes(path: Path, body: str) -> dict[str, VisualScore]:
    if not path.exists():
        return {}
    with open(path, encoding="utf-8-sig") as fh:
        return votes_from_rows(csv.DictReader(fh), body)


def physical_threshold(random_ifas: Iterable[Optional[float]], pct: float = EARTH_PCT) -> Optional[float]:
    xs = [x for x in random_ifas if x is not None]
    return float(np.percentile(xs, pct)) if xs else None


def classify(ifa: Optional[float], visual: Optional[VisualScore], y_thr: Optional[float],
             x_thr: float = VISUAL_HIGH) -> str:
    if ifa is None or y_thr is None:
        return "sin_datos_fisicos"
    if visual is None:
        return "sin_votos"
    hi_y, hi_x = ifa >= y_thr, visual.mean >= x_thr
    return {(True, False): "oculto", (True, True): "analogo_completo",
            (False, True): "impostor", (False, False): "ninguno"}[(hi_y, hi_x)]


LABEL = {"oculto": "Análogo oculto (no lo parece, pero los datos dicen que sí)",
         "analogo_completo": "Análogo completo (lo parece y los datos lo confirman)",
         "impostor": "Impostor (lo parece, pero los datos dicen que no)",
         "ninguno": "Ni lo parece ni lo es",
         "sin_votos": "Falta la votación visual del equipo",
         "sin_datos_fisicos": "Faltan datos físicos"}


def quadrant(site_ifa: Mapping[str, Optional[float]], votes: Mapping[str, VisualScore],
             random_ifas: Iterable[Optional[float]]) -> dict:
    thr = physical_threshold(random_ifas)
    rows = {sid: {"ifa": ifa, "visual": (votes[sid].__dict__ if sid in votes else None),
                  "class": classify(ifa, votes.get(sid), thr)} for sid, ifa in site_ifa.items()}
    return {"y_threshold": thr, "y_threshold_rule": f"percentil {EARTH_PCT} del IFA de la muestra terrestre al azar",
            "x_threshold": VISUAL_HIGH, "x_status": "estimated", "x_source": "Votación del equipo con fotos (0–10)",
            "sites": rows}
