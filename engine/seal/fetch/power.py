# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""NASA POWER (climatología de punto) → Value, con la misma corrección por elevación que el juego
(referencias/juego/build_site.mjs: temperatura con 6,5 K/km y presión con la atmósfera estándar ISA)."""
from __future__ import annotations

import datetime as dt

from ..schema import Value
from . import cache
from .http import get_json

POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point"
POWER_DOCS = "https://power.larc.nasa.gov/docs/"
PARAMS = ["T2M", "T2M_RANGE", "T2M_MAX", "T2M_MIN", "PS", "RH2M", "WS10M", "PRECTOTCORR",
          "ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_UV_INDEX", "ALLSKY_SRF_ALB", "GWETTOP"]
SOURCE = "NASA POWER, climatología (modelo/reanálisis de rejilla gruesa, ~50 km)"
NOTE_GRID = "Es un valor de celda de rejilla, no una medición en el punto exacto."
LAPSE_K_PER_M = 0.0065
ELEV_CORRECTION_MIN_M = 300.0
FILL = -999.0


def _request(lat: float, lon: float, params: list[str]) -> dict:
    return get_json("power", POWER_URL, {"parameters": ",".join(params), "community": "RE",
                                          "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "format": "JSON"})


def _fetch(lat: float, lon: float) -> dict:
    out = {"tables": {}, "elevation": None, "errors": {}, "retrieved": dt.date.today().isoformat()}

    def take(j: dict) -> None:
        for p, table in j.get("properties", {}).get("parameter", {}).items():
            out["tables"][p] = table
        coords = j.get("geometry", {}).get("coordinates", [])
        if len(coords) >= 3 and coords[2] is not None:
            out["elevation"] = float(coords[2])

    try:
        take(_request(lat, lon, PARAMS))
    except Exception as e:  # si el pedido conjunto falla, uno por uno (un parámetro que falla no tumba los demás)
        out["errors"]["_batch"] = str(e)[:200]
        for p in PARAMS:
            try:
                take(_request(lat, lon, [p]))
            except Exception as e2:
                out["errors"][p] = str(e2)[:200]
    if not out["tables"]:
        out["error"] = "POWER no devolvió ningún parámetro"
    elif any(k != "_batch" and "HTTP 4" not in v for k, v in out["errors"].items()):
        # falló algún parámetro por red/servidor (no por "parámetro inválido"): no se guarda en caché para reintentar
        out["error_transient"] = True
    return out


def fetch_power(lat: float, lon: float) -> dict:
    """Climatología cruda (cacheada)."""
    return cache.cached("power", {"lat": round(lat, 4), "lon": round(lon, 4), "params": PARAMS, "v": 3},
                        lambda: _fetch(lat, lon))


# ----------------------------------------------------------------------------- conversión (pura)
def isa_pressure_kpa(h: float) -> float:
    return 101.325 * (1 - 2.25577e-5 * h) ** 5.25588


def _ann(raw: dict, p: str) -> float | None:
    v = raw.get("tables", {}).get(p, {}).get("ANN")
    return None if v is None or v <= FILL + 1 else float(v)


def _v(value, unit, param, retrieved, note="", **kw) -> Value:
    return Value(value=round(value, 4), unit=unit, status="modeled", source=f"{SOURCE}, parámetro {param}",
                 ref=POWER_DOCS, retrieved=retrieved, note=f"{note} {NOTE_GRID}".strip(), **kw)


def power_values(raw: dict) -> dict[str, Value]:
    """Valores del motor (sin corregir por elevación). Lo que falta queda pending con la razón."""
    r = raw.get("retrieved")
    out: dict[str, Value] = {}
    errs = raw.get("errors", {})

    def miss(fid, unit, p):
        out[fid] = Value.pending(unit, f"POWER no devolvió {p}: {errs.get(p, 'sin dato / valor de relleno')}")

    t2m, tmax, tmin = _ann(raw, "T2M"), _ann(raw, "T2M_MAX"), _ann(raw, "T2M_MIN")
    out["t_mean"] = _v(t2m + 273.15, "K", "T2M", r, "Promedio anual de la temperatura del aire a 2 m.") \
        if t2m is not None else Value.pending("K", "POWER no devolvió T2M")
    # OJO: en la climatología de POWER, ANN de T2M_MAX es el MÁXIMO de los meses y ANN de T2M_MIN el MÍNIMO
    # (comprobado el 2026-11-14 en Uyuni: 25,07 = máx mensual; −14,47 = mín mensual). Su resta es una envolvente
    # anual, no la amplitud día-noche. La amplitud diaria media es T2M_RANGE.
    rng = _ann(raw, "T2M_RANGE")
    env = f" Envolvente anual (máx. de T2M_MAX − mín. de T2M_MIN): {tmax - tmin:.1f} K, NO usada." \
        if tmax is not None and tmin is not None else ""
    if rng is not None:
        out["t_range_diurnal"] = _v(rng, "K", "T2M_RANGE", r, "Promedio anual de la amplitud diaria del aire a 2 m." + env)
    else:
        miss("t_range_diurnal", "K", "T2M_RANGE")
    for fid, p, unit, f, note in [
        ("pressure", "PS", "kPa", 1.0, "Presión superficial."),
        ("rh", "RH2M", "%", 1.0, ""),
        ("wind", "WS10M", "m/s", 1.0, "Viento a 10 m."),
        ("precip", "PRECTOTCORR", "mm/año", 365.25, "Promedio diario anual (mm/día) × 365,25."),
        ("uv_index", "ALLSKY_SFC_UV_INDEX", "1", 1.0,
         "Unidad POWER 'W m-2 x 40': promedio de 24 h, NO el índice UV de mediodía (que es varias veces mayor)."),
        ("albedo", "ALLSKY_SRF_ALB", "1", 1.0, "Albedo de celda; se satura con nieve o salares."),
        ("soil_moisture", "GWETTOP", "1", 1.0, "Humedad de la capa superficial del suelo (MERRA-2), fracción de saturación 0–1."),
    ]:
        a = _ann(raw, p)
        if a is None:
            miss(fid, unit, p)
        else:
            out[fid] = _v(max(a * f, 0.0) if fid == "precip" else a * f, unit, p, r, note)
    sw = _ann(raw, "ALLSKY_SFC_SW_DWN")
    if sw is not None:
        out["_solar_sw_dwn"] = _v(sw, "kWh/m²/día", "ALLSKY_SFC_SW_DWN", r, "Promedio anual, cielo real.")
    return out


def correct_for_elevation(values: dict[str, Value], cell_elev: float | None, site_elev: float | None) -> dict[str, Value]:
    """Igual que correctClimateForElevation del juego: temperatura y presión pasan a 'derived'; el valor bruto va a la nota."""
    if cell_elev is None or site_elev is None:
        return values
    dh = site_elev - cell_elev
    if abs(dh) < ELEV_CORRECTION_MIN_M:
        return values
    out = dict(values)
    dT = -LAPSE_K_PER_M * dh
    how = (f"Corregido por elevación: la celda de POWER está a {cell_elev:.0f} m y el sitio (DEM) a {site_elev:.0f} m "
           f"({dh:+.0f} m).")
    lapse = "Método aproximado: gradiente estándar de 6,5 K/km; no considera inversiones térmicas ni efectos locales."
    tm = values.get("t_mean")
    if tm is not None and tm.status == "modeled":
        out["t_mean"] = tm.model_copy(update={"value": round(tm.value + dT, 2), "status": "derived",
                                              "source": f"{tm.source}, ajustada por elevación",
                                              "note": f"{how} Valor POWER sin corregir: {tm.value:.2f} K. {lapse}"})
    ps = values.get("pressure")
    if ps is not None and ps.status == "modeled":
        ratio = isa_pressure_kpa(site_elev) / isa_pressure_kpa(cell_elev)
        out["pressure"] = ps.model_copy(update={"value": round(ps.value * ratio, 3), "status": "derived",
                                                "source": f"{ps.source}, ajustada por elevación (atmósfera estándar ISA)",
                                                "note": f"{how} Valor POWER sin corregir: {ps.value:.2f} kPa (factor {ratio:.3f})."})
    return out
