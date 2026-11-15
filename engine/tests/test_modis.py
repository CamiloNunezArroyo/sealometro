# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import pytest

from seal.fetch.modis import DOYS, _chunks, ndvi_value


def test_fechas_y_pedidos_de_10():
    assert len(DOYS) == 23 and DOYS[-1] == 353
    ch = list(_chunks())
    assert ch == [("A2023001", "A2023145"), ("A2023161", "A2023305"), ("A2023321", "A2023353")]


def test_ndvi_mediana_y_pending():
    v = ndvi_value({"ndvi": [0.1, 0.2, 0.9], "errors": [], "retrieved": "2026-11-14"})
    assert v.value == pytest.approx(0.2) and v.status == "modeled" and "Mediana de 3" in v.note
    assert ndvi_value({"error": "503"}).status == "pending"
    v0 = ndvi_value({"ndvi": [], "errors": ["HTTP 400: No data"], "retrieved": "x"})
    assert v0.status == "pending" and "No data" in v0.note
