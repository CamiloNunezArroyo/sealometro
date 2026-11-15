# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""data/shared/ranking.json (esquema de MOTOR_SIMILITUD.md §7), ranking.csv y sites_index.json."""
from __future__ import annotations

import csv
import datetime as dt
import shutil
from pathlib import Path
from typing import Mapping, Sequence

from .. import __version__
from ..explain.gaps import gaps
from ..explain.narrative import story
from ..explain.narrative_en import story_en
from ..schema import FeatureDef, Site, Target, Value
from ..store import write_json

REPO = Path(__file__).resolve().parents[3]
SHARED = REPO / "data" / "shared"
SLIM = ("value", "unit", "status", "source", "ref", "range", "classes", "retrieved")


def slim(v: Value | None) -> dict | None:
    if v is None:
        return None
    d = v.model_dump(exclude_none=True)
    return {k: d[k] for k in SLIM if k in d}


def build_ranking(results: Sequence[dict], validation: Mapping, sites: Mapping[str, Site], targets: Sequence[Target],
                  site_values: Mapping[str, Mapping[str, Value]], features: Sequence[FeatureDef]) -> dict:
    T = {t.id: t for t in targets}
    out_results = []
    for r in results:
        site, tgt, sv = sites[r["site_id"]], T[r["target_id"]], site_values[r["site_id"]]
        dims = []
        for d in r["dims"]:
            if d["s"] is None and d["skipped"] == "target_pending" and d["id"] not in sv:
                continue
            dims.append({"id": d["id"], "s": d["s"], "po": d["po"], "pct_earth": d["pct_earth"], "skipped": d["skipped"],
                         "analogable": d["analogable"], "weight": d["weight"],
                         "site": slim(sv.get(d["id"])), "target": slim(tgt.values.get(d["id"]))})
        out_results.append({
            "site_id": r["site_id"], "target_id": r["target_id"], "role": site.role,
            "ifa": r["ifa"], "ifa_min": r.get("ifa_min"), "insufficient": r.get("insufficient"), "coverage": r["coverage"],
            "profiles": {k: p["score"] for k, p in r["profiles"].items()},
            "profiles_detail": r["profiles"], "limiting": r["limiting"], "robust": r.get("robust"),
            "dims": dims, "gaps": gaps(tgt, sv), "story": story(site, tgt, r, sv, features),
            "story_en": story_en(site, tgt, r, sv, features),
        })
    v_targets = validation.get("targets", {})
    main = v_targets.get("mars_global", {})
    return {
        "generated": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "engine_version": __version__,
        "validation": {"auc": main.get("auc"), "auc_ci90": main.get("auc_ci90"), "n_pos": main.get("n_pos"),
                       "n_rand": main.get("n_rand"), "target": "mars_global", "note": validation.get("note"),
                       "by_target": {k: {kk: v.get(kk) for kk in ("auc", "auc_ci90", "n_pos", "n_rand")}
                                     for k, v in v_targets.items()}},
        "targets": [{"id": t.id, "body": t.body, "name": t.name, "group": t.group} for t in targets],
        "results": out_results,
    }


def sites_index(sites: Sequence[Site], processed: set[str]) -> dict:
    return {"generated": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "sites": [
        {"id": s.id, "name": s.name, "country": s.country, "region": s.region, "lat": s.lat, "lon": s.lon,
         "coord_status": s.coord.status, "role": s.role, "analog_for": s.analog_for, "refs": s.refs,
         "processed": s.id in processed} for s in sites]}


def write_csv(path: Path, ranking: dict, features: Sequence[FeatureDef]) -> None:
    fids = [f.id for f in features]
    cols = ["site_id", "target_id", "role", "ifa", "ifa_min", "coverage", "limiting", "median_rank", "p_top3"] + \
           [f"prof_{k}" for k in ("rover", "isru", "astrobio", "habitat", "instrumentos")] + [f"s_{f}" for f in fids]
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for r in ranking["results"]:
            s = {d["id"]: d["s"] for d in r["dims"]}
            rb = r.get("robust") or {}
            w.writerow([r["site_id"], r["target_id"], r["role"], _r(r["ifa"]), _r(r.get("ifa_min")), _r(r["coverage"], 3), r["limiting"] or "",
                        rb.get("median_rank", ""), _r(rb.get("p_top3"), 3)] +
                       [_r(r["profiles"].get(k)) for k in ("rover", "isru", "astrobio", "habitat", "instrumentos")] +
                       [_r(s.get(f), 3) for f in fids])


def _r(x, nd=1):
    return "" if x is None else round(x, nd)


def export_all(ranking: dict, index: dict, features: Sequence[FeatureDef]) -> list[Path]:
    files = [SHARED / "ranking.json", SHARED / "ranking.csv", SHARED / "sites_index.json"]
    write_json(files[0], ranking, compact=True)
    write_csv(files[1], ranking, features)
    write_json(files[2], index)
    # Para la web: un archivo por objetivo (~400 KB) + índice, así la página no carga 5 MB de golpe
    rdir = SHARED / "ranking"
    rdir.mkdir(parents=True, exist_ok=True)
    head = {k: ranking[k] for k in ("generated", "engine_version", "validation")}
    toc = []
    for t in ranking["targets"]:
        rows = sorted([r for r in ranking["results"] if r["target_id"] == t["id"]],
                      key=lambda r: -(r["ifa_min"] if r.get("ifa_min") is not None else -1))
        p = rdir / f"{t['id']}.json"
        write_json(p, {**head, "target": t, "results": rows}, compact=True)
        toc.append({**t, "file": f"ranking/{t['id']}.json", "n": len(rows),
                    "top3": [r["site_id"] for r in rows[:3]]})
        files.append(p)
    write_json(rdir / "index.json", {**head, "targets": toc})
    files.append(rdir / "index.json")
    game = REPO / "game"
    if (game / "package.json").exists():  # solo si el juego ya está copiado en game/
        dst = game / "public" / "data" / "engine" / "ranking.json"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(files[0], dst)
        files.append(dst)
    return files
