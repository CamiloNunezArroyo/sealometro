# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Relieve real para el juego: ventana de Copernicus DEM GLO-30 (ESA) de cada sitio → mapa de alturas compacto.

Salida en data/shared/terrain/:
- <site_id>.bin : N×N alturas uint16 little-endian, fila 0 = norte; altura = min + q/65535·(max − min).
- game_sites.json : metadatos por sitio (tamaño, alturas, agua, bioma, minerales, clima real para la estación del juego).

Honestidad (se muestra en el juego):
- El relieve grande es REAL (DEM de 30 m, ventana de 3 × 3 km remuestreada a N×N).
- El detalle chico, las rocas, la arena blanda y las muestras son de JUEGO (gameplay).
- 'biome' y 'water' son decisiones de diseño a partir de los datos y del nombre del lugar; no son mediciones.
"""
from __future__ import annotations

import datetime as dt
import math
from pathlib import Path
from typing import Mapping

import numpy as np

from ..fetch.dem import _read_window
from ..schema import Site, Value

N = 129
SIZE_M = 3000.0
WATER_SITES = {"laguna_colorada", "laguna_verde_licancabur"}  # design: lagos visibles en la ventana
VOLCANIC_HINTS = ("volc", "etna", "mauna", "askja", "lava", "cinder", "teide", "lanzarote", "payun", "pinacate",
                  "bromo", "kverk", "uturuncu", "sajama", "licancabur")


def resample(z: np.ndarray, n: int) -> np.ndarray:
    from scipy.ndimage import map_coordinates
    valid = np.isfinite(z)
    zf = np.where(valid, z, np.nanmean(z) if valid.any() else 0.0)
    yy, xx = np.meshgrid(np.linspace(0, z.shape[0] - 1, n), np.linspace(0, z.shape[1] - 1, n), indexing="ij")
    return map_coordinates(zf, [yy, xx], order=1, mode="nearest")


def quantize(h: np.ndarray) -> tuple[np.ndarray, float, float]:
    lo, hi = float(h.min()), float(h.max())
    span = max(hi - lo, 1e-6)
    q = np.round((h - lo) / span * 65535).astype("<u2")
    return q, lo, hi


def _val(vals: Mapping[str, Value], k: str):
    v = vals.get(k)
    if v is None or not v.usable():
        return None
    return {"value": v.value, "unit": v.unit, "status": v.status, "source": v.source, "ref": v.ref}


def biome(site: Site, vals: Mapping[str, Value]) -> str:
    """Decisión de diseño (no medición): cómo se ve el suelo en el juego."""
    mins = set((vals.get("mineral_classes").classes or []) if vals.get("mineral_classes") and vals["mineral_classes"].usable() else [])
    s50 = vals.get("slope_p50_100m").value if vals.get("slope_p50_100m") and vals["slope_p50_100m"].usable() else 5
    ndvi = vals.get("ndvi").value if vals.get("ndvi") and vals["ndvi"].usable() else None
    tm = vals.get("t_mean").value if vals.get("t_mean") and vals["t_mean"].usable() else 285
    name = (site.id + " " + site.name).lower()
    if site.id in WATER_SITES:
        return "lago"
    if "cloruro" in mins and s50 < 1.5:
        return "salar"
    if ndvi is not None and ndvi > 0.35:
        return "vegetado"
    # frío: media anual bajo −7 °C (POWER) o un glaciar de roca por nombre
    if tm < 266 or "glaciar" in name or "glacier" in name:
        return "frio"
    if "basalto" in mins or any(h in name for h in VOLCANIC_HINTS):
        return "volcanico"
    # sin NDVI alto pero cálido y lluvioso (POWER > 900 mm/año): suelo con vegetación (p. ej. Pantanal)
    pr = vals.get("precip").value if vals.get("precip") and vals["precip"].usable() else None
    if pr is not None and pr > 900 and tm > 285:
        return "vegetado"
    return "desierto"


def export_site(site: Site, vals: Mapping[str, Value], out: Path, n: int = N, size_m: float = SIZE_M) -> dict:
    z, res, tiles = _read_window(site.lat, site.lon, size_m)
    if z is None:
        return {"id": site.id, "error": "sin DEM"}
    h = resample(z, n)
    q, lo, hi = quantize(h)
    (out / f"{site.id}.bin").write_bytes(q.tobytes())
    water = None
    if site.id in WATER_SITES:
        flat = (h - lo) < 0.6
        if flat.mean() > 0.03:
            water = round(lo + 0.25, 2)
    cave = vals.get("cave_lava_tube")
    mins = vals.get("mineral_classes")
    return {
        "id": site.id, "name": site.name, "country": site.country, "lat": site.lat, "lon": site.lon, "role": site.role,
        "file": f"terrain/{site.id}.bin", "n": n, "size_m": size_m, "m_per_px": round(size_m / (n - 1), 2),
        "h_min": round(lo, 2), "h_max": round(hi, 2), "tiles": tiles,
        "water_level": water, "biome": biome(site, vals),
        "cave": bool(cave and cave.usable() and cave.value and cave.value >= 1),
        "minerals": {"classes": mins.classes, "status": mins.status, "source": mins.source} if mins and mins.usable() and mins.classes else None,
        "climate": {k: _val(vals, k) for k in ("t_mean", "t_range_diurnal", "pressure", "uv_index", "precip", "rh",
                                                "wind", "soil_moisture", "ndvi")},
        "terrain_stats": {k: _val(vals, k) for k in ("slope_p50_100m", "slope_p90_100m", "roughness_100m", "_elevation")},
    }


def export_all(sites: Mapping[str, Site], site_values: Mapping[str, Mapping[str, Value]], out: Path) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    items = []
    for sid, vals in site_values.items():
        s = sites.get(sid)
        if s is None or not s.processable():
            continue
        items.append(export_site(s, vals, out))
    return {
        "generated": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": "Copernicus DEM GLO-30 (ESA), AWS Open Data; ventana de 3 × 3 km remuestreada",
        "honesty": "Relieve grande REAL (DEM 30 m). Detalle chico, rocas, arena blanda, muestras y cuevas: JUEGO. "
                   "Bioma y agua: decisiones de diseño.",
        "sites": items,
    }
