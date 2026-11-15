# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import json
from pathlib import Path

from seal.catalog import load_features, load_profiles, load_targets
from seal.explain.gaps import gaps
from seal.explain.narrative import story
from seal.fetch.field import combine, parse_box
from seal.run import score_site_target
from seal.schema import Site, Value

EJ = Path(__file__).resolve().parents[2] / "data" / "shared" / "field" / "ejemplo_sucre.json"


def test_caja_a_value():
    b = parse_box(json.loads(EJ.read_text(encoding="utf-8")))
    assert b["example"] and b["warnings"][0].startswith("ESTE ARCHIVO ES UN EJEMPLO")
    assert (b["lat"], b["lon"]) == (-19.04, -65.26)
    assert b["measured"]["pressure"].value == 73.52 and b["measured"]["pressure"].status == "measured"
    assert b["confidence"]["uv_index"] == "baja"  # sin calibrar
    assert b["measured"]["uv_index"].status == "estimated"  # sin calibrar no es 'measured'
    assert "t_mean" not in b["measured"]  # la temperatura puntual no reemplaza a la media anual
    assert b["context"]["elevation_baro"].status == "derived"
    assert "NO entra al IFA" in b["context"]["gas_anomaly"].note
    sat = {"pressure": Value(value=72.0, unit="kPa", status="modeled", source="POWER"),
           "t_mean": Value(value=287.0, unit="K", status="derived", source="POWER")}
    c = combine(sat, b["measured"])
    assert c["pressure"].status == "measured" and c["t_mean"].status == "derived"


def test_gps_sin_fix():
    b = parse_box({"gps": {"fix": False}, "air": {"p_hpa": 700}})
    assert b["lat"] is None and any("fix" in w for w in b["warnings"])


def test_ficha_tres_niveles_y_brechas():
    F, P = load_features(), load_profiles()
    t = {x.id: x for x in load_targets()}["mars_global"]
    vals = {"t_mean": Value(value=278, unit="K", status="derived", source="POWER"),
            "precip": Value(value=40, unit="mm/año", status="modeled", source="POWER"),
            "albedo": Value(value=0.24, unit="1", status="modeled", source="POWER"),
            "pressure": Value(value=60.8, unit="kPa", status="derived", source="POWER")}
    r = score_site_target(F, P, vals, t, {})
    s = story(Site(id="x", name="Siloli"), t, r, vals, F)
    assert set(s) == {"explorador", "cadete", "cientifico"}
    assert "Siloli" in s["explorador"] and "38 de cada 100" in s["explorador"]  # 3,73 / 9,820 = 38 %
    assert "IFA" in s["cientifico"] and "pending" in s["cientifico"]
    g = {x["id"]: x for x in gaps(t, vals)}
    assert g["gravity"]["ratio"] == round(3.73 / 9.82, 3)
    assert g["ionizing_dose"]["status"] == "pending" and g["ionizing_dose"]["earth"] is None
