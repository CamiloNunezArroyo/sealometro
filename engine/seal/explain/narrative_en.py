# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""English version of the 3-level site stories (same rules as narrative.py: templates + engine numbers only).

Levels: explorer (8–12), cadet (13–17), scientist (18+). Keys stay 'explorador' / 'cadete' / 'cientifico' so the web can
switch language without changing the data shape.
"""
from __future__ import annotations

from typing import Mapping, Optional, Sequence

from ..schema import FeatureDef, Site, Target, Value
from .gaps import gravity_pct

BODY = {"mars": "Mars", "moon": "the Moon"}
ATM_EN = {"mars": "95.1% CO₂, 2.59% nitrogen, 1.94% argon and only 0.16% oxygen", "moon": None}
TARGET_EN = {
    "mars_global": "Mars (global values)", "mars_gale": "Gale crater (Curiosity)", "mars_jezero": "Jezero crater (Perseverance)",
    "mars_gusev_homeplate": "Gusev – Home Plate (Spirit)", "mars_meridiani": "Meridiani Planum (Opportunity)",
    "mars_ice_arcadia": "Arcadia Planitia (buried ice)", "moon_global": "the Moon (global values)",
    "moon_artemis_plateau": "Artemis III – plateau/plain regions", "moon_artemis_massif": "Artemis III – massif regions",
    "moon_artemis_rim": "Artemis III – crater-rim regions", "moon_shackleton_degerlache": "Shackleton–de Gerlache ridge",
    "moon_lava_tube_pit": "Mare Tranquillitatis pit",
}
LABEL_EN = {"t_mean": "mean temperature", "t_range_diurnal": "day–night temperature range", "pressure": "air pressure",
            "uv_index": "UV index", "precip": "yearly rain", "soil_moisture": "surface soil moisture",
            "rh": "relative humidity", "wind": "mean wind", "albedo": "surface albedo",
            "slope_p50_100m": "median slope", "slope_p90_100m": "steep slopes (90th percentile)",
            "roughness_100m": "terrain roughness", "ndvi": "vegetation (NDVI)", "cave_lava_tube": "caves or lava tubes",
            "mineral_classes": "minerals"}
SIMPLE_EN = {"t_mean": "temperature", "t_range_diurnal": "the difference between day and night temperature",
             "pressure": "air pressure", "uv_index": "ultraviolet light", "precip": "rain",
             "soil_moisture": "how wet the ground is", "rh": "air humidity", "wind": "wind",
             "albedo": "how light or dark the ground is", "slope_p50_100m": "its slopes",
             "slope_p90_100m": "its steepest slopes", "roughness_100m": "how rough the ground is",
             "ndvi": "plants", "cave_lava_tube": "caves", "mineral_classes": "minerals"}
PROFILE_EN = {"rover": "testing rovers and landings", "isru": "looking for water and resources (ISRU)",
              "astrobio": "studying where life could exist (astrobiology)",
              "habitat": "testing habitats and human operations", "instrumentos": "testing science instruments"}
CLASS_EN = {"sulfato": "sulfate", "cloruro": "chloride", "arcilla": "clay", "carbonato": "carbonate",
            "silice_hidratada": "hydrated silica", "oxido_fe": "iron oxide", "basalto": "basalt", "anortosita": "anorthosite"}


def _fmt(v: Optional[Value]) -> str:
    if v is None or not v.usable():
        return "no data"
    if v.classes is not None:
        return ", ".join(CLASS_EN.get(c, c) for c in v.classes) or "none"
    if v.value is None and v.range is not None:
        return f"{v.range[0]:g}–{v.range[1]:g} {v.unit}".strip()
    x = v.value
    s = f"{x:.3g}" if abs(x) < 1e-3 or abs(x) >= 1e4 else (f"{x:.0f}" if abs(x) >= 100 else f"{x:.2g}" if abs(x) < 1 else f"{x:.1f}")
    unit = "" if v.unit == "1" else f" {v.unit.replace('mm/año', 'mm/yr').replace('grados', 'degrees')}"
    rng = f" (range {v.range[0]:g}–{v.range[1]:g})" if v.range is not None and v.value is not None else ""
    return f"{s}{unit}{rng}"


def _pct(x: Optional[float]) -> str:
    return "—" if x is None else f"{100 * x:.0f}%"


def story_en(site: Site, target: Target, res: Mapping, site_values: Mapping[str, Value],
             features: Sequence[FeatureDef]) -> dict[str, str]:
    body = BODY[target.body]
    tname = TARGET_EN.get(target.id, target.name)
    used = [d for d in res["dims"] if d["s"] is not None and d["weight"] > 0]
    best = sorted([d for d in used if d["s"] >= 0.5], key=lambda d: -d["s"])[:2]
    lim = res.get("limiting")
    pcts = [d for d in res["dims"] if d.get("pct_earth") is not None and d["analogable"]]
    top_pct = max(pcts, key=lambda d: d["pct_earth"]) if pcts else None
    pos = [d for d in res["dims"] if d.get("po") is not None and d["po"] > 0]
    top_po = max(pos, key=lambda d: d["po"]) if pos else None
    prof = {k: p for k, p in res["profiles"].items() if p.get("score") is not None}
    best_prof = max(prof.items(), key=lambda kv: kv[1]["score"]) if prof else None
    rob = res.get("robust") or {}
    gpct = gravity_pct(target)
    ifa, cov = res.get("ifa"), res.get("coverage", 0)

    e = []
    if best:
        e.append(f"{site.name} is like {body} in {' and in '.join(SIMPLE_EN[d['id']] for d in best)}.")
    else:
        e.append(f"With the data we have, {site.name} is not very similar to {body} in any measure.")
    if top_pct and top_pct["pct_earth"] >= 50:
        if top_pct["s"] is not None and top_pct["s"] >= 0.5:
            e.append(f"In {SIMPLE_EN[top_pct['id']]}, it is closer to {body} than {top_pct['pct_earth']:.0f} out of 100 places on Earth.")
        else:
            e.append(f"In {SIMPLE_EN[top_pct['id']]}, it is closer to {body} than {top_pct['pct_earth']:.0f} out of 100 places "
                     "on Earth, but it is still far away.")
            if top_pct["id"] == lim:
                lim = None
    if lim and lim not in [d["id"] for d in best]:
        e.append(f"It is not alike in {SIMPLE_EN[lim]}.")
    ps, pt = site_values.get("pressure"), target.values.get("pressure")
    p_ratio = 100 * pt.interval()[0] / ps.value if ps is not None and ps.usable() and pt is not None and pt.usable() else None
    if p_ratio is not None:
        frac = "less than 1%" if p_ratio < 1 else f"about {p_ratio:.0f}%"
        e.append(f"But the air is very different: the pressure there is {frac} of the pressure here.")
    if gpct is not None:
        e.append(f"On {body.replace('the ', '')} you would weigh only {gpct:.0f} parts out of 100 of what you weigh here.")
    if ATM_EN.get(target.body):
        e.append(f"And you could not breathe: the air there is {ATM_EN[target.body]}.")
    elif target.body == "moon":
        e.append("And there is no air to breathe.")

    c = []
    if ifa is not None:
        c.append(f"Physical similarity (IFA) with {tname}: {ifa:.0f} out of 100, computed with data for {100 * cov:.0f}% "
                 "of the comparisons (the rest is missing and is not counted).")
    else:
        c.append(f"There is not enough data yet for an overall similarity with {tname}; below is what can be compared.")
    for d in best:
        c.append(f"Alike in {LABEL_EN[d['id']]}: here {_fmt(site_values.get(d['id']))}; on {body.replace('the ', '')} "
                 f"{_fmt(target.values.get(d['id']))}.")
    if lim:
        c.append(f"Least alike: {LABEL_EN[lim]} (here {_fmt(site_values.get(lim))}; there {_fmt(target.values.get(lim))}).")
    if top_po:
        c.append(f"In {LABEL_EN[top_po['id']]}, it covers {_pct(top_po['po'])} of the way from a typical place on Earth to {body}.")
    if best_prof:
        c.append(f"Best possible use according to the engine: {PROFILE_EN.get(best_prof[0], best_prof[0])} ({best_prof[1]['score']:.0f}/100).")
    if rob.get("p_top3") is not None:
        c.append(f"Confidence: in {rob.get('n', 2000)} scenarios with varied weights and data, it ranks in the top 3 "
                 f"{100 * rob['p_top3']:.0f}% of the time.")
    if gpct is not None:
        c.append(f"Earth cannot copy gravity: on {body.replace('the ', '')} it is {gpct:.0f}% of Earth's.")

    s = []
    imin = res.get("ifa_min")
    imin_txt = f"; conservative IFA (missing data counts as 0, used for ranking) = {imin:.1f}" if imin is not None else ""
    if ifa is not None:
        s.append(f"IFA = {ifa:.1f}/100 against {tname} (Gaussian kernel, analog dimensions), coverage {100 * cov:.0f}% of the weight{imin_txt}.")
    else:
        s.append(f"IFA not published against {tname}: insufficient data (coverage {100 * cov:.0f}%){imin_txt}.")
    rows = []
    for d in res["dims"]:
        if d["s"] is None:
            continue
        sv = site_values.get(d["id"])
        tag = "" if d["analogable"] else " [gap, outside the IFA]"
        extra = (f", PO {_pct(d['po'])}" if d.get("po") is not None else "") + \
                (f", Earth percentile {d['pct_earth']:.0f}" if d.get("pct_earth") is not None else "")
        rows.append(f"{d['id']}: s = {d['s']:.2f} (site {_fmt(sv)} [{sv.status if sv else '—'}], target "
                    f"{_fmt(target.values.get(d['id']))} [{target.values[d['id']].status}]){extra}{tag}")
    s.append("Per dimension — " + "; ".join(rows) + ".")
    missing = [d["id"] for d in res["dims"] if d["skipped"] in ("site_pending", "target_pending") and d["weight"] > 0]
    if missing:
        s.append(f"Excluded for missing data (pending): {', '.join(missing)}.")
    if lim:
        s.append(f"Limiting factor: {lim}.")
    profs = ", ".join(f"{k} {p['score']:.0f}" if p.get("score") is not None else f"{k} — (coverage {100 * p['coverage']:.0f}%)"
                      for k, p in res["profiles"].items())
    s.append(f"Profiles: {profs}.")
    if rob.get("median_rank") is not None:
        s.append(f"Robustness (Monte Carlo, N = {rob.get('n')}): median rank {rob['median_rank']:.0f}, 90% interval "
                 f"{rob['p90'][0]}–{rob['p90'][1]}, P(top-3) = {rob['p_top3']:.2f}.")
    n_est = sum(1 for d in used if target.values.get(d["id"]) is not None and target.values[d["id"]].status == "estimated")
    s.append(f"Limits: Earth climate comes from NASA POWER (~50 km cells), relief from Copernicus GLO-30 (a surface model); "
             f"{n_est} of the {len(used)} target values used are 'estimated'. Weights and tolerances are design decisions.")
    return {"explorador": " ".join(e), "cadete": " ".join(c), "cientifico": " ".join(s)}
