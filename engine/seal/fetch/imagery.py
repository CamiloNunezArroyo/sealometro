# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Imagen satelital REAL de cada sitio: Copernicus Sentinel-2 L2A (ESA), color verdadero (TCI, 10 m).

Se recorta EXACTAMENTE la misma ventana de 3 × 3 km que el relieve del juego (misma fórmula que el DEM, en
grados), así el suelo del juego es la foto real del lugar. Escena: la de menos nubes (y poca nieve, salvo sitios
fríos) entre 2023 y 2026, buscada en el catálogo público STAC de Earth Search (Element84, AWS Open Data).
Sin cuenta ni token. Atribución obligatoria: "Contains modified Copernicus Sentinel data <año>".
"""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np

from .dem import GDAL_ENV, M_PER_DEG
from .http import USER_AGENT, session

STAC = "https://earth-search.aws.element84.com/v1/search"
PX = 512
SOURCE = "Copernicus Sentinel-2 L2A (ESA), color verdadero TCI 10 m, vía Earth Search (Element84, AWS Open Data)"


def bounds(lat: float, lon: float, size_m: float) -> tuple[float, float, float, float]:
    """(oeste, sur, este, norte) igual que el recorte del DEM en fetch/dem.py."""
    dlat = size_m / 2 / M_PER_DEG
    dlon = size_m / 2 / (M_PER_DEG * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def search(b: tuple[float, float, float, float], max_cloud: float = 8, limit: int = 12) -> list[dict]:
    body = {
        "collections": ["sentinel-2-l2a"], "bbox": list(b), "datetime": "2023-01-01T00:00:00Z/2026-10-31T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": max_cloud}}, "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
        "limit": limit,
    }
    r = session().post(STAC, json=body, timeout=90)
    r.raise_for_status()
    return r.json().get("features", [])


def read_bands(hrefs: list[str], b: tuple[float, float, float, float], px: int = PX, dtype: str = "uint8") -> np.ndarray:
    """Lee la ventana (en lon/lat) de 1 o 3 COG, reproyectada a EPSG:4326 → px × px × 3."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_bounds as tf_from_bounds
    from rasterio.warp import reproject

    arr = np.zeros((3, px, px), dtype=dtype)
    dst_tf = tf_from_bounds(*b, px, px)
    with rasterio.Env(GDAL_HTTP_USERAGENT=USER_AGENT, **GDAL_ENV):
        for i in range(3):  # el warper de GDAL solo lee los bloques del COG que necesita
            href, band = (hrefs[0], i + 1) if len(hrefs) == 1 else (hrefs[i], 1)
            with rasterio.open(href) as src:
                reproject(rasterio.band(src, band), arr[i], dst_transform=dst_tf, dst_crs="EPSG:4326",
                          dst_nodata=0, resampling=Resampling.bilinear)
    return np.transpose(arr, (1, 2, 0))


def stretch(raw: np.ndarray) -> np.ndarray:
    """Contraste ajustado con la MISMA escala para las 3 bandas (no cambia la proporción entre colores)."""
    v = raw[raw > 0].astype("float64")
    lo, hi = np.percentile(v, 0.5), np.percentile(v, 99.8)
    x = np.clip((raw.astype("float64") - lo) / max(hi - lo, 1), 0, 1) ** (1 / 1.25)
    return (x * 255).astype("uint8")


def fetch_site(site_id: str, lat: float, lon: float, size_m: float, out_dir: Path, cold: bool = False) -> dict:
    from PIL import Image

    b = bounds(lat, lon, size_m)
    items = search(b)
    if not items:
        items = search(b, max_cloud=25)
    if not cold:  # en sitios no fríos, evitar escenas con nieve
        dry = [i for i in items if (i["properties"].get("s2:snow_ice_percentage") or 0) < 3]
        items = dry or items
    tried = []
    for it in items[:6]:
        href = it["assets"].get("visual", {}).get("href")
        if not href or not href.startswith("https://"):  # solo COG públicos por HTTPS (no s3 de pago)
            continue
        rgb = read_bands([href], b)
        empty = float((rgb.astype("int32").sum(axis=2) == 0).mean())
        tried.append(it["id"])
        if empty > 0.02:  # la escena no cubre toda la ventana (borde de la pasada)
            continue
        # superficies muy brillantes (sal, nieve) saturan el color verdadero de 8 bits: se leen las bandas originales
        # de 16 bits y se ajusta el contraste (se informa como "contraste ajustado")
        enhanced = float((rgb.max(axis=2) >= 250).mean()) > 0.2
        if enhanced:
            a = it["assets"]
            if all(k in a for k in ("red", "green", "blue")):
                rgb = stretch(read_bands([a["red"]["href"], a["green"]["href"], a["blue"]["href"]], b, dtype="uint16"))
            else:
                enhanced = False
        out_dir.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgb).save(out_dir / f"{site_id}.jpg", quality=86, optimize=True)
        p = it["properties"]
        date = p.get("datetime", "")[:10]
        return {
            "id": site_id, "file": f"imagery/{site_id}.jpg", "px": PX, "bounds": [round(x, 6) for x in b],
            "scene": it["id"], "date": date, "cloud_pct": round(float(p.get("eo:cloud_cover") or 0), 2),
            "snow_pct": round(float(p.get("s2:snow_ice_percentage") or 0), 2),
            "status": "modeled", "source": SOURCE + (" — contraste ajustado (superficie muy brillante)" if enhanced else ""),
            "enhanced": enhanced,
            "credit": f"Contains modified Copernicus Sentinel data {date[:4]}",
            "ref": "https://registry.opendata.aws/sentinel-2-l2a-cogs/",
        }
    return {"id": site_id, "error": f"sin escena que cubra la ventana (probadas: {', '.join(tried) or 'ninguna'})"}
