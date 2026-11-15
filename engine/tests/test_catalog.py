# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import pytest

from seal.catalog import load_features, load_sites, load_targets, resolve_inheritance
from seal.schema import FeatureDef, Target, Value
from seal.score.similarity import dim_similarity


def test_herencia_solo_llena_lo_pending():
    g = Target(id="g", body="mars", name="g", values={
        "pressure": Value(value=0.6, unit="kPa", status="literature", source="NSSDC"),
        "t_mean": Value(value=214, unit="K", status="literature", source="NSSDC")})
    s = Target(id="s", body="mars", name="s", inherit_from="g", inherit_dims=["pressure"], values={
        "t_mean": Value.pending("K")})
    out = {t.id: t for t in resolve_inheritance([g, s])}["s"]
    assert out.values["pressure"].value == 0.6 and out.values["pressure"].note.startswith("Heredado de g")
    assert not out.values["t_mean"].usable()  # t_mean no estaba en inherit_dims


def test_objetivo_solo_rango():
    f = FeatureDef(id="wind", label="v", unit="m/s", tau=3)
    t = Value(range=(2, 7), unit="m/s", status="literature", source="NSSDC")
    assert dim_similarity(f, Value(value=5, unit="m/s", status="modeled", source="POWER"), t).s == 1.0
    # 10 m/s: d = 3 = τ → s = exp(−0,5) = 0,606531
    assert dim_similarity(f, Value(value=10, unit="m/s", status="modeled", source="POWER"), t).s == pytest.approx(0.606531, abs=1e-6)


def test_yaml_de_sitios_y_objetivos():
    feats = {f.id: f for f in load_features()}
    sites, targets = load_sites(), load_targets()
    assert len({s.id for s in sites}) == len(sites)
    for s in sites:
        assert s.role != "control_pos" or s.refs, f"{s.id}: control_pos sin referencia"
        for k, v in s.values.items():
            assert k in feats and v.unit == feats[k].unit, (s.id, k)
    for t in targets:
        for k, v in t.values.items():
            assert k in feats and v.unit == feats[k].unit, (t.id, k)
            assert v.status == "pending" or v.source, (t.id, k)
