# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""NDVI de MODIS (MOD13Q1 v061, 250 m, compuestos de 16 días) vía el servicio web ORNL DAAC MODIS subsets.

Comprobado el 2026-11-14: la API acepta como máximo 10 fechas por pedido y tarda ~20–45 s por pedido; MOD13A3
(mensual) no está disponible ahí. Por eso: 3 pedidos por punto para cubrir los 23 compuestos de 2023, y SOLO para los
sitios (no para la muestra terrestre de 300 puntos: serían ~1,5 h). La validación deja fuera las dimensiones que la
muestra al azar no tiene.

Valor = MEDIANA anual del píxel de 250 m que contiene el punto (la mediana es robusta a compuestos con nubes).
Sin filtro de calidad (QA): las nubes bajan el NDVI; se dice en la nota.
"""
from __future__ import annotations

import datetime as dt

import numpy as np

from ..schema import Value
from . import cache
from .http import get_json

BASE = "https://modis.ornl.gov/rst/api/v1"
REF = "https://modis.ornl.gov/data/modis_webservice.html"
PRODUCT, BAND = "MOD13Q1", "250m_16_days_NDVI"
YEAR = 2023
DOYS = list(range(1, 366, 16))  # 23 compuestos: 1, 17, ..., 353
SCALE, FILL = 0.0001, -3000


def _chunks():
    for i in range(0, len(DOYS), 10):
        part = DOYS[i:i + 10]
        yield f"A{YEAR}{part[0]:03d}", f"A{YEAR}{part[-1]:03d}"


def _fetch(lat: float, lon: float) -> dict:
    from .http import FatalHTTP
    vals, errs, transient = [], [], False
    for start, end in _chunks():
        try:
            j = get_json("modis", f"{BASE}/{PRODUCT}/subset",
                         {"latitude": lat, "longitude": lon, "band": BAND, "startDate": start, "endDate": end,
                          "kmAboveBelow": 0, "kmLeftRight": 0}, retries=3, timeout=180)
            for s in j.get("subset", []):
                for x in s.get("data", []):
                    if x is not None and x != FILL:
                        vals.append(x * SCALE)
        except FatalHTTP as e:  # p. ej. "No data available" (Antártida): definitivo, se guarda en caché
            errs.append(f"{start}–{end}: {str(e)[:120]}")
        except Exception as e:  # red/servidor: no se guarda, se reintenta en otra corrida
            errs.append(f"{start}–{end}: {str(e)[:120]}")
            transient = True
    if not vals and transient:
        return {"error": "MODIS no respondió: " + "; ".join(errs)}
    return {"ndvi": vals, "errors": errs, "retrieved": dt.date.today().isoformat()}


def fetch_ndvi(lat: float, lon: float, network: bool = True) -> dict:
    """network=False: solo lo que ya está en caché (ORNL es lento: ~1 min por punto)."""
    params = {"lat": round(lat, 4), "lon": round(lon, 4), "year": YEAR, "v": 1}
    if not network:
        hit = cache.get("modis_ndvi", params)
        return hit if hit is not None else {"error": "NDVI no descargado (usar 'python -m seal fetch --modis')"}
    return cache.cached("modis_ndvi", params, lambda: _fetch(lat, lon))


def ndvi_value(raw: dict) -> Value:
    if raw.get("error"):
        return Value.pending("1", raw["error"])
    if not raw.get("ndvi"):
        why = "; ".join(raw.get("errors", [])) or "todos los compuestos sin dato (¿agua o hielo?)"
        return Value.pending("1", f"MODIS sin NDVI válido en este píxel: {why}")
    a = np.asarray(raw["ndvi"])
    part = f" Faltaron compuestos: {'; '.join(raw['errors'])}." if raw.get("errors") else ""
    return Value(value=round(float(np.median(a)), 3), unit="1", status="modeled",
                 source=f"MODIS {PRODUCT} v061 (NASA), NDVI 250 m, vía ORNL DAAC MODIS subsets", ref=REF,
                 retrieved=raw.get("retrieved"), sigma=round(float(np.std(a)), 3),
                 note=(f"Mediana de {len(a)} compuestos de 16 días de {YEAR} (rango {a.min():.2f}–{a.max():.2f}) en el píxel "
                       f"de 250 m del punto. Sin filtro de calidad: las nubes bajan el NDVI.{part}"))
