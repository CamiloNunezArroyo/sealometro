# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""EMIT sin red: tabla, clasificación de píxeles, lectura de un NetCDF sintético y falta de token."""
import numpy as np
import pytest

from seal.fetch.emit import classify, download, emit_value, parse_table, read_window

TABLE = ("Index,Record,Filename,Name,URL,Group,Library,Calcite,Chlorite,Dolomite,Goethite,Gypsum,Hematite,"
         "Illite+Muscovite,Kaolinite,Montmorillonite,Vermiculite\n"
         "1,1,a,Hematite,u,1,s,,,,,,1.0,,,,\n"
         "2,2,b,Gypsum,u,2,s,,,,,1.0,,,,,\n"
         "3,3,c,Calc+Kaol,u,2,s,0.5,,,,,,,0.5,,\n"
         "4,4,d,Plastic,u,1,s,,,,,,,,,,\n")


def test_tabla_a_clases():
    t = parse_table(TABLE)
    assert t[1] == {"oxido_fe"} and t[2] == {"sulfato"} and t[3] == {"carbonato", "arcilla"} and t[4] == set()


def test_clasificacion_por_pixeles():
    t = parse_table(TABLE)
    # 10 píxeles válidos + 1 relleno; yeso fuerte en 6, hematita fuerte en 1, hematita débil (bd < 0,02) en 2
    win = {"group_1_mineral_id": [2] * 6 + [0, 0, 0, 0, 2], "group_1_band_depth": [0.1] * 6 + [0, 0, 0, 0, -9999],
           "group_2_mineral_id": [0] * 6 + [1, 1, 1, 0, 0], "group_2_band_depth": [0] * 6 + [0.05, 0.01, 0.01, 0, 0]}
    r = classify(win, t)
    assert r["n_valid"] == 10
    assert r["fractions"] == {"oxido_fe": pytest.approx(0.1), "sulfato": pytest.approx(0.6)}
    assert r["classes"] == ["oxido_fe", "sulfato"]  # 10 % ≥ 5 %


def test_value_y_pending():
    g = {"id": "EMIT_X", "date": "2026-11-10", "cloud": 1.0}
    v = emit_value({"n_valid": 10, "fractions": {"sulfato": 0.6}, "classes": ["sulfato"]}, g)
    assert v.status == "modeled" and v.classes == ["sulfato"] and "EMIT_X" in v.source and "no detecta" in v.note
    assert emit_value({"n_valid": 0, "fractions": {}, "classes": []}, g).status == "pending"


def test_lectura_netcdf_sintetico(tmp_path):
    import h5py
    p = tmp_path / "x.nc"
    la, lo = np.meshgrid(np.linspace(-22.1, -22.0, 20), np.linspace(-67.9, -67.8, 20), indexing="ij")
    with h5py.File(p, "w") as h:
        h["group_1_mineral_id"] = np.full((20, 20), 2)
        h["group_1_band_depth"] = np.full((20, 20), 0.1)
        loc = h.create_group("location")
        loc["lat"], loc["lon"] = la, lo
    w = read_window(p, -22.05, -67.85, radius_km=1.5)
    assert w["n_window"] > 0 and set(w["group_1_mineral_id"]) == {2}
    assert "error" in read_window(p, -10.0, -60.0)


def test_tabla_del_archivo_por_registro_y_por_nombre():
    from seal.fetch.emit import table_for_file
    meta = {"index": [1, 2, 302], "record": [1, 2, 1332], "sample_name": ["Hematite", "Gypsum", "Hematite0.1+Goeth0.4+Qtz.5"]}
    t, by_name = table_for_file(meta, TABLE)
    assert t[1] == {"oxido_fe"} and t[2] == {"sulfato"}
    assert t[302] == {"oxido_fe"} and by_name == {302}  # no está en la tabla oficial: se clasifica por su nombre


def test_sin_token(monkeypatch, tmp_path):
    monkeypatch.delenv("EARTHDATA_TOKEN", raising=False)
    with pytest.raises(PermissionError):
        download("https://example.invalid/x.nc", tmp_path / "x.nc")
