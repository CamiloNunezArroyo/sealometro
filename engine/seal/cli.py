# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Línea de comandos: python -m seal fetch | score | validate | export | field."""
from __future__ import annotations

import datetime as dt
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import typer

from . import __version__, store
from .catalog import PKG, load_features, load_profiles, load_sites, load_targets
from .run import merge_site_values, score_site_target

app = typer.Typer(add_completion=False, help="Motor de similitud del Seal Hackathon Team (NASA Space Apps Sucre 2026).")


def _say(msg: str) -> None:
    typer.echo(msg)


@app.command()
def fetch(sites: Path = typer.Option(PKG / "sites" / "sites.yaml", help="YAML de sitios"),
          n_earth: int = typer.Option(300, help="Puntos al azar de tierra firme"),
          no_earth: bool = typer.Option(False, help="No descargar la muestra terrestre"),
          no_dem_earth: bool = typer.Option(False, help="Muestra terrestre solo con POWER (más rápido)"),
          modis: bool = typer.Option(False, help="NDVI de MODIS para los sitios (ORNL: lento, ~11 min sin caché)")):
    """Descarga POWER + Copernicus DEM para los sitios y la muestra terrestre (con caché)."""
    from .fetch.earth_sample import SEED, fetch_sample
    from .fetch.pipeline import fetch_point

    t0 = time.time()
    all_sites = load_sites(sites)
    todo = [s for s in all_sites if s.processable()]
    skipped = [s.id for s in all_sites if not s.processable()]
    _say(f"Sitios: {len(todo)} a procesar; sin coordenada (no se procesan): {skipped}")

    def one(s):
        return s.id, fetch_point(s.lat, s.lon, with_modis=True if modis else None)  # sin --modis: NDVI de la caché

    with ThreadPoolExecutor(max_workers=4) as ex:
        fetched = dict(ex.map(one, todo))
    out = {}
    for s in todo:
        vals = merge_site_values(fetched[s.id], s.values)
        out[s.id] = store.dump_values(vals)
        pend = [k for k, v in vals.items() if not k.startswith("_") and not v.usable()]
        if pend:
            _say(f"  {s.id}: pending {pend}")
    store.write_json(store.SITE_VALUES, {"generated": dt.datetime.now().isoformat(timespec="seconds"),
                                         "engine_version": __version__, "sites": out})
    _say(f"Sitios listos en {time.time() - t0:.0f} s → {store.SITE_VALUES}")

    if not no_earth:
        t1 = time.time()
        done = [0]

        def prog(_):
            done[0] += 1
            if done[0] % 50 == 0:
                _say(f"  muestra terrestre: {done[0]}/{n_earth} ({time.time() - t1:.0f} s)")

        sample = fetch_sample(n_earth, with_dem=not no_dem_earth, progress=prog)
        store.write_json(store.EARTH_SAMPLE, {
            "generated": dt.datetime.now().isoformat(timespec="seconds"), "seed": SEED, "n": len(sample),
            "method": "Uniforme por área en la esfera; tierra firme según GLOBE 1 km (global-land-mask); "
                      "mismo proceso que los sitios (DEM + POWER + corrección por elevación).",
            "points": [{**p, "values": store.dump_values(p["values"])} for p in sample]})
        _say(f"Muestra terrestre: {len(sample)} puntos en {time.time() - t1:.0f} s → {store.EARTH_SAMPLE}")
    _say(f"Total: {time.time() - t0:.0f} s")


def _fmt(x, nd=1, pct=False):
    if x is None:
        return "—"
    return f"{100 * x:.0f}%" if pct else f"{x:.{nd}f}"


@app.command()
def score(profile: str = typer.Option("todos", help="Perfil a mostrar en la tabla (o 'todos' = IFA total)"),
          show: str = typer.Option("mars_global,mars_gale", help="Objetivos a mostrar, separados por coma"),
          top: int = typer.Option(10, help="Filas por objetivo")):
    """Calcula IFA, perfiles, progreso y percentil terrestre para cada par sitio × objetivo."""
    from .fetch.earth_sample import earth_stats

    features, profiles, targets = load_features(), load_profiles(), load_targets()
    sites = {s.id: s for s in load_sites()}
    site_vals = store.read_site_values()
    sample = store.read_earth_sample() if store.EARTH_SAMPLE.exists() else []
    stats = earth_stats(sample, [f.id for f in features if f.kind == "numeric"])
    if not sample:
        _say("AVISO: no hay muestra terrestre: progreso y percentil quedan vacíos.")
    from .score.robustness import N_DEFAULT, monte_carlo

    results = []
    for t in targets:
        rob = monte_carlo(features, site_vals, t.values, n=N_DEFAULT)
        for sid, vals in site_vals.items():
            r = score_site_target(features, profiles, vals, t, stats)
            rb = rob.get(sid)
            r["robust"] = {"median_rank": rb.median_rank, "p90": list(rb.p90) if rb.p90 else None,
                           "p_top3": rb.p_top3, "n": N_DEFAULT} if rb else None
            results.append({"site_id": sid, "target_id": t.id, "role": sites[sid].role if sid in sites else "?", **r})
    store.write_json(store.SCORES, {
        "generated": dt.datetime.now().isoformat(timespec="seconds"), "engine_version": __version__,
        "earth_stats": {k: {kk: vv for kk, vv in v.items() if kk != "values"} for k, v in stats.items()},
        "results": results})
    _say(f"{len(results)} pares → {store.SCORES}")

    for tid in [x.strip() for x in show.split(",") if x.strip()]:
        rows = [r for r in results if r["target_id"] == tid]
        key = (lambda r: r["ifa_min"]) if profile == "todos" else (lambda r: r["profiles"].get(profile, {}).get("score"))
        rows = sorted([r for r in rows if key(r) is not None], key=lambda r: -key(r))[:top]
        _say(f"\n=== {tid} — {'IFA total' if profile == 'todos' else 'perfil ' + profile} ===")
        _say(f"{'#':>2} {'sitio':28s} {'rol':12s} {'IFA':>5} {'IFAmin':>6} {'cob':>4} {'limitante':16s} {'puesto':>6} {'IC90':>7} {'Ptop3':>5}")
        for i, r in enumerate(rows, 1):
            rb = r.get("robust") or {}
            ic = f"{rb['p90'][0]}–{rb['p90'][1]}" if rb.get("p90") else "—"
            _say(f"{i:>2} {r['site_id'][:28]:28s} {r['role']:12s} {_fmt(r['ifa']):>5} {_fmt(r['ifa_min']):>6} {_fmt(r['coverage'], pct=True):>4} "
                 f"{(r['limiting'] or '—')[:16]:16s} {_fmt(rb.get('median_rank'), 0):>6} {ic:>7} {_fmt(rb.get('p_top3'), pct=True):>5}")


@app.command()
def validate():
    """AUC de los controles positivos contra la muestra al azar, por objetivo (§5.5)."""
    from .score.validate import CIRCULARITY, validate_target

    features, targets = load_features(), load_targets()
    sites = {s.id: s for s in load_sites()}
    site_vals = store.read_site_values()
    randoms = [p["values"] for p in store.read_earth_sample()]
    negatives = {k: v for k, v in site_vals.items() if sites[k].role == "control_neg"}
    report = {}
    _say(f"{'objetivo':28s} {'AUC':>5} {'IC90':>11} {'n+':>3} {'nAz':>4}  dimensión que más pesa (AUC sin ella)   negativos (percentil)")
    for t in targets:
        pos = {k: v for k, v in site_vals.items() if sites[k].role == "control_pos" and t.body in sites[k].analog_for}
        r = validate_target(features, t.values, pos, randoms, negatives)
        report[t.id] = r
        if r.get("auc") is None:
            _say(f"{t.id:28s}   —   datos insuficientes del objetivo para validar ({', '.join(r.get('dims', [])) or 'sin dimensiones satelitales'})")
            continue
        loo = sorted(((k, v) for k, v in r["leave_one_out"].items() if v is not None), key=lambda kv: kv[1])
        key = f"{loo[0][0]} ({loo[0][1]:.2f})" if loo else "—"
        ci = f"{r['auc_ci90'][0]:.2f}–{r['auc_ci90'][1]:.2f}" if r["auc_ci90"] else "—"
        negs = ", ".join(f"{k.split('_')[0]} {v['pct_random']:.0f}" for k, v in r["negatives"].items())
        _say(f"{t.id:28s} {r['auc']:.2f} {ci:>11} {r['n_pos']:>3} {r['n_rand']:>4}  {key:38s} {negs}")
    store.write_json(store.OUT / "validation.json", {"generated": dt.datetime.now().isoformat(timespec="seconds"),
                                                     "note": CIRCULARITY, "targets": report})
    _say(f"\n{CIRCULARITY}\n→ {store.OUT / 'validation.json'}")


@app.command()
def export(plots: bool = typer.Option(True, help="Generar gráficos en data/shared/plots/"),
           plot_target: str = typer.Option("mars_global", help="Objetivo para radar y progreso")):
    """Escribe data/shared/ranking.json, ranking.csv, sites_index.json y los gráficos."""
    from .export.shared import SHARED, build_ranking, export_all, sites_index

    features, targets = load_features(), load_targets()
    sites = {s.id: s for s in load_sites()}
    site_vals = store.read_site_values()
    results = store.read_json(store.SCORES)["results"]
    vpath = store.OUT / "validation.json"
    validation = store.read_json(vpath) if vpath.exists() else {}
    if not validation:
        _say("AVISO: no hay validation.json (corre 'python -m seal validate'): el ranking sale sin AUC.")
    ranking = build_ranking(results, validation, sites, targets, site_vals, features)
    from .export.check import check_ranking
    errs = check_ranking(ranking)
    if errs:
        for e in errs[:20]:
            _say(f"ERROR: {e}")
        _say(f"ranking.json NO es válido ({len(errs)} errores): no se escribe.")
        raise typer.Exit(code=1)
    _say("ranking.json válido con el esquema §7; todo número no-pending tiene fuente.")
    files = export_all(ranking, sites_index(list(sites.values()), set(site_vals)), features)
    if plots:
        from .export.plots import progress_bars, radar, similarity_map
        out = SHARED / "plots"
        T = {t.id: t for t in targets}
        rows = sorted([r for r in results if r["target_id"] == plot_target and r["ifa"] is not None], key=lambda r: -r["ifa_min"])
        for r in rows[:5]:
            p = radar(sites[r["site_id"]], T[plot_target], r, features, out)
            files += [p] if p else []
        bol = [r for r in rows if sites[r["site_id"]].country == "Bolivia"][:5]
        for r in bol:
            p = progress_bars(sites[r["site_id"]], T[plot_target], r, features, out)
            files += [p] if p else []
        earth = [p["values"] for p in store.read_earth_sample()]
        files += similarity_map(features, earth, sites, site_vals, targets, out)
    size = (SHARED / "ranking.json").stat().st_size / 1e6
    _say(f"ranking.json: {len(ranking['results'])} pares, {size:.1f} MB")
    if not (store.ENGINE.parent / "game" / "package.json").exists():
        _say("game/ todavía no tiene el juego (sin package.json): no se copió ranking.json a game/public/data/engine/.")
    for f in files:
        _say(f"  {f}")


@app.command()
def discover(step: float = typer.Option(0.5, help="Paso de la rejilla en grados (POWER tiene celdas de 0,5° × 0,625°)"),
             target: str = typer.Option("mars_global", help="Objetivo"),
             top: int = typer.Option(10, help="Celdas que reciben el análisis completo (DEM + POWER corregido)")):
    """Rejilla de Bolivia y el Altiplano → IFA por celda → mapa de calor (§5.7)."""
    from . import discover as D
    from .export.shared import SHARED
    from .fetch.earth_sample import earth_stats
    from .fetch.pipeline import fetch_point

    t0 = time.time()
    features, profiles = load_features(), load_profiles()
    T = {t.id: t for t in load_targets()}[target]
    sites = load_sites()
    pts = D.grid(step)
    _say(f"Rejilla: {len(pts)} celdas de tierra firme de {step}° (lat {D.BBOX['lat']}, lon {D.BBOX['lon']})")
    done = [0]

    def prog(_):
        done[0] += 1
        if done[0] % 100 == 0:
            _say(f"  {done[0]}/{len(pts)} ({time.time() - t0:.0f} s)")

    cells = D.fetch_grid(pts, progress=prog)
    failed = sum(1 for c in cells if c["error"])
    scored = D.score_grid(features, cells, T)
    ok = sorted([c for c in scored if c["ifa"] is not None], key=lambda c: -c["ifa"])
    sample = store.read_earth_sample() if store.EARTH_SAMPLE.exists() else []
    stats = earth_stats(sample, [f.id for f in features if f.kind == "numeric"])
    best = []
    for c in ok[:top]:
        sid, km = D.nearest_site(c["lat"], c["lon"], sites)
        full = score_site_target(features, profiles, fetch_point(c["lat"], c["lon"]), T, stats)
        best.append({**c, "nearest_site": sid, "nearest_km": round(km, 1) if km else None,
                     "full": {"ifa": full["ifa"], "ifa_min": full["ifa_min"], "coverage": full["coverage"], "limiting": full["limiting"],
                              "dims": [d for d in full["dims"] if d["s"] is not None]}})
    try:
        rings = D.country_rings("BOL")
    except Exception as e:  # sin frontera, el mapa sale igual
        _say(f"AVISO: no se pudo leer la frontera de Bolivia ({str(e)[:100]}).")
        rings = []
    bol = [c for c in ok if rings and D.in_country(c["lat"], c["lon"], rings)]
    best_bol = []
    for c in bol[:top]:
        sid, km = D.nearest_site(c["lat"], c["lon"], sites)
        best_bol.append({**c, "nearest_site": sid, "nearest_km": round(km, 1) if km else None})
    vpath = store.OUT / "validation.json"
    auc = (store.read_json(vpath)["targets"].get(target, {}).get("auc") if vpath.exists() else None)
    auc_txt = f"AUC de validación {auc:.2f}".replace(".", ",") if auc is not None else "sin validación todavía"
    dims_used = ", ".join(D.grid_weights(features, cells, T))
    note = ("Unidad = celda de NASA POWER (~50 km), sin corrección por elevación; solo clima "
            f"({dims_used}; el motor aún no ve minerales en la rejilla; {auc_txt}). Pesos y tolerancias: decisiones de diseño.")
    out_json = SHARED / f"discover_{target}.json"
    store.write_json(out_json, {"generated": dt.datetime.now().isoformat(timespec="seconds"), "target": target,
                                "step_deg": step, "bbox": D.BBOX, "n_cells": len(cells), "n_failed": failed,
                                "note": note, "top": best, "top_bolivia": best_bol, "cells": scored}, compact=True)
    html = SHARED / "plots" / f"mapa_calor_{target}.html"
    png = SHARED / "plots" / f"mapa_calor_{target}.png"
    html.parent.mkdir(parents=True, exist_ok=True)
    D.heatmap_html(scored, sites, T, step, html, note)
    D.heatmap_png(scored, sites, T, step, png, note, rings)
    if best_bol:
        _say(f"\nTop {len(best_bol)} celdas DENTRO DE BOLIVIA (de {len(bol)}) contra {target}:")
        for i, c in enumerate(best_bol, 1):
            _say(f"{i:>2} ({c['lat']:7.2f}, {c['lon']:7.2f})  IFA {c['ifa']:5.1f}  limitante {c['limiting']:14s} "
                 f"sitio más cercano: {c['nearest_site']} ({c['nearest_km']} km)")
    _say(f"\nTop {top} celdas contra {target} (IFA de celda → IFA completo en el centro):")
    for i, c in enumerate(best, 1):
        _say(f"{i:>2} ({c['lat']:7.2f}, {c['lon']:7.2f})  celda {c['ifa']:5.1f} → centro {_fmt(c['full']['ifa'])} (conservador {_fmt(c['full']['ifa_min'])})  "
             f"limitante {c['limiting']:14s} sitio más cercano: {c['nearest_site']} ({c['nearest_km']} km)")
    _say(f"Celdas con error de POWER: {failed}. Tiempo: {time.time() - t0:.0f} s")
    for f in (out_json, html, png):
        _say(f"  {f}")


@app.command()
def emit(top: int = typer.Option(5, help="Cuántos sitios del ranking (por IFA) procesar"),
         target: str = typer.Option("mars_global", help="Objetivo del ranking para elegir el top"),
         sites_ids: str = typer.Option("", "--sites", help="Ids separados por coma (reemplaza a --top)")):
    """Minerales con NASA EMIT para el top del ranking. Necesita la variable de entorno EARTHDATA_TOKEN."""
    import os

    from .fetch.emit import fetch_emit, search

    S = {s.id: s for s in load_sites()}
    if sites_ids:
        ids = [x.strip() for x in sites_ids.split(",") if x.strip()]
    else:
        res = [r for r in store.read_json(store.SCORES)["results"] if r["target_id"] == target and r.get("ifa_min", r["ifa"]) is not None]
        ids = [r["site_id"] for r in sorted(res, key=lambda r: -r.get("ifa_min", r["ifa"]))[:top]]
    has_token = bool(os.environ.get("EARTHDATA_TOKEN", "").strip())
    _say(f"Sitios: {ids}\nToken de Earthdata: {'sí' if has_token else 'NO (solo busco pasadas; no descargo)'}")
    processed = False
    for sid in ids:
        s = S[sid]
        try:  # si el archivo ya está descargado, se procesa sin token
            v, g = fetch_emit(s.lat, s.lon)
            processed = True
        except PermissionError as e:
            g = search(s.lat, s.lon)
            _say(f"  {sid:24s} sin descargar ({e}) · pasadas con ≤ 30 % de nubes: {len(g)}"
                 + (f"; la mejor: {g[0]['id']} ({g[0]['cloud']:.0f} %)" if g else ""))
            continue
        lit = s.values.get("mineral_classes")
        lit_txt = f" · literatura: {lit.classes}" if lit is not None and lit.usable() else ""
        _say(f"  {sid:24s} EMIT: {v.classes if v.usable() else '— (' + (v.note or '') + ')'}{lit_txt}")
    if processed:
        _say("Listo. Para usarlo en el ranking: python -m seal fetch --no-earth; python -m seal score; "
             "python -m seal validate; python -m seal export")


@app.command()
def quadrant(body: str = typer.Option("moon", help="moon o mars"),
             votes_csv: Path = typer.Option(store.ENGINE.parent / "data" / "shared" / "visual_votes.csv",
                                            help="CSV de la votación visual del equipo")):
    """Cuadrante "impostor vs oculto" (§5.6): parecido físico (motor) vs parecido visual (votación del equipo)."""
    import csv as _csv

    from .export.shared import SHARED
    from .score.quadrant import LABEL, quadrant as Q, read_votes
    from .score.similarity import score as _score
    from .score.validate import satellite_weights

    features = load_features()
    T = {t.id: t for t in load_targets()}[f"{body}_global"]
    sites = {s.id: s for s in load_sites()}
    site_vals = store.read_site_values()
    randoms = [p["values"] for p in store.read_earth_sample()]
    # mismas dimensiones para sitios y azar: satelitales, con dato en el objetivo y en ≥ 90 % de la muestra
    w = {k: v for k, v in satellite_weights(features).items() if T.values.get(k) is not None and T.values[k].usable()
         and sum(1 for r in randoms if r.get(k) is not None and r[k].usable()) >= 0.9 * len(randoms)}
    site_ifa = {sid: _score(features, v, T.values, w).ifa for sid, v in site_vals.items()}
    rnd_ifa = [_score(features, r, T.values, w).ifa for r in randoms]

    if not votes_csv.exists():
        votes_csv.parent.mkdir(parents=True, exist_ok=True)
        with open(votes_csv, "w", newline="", encoding="utf-8") as fh:
            wr = _csv.writer(fh)
            wr.writerow(["site_id", "nombre", "body", "votante", "puntaje", "foto"])
            for b in ("moon", "mars"):
                for sid in site_vals:
                    wr.writerow([sid, sites[sid].name, b, "", "", ""])
        _say(f"Creé la plantilla de votación: {votes_csv} (instrucciones en visual_votes_LEEME.md).")
    votes = read_votes(votes_csv, body)
    q = Q(site_ifa, votes, rnd_ifa)
    thr = q["y_threshold"]
    store.write_json(SHARED / f"quadrant_{body}.json", {"generated": dt.datetime.now().isoformat(timespec="seconds"),
                                                       "target": T.id, "dims": list(w), **q})
    rnd_sorted = sorted(x for x in rnd_ifa if x is not None)
    _say(f"Objetivo {T.id}; dimensiones físicas: {', '.join(w)}; umbral físico (p75 de la Tierra al azar) = {thr:.1f}")
    _say(f"Votos visuales: {sum(v.n for v in votes.values())} en {len(votes)} sitios.")
    for sid in ["valle_de_la_luna", "valle_de_las_animas", "canones_de_palca", "desierto_blanco", "wadi_rum", "cinder_lake_az", "siloli"]:
        if sid in q["sites"]:
            r = q["sites"][sid]
            pct = 100 * sum(1 for x in rnd_sorted if x < r["ifa"]) / len(rnd_sorted) if r["ifa"] is not None else None
            vis = f"visual {r['visual']['mean']:.1f}/10 (n={r['visual']['n']})" if r["visual"] else "visual: sin votos"
            _say(f"  {sid:22s} IFA {_fmt(r['ifa'])} (percentil {_fmt(pct, 0)} de la Tierra) · {vis} → {LABEL[r['class']]}")
    if votes:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        pts = [(sid, r) for sid, r in q["sites"].items() if r["visual"] and r["ifa"] is not None]
        fig, ax = plt.subplots(figsize=(7.5, 6.2))
        ax.axhline(thr, color="#52514e", linewidth=1, linestyle="--")
        ax.axvline(5, color="#52514e", linewidth=1, linestyle="--")
        ax.scatter([r["visual"]["mean"] for _, r in pts], [r["ifa"] for _, r in pts], s=50, color="#2a78d6",
                   edgecolor="#fcfcfb", linewidth=1.5, zorder=3)
        for sid, r in pts:
            ax.annotate(sites[sid].name.split(" – ")[0].split(" (")[0], (r["visual"]["mean"], r["ifa"]), xytext=(5, 3),
                        textcoords="offset points", fontsize=7.5)
        top = max([thr * 1.6] + [r["ifa"] * 1.1 for _, r in pts])
        for x, y, t in [(0.3, top * 0.97, "OCULTO\nno lo parece, pero lo es"), (9.7, top * 0.97, "ANÁLOGO COMPLETO"),
                        (9.7, thr * 0.05, "IMPOSTOR\nlo parece, pero no lo es"), (0.3, thr * 0.05, "NI LO PARECE NI LO ES")]:
            ax.text(x, y, t, fontsize=8, color="#52514e", ha="left" if x < 5 else "right", va="top" if y > thr else "bottom")
        ax.set_xlim(0, 10)
        ax.set_ylim(0, top)
        ax.set_xlabel("Parecido VISUAL (votación del equipo, 0–10; estimated)", fontsize=9)
        ax.set_ylabel(f"Parecido FÍSICO (IFA contra {T.name.split(' (')[0]}, valores globales)", fontsize=9)
        ax.set_title(f"Impostores y análogos ocultos — {T.name}", fontsize=11, loc="left")
        for s_ in ("top", "right"):
            ax.spines[s_].set_visible(False)
        fig.text(0.01, 0.01, f"Umbral físico: percentil 75 de la Tierra al azar ({thr:.1f}). Votos a ciegas del equipo. "
                 "Seal Hackathon Team, 2026.", fontsize=6.5, color="#52514e")
        fig.tight_layout(rect=(0, 0.04, 1, 1))
        png = SHARED / "plots" / f"cuadrante_{body}.png"
        fig.savefig(png, dpi=150, facecolor="#fcfcfb")
        plt.close(fig)
        _say(f"→ {png}")
    else:
        _say("Sin votos todavía: el cuadrante se dibuja cuando el equipo vote (ver visual_votes_LEEME.md).")
    _say(f"→ {SHARED / f'quadrant_{body}.json'}")


@app.command()
def field(path: Path = typer.Argument(..., help="JSON de la caja (data/shared/field/<archivo>.json)"),
          lat: Optional[float] = typer.Option(None, help="Latitud si el GPS no tiene fix"),
          lon: Optional[float] = typer.Option(None, help="Longitud si el GPS no tiene fix")):
    """Lee la caja SEAL-BOX, combina con el satélite en ese GPS y da el % de analogía + 'satélite vs medido'."""
    import json

    from .explain.narrative import story
    from .fetch.earth_sample import earth_stats
    from .fetch.field import combine, parse_box
    from .fetch.pipeline import fetch_point
    from .schema import Site, Value

    box = parse_box(json.loads(path.read_text(encoding="utf-8")))
    for w in box["warnings"]:
        _say(f"AVISO: {w}")
    la, lo = (lat, lon) if lat is not None and lon is not None else (box["lat"], box["lon"])
    if la is None or lo is None:
        _say("No hay coordenadas: usa --lat y --lon.")
        raise typer.Exit(code=2)
    sat = fetch_point(la, lo)
    vals = combine(sat, box["measured"])
    features, profiles, targets = load_features(), load_profiles(), load_targets()
    sample = store.read_earth_sample() if store.EARTH_SAMPLE.exists() else []
    stats = earth_stats(sample, [f.id for f in features if f.kind == "numeric"])
    sid = path.stem
    site = Site(id=sid, name=f"Punto de campo {sid}", lat=la, lon=lo,
                coord=Value(value=None, unit="", status="measured", source="GPS de la caja"), role="candidate")
    res = []
    for t in targets:
        r = score_site_target(features, profiles, vals, t, stats)
        res.append({"target_id": t.id, "ifa": r["ifa"], "ifa_min": r["ifa_min"], "insufficient": r["insufficient"], "coverage": r["coverage"], "limiting": r["limiting"],
                    "story": story(site, t, r, vals, features)})
    res.sort(key=lambda r: -(r["ifa_min"] or -1))

    def num(v):
        return None if v is None or not v.usable() else v.value
    cmp = [
        {"id": "pressure", "satelite": num(sat.get("pressure")), "medido": num(box["measured"].get("pressure")), "unit": "kPa"},
        {"id": "rh", "satelite": num(sat.get("rh")), "medido": num(box["measured"].get("rh")), "unit": "%",
         "nota": "satélite = promedio anual; medido = un momento"},
        {"id": "uv_index", "satelite": num(sat.get("uv_index")), "medido": num(box["measured"].get("uv_index")), "unit": "1",
         "nota": "POWER = promedio de 24 h; caja = lectura puntual (y sin calibrar)"},
        {"id": "temperatura", "satelite": num(sat.get("t_mean")), "medido": num(box["context"].get("t_air")), "unit": "K",
         "nota": "no es la misma magnitud: promedio anual vs un momento"},
        {"id": "elevacion", "satelite": num(sat.get("_elevation")), "medido": num(box["context"].get("elevation_gps")), "unit": "m",
         "nota": "DEM GLO-30 vs GPS (el barómetro es derivado)"},
    ]
    out = {"source_file": path.name, "example": box["example"], "lat": la, "lon": lo, "warnings": box["warnings"],
           "confidence": box["confidence"], "comparison": cmp, "results": res,
           "context": store.dump_values(box["context"]), "values": store.dump_values(vals)}
    dst = path.with_name(f"{path.stem}_resultado.json")
    store.write_json(dst, out)
    _say("\nSatélite vs medido:")
    for c in cmp:
        _say(f"  {c['id']:12s} satélite {c['satelite'] if c['satelite'] is None else round(c['satelite'], 2)!s:>8}  "
             f"medido {c['medido'] if c['medido'] is None else round(c['medido'], 2)!s:>8} {c['unit']:4s} {c.get('nota', '')}")
    _say("\n% de analogía (IFA) del lugar:")
    for r in res[:6]:
        _say(f"  {r['target_id']:28s} {_fmt(r['ifa'], 0):>4} / 100  "
             f"(cobertura {100 * r['coverage']:.0f} %, limitante {r['limiting']})")
    _say(f"→ {dst}")


@app.command()
def serve(port: int = typer.Option(8765, help="Puerto local"),
          host: str = typer.Option("127.0.0.1", help="127.0.0.1 = solo esta compu")):
    """Servidor local para la página /estacion: recibe la medición de la caja y devuelve el % de analogía del motor."""
    import json
    import re
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from .export.shared import SHARED

    folder = SHARED / "field"
    folder.mkdir(parents=True, exist_ok=True)

    class H(BaseHTTPRequestHandler):
        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")   # Chrome: página https → localhost

        def do_OPTIONS(self):
            self.send_response(204); self._cors(); self.end_headers()

        def _json(self, code: int, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code); self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

        def do_POST(self):
            if not self.path.startswith("/field"):
                return self._json(404, {"error": "usa POST /field"})
            m = re.search(r"name=([A-Za-z0-9_-]{1,40})", self.path)
            name = m.group(1) if m else f"campo_{int(time.time())}"
            try:
                n = int(self.headers.get("Content-Length", 0))
                if n > 2_000_000:
                    return self._json(413, {"error": "demasiado grande"})
                box = json.loads(self.rfile.read(n).decode("utf-8"))
                path = folder / f"{name}.json"
                store.write_json(path, box)
                field(path=path, lat=None, lon=None)          # mismo cálculo que `python -m seal field`
                return self._json(200, json.loads((folder / f"{name}_resultado.json").read_text(encoding="utf-8")))
            except typer.Exit:
                return self._json(422, {"error": "sin coordenadas (el GPS no tenía señal)"})
            except Exception as e:  # se informa, no se inventa
                return self._json(500, {"error": f"{type(e).__name__}: {e}"})

        def log_message(self, fmt, *args):
            _say(f"[serve] {self.address_string()} {fmt % args}")

    _say(f"Motor escuchando en http://{host}:{port}/field  (Ctrl+C para salir)")
    ThreadingHTTPServer((host, port), H).serve_forever()


@app.command()
def terrain():
    """Relieve real (Copernicus DEM) de cada sitio para el juego → data/shared/terrain/."""
    from .export.shared import SHARED
    from .export.terrain import export_all as export_terrain

    t0 = time.time()
    sites = {s.id: s for s in load_sites()}
    out = SHARED / "terrain"
    meta = export_terrain(sites, store.read_site_values(), out)
    store.write_json(out / "game_sites.json", meta)
    ok = [s for s in meta["sites"] if not s.get("error")]
    _say(f"Relieve de {len(ok)} sitios en {time.time() - t0:.0f} s → {out}")
    for s in ok[:5]:
        _say(f"  {s['id']:24s} {s['h_min']:.0f}–{s['h_max']:.0f} m  bioma {s['biome']:9s} agua {s['water_level']}  cueva {s['cave']}")


@app.command()
def imagery(only: str = typer.Option("", help="ids separados por coma (vacío = todos)"),
            force: bool = typer.Option(False, help="volver a bajar aunque ya exista")):
    """Imagen satelital real (Sentinel-2, color verdadero) de la ventana de 3 km de cada sitio → data/shared/imagery/."""
    from concurrent.futures import ThreadPoolExecutor

    from .export.shared import SHARED
    from .export.terrain import SIZE_M
    from .fetch.imagery import fetch_site

    out = SHARED / "imagery"
    meta_path = out / "imagery.json"
    old = {m["id"]: m for m in (store.read_json(meta_path) or {}).get("sites", [])} if meta_path.exists() else {}
    vals = store.read_site_values()
    sites = [s for s in load_sites() if (not only or s.id in only.split(",")) and s.lat is not None and s.lon is not None]

    def one(s):
        if not force and s.id in old and not old[s.id].get("error") and (out / f"{s.id}.jpg").exists():
            return old[s.id]
        tm = vals.get(s.id, {}).get("t_mean")
        cold = bool(tm and tm.usable() and tm.value is not None and tm.value < 266)
        try:
            return fetch_site(s.id, s.lat, s.lon, SIZE_M, out, cold=cold)
        except Exception as e:  # red caída, etc.: se informa, no se inventa
            return {"id": s.id, "error": f"{type(e).__name__}: {str(e)[:200]}"}

    t0 = time.time()
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(one, sites))
    merged = {**old, **{r["id"]: r for r in res}}
    store.write_json(meta_path, {"source": "Copernicus Sentinel-2 L2A (ESA) vía Earth Search", "sites": list(merged.values())})
    ok = [r for r in res if not r.get("error")]
    _say(f"Imágenes: {len(ok)}/{len(res)} en {time.time() - t0:.0f} s → {out}")
    for r in res:
        if r.get("error"):
            _say(f"  ✗ {r['id']}: {r['error']}")


@app.command()
def photos(only: str = typer.Option("", help="ids separados por coma (vacío = todos)"),
           queries: str = typer.Option("", help="búsqueda por nombre: 'id=texto;id=texto' (reemplaza las candidatas)")):
    """Paso 1: candidatas de fotos reales (Wikimedia Commons, licencias libres) → data/shared/photos/candidates/."""
    from concurrent.futures import ThreadPoolExecutor

    from .export.shared import SHARED
    from .fetch.photos import candidates

    out = SHARED / "photos" / "candidates"
    qmap = dict(x.split("=", 1) for x in queries.split(";") if "=" in x)
    if qmap:
        only = ",".join(qmap)
    sites = [s for s in load_sites() if (not only or s.id in only.split(",")) and s.lat is not None]
    path = out / "candidates.json"
    old = {r["id"]: r for r in store.read_json(path)["sites"]} if path.exists() else {}

    def one(s):
        if not only and old.get(s.id, {}).get("candidates"):
            return old[s.id]  # ya tiene candidatas: no se vuelve a pedir
        try:
            return candidates(s.id, s.name, s.lat, s.lon, out, query=qmap.get(s.id))
        except Exception as e:
            return {"id": s.id, "error": f"{type(e).__name__}: {str(e)[:200]}", "candidates": []}

    with ThreadPoolExecutor(1) as ex:  # de a uno: Wikimedia limita la cantidad de pedidos
        res = list(ex.map(one, sites))
    store.write_json(path, {"sites": list({**old, **{r["id"]: r for r in res}}.values())})
    for r in res:
        _say(f"  {r['id']:28s} {len(r['candidates'])} candidatas" + (f"  ✗ {r['error']}" if r.get("error") else ""))


@app.command("photos-choose")
def photos_choose(picks: str = typer.Argument(..., help="sitio=índice separados por coma; índice -1 = ninguna")):
    """Paso 2: guarda la foto elegida (revisada por una persona) de cada sitio → data/shared/photos/<id>.jpg + photos.json."""
    import shutil

    from .export.shared import SHARED

    base = SHARED / "photos"
    cand = {r["id"]: r for r in store.read_json(base / "candidates" / "candidates.json")["sites"]}
    meta_path = base / "photos.json"
    meta = {m["id"]: m for m in (store.read_json(meta_path) or {}).get("sites", [])} if meta_path.exists() else {}
    for item in picks.split(","):
        sid, idx = item.split("=")
        idx = int(idx)
        if idx < 0:
            meta.pop(sid, None)
            continue
        c = cand[sid]["candidates"][idx]
        shutil.copy(base / "candidates" / c["file"], base / f"{sid}.jpg")
        meta[sid] = {"id": sid, "file": f"photos/{sid}.jpg", "title": c["title"], "artist": c["artist"], "license": c["license"],
                     "license_url": c["license_url"], "page": c["page"], "near": c["dist"] is not None, "status": "literature",
                     "source": "Wikimedia Commons (licencia libre); elegida y revisada por el equipo"}
    store.write_json(meta_path, {"source": "Wikimedia Commons", "sites": list(meta.values())})
    _say(f"Fotos elegidas: {len(meta)} → {meta_path}")


@app.command("all")
def run_all(n_earth: int = typer.Option(300, help="Puntos al azar de tierra firme")):
    """Todo de una vez: fetch → score → validate → export (usa la caché; NDVI y EMIT solo si ya están descargados)."""
    t0 = time.time()
    fetch(sites=PKG / "sites" / "sites.yaml", n_earth=n_earth, no_earth=False, no_dem_earth=False, modis=False)
    score(profile="todos", show="mars_global,mars_gale", top=10)
    validate()
    export(plots=True, plot_target="mars_global")
    _say(f"\nTODO LISTO en {(time.time() - t0) / 60:.1f} min.")


def main():
    if sys.platform == "win32":  # la consola de Windows usa otra página de códigos: sin esto salen "ÔåÆ" en vez de "→"
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        except Exception:
            pass
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    app()
