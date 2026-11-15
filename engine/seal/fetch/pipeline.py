# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Un punto de la Tierra → valores del motor: DEM (elevación, terreno) + POWER (clima) corregido por elevación.
Sitios y puntos al azar pasan por EXACTAMENTE el mismo proceso (para que la validación sea justa)."""
from __future__ import annotations

from ..schema import Value
from .dem import dem_values, fetch_dem
from .power import correct_for_elevation, fetch_power, power_values


def fetch_point(lat: float, lon: float, with_dem: bool = True, with_modis: bool | None = False) -> dict[str, Value]:
    """with_modis: True = descarga NDVI; None = solo NDVI ya en caché; False = sin NDVI."""
    values: dict[str, Value] = {}
    if with_modis is not False:
        from .modis import fetch_ndvi, ndvi_value
        values["ndvi"] = ndvi_value(fetch_ndvi(lat, lon, network=bool(with_modis)))
        # EMIT: solo lo ya descargado con 'python -m seal emit' (la descarga necesita token de Earthdata)
        from .emit import fetch_emit
        ev, _ = fetch_emit(lat, lon, network=False)
        if ev.usable():
            values["mineral_classes"] = ev  # la literatura de sites.yaml manda si existe (merge_site_values)
            values["_mineral_classes_emit"] = ev
    site_elev = None
    if with_dem:
        dv = dem_values(fetch_dem(lat, lon))
        values.update(dv)
        e = dv.get("_elevation")
        site_elev = e.value if e is not None and e.usable() else None
    raw = fetch_power(lat, lon)
    if raw.get("error"):
        for fid, unit in [("t_mean", "K"), ("t_range_diurnal", "K"), ("pressure", "kPa"), ("rh", "%"), ("wind", "m/s"),
                          ("precip", "mm/año"), ("uv_index", "1"), ("albedo", "1"), ("soil_moisture", "1")]:
            values[fid] = Value.pending(unit, f"POWER: {raw['error']}")
        return values
    pv = correct_for_elevation(power_values(raw), raw.get("elevation"), site_elev)
    values.update(pv)
    if raw.get("elevation") is not None:
        values["_power_cell_elevation"] = Value(value=raw["elevation"], unit="m", status="modeled",
                                                source="NASA POWER (elevación media de la celda)",
                                                ref="https://power.larc.nasa.gov/docs/", retrieved=raw.get("retrieved"))
    return values
