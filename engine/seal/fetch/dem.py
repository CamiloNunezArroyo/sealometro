# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Copernicus DEM GLO-30 (ESA, AWS Open Data, sin login) → elevación, pendiente y rugosidad.

- Ventana de 6 × 6 km centrada en el punto. Si cruza el borde de un mosaico de 1°, se leen y unen los vecinos.
- Pendiente a 30 m (resolución nativa) y REMUESTREADA a 100 m (bilineal) → p50 y p90: misma base para Tierra, Luna y Marte.
- Rugosidad a ~100 m: mediana, sobre la ventana, de la desviación estándar de la elevación tras restar un plano de
  ajuste en bloques de ~100 m × 100 m (k × k píxeles de 30 m).
- AVISO: GLO-30 es un modelo de SUPERFICIE (incluye vegetación y edificios) con ruido vertical de algunos metros,
  que infla la pendiente y la rugosidad en terreno plano. Los cuerpos de agua están aplanados.
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np

from ..schema import Value
from . import cache

SOURCE = "Copernicus DEM GLO-30 (ESA), AWS Open Data"
REF = "https://registry.opendata.aws/copernicus-dem/"
DEM_NOTE = "GLO-30 es un modelo de superficie (incluye vegetación/edificios) con ruido vertical de algunos metros."
M_PER_DEG = 111_320.0
GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE")


def tile_url(la: int, lo: int) -> str:
    name = (f"Copernicus_DSM_COG_10_{'N' if la >= 0 else 'S'}{abs(la):02d}_00_"
            f"{'E' if lo >= 0 else 'W'}{abs(lo):03d}_00_DEM")
    return f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"


def _read_window(lat: float, lon: float, size_m: float):
    import rasterio
    from rasterio.merge import merge
    from rasterio.windows import from_bounds

    from .http import USER_AGENT

    dlat = size_m / 2 / M_PER_DEG
    dlon = size_m / 2 / (M_PER_DEG * math.cos(math.radians(lat)))
    w, e, s, n = lon - dlon, lon + dlon, lat - dlat, lat + dlat
    tiles = [(la, lo) for la in range(math.floor(s), math.floor(n) + 1) for lo in range(math.floor(w), math.floor(e) + 1)]
    with rasterio.Env(GDAL_HTTP_USERAGENT=USER_AGENT, **GDAL_ENV):
        dss, used = [], []
        for la, lo in tiles:
            try:
                dss.append(rasterio.open(tile_url(la, lo)))
                used.append(f"{la},{lo}")
            except Exception as e:
                msg = str(e)
                # 404 / "does not exist" = mosaico inexistente (océano o no publicado): se sigue.
                # Cualquier otro error (red, tiempo agotado) NO es océano: se propaga para no cachear un resultado roto.
                if not any(x in msg for x in ("404", "does not exist", "No such file", "not recognized")):
                    raise
        if not dss:
            return None, None, used
        try:
            if len(dss) == 1:
                ds = dss[0]
                win = from_bounds(w, s, e, n, ds.transform).round_offsets().round_lengths()
                arr = ds.read(1, window=win, boundless=True, fill_value=np.nan, out_dtype="float32")
                res = (ds.res[0], ds.res[1])
            else:
                arr, _ = merge(dss, bounds=(w, s, e, n), nodata=np.nan, dtype="float32")
                arr, res = arr[0], (dss[0].res[0], dss[0].res[1])
        finally:
            for d in dss:
                d.close()
    return arr.astype("float64"), res, used


def _slope_deg(z: np.ndarray, dy: float, dx: float) -> np.ndarray:
    gy, gx = np.gradient(z, dy, dx)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def _resample(z: np.ndarray, dy: float, dx: float, step: float) -> np.ndarray:
    from scipy.ndimage import map_coordinates
    ny, nx = int(z.shape[0] * dy // step), int(z.shape[1] * dx // step)
    yy, xx = np.meshgrid(np.arange(ny) * step / dy, np.arange(nx) * step / dx, indexing="ij")
    return map_coordinates(z, [yy, xx], order=1, mode="nearest")


def _roughness(z: np.ndarray, k: int) -> float:
    ys, xs = np.mgrid[0:k, 0:k]
    A = np.c_[xs.ravel(), ys.ravel(), np.ones(k * k)]
    pinv = np.linalg.pinv(A)
    out = []
    for i in range(0, z.shape[0] - k + 1, k):
        for j in range(0, z.shape[1] - k + 1, k):
            b = z[i:i + k, j:j + k].ravel()
            if np.isnan(b).any():
                continue
            r = b - A @ (pinv @ b)
            out.append(r.std())
    return float(np.median(out)) if out else float("nan")


def analyze(z: np.ndarray, res_deg: tuple[float, float], lat: float) -> dict:
    """Métricas de terreno de una ventana (pura: sin red)."""
    dx = res_deg[0] * M_PER_DEG * math.cos(math.radians(lat))
    dy = res_deg[1] * M_PER_DEG
    valid = np.isfinite(z)
    frac = float(valid.mean())
    if frac < 0.9:
        return {"error": f"solo {frac:.0%} de la ventana tiene datos (¿costa u océano?)", "valid_frac": frac}
    zf = np.where(valid, z, np.nanmean(z))
    s30 = _slope_deg(zf, dy, dx)
    z100 = _resample(zf, dy, dx, 100.0)
    s100 = _slope_deg(z100, 100.0, 100.0)
    k = max(3, round(100.0 / ((dx + dy) / 2)))
    cy, cx = z.shape[0] // 2, z.shape[1] // 2
    return {
        "elevation": float(np.nanmedian(z[cy - 1:cy + 2, cx - 1:cx + 2])),
        "slope_p50_30m": float(np.percentile(s30, 50)), "slope_p90_30m": float(np.percentile(s30, 90)),
        "slope_p50_100m": float(np.percentile(s100, 50)), "slope_p90_100m": float(np.percentile(s100, 90)),
        "roughness_100m": _roughness(z, k), "roughness_block_m": round(k * (dx + dy) / 2, 1),
        "pixel_m": [round(dx, 2), round(dy, 2)], "shape": list(z.shape), "valid_frac": frac,
    }


def _fetch(lat: float, lon: float, size_m: float) -> dict:
    try:
        z, res, tiles = _read_window(lat, lon, size_m)
    except Exception as e:
        return {"error": f"no se pudo leer el DEM: {str(e)[:200]}"}
    if z is None:
        return {"error": "no hay mosaico GLO-30 para este punto", "tiles": tiles}
    out = analyze(z, res, lat)
    out.update(tiles=tiles, size_m=size_m, retrieved=dt.date.today().isoformat())
    return out


def fetch_dem(lat: float, lon: float, size_m: float = 6000.0) -> dict:
    return cache.cached("dem", {"lat": round(lat, 5), "lon": round(lon, 5), "size": size_m, "v": 1},
                        lambda: _fetch(lat, lon, size_m))


ROUGH_FLOOR_M = 0.05  # por debajo, el DEM no distingue (superficie aplanada: salares, agua)


def _roughness_value(raw: dict, win: str, base: dict) -> Value:
    r = raw["roughness_100m"]
    note = f"Mediana de la desv. estándar sin plano en bloques de ~{raw['roughness_block_m']} m. {win} {DEM_NOTE}"
    if not (r == r):
        return Value.pending("m", "No se pudo calcular la rugosidad.")
    if r < ROUGH_FLOOR_M:
        return Value(value=ROUGH_FLOOR_M, unit="m", status="estimated", note=(
            f"Rugosidad por debajo de lo que el DEM resuelve ({r:.3f} m): se usa el límite {ROUGH_FLOOR_M} m. "
            "Probable superficie aplanada (salar o agua). " + note), **base)
    return Value(value=round(r, 3), unit="m", status="derived", note=note, **base)


def dem_values(raw: dict) -> dict[str, Value]:
    """Value del motor a partir del resultado de fetch_dem. Si hubo error, todo pending con la razón."""
    feats = {"slope_p50_100m": "grados", "slope_p90_100m": "grados", "roughness_100m": "m", "_elevation": "m"}
    if raw.get("error"):
        return {k: Value.pending(u, f"DEM: {raw['error']}") for k, u in feats.items()}
    r, win = raw.get("retrieved"), f"Ventana de {raw['size_m'] / 1000:.0f} × {raw['size_m'] / 1000:.0f} km; mosaicos {raw['tiles']}."
    base = dict(source=SOURCE, ref=REF, retrieved=r)
    return {
        "_elevation": Value(value=round(raw["elevation"], 1), unit="m", status="modeled",
                            note=f"Mediana de 3 × 3 píxeles en el centro. {DEM_NOTE}", **base),
        "slope_p50_100m": Value(value=round(raw["slope_p50_100m"], 2), unit="grados", status="derived",
                                note=f"Pendiente mediana remuestreada a 100 m (a 30 m: {raw['slope_p50_30m']:.2f}°). {win} {DEM_NOTE}", **base),
        "slope_p90_100m": Value(value=round(raw["slope_p90_100m"], 2), unit="grados", status="derived",
                                note=f"Percentil 90 a 100 m (a 30 m: {raw['slope_p90_30m']:.2f}°). {win} {DEM_NOTE}", **base),
        "roughness_100m": _roughness_value(raw, win, base),
    }
