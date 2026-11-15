# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import copy
import json
from pathlib import Path

import pytest

from seal.export.check import check_ranking

RANKING = Path(__file__).resolve().parents[2] / "data" / "shared" / "ranking.json"

MIN = {"generated": "x", "engine_version": "0.1.0",
       "validation": {"auc": 0.5, "n_pos": 1, "n_rand": 2, "note": "n"},
       "targets": [{"id": "mars_global", "body": "mars", "name": "Marte"}],
       "results": [{"site_id": "a", "target_id": "mars_global", "ifa": 50.0, "coverage": 0.5,
                    "profiles": {"rover": None}, "limiting": "precip", "robust": None,
                    "dims": [{"id": "precip", "s": 0.5, "po": 0.1, "pct_earth": 90.0,
                              "site": {"value": 10, "unit": "mm/año", "status": "modeled", "source": "POWER"},
                              "target": {"value": 0, "unit": "mm/año", "status": "estimated", "source": "Simplificación"}}],
                    "gaps": [{"id": "gravity", "earth": 9.82, "target": 3.73, "unit": "m/s²", "text_key": "gap.gravity"}],
                    "story": {"explorador": "a", "cadete": "b", "cientifico": "c"}}]}


def test_minimo_valido():
    assert check_ranking(MIN) == []


def test_numero_sin_fuente_y_rango():
    bad = copy.deepcopy(MIN)
    bad["results"][0]["dims"][0]["site"]["source"] = ""
    bad["results"][0]["ifa"] = 140
    errs = check_ranking(bad)
    assert any("sin fuente" in e for e in errs) and any("IFA" in e for e in errs)


def test_falta_campo():
    bad = copy.deepcopy(MIN)
    del bad["results"][0]["story"]
    assert check_ranking(bad)[0].startswith("esquema")


@pytest.mark.skipif(not RANKING.exists(), reason="todavía no se corrió export")
def test_ranking_real_es_valido():
    assert check_ranking(json.loads(RANKING.read_text(encoding="utf-8"))) == []
