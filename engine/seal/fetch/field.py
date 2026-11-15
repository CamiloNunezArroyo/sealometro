# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""JSON de la caja SEAL-BOX (docs/CAJA_CAMPO.md §3) → Value(status="measured") + avisos de confianza. Parte pura.

Reglas:
- Lo medido MANDA donde existe y es la misma magnitud: presión, humedad relativa, índice UV.
  (HR y UV son lecturas puntuales, no promedios anuales: se dice en la nota y se baja la confianza.)
- La temperatura del aire medida NO reemplaza a t_mean (promedio anual): se muestra al lado, como contexto.
- Altitud: manda la del GPS (measured); la del barómetro es 'derived' (sale de una fórmula).
- UV saturado o sin calibrar, luz saturada → confianza baja, visible.
- Gas (MQ-2, ppm, no selectivo): se guarda y se muestra, NUNCA entra al IFA (Marte se mide en ppb).
"""
from __future__ import annotations

from typing import Any

from ..schema import Value

OVERRIDE = ("pressure", "rh", "uv_index")


def parse_box(j: dict[str, Any]) -> dict:
    dev = j.get("device", "seal-box")
    src = f"SEAL-BOX {dev} (fw {j.get('fw', '?')})"
    when = (j.get("t_utc") or "")[:10] or None
    n = j.get("n_samples")
    base = dict(status="measured", source=src, retrieved=when)
    warn: list[str] = []
    measured: dict[str, Value] = {}
    context: dict[str, Value] = {}
    conf: dict[str, str] = {}

    gps = j.get("gps") or {}
    lat = lon = None
    if gps.get("fix") and gps.get("lat") is not None and gps.get("lon") is not None:
        lat, lon = float(gps["lat"]), float(gps["lon"])
        if gps.get("alt_m") is not None:
            context["elevation_gps"] = Value(value=float(gps["alt_m"]), unit="m", note=f"GPS, HDOP {gps.get('hdop')}, {gps.get('sats')} satélites.", **base)
    else:
        warn.append("El GPS no tiene fix: hay que dar las coordenadas a mano (--lat --lon).")

    air = j.get("air") or {}
    snap = f"Lectura puntual ({n} muestras), no un promedio anual."
    if air.get("p_hpa") is not None:
        measured["pressure"] = Value(value=round(air["p_hpa"] / 10, 3), unit="kPa", sigma=0.1, note=f"BME280: {air['p_hpa']} hPa. {snap}", **base)
        conf["pressure"] = "alta"
    if air.get("rh_pct") is not None:
        measured["rh"] = Value(value=float(air["rh_pct"]), unit="%", sigma=5, note=f"BME280. {snap} La humedad cambia mucho en el día.", **base)
        conf["rh"] = "media"
        warn.append("La humedad medida es de un momento; el satélite da el promedio del año.")
    if air.get("t_c") is not None:
        context["t_air"] = Value(value=round(air["t_c"] + 273.15, 2), unit="K",
                                 note=f"BME280: {air['t_c']} °C. {snap} No reemplaza a la temperatura media anual.", **base)
    if air.get("alt_baro_m") is not None:
        context["elevation_baro"] = Value(value=float(air["alt_baro_m"]), unit="m", status="derived", source=src, retrieved=when,
                                          note="Altura calculada desde la presión con una fórmula; manda la del GPS.")

    uv = j.get("uv") or {}
    if uv.get("uvi_est") is not None:
        bad = [m for m, c in [("saturado", uv.get("saturated")), ("sin calibrar", not uv.get("calibrated", False))] if c]
        # sin calibrar o saturado → 'estimated' (la fórmula mV/100 no está verificada), no 'measured'
        uv_base = {**base, "status": "estimated"} if bad else base
        measured["uv_index"] = Value(value=float(uv["uvi_est"]), unit="1", sigma=1.0,
                                     note=f"{uv.get('model', 'UV')} {uv.get('mv')} mV → índice ≈ mV/100 (fórmula sin verificar). "
                                          f"{'; '.join(bad).capitalize() + '. ' if bad else ''}Lectura puntual, no el promedio de 24 h de POWER.", **uv_base)
        conf["uv_index"] = "baja" if bad else "media"
        if bad:
            warn.append(f"UV {' y '.join(bad)}: confianza baja.")
    light = j.get("light") or {}
    if light:
        context["lux"] = Value(value=light.get("lux_est"), unit="lux", note=f"{light.get('model')} {light.get('mv')} mV; "
                               + ("saturado (al sol el módulo llega al tope)." if light.get("saturated") else "aproximado."), **base) \
            if light.get("lux_est") is not None else Value.pending("lux", "Luz saturada o sin convertir a lux." if light.get("saturated") else "Sin lux.")
        if light.get("saturated"):
            warn.append("El sensor de luz está saturado: no se usa.")
    gas = j.get("gas") or {}
    if gas:
        context["gas_anomaly"] = Value(value=gas.get("mv"), unit="mV", note=(
            f"{gas.get('model')} (no selectivo, ppm). NO entra al IFA: el metano de Marte se mide en ppb. "
            f"Precalentamiento {gas.get('warmup_s')} s; {'calibrado' if gas.get('calibrated') else 'sin calibrar'}."), **base)
    if j.get("ejemplo"):
        warn.insert(0, "ESTE ARCHIVO ES UN EJEMPLO INVENTADO (\"ejemplo\": true): no son mediciones reales.")
    return {"lat": lat, "lon": lon, "measured": measured, "context": context, "confidence": conf, "warnings": warn,
            "photos": j.get("photos", []), "notes": j.get("notes", ""), "example": bool(j.get("ejemplo"))}


def combine(satellite: dict[str, Value], measured: dict[str, Value]) -> dict[str, Value]:
    """Lo medido manda en OVERRIDE; el resto viene del satélite."""
    out = dict(satellite)
    for k in OVERRIDE:
        if k in measured and measured[k].usable():
            out[k] = measured[k]
    return out
