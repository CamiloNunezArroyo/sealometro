# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import pytest

from seal.catalog import load_features, load_profiles
from seal.schema import FeatureDef, Gate, Profile, Value
from seal.score.profiles import check_profile, score_pair, score_profile


def V(x, unit):
    return Value(value=x, unit=unit, status="literature", source="test")


P50 = FeatureDef(id="slope_p50_100m", label="p50", unit="grados", tau=3)
P90 = FeatureDef(id="slope_p90_100m", label="p90", unit="grados", tau=5)
PRESS = FeatureDef(id="pressure", label="P", unit="kPa", space="log", tau=0.5, analogable=False, weight=0)
FEATS = [P50, P90, PRESS]
ROVER = Profile(id="rover", name="Rover", weights={"slope_p50_100m": 1, "slope_p90_100m": 1},
                gates=[Gate(feature="slope_p90_100m", min_s=0.4)])


def test_compuerta_topa_el_perfil():
    # p50 igual (s=1); p90: d = 10 → d/τ = 2 → s = exp(−2) = 0,135335 < 0,4
    # sin compuerta: (1 + 0,135335)/2 = 56,77; con compuerta: tope 13,53
    r = score_profile(ROVER, FEATS, {"slope_p50_100m": V(2, "grados"), "slope_p90_100m": V(18, "grados")},
                      {"slope_p50_100m": V(2, "grados"), "slope_p90_100m": V(8, "grados")})
    assert r.raw == pytest.approx(56.7668, abs=1e-3)
    assert r.score == pytest.approx(13.5335, abs=1e-3)
    assert r.gates_failed == ["slope_p90_100m"] and r.limiting == "slope_p90_100m"


def test_compuerta_pending_deja_el_perfil_no_evaluable():
    r = score_profile(ROVER, FEATS, {"slope_p50_100m": V(2, "grados")},
                      {"slope_p50_100m": V(2, "grados"), "slope_p90_100m": V(8, "grados")})
    assert r.score is None and r.raw == pytest.approx(100.0) and r.coverage == pytest.approx(0.5)
    assert r.gates_unknown == ["slope_p90_100m"]


def test_perfil_con_poca_cobertura_no_da_numero():
    # solo p50 con datos → cobertura 0,5 con pesos 1:1; con pesos 1:3 → 0,25 < 0,5 → None
    p = Profile(id="r", name="r", weights={"slope_p50_100m": 1, "slope_p90_100m": 3})
    r = score_profile(p, FEATS, {"slope_p50_100m": V(2, "grados")},
                      {"slope_p50_100m": V(2, "grados"), "slope_p90_100m": V(8, "grados")})
    assert r.score is None and r.raw == pytest.approx(100.0) and r.coverage == pytest.approx(0.25)


def test_perfil_con_brecha_es_error():
    bad = Profile(id="x", name="x", weights={"pressure": 1})
    with pytest.raises(ValueError):
        check_profile(bad, FEATS)


def test_ifa_total_excluye_brechas():
    site = {"slope_p50_100m": V(2, "grados"), "slope_p90_100m": V(8, "grados"), "pressure": V(60, "kPa")}
    tgt = {"slope_p50_100m": V(2, "grados"), "slope_p90_100m": V(8, "grados"), "pressure": V(0.6, "kPa")}
    r = score_pair(FEATS, [ROVER], site, tgt)
    assert r.total.ifa == pytest.approx(100.0)  # la presión (s≈0) no baja el IFA total
    assert r.total.dims["pressure"].s < 0.01


def test_yaml_del_motor_es_valido():
    feats = load_features()
    ids = {f.id for f in feats}
    t1 = {"t_mean", "t_range_diurnal", "pressure", "uv_index", "precip", "rh", "wind", "albedo", "slope_p50_100m",
          "slope_p90_100m", "roughness_100m", "ndvi", "cave_lava_tube", "mineral_classes"}
    assert t1 <= ids
    assert all(f.tau_status == "design" and (f.kind != "numeric" or f.tau_note) for f in feats)
    for p in load_profiles():
        check_profile(p, feats)
