# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import pytest

from seal.score.quadrant import VisualScore, classify, physical_threshold, quadrant, read_votes


def test_cuatro_cuadrantes():
    thr = 30.0
    assert classify(40, VisualScore(2, 3, 0), thr) == "oculto"
    assert classify(40, VisualScore(8, 3, 0), thr) == "analogo_completo"
    assert classify(10, VisualScore(8, 3, 0), thr) == "impostor"
    assert classify(10, VisualScore(2, 3, 0), thr) == "ninguno"
    assert classify(10, None, thr) == "sin_votos"
    assert classify(None, VisualScore(8, 1, 0), thr) == "sin_datos_fisicos"


def test_umbral_percentil_75():
    assert physical_threshold([0, 10, 20, 30, 40, None]) == pytest.approx(30.0)


def test_votos_formato_ancho():
    from seal.score.quadrant import votes_from_rows
    rows = [{"site_id": "valle", "body": "moon", "votante_1": "8", "votante_2": "6,0", "votante_3": "", "votante_4": "x"},
            {"site_id": "valle", "body": "mars", "votante_1": "3", "votante_2": "", "votante_3": "", "votante_4": ""},
            {"site_id": "otro", "body": "moon", "votante_1": "", "votante_2": "", "votante_3": "", "votante_4": ""}]
    v = votes_from_rows(rows, "moon")
    assert v["valle"].n == 2 and v["valle"].mean == pytest.approx(7.0) and "otro" not in v


def test_votos_csv(tmp_path):
    p = tmp_path / "v.csv"
    p.write_text("site_id,nombre,body,votante,puntaje,foto\n"
                 "valle,Valle,moon,votante_1,8,a.jpg\nvalle,Valle,moon,votante_2,\"6,0\",b.jpg\n"
                 "valle,Valle,moon,votante_3,,\nvalle,Valle,mars,votante_1,3,\nvalle,Valle,moon,votante_4,12,\n",
                 encoding="utf-8")
    v = read_votes(p, "moon")["valle"]
    assert v.n == 2 and v.mean == pytest.approx(7.0)  # vacío y 12 (fuera de rango) se ignoran
    q = quadrant({"valle": 10.0, "otro": 50.0}, {"valle": v}, [0, 10, 20, 30, 40])
    assert q["sites"]["valle"]["class"] == "impostor" and q["sites"]["otro"]["class"] == "sin_votos"
    assert q["x_status"] == "estimated"
