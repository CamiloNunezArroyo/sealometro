# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import pytest

from seal.schema import FeatureDef, Value
from seal.score.robustness import monte_carlo
from seal.score.similarity import score
from seal.score.validate import auc, validate_target

T = FeatureDef(id="t_mean", label="T", unit="K", tau=20, sigma=1.5)
P = FeatureDef(id="precip", label="P", unit="mm/año", space="log1p", tau=0.5, sigma=0.1)
FEATS = [T, P]


def V(x, unit):
    return Value(value=x, unit=unit, status="modeled", source="test")


def site(t, p):
    return {"t_mean": V(t, "K"), "precip": V(p, "mm/año")}


TARGET = {"t_mean": V(214, "K"), "precip": V(0, "mm/año")}


def test_auc_casos_a_mano():
    assert auc([3, 4], [1, 2]) == 1.0
    assert auc([1], [1]) == 0.5
    assert auc([2], [1, 3]) == 0.5
    assert auc([1, 2], [3, 4]) == 0.0


def test_monte_carlo_orden_claro_y_reproducible():
    sites = {"cerca": site(220, 1), "medio": site(250, 50), "lejos": site(300, 2000)}
    r1 = monte_carlo(FEATS, sites, TARGET, n=500, seed=1)
    r2 = monte_carlo(FEATS, sites, TARGET, n=500, seed=1)
    assert r1["cerca"].median_rank == 1 and r1["cerca"].p_top3 == 1.0
    assert r1["lejos"].median_rank == 3
    assert r1 == r2  # semilla fija


def test_monte_carlo_sin_ruido_coincide_con_score():
    # α enorme y σ = 0 → mismo IFA que score()
    f = [FeatureDef(id="t_mean", label="T", unit="K", tau=20, sigma=0)]
    s = {"a": {"t_mean": V(240, "K")}}
    r = monte_carlo(f, s, {"t_mean": V(214, "K")}, n=50, alpha_total=1e9)
    assert r["a"].ifa_median == pytest.approx(score(f, s["a"], {"t_mean": V(214, "K")}).ifa, abs=1e-6)


def test_monte_carlo_usa_distancia_al_intervalo():
    # objetivo 2–7 m/s: tres sitios dentro del rango deben empatar (IFA 100), como en el ranking
    w = [FeatureDef(id="wind", label="v", unit="m/s", tau=3, sigma=0)]
    t = {"wind": Value(range=(2, 7), unit="m/s", status="literature", source="NSSDC")}
    s = {k: {"wind": V(x, "m/s")} for k, x in (("a", 2.1), ("b", 4.5), ("c", 6.9))}
    r = monte_carlo(w, s, t, n=200)
    assert all(r[k].ifa_median == pytest.approx(100.0) for k in s)


def test_validacion_ignora_dims_que_el_azar_no_tiene():
    nd = FeatureDef(id="ndvi", label="N", unit="1", tau=0.1)
    tgt = {**TARGET, "ndvi": V(0, "1")}
    pos = {"p": {**site(225, 2), "ndvi": V(0.0, "1")}}
    rnd = [site(290, 800), site(280, 400)]  # sin NDVI
    r = validate_target(FEATS + [nd], tgt, pos, rnd, {})
    assert r["dims_dropped_no_random_data"] == ["ndvi"] and "ndvi" not in r["dims"]


def test_validacion_separa_y_dejar_una_fuera():
    pos = {"p1": site(225, 2), "p2": site(230, 5)}
    rnd = [site(t, p) for t, p in [(290, 800), (280, 400), (300, 1500), (270, 200), (285, 600)]]
    neg = {"selva": site(299, 2000)}
    r = validate_target(FEATS, TARGET, pos, rnd, neg)
    assert r["auc"] == 1.0 and r["n_pos"] == 2 and r["n_rand"] == 5
    assert set(r["leave_one_out"]) == {"t_mean", "precip"}
    assert r["negatives"]["selva"]["pct_random"] <= 20
