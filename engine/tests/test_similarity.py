# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Casos calculados a mano para §5.1 y §5.2. Los números esperados están escritos como literales."""
import math

import pytest

from seal.schema import FeatureDef, Value
from seal.score.similarity import dim_similarity, percentile_earth, progress, score


def V(x=None, unit="K", rng=None, status="literature", classes=None):
    if x is None and classes is None and rng is None:
        return Value.pending(unit)
    return Value(value=x, unit=unit, status=status, source="test", range=rng, classes=classes)


T_MEAN = FeatureDef(id="t_mean", label="T", unit="K", tau=20)
PRECIP = FeatureDef(id="precip", label="P", unit="mm/año", space="log1p", tau=0.5, weight=1.5)
RH = FeatureDef(id="rh", label="RH", unit="%", tau=15)
ROUGH = FeatureDef(id="roughness_100m", label="R", unit="m", space="log", tau=0.3)
PRESS = FeatureDef(id="pressure", label="P", unit="kPa", space="log", tau=0.5, analogable=False, weight=0)
CAVE = FeatureDef(id="cave_lava_tube", label="C", unit="1", kind="binary")
MIN = FeatureDef(id="mineral_classes", label="M", unit="1", kind="set")


# --------------------------------------------------------------------------- §5.1 una dimensión
def test_dentro_del_rango_da_1():
    r = dim_similarity(T_MEAN, V(210), V(rng=(200, 220), x=210))
    assert r.s == 1.0 and r.d == 0.0


def test_fuera_del_rango_gaussiana():
    # d = 250 − 220 = 30; s = exp(−½·(30/20)²) = exp(−1,125) = 0,324652
    r = dim_similarity(T_MEAN, V(250), V(210, rng=(200, 220)))
    assert r.d == pytest.approx(30)
    assert r.s == pytest.approx(0.324652, abs=1e-6)


def test_log10():
    # d = log10(8/2) = 0,602060; d/τ = 2,006867; s = exp(−2,013757) = e^−2 · e^−0,013757 = 0,135335 · 0,986337 = 0,133486
    r = dim_similarity(ROUGH, V(2, "m"), V(8, "m"))
    assert r.d == pytest.approx(0.602060, abs=1e-6)
    assert r.s == pytest.approx(0.133486, abs=1e-6)


def test_log1p():
    # log10(1+9) = 1; log10(1+0) = 0; d/τ = 2; s = exp(−2) = 0,135335
    r = dim_similarity(PRECIP, V(9, "mm/año"), V(0, "mm/año"))
    assert r.s == pytest.approx(0.135335, abs=1e-6)


def test_log_de_cero_es_invalido():
    assert dim_similarity(ROUGH, V(0, "m"), V(8, "m")).skipped == "invalid"


def test_pending_y_unidades():
    assert dim_similarity(T_MEAN, V(), V(210)).skipped == "site_pending"
    assert dim_similarity(T_MEAN, V(210), V()).skipped == "target_pending"
    assert dim_similarity(T_MEAN, V(210, "°C"), V(210, "°C")).skipped == "unit_mismatch"
    gameplay = Value(value=210, unit="K", status="gameplay", source="juego")
    assert dim_similarity(T_MEAN, gameplay, V(210)).skipped == "site_pending"


def test_binaria_y_conjunto():
    assert dim_similarity(CAVE, V(1, "1"), V(1, "1")).s == 1.0
    assert dim_similarity(CAVE, V(0, "1"), V(1, "1")).s == 0.0
    # objetivo {sulfato, arcilla, oxido_fe}; sitio tiene 2 de 3 → 0,666667
    r = dim_similarity(MIN, V(unit="1", classes=["sulfato", "oxido_fe", "cloruro"]),
                       V(unit="1", classes=["sulfato", "arcilla", "oxido_fe"]))
    assert r.s == pytest.approx(2 / 3)


def test_minerales_solo_clases_detectables():
    det = ["carbonato", "sulfato", "oxido_fe", "arcilla"]
    site = Value(unit="1", classes=["oxido_fe"], detectable=det, status="modeled", source="EMIT")
    # objetivo {basalto, silice_hidratada, oxido_fe}: EMIT solo puede ver oxido_fe → s = 1/1, no 1/3
    tgt = V(unit="1", classes=["basalto", "silice_hidratada", "oxido_fe"])
    assert dim_similarity(MIN, site, tgt).s == 1.0
    # objetivo solo con clases indetectables → no se puede comparar (no es 0)
    assert dim_similarity(MIN, site, V(unit="1", classes=["anortosita"])).skipped == "invalid"
    # "buscamos y no hay" (lista vacía con detectable) es un dato; lista vacía sin detectable no lo es
    assert Value(unit="1", classes=[], detectable=det, status="modeled", source="EMIT").usable()
    assert not Value(unit="1", classes=[], status="literature", source="x").usable()


# --------------------------------------------------------------------------- §5.1 varias dimensiones
FEATS = [T_MEAN, PRECIP, RH, PRESS]


def test_ifa_min_y_reglas_de_suficiencia():
    tgt = {"t_mean": V(210, rng=(200, 220)), "precip": V(0, "mm/año", status="estimated"), "rh": V(1, "%")}
    # solo t_mean (peso 1 de 3,5) → cobertura 0,286 < 0,4 → IFA None, pero ifa_min = 100·1/3,5 = 28,571
    r = score(FEATS, {"t_mean": V(210)}, tgt)
    assert r.ifa is None and "cobertura" in r.insufficient and r.ifa_min == pytest.approx(28.571, abs=1e-3)
    # solo precip (estimated) con cobertura suficiente → todos simplificaciones → IFA None
    r2 = score(FEATS, {"precip": V(0, "mm/año")}, tgt, weights={"precip": 1.5, "rh": 1})
    assert r2.ifa is None and "simplificaciones" in r2.insufficient and r2.ifa_raw == pytest.approx(100.0)


def test_todo_pending():
    r = score(FEATS, {}, {"t_mean": V(210)})
    assert r.ifa is None and r.coverage == 0.0 and r.limiting is None


def test_cobertura_parcial_y_renormalizacion():
    # pesos t_mean 1, precip 1,5, rh 1 (presión es brecha: peso 0, no cuenta)
    # rh pending → cobertura = 2,5/3,5 = 0,714286
    # IFA = (1·1 + 1,5·0,135335)/2,5 · 100 = 48,1201
    site = {"t_mean": V(210), "precip": V(9, "mm/año"), "pressure": V(60, "kPa")}
    tgt = {"t_mean": V(210, rng=(200, 220)), "precip": V(0, "mm/año"), "rh": V(1, "%"), "pressure": V(0.636, "kPa")}
    r = score(FEATS, site, tgt)
    assert r.coverage == pytest.approx(0.714286, abs=1e-6)
    assert r.ifa == pytest.approx(48.1201, abs=1e-3)
    assert r.limiting == "precip"
    assert r.dims["rh"].skipped == "site_pending"
    assert r.dims["pressure"].s is not None  # la brecha se calcula, pero no entra al IFA
    assert "pressure" not in r.weights


# --------------------------------------------------------------------------- §5.2
def test_progreso_mitad_y_mas_alla():
    tgt = V(210, rng=(200, 220))
    # m_T = 288, borde más cercano 220: (254−288)/(220−288) = 0,5
    assert progress(254, tgt, 288, "linear") == pytest.approx(0.5)
    # más allá del objetivo: (190−288)/(220−288) = 1,44 → se recorta a 1
    assert progress(190, tgt, 288, "linear") == 1.0
    # en sentido contrario (más caliente que la mediana) → 0
    assert progress(300, tgt, 288, "linear") == 0.0


def test_progreso_presion_log():
    # (log 60 − log 95)/(log 0,636 − log 95) = −0,199572/−2,174280 = 0,091788 → "recorre el 9 % del camino"
    assert progress(60, V(0.636, "kPa"), 95, "log") == pytest.approx(0.091788, abs=1e-5)


def test_percentil_terrestre():
    # objetivo [200, 220]; muestra 280, 290, 300, 260 → distancias 60, 70, 80, 40; x = 270 → d = 50 → 3 de 4 más lejos
    assert percentile_earth(270, V(210, rng=(200, 220)), [280, 290, 300, 260], "linear") == pytest.approx(75.0)
    # empate cuenta la mitad: x = 260 → d = 40 → 3 más lejos + 0,5 → 87,5
    assert percentile_earth(260, V(210, rng=(200, 220)), [280, 290, 300, 260], "linear") == pytest.approx(87.5)


# --------------------------------------------------------------------------- compatibilidad con el juego (score.ts)
# El juego usa s = clamp(1 − |x − t|/tol) (lineal) y s = clamp(1 − décadas/tol) (log), con objetivo puntual.
# Con kernel="linear" el motor da EXACTAMENTE lo mismo. Valores de referencias/juego/targets/mars.json.
GAME_CASES = [
    # (feature, x, target, esperado según score.ts)
    (FeatureDef(id="t_mean", label="T", unit="K", tau=100), 288.0, 214.0, 1 - 74 / 100),  # 0,26
    (FeatureDef(id="precip", label="P", unit="mm/año", tau=600), 120.0, 0.0, 1 - 120 / 600),  # 0,8
    (FeatureDef(id="pressure", label="P", unit="kPa", space="log", tau=3), 65.0, 0.636,
     1 - math.log10(65 / 0.636) / 3),  # 0,330181
]


@pytest.mark.parametrize("feat,x,t,expected", GAME_CASES)
def test_igual_que_score_ts(feat, x, t, expected):
    r = dim_similarity(feat, V(x, feat.unit), V(t, feat.unit), kernel_kind="linear")
    assert r.s == pytest.approx(expected, abs=1e-12)


def test_presion_juego_literal():
    assert 1 - math.log10(65 / 0.636) / 3 == pytest.approx(0.330181, abs=1e-6)
