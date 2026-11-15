# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Fichas por sitio en 3 niveles de lectura, hechas SOLO con plantillas y números del motor (nada inventado).

- explorador (8–12 años): frases cortas, 1–2 números, comparaciones de "cada 100 lugares".
- cadete (13–17): números con unidad, progreso y percentil, uso posible, confianza.
- cientifico (18+): IFA, cobertura, s/PO/percentil por dimensión, robustez, estados de los datos y límites.
Reglas: sin adjetivos que los datos no respalden; si falta un dato, se dice que falta.
"""
from __future__ import annotations

from typing import Mapping, Optional, Sequence

from ..schema import FeatureDef, Site, Target, Value
from .gaps import ATMOSPHERE, gravity_pct

BODY = {"mars": "Marte", "moon": "la Luna"}
BODY_CAP = {"mars": "Marte", "moon": "La Luna"}
PROFILE_NAME = {"rover": "probar rovers y aterrizajes", "isru": "buscar agua y recursos (ISRU)",
                "astrobio": "estudiar dónde podría haber vida (astrobiología)",
                "habitat": "ensayar hábitats y operaciones humanas", "instrumentos": "probar instrumentos científicos"}
SIMPLE = {"t_mean": "la temperatura", "t_range_diurnal": "la diferencia de temperatura entre el día y la noche",
          "pressure": "el aire (presión)", "uv_index": "la radiación ultravioleta", "precip": "la lluvia",
          "soil_moisture": "la humedad del suelo", "rh": "la humedad del aire", "wind": "el viento",
          "albedo": "el color claro u oscuro del suelo", "slope_p50_100m": "las pendientes",
          "slope_p90_100m": "las pendientes más fuertes", "roughness_100m": "lo rugoso del terreno",
          "ndvi": "la vegetación", "cave_lava_tube": "las cuevas", "mineral_classes": "los minerales"}


def _fmt(v: Optional[Value]) -> str:
    if v is None or not v.usable():
        return "sin dato"
    if v.classes is not None:
        return ", ".join(v.classes) or "ninguna"
    if v.value is None and v.range is not None:
        return f"{v.range[0]:g}–{v.range[1]:g} {v.unit}".strip()
    x = v.value
    s = f"{x:.3g}" if abs(x) < 1e-3 or abs(x) >= 1e4 else (f"{x:.0f}" if abs(x) >= 100 else f"{x:.2g}" if abs(x) < 1 else f"{x:.1f}")
    unit = "" if v.unit == "1" else f" {v.unit}"
    rng = f" (rango {v.range[0]:g}–{v.range[1]:g})" if v.range is not None and v.value is not None else ""
    return f"{s}{unit}{rng}"


def _pct(x: Optional[float]) -> str:
    return "—" if x is None else f"{100 * x:.0f} %"


def story(site: Site, target: Target, res: Mapping, site_values: Mapping[str, Value],
          features: Sequence[FeatureDef]) -> dict[str, str]:
    F = {f.id: f for f in features}
    body = BODY[target.body]
    used = [d for d in res["dims"] if d["s"] is not None and d["weight"] > 0]
    best = sorted([d for d in used if d["s"] >= 0.5], key=lambda d: -d["s"])[:2]
    lim = res.get("limiting")
    # el percentil destacado es de una dimensión ANALOGABLE: en una brecha (presión) "más cerca que el 99 %" engaña
    pcts = [d for d in res["dims"] if d.get("pct_earth") is not None and d["analogable"]]
    top_pct = max(pcts, key=lambda d: d["pct_earth"]) if pcts else None
    pos = [d for d in res["dims"] if d.get("po") is not None and d["po"] > 0]
    top_po = max(pos, key=lambda d: d["po"]) if pos else None
    prof = {k: p for k, p in res["profiles"].items() if p.get("score") is not None}
    best_prof = max(prof.items(), key=lambda kv: kv[1]["score"]) if prof else None
    rob = res.get("robust") or {}
    gpct = gravity_pct(target)
    atm = ATMOSPHERE.get(target.body, {}).get("text")
    ifa, cov = res.get("ifa"), res.get("coverage", 0)

    # ---------------------------------------------------------------- explorador
    e = []
    if best:
        e.append(f"{site.name} se parece a {body} en {' y en '.join(SIMPLE[d['id']] for d in best)}.")
    else:
        e.append(f"Con los datos que tenemos, {site.name} no se parece mucho a {body} en ninguna medida.")
    if top_pct and top_pct["pct_earth"] >= 50:
        if top_pct["s"] is not None and top_pct["s"] >= 0.5:
            e.append(f"En {SIMPLE[top_pct['id']]}, se parece más a {body} que {top_pct['pct_earth']:.0f} de cada 100 lugares de la Tierra.")
        else:  # cerca para la Tierra, pero todavía lejos del objetivo: decir las dos cosas, sin contradecirse
            e.append(f"En {SIMPLE[top_pct['id']]}, está más cerca de {body} que {top_pct['pct_earth']:.0f} de cada 100 lugares "
                     f"de la Tierra, pero todavía está lejos.")
            if top_pct["id"] == lim:
                lim = None  # ya se dijo que está lejos en esa dimensión
    if lim and lim not in [d["id"] for d in best]:
        e.append(f"No se parece en {SIMPLE[lim]}.")
    ps, pt = site_values.get("pressure"), target.values.get("pressure")
    p_ratio = 100 * pt.interval()[0] / ps.value if ps is not None and ps.usable() and pt is not None and pt.usable() else None
    if p_ratio is not None:
        frac = "menos del 1 %" if p_ratio < 1 else f"cerca del {p_ratio:.0f} %"
        e.append(f"Pero el aire es muy distinto: allá la presión es {frac} de la de aquí.")
    if gpct is not None:
        e.append(f"En {body} pesarías solo {gpct:.0f} de cada 100 partes de lo que pesas aquí.")
    if atm:
        e.append(f"Y no podrías respirar: allá hay {atm}." if target.body == "mars" else "Y no hay aire para respirar.")

    # ---------------------------------------------------------------- cadete
    c = []
    if ifa is not None:
        c.append(f"Parecido físico (IFA) con {target.name}: {ifa:.0f} de 100, calculado con datos para el {100 * cov:.0f} % "
                 "de las comparaciones (el resto falta y no se cuenta).")
    else:
        c.append(f"Todavía no hay datos suficientes para dar un parecido total con {target.name} "
                 f"({res.get('insufficient') or 'faltan datos'}); abajo va lo que sí se puede comparar.")
    for d in best:
        f = F[d["id"]]
        c.append(f"Se parece en {f.label.lower()}: aquí {_fmt(site_values.get(d['id']))}; en {body} {_fmt(target.values.get(d['id']))}.")
    if lim:
        f = F[lim]
        c.append(f"Lo que menos se parece: {f.label.lower()} (aquí {_fmt(site_values.get(lim))}; en {body} {_fmt(target.values.get(lim))}).")
    if top_po:
        c.append(f"En {F[top_po['id']].label.lower()}, recorre el {_pct(top_po['po'])} del camino entre un lugar típico de la Tierra y {body}.")
    if best_prof:
        c.append(f"Su mejor uso posible según el motor: {PROFILE_NAME.get(best_prof[0], best_prof[0])} ({best_prof[1]['score']:.0f}/100).")
    if rob.get("p_top3") is not None:
        c.append(f"Confianza: en {rob.get('n', 2000)} escenarios con pesos y datos variados, queda entre los 3 primeros el "
                 f"{100 * rob['p_top3']:.0f} % de las veces.")
    if gpct is not None:
        c.append(f"La Tierra no puede imitar la gravedad: en {body} es el {gpct:.0f} % de la terrestre.")

    # ---------------------------------------------------------------- científico
    s = []
    imin = res.get("ifa_min")
    imin_txt = f"; IFA conservador (lo que falta cuenta como 0, usado para ordenar) = {imin:.1f}" if imin is not None else ""
    if ifa is not None:
        s.append(f"IFA = {ifa:.1f}/100 contra {target.name} (núcleo gaussiano, dimensiones analogables), "
                 f"cobertura {100 * cov:.0f} % del peso{imin_txt}.")
    else:
        s.append(f"IFA no publicado contra {target.name}: {res.get('insufficient')} (cobertura {100 * cov:.0f} %){imin_txt}.")
    rows = []
    for d in res["dims"]:
        if d["s"] is None:
            continue
        sv = site_values.get(d["id"])
        tag = "" if d["analogable"] else " [brecha, fuera del IFA]"
        extra = (f", PO {_pct(d['po'])}" if d.get("po") is not None else "") + \
                (f", percentil terrestre {d['pct_earth']:.0f}" if d.get("pct_earth") is not None else "")
        rows.append(f"{d['id']}: s = {d['s']:.2f} (sitio {_fmt(sv)} [{sv.status if sv else '—'}], objetivo "
                    f"{_fmt(target.values.get(d['id']))} [{target.values[d['id']].status}]){extra}{tag}")
    s.append("Por dimensión — " + "; ".join(rows) + ".")
    missing = [d["id"] for d in res["dims"] if d["skipped"] in ("site_pending", "target_pending") and d["weight"] > 0]
    if missing:
        s.append(f"Excluidas por falta de datos (pending): {', '.join(missing)}.")
    if lim:
        s.append(f"Factor limitante: {lim}.")
    profs = ", ".join(f"{k} {p['score']:.0f}" if p.get("score") is not None else f"{k} — (cobertura {100 * p['coverage']:.0f} %)"
                      for k, p in res["profiles"].items())
    s.append(f"Perfiles: {profs}.")
    if rob.get("median_rank") is not None:
        s.append(f"Robustez (Monte Carlo, N = {rob.get('n')}): puesto mediano {rob['median_rank']:.0f}, IC 90 % "
                 f"{rob['p90'][0]}–{rob['p90'][1]}, P(top-3) = {rob['p_top3']:.2f}.")
    n_est = sum(1 for d in used if target.values.get(d["id"]) is not None and target.values[d["id"]].status == "estimated")
    s.append(f"Límites: el clima de la Tierra viene de NASA POWER (celdas de ~50 km), el relieve de Copernicus GLO-30 (modelo de "
             f"superficie); {n_est} de los {len(used)} valores del objetivo usados son 'estimated'. Pesos y tolerancias son decisiones de diseño.")

    return {k: _comma(" ".join(v)) for k, v in (("explorador", e), ("cadete", c), ("cientifico", s))}


def _comma(text: str) -> str:
    """Decimales con coma (español): 3.6 → 3,6. Los ids con guion bajo no tienen puntos."""
    import re
    return re.sub(r"(\d)\.(\d)", r"\1,\2", text)
