# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Partes puras de fetch/ (sin red): conversión de POWER, corrección por elevación y análisis del DEM."""
import math

import numpy as np
import pytest

from seal.fetch.dem import analyze, dem_values, tile_url
from seal.fetch.power import correct_for_elevation, isa_pressure_kpa, power_values

RAW = {"retrieved": "2026-11-14", "elevation": 3692.0, "errors": {}, "tables": {
    "T2M": {"ANN": 7.48}, "T2M_RANGE": {"ANN": 16.59}, "T2M_MAX": {"ANN": 25.07}, "T2M_MIN": {"ANN": -14.47},
    "PS": {"ANN": 65.44}, "RH2M": {"ANN": 42.84}, "WS10M": {"ANN": 2.82}, "PRECTOTCORR": {"ANN": 0.91},
    "ALLSKY_SFC_UV_INDEX": {"ANN": 2.4}, "ALLSKY_SRF_ALB": {"ANN": -999.0}}}


def test_power_usa_t2m_range_y_relleno_es_pending():
    v = power_values(RAW)
    assert v["t_mean"].value == pytest.approx(280.63)
    assert v["t_range_diurnal"].value == pytest.approx(16.59)  # NO 25,07 − (−14,47) = 39,54
    assert "39.5 K" in v["t_range_diurnal"].note
    assert v["precip"].value == pytest.approx(0.91 * 365.25)
    assert v["albedo"].status == "pending"  # −999 = relleno


def test_correccion_por_elevacion():
    v = power_values(RAW)
    # sitio 400 m más bajo que la celda: +2,6 K y presión × ISA(3292)/ISA(3692)
    c = correct_for_elevation(v, 3692.0, 3292.0)
    assert c["t_mean"].value == pytest.approx(280.63 + 2.6, abs=0.01) and c["t_mean"].status == "derived"
    ratio = isa_pressure_kpa(3292) / isa_pressure_kpa(3692)
    assert c["pressure"].value == pytest.approx(65.44 * ratio, abs=1e-3)
    assert "sin corregir: 65.44" in c["pressure"].note
    # diferencia < 300 m: no se toca
    assert correct_for_elevation(v, 3692.0, 3500.0)["t_mean"].status == "modeled"


def test_dem_plano_inclinado():
    # plano con 10° de pendiente hacia el este, píxel de ~30 m
    lat = 0.0
    res = (1 / 3600, 1 / 3600)
    dx = res[0] * 111_320
    x = np.arange(200) * dx
    z = np.tile(x * math.tan(math.radians(10)), (200, 1))
    a = analyze(z, res, lat)
    assert a["slope_p50_30m"] == pytest.approx(10, abs=0.2)
    assert a["slope_p50_100m"] == pytest.approx(10, abs=0.2)
    assert a["slope_p90_100m"] == pytest.approx(10, abs=0.2)
    assert a["roughness_100m"] == pytest.approx(0, abs=1e-6)
    a.update(tiles=["0,0"], size_m=6000, retrieved="x")
    vals = dem_values(a)
    assert vals["roughness_100m"].status == "estimated" and vals["roughness_100m"].value == 0.05  # límite inferior


def test_dem_poca_cobertura_es_error():
    z = np.full((100, 100), np.nan)
    z[:20] = 1.0
    assert "error" in analyze(z, (1 / 3600, 1 / 3600), 0.0)


def test_nombre_de_mosaico():
    assert tile_url(-20, -66).endswith("Copernicus_DSM_COG_10_S20_00_W066_00_DEM.tif")
    assert tile_url(37, 15).endswith("Copernicus_DSM_COG_10_N37_00_E015_00_DEM.tif")
