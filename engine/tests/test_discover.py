# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import pytest

from seal.discover import grid, haversine_km, score_grid
from seal.schema import FeatureDef, Target, Value


def test_rejilla_solo_tierra_y_centros():
    pts = grid(0.5, {"lat": (-20.0, -19.0), "lon": (-66.0, -65.0)})  # interior de Bolivia: todo tierra
    assert pts == [(-19.75, -65.75), (-19.75, -65.25), (-19.25, -65.75), (-19.25, -65.25)]
    mar = grid(0.5, {"lat": (-20.0, -19.0), "lon": (-75.0, -74.0)})  # Pacífico frente a Chile
    assert mar == []


def test_haversine():
    # 1° de latitud ≈ 111,2 km
    assert haversine_km((0, 0), (1, 0)) == pytest.approx(111.19, abs=0.1)


def test_score_grid():
    f = [FeatureDef(id="precip", label="P", unit="mm/año", space="log1p", tau=0.5)]
    t = Target(id="m", body="mars", name="m", values={"precip": Value(value=0, unit="mm/año", status="literature", source="x")})
    cells = [{"lat": 0, "lon": 0, "cell_elev": 100, "error": None,
              "values": {"precip": Value(value=9, unit="mm/año", status="modeled", source="POWER")}}]
    r = score_grid(f, cells, t)[0]
    assert r["ifa"] == pytest.approx(13.5335, abs=1e-3) and r["coverage"] == 1.0
