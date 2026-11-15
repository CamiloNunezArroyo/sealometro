# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Muestra al azar de tierra firme (semilla fija) → mediana y percentiles de la Tierra (§5.2) y puntos al azar
para la validación (§5.5).

- Muestreo uniforme por ÁREA sobre la esfera (lat = asin(u)), aceptando solo tierra firme según la máscara GLOBE
  de 1 km (paquete global-land-mask). Incluye Antártida y Groenlandia: son tierra firme.
- Cada punto pasa por el mismo proceso que los sitios (DEM + POWER + corrección por elevación).
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from ..schema import Value
from .pipeline import fetch_point

SEED = 20261114


def land_points(n: int, seed: int = SEED) -> list[tuple[float, float]]:
    from global_land_mask import globe
    rng = np.random.default_rng(seed)
    pts: list[tuple[float, float]] = []
    while len(pts) < n:
        lat = float(np.degrees(np.arcsin(rng.uniform(-1, 1))))
        lon = float(rng.uniform(-180, 180))
        lat = max(min(lat, 84.9), -89.9)
        if globe.is_land(lat, lon):
            pts.append((round(lat, 4), round(lon, 4)))
    return pts


def fetch_sample(n: int = 300, seed: int = SEED, with_dem: bool = True, workers: int = 4,
                 progress=None) -> list[dict]:
    pts = land_points(n, seed)

    def one(i_pt):
        i, (lat, lon) = i_pt
        try:
            vals = fetch_point(lat, lon, with_dem=with_dem)
        except Exception as e:  # un punto que falla no tumba la muestra
            vals = {"_error": Value.pending("", str(e)[:200])}
        if progress:
            progress(i)
        return {"id": f"rand_{i:03d}", "lat": lat, "lon": lon, "values": vals}

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(one, enumerate(pts)))


def earth_stats(sample: list[dict], fids: list[str]) -> dict[str, dict]:
    """Mediana, p5, p95 y lista de valores por dimensión (solo valores usables)."""
    out = {}
    for f in fids:
        xs = [p["values"][f].value for p in sample if f in p["values"] and p["values"][f].usable()
              and p["values"][f].value is not None and math.isfinite(p["values"][f].value)]
        if xs:
            a = np.asarray(xs)
            out[f] = {"n": len(xs), "median": float(np.median(a)), "p5": float(np.percentile(a, 5)),
                      "p95": float(np.percentile(a, 95)), "values": xs}
    return out
