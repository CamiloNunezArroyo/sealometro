# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Modo descubrimiento (MOTOR_SIMILITUD.md §5.7): rejilla sobre Bolivia y el Altiplano → IFA por celda → mapa de calor.

Decisiones (dichas en el mapa):
- La unidad del mapa es la CELDA de NASA POWER (0,5°): cada punto de la rejilla es el centro de una celda y se usa
  el valor de la celda SIN corrección por elevación (no hay un "sitio" puntual al que corregir).
- Sin DEM en la rejilla: contra los objetivos actuales el terreno no entra al IFA (ningún objetivo tiene pendientes
  con fuente). Las 10 mejores celdas sí reciben el análisis completo (DEM + POWER corregido) en su centro.
- Es un mapa de PARECIDO CLIMÁTICO: el motor todavía no ve minerales (ver validación, AUC 0,34).
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from typing import Mapping, Sequence

import numpy as np

from .fetch.power import fetch_power, power_values
from .schema import FeatureDef, Site, Target
from .score.similarity import score

# Bolivia (≈ -22,9 a -9,7; -69,6 a -57,5) + Altiplano de Chile, Perú y Argentina
BBOX = {"lat": (-26.0, -9.5), "lon": (-71.5, -57.5)}


def grid(step: float = 0.5, bbox: Mapping = BBOX) -> list[tuple[float, float]]:
    from global_land_mask import globe
    lats = np.arange(bbox["lat"][0] + step / 2, bbox["lat"][1], step)
    lons = np.arange(bbox["lon"][0] + step / 2, bbox["lon"][1], step)
    return [(round(float(a), 4), round(float(o), 4)) for a in lats for o in lons if globe.is_land(a, o)]


def fetch_grid(points: Sequence[tuple[float, float]], workers: int = 4, progress=None) -> list[dict]:
    def one(i_pt):
        i, (la, lo) = i_pt
        raw = fetch_power(la, lo)
        vals = power_values(raw) if not raw.get("error") else {}
        if progress:
            progress(i)
        return {"lat": la, "lon": lo, "cell_elev": raw.get("elevation"), "values": vals, "error": raw.get("error")}

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(one, enumerate(points)))


def grid_weights(features: Sequence[FeatureDef], cells: Sequence[dict], target: Target) -> dict[str, float]:
    """Mismas dimensiones para todas las celdas: las que el objetivo tiene y ≥ 90 % de las celdas tienen (como en
    la validación). Las celdas solo traen clima de POWER, así que el mapa es de parecido CLIMÁTICO."""
    from .score.similarity import default_weights
    n = max(len(cells), 1)
    return {k: w for k, w in default_weights(features).items()
            if target.values.get(k) is not None and target.values[k].usable()
            and sum(1 for c in cells if c["values"].get(k) is not None and c["values"][k].usable()) >= 0.9 * n}


def score_grid(features: Sequence[FeatureDef], cells: Sequence[dict], target: Target) -> list[dict]:
    w = grid_weights(features, cells, target)
    out = []
    for c in cells:
        r = score(features, c["values"], target.values, w)
        out.append({"lat": c["lat"], "lon": c["lon"], "cell_elev": c["cell_elev"], "ifa": r.ifa,
                    "coverage": r.coverage, "limiting": r.limiting,
                    "dims": {k: d.s for k, d in r.dims.items() if d.s is not None and r.weights.get(k, 0) > 0},
                    "values": {k: v.value for k, v in c["values"].items() if not k.startswith("_") and v.usable()}})
    return out


NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"


def country_rings(iso3: str = "BOL") -> list[list[tuple[float, float]]]:
    """Anillos exteriores (lon, lat) del país, de Natural Earth 1:110m (dominio público). Cacheado."""
    from .fetch import cache
    from .fetch.http import get_json

    def load():
        gj = get_json("naturalearth", NE_URL, {}, timeout=120)
        for f in gj["features"]:
            p = f["properties"]
            if iso3 in (p.get("ISO_A3"), p.get("ADM0_A3")):
                g = f["geometry"]
                polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
                return {"rings": [poly[0] for poly in polys]}
        return {"error": f"{iso3} no está en Natural Earth"}

    d = cache.cached("naturalearth", {"iso3": iso3, "scale": "110m"}, load)
    return [[(x, y) for x, y in r] for r in d.get("rings", [])]


def in_country(lat: float, lon: float, rings) -> bool:
    from matplotlib.path import Path as MPath
    return any(MPath(r).contains_point((lon, lat)) for r in rings)


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def nearest_site(lat: float, lon: float, sites: Sequence[Site]) -> tuple[str | None, float | None]:
    best = min(((s.id, haversine_km((lat, lon), (s.lat, s.lon))) for s in sites if s.processable()),
               key=lambda x: x[1], default=(None, None))
    return best


def heatmap_html(scored: Sequence[dict], sites: Sequence[Site], target: Target, step: float, path, note: str) -> None:
    import plotly.graph_objects as go
    ok = [c for c in scored if c["ifa"] is not None]
    hover = [f"{c['lat']:.2f}, {c['lon']:.2f}<br>IFA {c['ifa']:.0f}/100 (cobertura {100 * c['coverage']:.0f} %)<br>"
             f"limitante: {c['limiting']}<br>lluvia {c['values'].get('precip', float('nan')):.0f} mm/año · "
             f"humedad del suelo {c['values'].get('soil_moisture', float('nan')):.2f}<br>celda POWER a {c['cell_elev'] or 0:.0f} m"
             for c in ok]
    ramp = [[0, "#f0efec"], [0.25, "#cde2fb"], [0.5, "#86b6ef"], [0.75, "#2a78d6"], [1, "#0d366b"]]
    fig = go.Figure()
    fig.add_trace(go.Scattergeo(lat=[c["lat"] for c in ok], lon=[c["lon"] for c in ok], mode="markers",
                                marker=dict(symbol="square", size=11, color=[c["ifa"] for c in ok], colorscale=ramp,
                                            cmin=0, cmax=max(c["ifa"] for c in ok), line=dict(width=0),
                                            colorbar=dict(title="IFA")),
                                text=hover, hovertemplate="%{text}<extra></extra>", name="celdas (0,5°)"))
    S = [s for s in sites if s.processable() and BBOX["lat"][0] <= s.lat <= BBOX["lat"][1] and BBOX["lon"][0] <= s.lon <= BBOX["lon"][1]]
    fig.add_trace(go.Scattergeo(lat=[s.lat for s in S], lon=[s.lon for s in S], mode="markers+text",
                                text=[s.name.split(" – ")[0] for s in S], textposition="top center",
                                textfont=dict(size=10, color="#0b0b0b"),
                                marker=dict(size=7, color="#eb6834", line=dict(color="#fcfcfb", width=1.5)),
                                name="sitios evaluados", hovertemplate="%{text}<extra></extra>"))
    fig.update_geos(lataxis_range=list(BBOX["lat"]), lonaxis_range=list(BBOX["lon"]), showcountries=True,
                    countrycolor="#52514e", showcoastlines=True, coastlinecolor="#52514e", showland=True,
                    landcolor="#fcfcfb", showocean=True, oceancolor="#e6eef7", projection_type="mercator")
    fig.update_layout(title=dict(text=f"¿Dónde está {target.name.split(' (')[0]} en Bolivia y el Altiplano? "
                                      f"Parecido climático (IFA) por celda de {step}°<br><sup>{note}</sup>"),
                      height=760, margin=dict(l=10, r=10, t=90, b=10), paper_bgcolor="#fcfcfb",
                      legend=dict(orientation="h", y=-0.02))
    fig.write_html(path, include_plotlyjs="cdn")


PNG_LABELS = {"siloli", "laguna_verde_licancabur", "sol_de_manana", "uyuni_incahuasi", "coipasa", "poopo", "sajama",
              "valle_de_la_luna", "atacama_yungay", "ciudad_santa_cruz", "torotoro_umajalanta", "laguna_colorada"}


def heatmap_png(scored: Sequence[dict], sites: Sequence[Site], target: Target, step: float, path, note: str,
                rings=None) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap
    ok = [c for c in scored if c["ifa"] is not None]
    cmap = LinearSegmentedColormap.from_list("azul", ["#f0efec", "#cde2fb", "#86b6ef", "#2a78d6", "#0d366b"])
    fig, ax = plt.subplots(figsize=(8, 8.6))
    ax.set_facecolor("#e6eef7")
    for c in ok:
        ax.add_patch(plt.Rectangle((c["lon"] - step / 2, c["lat"] - step / 2), step, step,
                                   color=cmap(c["ifa"] / max(x["ifa"] for x in ok)), linewidth=0))
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(0, max(x["ifa"] for x in ok)))
    fig.colorbar(sm, ax=ax, shrink=0.6, label="IFA (parecido climático, 0–100)")
    S = [s for s in sites if s.processable() and BBOX["lat"][0] <= s.lat <= BBOX["lat"][1] and BBOX["lon"][0] <= s.lon <= BBOX["lon"][1]]
    for r in rings or []:
        xs, ys = zip(*r)
        ax.plot(xs, ys, color="#0b0b0b", linewidth=1.2, zorder=2, label="Bolivia (Natural Earth 1:110m)" if r is rings[0] else None)
    ax.scatter([s.lon for s in S], [s.lat for s in S], s=22, color="#eb6834", edgecolor="#fcfcfb", linewidth=1.2, zorder=3,
               label="sitios evaluados")
    for s in S:
        if s.id in PNG_LABELS:
            ax.annotate(s.name.split(" – ")[0], (s.lon, s.lat), xytext=(4, 3), textcoords="offset points", fontsize=7)
    ax.legend(loc="upper right", fontsize=7.5, frameon=True, facecolor="#fcfcfb")
    ax.set_xlim(*BBOX["lon"])
    ax.set_ylim(*BBOX["lat"])
    ax.set_aspect(1 / math.cos(math.radians(-17.5)))
    ax.set_xlabel("longitud", fontsize=9, color="#52514e")
    ax.set_ylabel("latitud", fontsize=9, color="#52514e")
    ax.set_title(f"¿Dónde está {target.name.split(' (')[0]} en Bolivia y el Altiplano?\nParecido climático (IFA) por celda de {step}°",
                 fontsize=11, loc="left")
    import textwrap
    foot = "\n".join(textwrap.wrap(note, 150)) + "\nDatos: NASA POWER (climatología); frontera: Natural Earth. Seal Hackathon Team, 2026. El mar queda en gris."
    fig.text(0.01, 0.01, foot, fontsize=6.5, color="#52514e")
    fig.tight_layout(rect=(0, 0.06, 1, 1))
    fig.savefig(path, dpi=150, facecolor="#fcfcfb")
    plt.close(fig)
