# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Minerales de superficie con NASA EMIT (L2B Mineral, EMITL2BMIN v002) → dimensión `mineral_classes`.

Comprobado el 2026-11-14:
- La búsqueda de gránulos (CMR) es pública; la DESCARGA necesita una cuenta de NASA Earthdata.
  El token se lee SOLO de la variable de entorno EARTHDATA_TOKEN (nunca va en el código ni en archivos del repo).
- Cada píxel trae hasta dos detecciones (grupo 1 ≈ 2 µm, grupo 2 ≈ 1 µm): `group_N_mineral_id` (índice en la tabla
  oficial mineral_grouping_matrix_20230503.csv de emit-sds-l2b) y `group_N_band_depth` (fuerza de la banda).
- Esa tabla da, para cada espectro de referencia, la fracción de los 10 minerales que EMIT mapea. Los traducimos:
  calcita/dolomita → carbonato · yeso → sulfato · goethita/hematita → oxido_fe ·
  clorita/illita+moscovita/caolinita/montmorillonita/vermiculita → arcilla (filosilicatos).
  EMIT NO detecta sílice hidratada, cloruros (halita) ni basalto: esas clases no pueden salir de aquí.

Regla (decisión de diseño): ventana de radio 1,5 km alrededor del punto; un píxel aporta una clase si su banda tiene
profundidad ≥ BD_MIN y la fracción de ese mineral en el espectro de referencia es ≥ 0,1; una clase se declara presente
si aparece en ≥ PRESENCE_MIN de los píxeles válidos de la ventana.
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import math
import os
from pathlib import Path
from typing import Mapping, Optional, Sequence

import numpy as np

from ..schema import Value
from . import cache
from .http import USER_AGENT, get_json, session

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
SHORT_NAME = "EMITL2BMIN"
TABLE_URL = "https://raw.githubusercontent.com/emit-sds/emit-sds-l2b/main/data/mineral_grouping_matrix_20230503.csv"
REF = "https://lpdaac.usgs.gov/products/emitl2bminv002/"
EMIT_TO_CLASS = {"Calcite": "carbonato", "Dolomite": "carbonato", "Gypsum": "sulfato", "Goethite": "oxido_fe",
                 "Hematite": "oxido_fe", "Chlorite": "arcilla", "Illite+Muscovite": "arcilla", "Kaolinite": "arcilla",
                 "Montmorillonite": "arcilla", "Vermiculite": "arcilla"}
RADIUS_KM, BD_MIN, FRACTION_MIN, PRESENCE_MIN = 1.5, 0.05, 0.1, 0.05
BD_STRICT = 0.10  # prueba de robustez: fracción con una banda más fuerte (va en la nota)
# Respaldo por NOMBRE para los espectros del archivo que no están en la tabla oficial (V002 agrega 18: índices 295–312)
NAME_KEYS = {"hemat": "oxido_fe", "goeth": "oxido_fe", "kaol": "arcilla", "montm": "arcilla", "illit": "arcilla",
             "musc": "arcilla", "chlor": "arcilla", "vermic": "arcilla", "smect": "arcilla", "calcit": "carbonato",
             "dolom": "carbonato", "gyps": "sulfato"}
MAX_CLOUD = 30


# ----------------------------------------------------------------------------- tabla de minerales (pública)
def mineral_table() -> dict[int, set[str]]:
    """índice → conjunto de clases del motor, según la tabla oficial de EMIT (cacheada)."""
    def load():
        r = session().get(TABLE_URL, timeout=60)
        r.raise_for_status()
        return {"csv": r.text}
    return parse_table(cache.cached("emit_table", {"url": TABLE_URL}, load)["csv"])


def _row_classes(row: Mapping) -> set[str]:
    classes = set()
    for mineral, cls in EMIT_TO_CLASS.items():
        try:
            if float(row.get(mineral) or 0) >= FRACTION_MIN:
                classes.add(cls)
        except ValueError:
            pass
    return classes


def parse_table(text: str) -> dict[int, set[str]]:
    """Índice → clases según la tabla oficial (válido para los índices que coinciden con el archivo)."""
    return {int(r["Index"]): _row_classes(r) for r in csv.DictReader(io.StringIO(text))}


def classes_from_name(name: str) -> set[str]:
    n = name.lower()
    return {cls for key, cls in NAME_KEYS.items() if key in n}


def table_for_file(meta: Mapping[str, Sequence], table_csv: str) -> tuple[dict[int, set[str]], set[int]]:
    """Tabla del ARCHIVO (mineral_metadata: index, record, sample_name) cruzada por número de registro con la oficial.
    Devuelve índice → clases y el conjunto de índices clasificados por nombre (respaldo, 'estimated')."""
    by_record: dict[int, Mapping] = {}
    for r in csv.DictReader(io.StringIO(table_csv)):
        by_record.setdefault(int(r["Record"]), r)
    out, by_name = {}, set()
    for i, rec, name in zip(meta["index"], meta["record"], meta["sample_name"]):
        row = by_record.get(int(rec))
        if row is not None:
            out[int(i)] = _row_classes(row)
        else:
            out[int(i)] = classes_from_name(str(name))
            by_name.add(int(i))
    return out, by_name


# ----------------------------------------------------------------------------- búsqueda (pública) y descarga (token)
def search(lat: float, lon: float, max_cloud: int = MAX_CLOUD) -> list[dict]:
    j = get_json("cmr", CMR, {"short_name": SHORT_NAME, "point": f"{lon},{lat}", "page_size": 100, "sort_key": "-start_date"})
    out = []
    for e in j["feed"]["entry"]:
        nc = [l["href"] for l in e.get("links", []) if l["href"].startswith("https") and l["href"].endswith(".nc")
              and "MINUNCERT" not in l["href"]]
        cc = float(e.get("cloud_cover") or 100)
        # solo la versión 002: no verificamos que la 001 use la misma tabla de minerales
        if nc and cc <= max_cloud and "_002_" in e["title"]:
            out.append({"id": e["title"], "date": e["time_start"][:10], "cloud": cc, "url": nc[0]})
    return sorted(out, key=lambda g: (g["cloud"], g["date"]))  # el menos nublado primero


def download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:  # ya descargado: no hace falta el token
        return dest
    token = os.environ.get("EARTHDATA_TOKEN", "").strip()
    if not token:
        raise PermissionError("Falta la variable de entorno EARTHDATA_TOKEN (cuenta de NASA Earthdata).")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".part")
    with session().get(url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT},
                       stream=True, timeout=300, allow_redirects=True) as r:
        if r.status_code in (401, 403):
            raise PermissionError(f"Earthdata rechazó el token (HTTP {r.status_code}).")
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)
    return dest


# ----------------------------------------------------------------------------- lectura y clasificación (puras)
def _find(h5, name: str):
    found = []
    h5.visititems(lambda k, obj: found.append(obj) if k.split("/")[-1] == name and hasattr(obj, "shape") else None)
    return found[0][()] if found else None


def read_window(path: Path, lat: float, lon: float, radius_km: float = RADIUS_KM) -> dict:
    import h5py
    with h5py.File(path, "r") as h:
        la, lo = _find(h, "lat"), _find(h, "lon")
        g = {k: _find(h, k) for k in ("group_1_mineral_id", "group_1_band_depth", "group_2_mineral_id", "group_2_band_depth")}
        meta = None
        if "mineral_metadata" in h:
            md = h["mineral_metadata"]
            dec = lambda a: [x.decode() if isinstance(x, bytes) else str(x) for x in a]  # noqa: E731
            meta = {"index": md["index"][()].tolist(), "record": md["record"][()].tolist(),
                    "sample_name": dec(md["sample_name"][()])}
    if la is None or lo is None or g["group_1_mineral_id"] is None:
        return {"error": "el archivo no tiene lat/lon o mineral_id donde se esperaba"}
    d = haversine_grid(la, lo, lat, lon)
    m = d <= radius_km
    if not m.any():
        return {"error": f"el punto no cae dentro de la pasada (píxel más cercano a {np.nanmin(d):.1f} km)"}
    return {k: v[m].tolist() for k, v in g.items() if v is not None} | {"n_window": int(m.sum()), "meta": meta}


def haversine_grid(la: np.ndarray, lo: np.ndarray, lat: float, lon: float) -> np.ndarray:
    p1, p2 = np.radians(la), math.radians(lat)
    dphi, dl = p1 - p2, np.radians(lo) - math.radians(lon)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * math.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def classify(win: Mapping, table: Mapping[int, set[str]], bd_min: Optional[float] = None) -> dict:
    """Fracción de píxeles válidos con cada clase y clases presentes (≥ PRESENCE_MIN)."""
    bd_min = BD_MIN if bd_min is None else bd_min
    ids1, bd1 = np.asarray(win["group_1_mineral_id"]), np.asarray(win["group_1_band_depth"], float)
    ids2 = np.asarray(win.get("group_2_mineral_id", np.zeros_like(ids1)))
    bd2 = np.asarray(win.get("group_2_band_depth", np.zeros_like(bd1)), float)
    valid = (bd1 >= 0) & np.isfinite(bd1)  # relleno (-9999) y nubes quedan fuera
    n = int(valid.sum())
    if n == 0:
        return {"n_valid": 0, "fractions": {}, "classes": []}
    counts: dict[str, int] = {}
    for i1, b1, i2, b2, ok in zip(ids1, bd1, ids2, bd2, valid):
        if not ok:
            continue
        cls = set()
        if b1 >= bd_min:
            cls |= table.get(int(i1), set())
        if b2 >= bd_min:
            cls |= table.get(int(i2), set())
        for c in cls:
            counts[c] = counts.get(c, 0) + 1
    fr = {c: k / n for c, k in sorted(counts.items())}
    return {"n_valid": n, "fractions": fr, "classes": sorted(c for c, f in fr.items() if f >= PRESENCE_MIN)}


def emit_value(res: Mapping, granule: Mapping) -> Value:
    if res.get("error"):
        return Value.pending("1", f"EMIT: {res['error']}")
    if res["n_valid"] == 0:
        return Value.pending("1", f"EMIT {granule['id']}: ningún píxel válido en la ventana (nubes o relleno).")
    fr = ", ".join(f"{c} {100 * f:.0f} %" for c, f in res["fractions"].items()) or "ninguna clase detectada"
    return Value(unit="1", classes=res["classes"], detectable=sorted(set(EMIT_TO_CLASS.values())), status="modeled",
                 source=f"NASA EMIT L2B Mineral ({SHORT_NAME} v002), gránulo {granule['id']} ({granule['date']}, nubes {granule['cloud']:.0f} %)",
                 ref=REF, retrieved=dt.date.today().isoformat(),
                 note=(f"Ventana de {RADIUS_KM} km de radio, {res['n_valid']} píxeles válidos de ~60 m; fracción de píxeles por clase: {fr}. "
                       f"Clase presente si ≥ {100 * PRESENCE_MIN:.0f} % de los píxeles (profundidad de banda ≥ {BD_MIN}). "
                       "EMIT no detecta sílice hidratada, cloruros ni basalto: su ausencia aquí no significa que no estén."))


def fetch_emit(lat: float, lon: float, network: bool = True) -> tuple[Value, Optional[dict]]:
    """Búsqueda → gránulo menos nublado → descarga (token) → clases. Cachea el resultado (no el archivo grande).
    network=False: solo lo que ya está en caché."""
    params = {"lat": round(lat, 4), "lon": round(lon, 4), "r": RADIUS_KM, "bd": BD_MIN, "p": PRESENCE_MIN, "v": 3}
    hit = cache.get("emit", params)
    if hit is not None:
        return Value(**hit["value"]), hit.get("granule")
    if not network:
        return Value.pending("1", "EMIT no descargado (usar 'python -m seal emit' con EARTHDATA_TOKEN)."), None
    grans = search(lat, lon)
    if not grans:
        return Value.pending("1", f"EMIT: no hay pasadas con ≤ {MAX_CLOUD} % de nubes sobre el punto."), None
    mineral_table()  # asegura la tabla oficial en caché
    table_csv = cache.get("emit_table", {"url": TABLE_URL})["csv"]
    for g in grans[:3]:  # hasta 3 intentos si el punto queda en el borde o cubierto
        path = download(g["url"], cache.CACHE_DIR / "emit_nc" / Path(g["url"]).name)
        win = read_window(path, lat, lon)
        if win.get("error"):
            continue
        table, by_name = table_for_file(win["meta"], table_csv) if win.get("meta") else (parse_table(table_csv), set())
        res = classify(win, table)
        if res["n_valid"] == 0:
            continue
        strict = classify(win, table, BD_STRICT)["fractions"]
        v = emit_value(res, g)
        extra = (f" Robustez: con profundidad de banda ≥ {BD_STRICT}: "
                 + (", ".join(f"{c} {100 * f:.0f} %" for c, f in strict.items()) or "ninguna clase") + ". "
                 f"Tabla de minerales: la del propio archivo, cruzada por número de registro con la oficial; "
                 f"{len(by_name)} espectros sin fila oficial se clasificaron por su nombre (estimated).")
        v = v.model_copy(update={"note": (v.note or "") + extra})
        cache.put("emit", params, {"value": v.model_dump(exclude_none=True), "granule": g})
        return v, g
    return Value.pending("1", "EMIT: ninguna de las 3 pasadas menos nubladas tuvo píxeles válidos sobre el punto."), None
