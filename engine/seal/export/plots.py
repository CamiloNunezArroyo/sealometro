# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Gráficos para el pitch y la web en data/shared/plots/:
- radar_<sitio>.png: similitud s por dimensión contra un objetivo (top 5 sitios).
- mapa_parecidos.png / .html: PCA ajustado SOLO con la muestra terrestre (normalizada con su mediana y desvío);
  los sitios, Marte y la Luna se proyectan en ese plano. Lo que queda fuera de escala se marca en el borde.
- progreso_<sitio>.png: progreso hacia Marte (PO) por dimensión, con el percentil terrestre.
Paleta categórica validada (scripts de la skill dataviz): azul, naranja, aqua, amarillo; etiquetas directas.
"""
from __future__ import annotations

from pathlib import Path
from typing import Mapping, Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from ..schema import FeatureDef, Site, Target, Value  # noqa: E402
from ..score.similarity import transform  # noqa: E402

C = {"bolivia": "#2a78d6", "mars": "#eb6834", "otros": "#1baf7a", "moon": "#eda100", "earth": "#c9c8c1",
     "ink": "#0b0b0b", "ink2": "#52514e", "grid": "#e6e5e0", "surface": "#fcfcfb"}
FOOT = "Datos: NASA POWER, Copernicus DEM GLO-30 (ESA), fichas NASA NSSDC y literatura citada. Seal Hackathon Team, 2026."
# Sin t_mean: la Luna global no tiene temperatura media con fuente y quedaría fuera del mapa.
PCA_DIMS = ["t_range_diurnal", "precip", "soil_moisture", "albedo"]
LABEL_IDS = {"siloli", "laguna_verde_licancabur", "sol_de_manana", "laguna_colorada", "uyuni_incahuasi", "poopo",
             "atacama_yungay", "amazonia_manaus", "dry_valleys_wright", "valle_de_la_luna"}


def _style(ax):
    ax.set_facecolor(C["surface"])
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(C["ink2"])
    ax.tick_params(colors=C["ink2"], labelsize=9)
    ax.grid(color=C["grid"], linewidth=0.8)
    ax.set_axisbelow(True)


def _save(fig, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.text(0.01, 0.01, FOOT, fontsize=7, color=C["ink2"])
    fig.savefig(path, dpi=150, facecolor=C["surface"])
    plt.close(fig)
    return path


def radar(site: Site, target: Target, res: Mapping, features: Sequence[FeatureDef], out: Path) -> Path | None:
    F = {f.id: f for f in features}
    dims = [d for d in res["dims"] if d["s"] is not None and d["weight"] > 0]
    if len(dims) < 3:
        return None
    labels = [F[d["id"]].label for d in dims]
    vals = [d["s"] for d in dims]
    ang = np.linspace(0, 2 * np.pi, len(dims), endpoint=False).tolist()
    fig = plt.figure(figsize=(8.0, 6.4))
    ax = fig.add_subplot(111, polar=True)
    ax.tick_params(axis="x", pad=14)
    ax.set_facecolor(C["surface"])
    ax.plot(ang + ang[:1], vals + vals[:1], color=C["bolivia"] if site.country == "Bolivia" else C["otros"], linewidth=2)
    ax.fill(ang + ang[:1], vals + vals[:1], color=C["bolivia"] if site.country == "Bolivia" else C["otros"], alpha=0.15)
    ax.set_xticks(ang)
    ax.set_xticklabels(labels, fontsize=8, color=C["ink"])
    ax.set_ylim(0, 1)
    ax.set_yticks([0.25, 0.5, 0.75, 1.0])
    ax.set_yticklabels(["0,25", "0,5", "0,75", "1"], fontsize=7, color=C["ink2"])
    ax.grid(color=C["grid"])
    for a, v in zip(ang, vals):
        if v < 0.1:
            continue
        ax.text(a, max(v - 0.12, 0.06), f"{v:.2f}", fontsize=7, color=C["ink2"], ha="center")
    fig.suptitle(f"{site.name}\nparecido con {target.name}: IFA {res['ifa']:.0f}/100 (datos para el {100 * res['coverage']:.0f} % del peso)",
                 fontsize=10, color=C["ink"])
    fig.tight_layout(rect=(0, 0.04, 1, 0.95))
    return _save(fig, out / f"radar_{site.id}_{target.id}.png")


def progress_bars(site: Site, target: Target, res: Mapping, features: Sequence[FeatureDef], out: Path) -> Path | None:
    F = {f.id: f for f in features}
    dims = [d for d in res["dims"] if d.get("po") is not None]
    if not dims:
        return None
    dims.sort(key=lambda d: -d["po"])
    fig, ax = plt.subplots(figsize=(7.2, 0.55 * len(dims) + 1.6))
    _style(ax)
    y = np.arange(len(dims))
    ax.barh(y, [100 * d["po"] for d in dims], color=C["bolivia"], height=0.55)
    ax.set_yticks(y)
    ax.set_yticklabels([F[d["id"]].label + ("  [brecha]" if not d["analogable"] else "") for d in dims], fontsize=9, color=C["ink"])
    ax.invert_yaxis()
    ax.set_xlim(0, 150)
    ax.set_xticks([0, 25, 50, 75, 100])
    ax.set_xlabel("% del camino entre un lugar típico de la Tierra (mediana) y el objetivo", fontsize=9, color=C["ink2"])
    for i, d in enumerate(dims):
        pct = f" · percentil {d['pct_earth']:.0f}" if d.get("pct_earth") is not None else ""
        ax.text(100 * d["po"] + 1.5, i, f"{100 * d['po']:.0f} %{pct}", va="center", fontsize=8, color=C["ink2"])
    ax.set_title(f"{site.name}\nprogreso hacia {target.name} (percentil = % de la Tierra que está más lejos)",
                 fontsize=10, color=C["ink"], loc="left")
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    return _save(fig, out / f"progreso_{site.id}_{target.id}.png")


def _z(v: Value | None, f: FeatureDef, med: float, sd: float):
    if v is None or not v.usable():
        return None
    x = v.value if v.value is not None else (v.range[0] + v.range[1]) / 2
    t = transform(x, f.space)
    return None if t is None else (t - med) / sd


def similarity_map(features: Sequence[FeatureDef], earth: Sequence[Mapping[str, Value]], sites: Mapping[str, Site],
                   site_values: Mapping[str, Mapping[str, Value]], targets: Sequence[Target], out: Path) -> list[Path]:
    from sklearn.decomposition import PCA

    F = {f.id: f for f in features}
    dims = [d for d in PCA_DIMS if d in F]
    stats = {}
    for d in dims:
        xs = [transform(p[d].value, F[d].space) for p in earth if d in p and p[d].usable() and p[d].value is not None]
        xs = np.array([x for x in xs if x is not None])
        stats[d] = (float(np.median(xs)), float(xs.std()) or 1.0)

    def vec(vals):
        z = [_z(vals.get(d), F[d], *stats[d]) for d in dims]
        return None if any(v is None for v in z) else z

    E = np.array([v for v in (vec(p) for p in earth) if v is not None])
    pca = PCA(n_components=2).fit(E)
    pe = pca.transform(E)
    pts = []  # (label, x, y, group)
    for sid, vals in site_values.items():
        v = vec(vals)
        if v is not None:
            x, yv = pca.transform([v])[0]
            pts.append((sites[sid].name.split(" – ")[0], x, yv, "bolivia" if sites[sid].country == "Bolivia" else "otros", sid))
    tg = []
    for t in targets:
        if t.group != "global":
            continue
        v = vec(t.values)
        if v is not None:
            x, yv = pca.transform([v])[0]
            tg.append((t.name.split(" (")[0], x, yv, t.body))
    missing = [t.name for t in targets if t.group == "global" and vec(t.values) is None]

    allx = np.r_[pe[:, 0], [p[1] for p in pts]]
    ally = np.r_[pe[:, 1], [p[2] for p in pts]]
    lo_x, hi_x = np.percentile(allx, [0.5, 99.5])
    lo_y, hi_y = np.percentile(ally, [0.5, 99.5])
    pad_x, pad_y = (hi_x - lo_x) * 0.12, (hi_y - lo_y) * 0.12
    xl, yl = (lo_x - pad_x, hi_x + pad_x), (lo_y - pad_y, hi_y + pad_y)

    fig, ax = plt.subplots(figsize=(8.5, 6.4))
    _style(ax)
    ax.scatter(pe[:, 0], pe[:, 1], s=14, color=C["earth"], label=f"Tierra al azar (n = {len(pe)})", zorder=1)
    for grp, mk, name in [("otros", "s", "Otros sitios y controles"), ("bolivia", "o", "Bolivia")]:
        P = [p for p in pts if p[3] == grp]
        ax.scatter([p[1] for p in P], [p[2] for p in P], s=46, marker=mk, color=C[grp], edgecolor=C["surface"],
                   linewidth=1.5, label=name, zorder=3)
    for p in pts:
        if p[4] in LABEL_IDS:
            ax.annotate(p[0], (p[1], p[2]), xytext=(5, 3), textcoords="offset points", fontsize=7, color=C["ink"])
    for k, (name, x, yv, body) in enumerate(tg):
        cx, cy = float(np.clip(x, *xl)), float(np.clip(yv, *yl))
        off = (x, yv) != (cx, cy)
        ax.scatter([cx], [cy], s=170, marker="*", color=C[body], edgecolor=C["ink"], linewidth=0.8, zorder=4, clip_on=False)
        dist = np.hypot(x, yv)
        right = cx > np.mean(xl)
        ax.annotate(f"{name}" + (f" (fuera de escala: {dist:.0f} unidades del centro)" if off else ""),
                    (cx, cy), xytext=((0.6 if right else 0.06), 0.08 + 0.07 * k), textcoords="axes fraction", fontsize=8,
                    color=C["ink"], ha="right" if right else "left", va="bottom", fontweight="bold",
                    arrowprops=dict(arrowstyle="-", color=C["ink2"], linewidth=0.6))
    ax.set_xlim(*xl)
    ax.set_ylim(*yl)
    ev = pca.explained_variance_ratio_
    ax.set_xlabel(f"Componente 1 ({100 * ev[0]:.0f} % de la variación terrestre)", fontsize=9, color=C["ink2"])
    ax.set_ylabel(f"Componente 2 ({100 * ev[1]:.0f} %)", fontsize=9, color=C["ink2"])
    fig.suptitle("Mapa de parecidos: la Tierra, los sitios, Marte y la Luna en un mismo plano",
                 fontsize=11, color=C["ink"], x=0.07, ha="left", y=0.975)
    import textwrap
    sub = f"Dimensiones: {', '.join(F[d].label.lower() for d in dims)}; normalizadas con la estadística terrestre."
    if missing:
        sub += f" Sin ubicar (faltan datos): {', '.join(missing)}."
    fig.text(0.07, 0.915, "\n".join(textwrap.wrap(sub, 120)), fontsize=7.5, color=C["ink2"], va="bottom")
    ax.legend(loc="upper left", fontsize=8, frameon=True, facecolor=C["surface"], edgecolor=C["grid"])
    fig.subplots_adjust(left=0.07, right=0.97, top=0.9, bottom=0.12)
    files = [_save(fig, out / "mapa_parecidos.png")]

    try:  # versión interactiva (hover con el nombre)
        import plotly.graph_objects as go
        g = go.Figure()
        g.add_trace(go.Scatter(x=pe[:, 0], y=pe[:, 1], mode="markers", name="Tierra al azar",
                               marker=dict(color=C["earth"], size=6), hoverinfo="skip"))
        for grp, name in [("otros", "Otros sitios"), ("bolivia", "Bolivia")]:
            P = [p for p in pts if p[3] == grp]
            g.add_trace(go.Scatter(x=[p[1] for p in P], y=[p[2] for p in P], mode="markers", name=name, text=[p[0] for p in P],
                                   hovertemplate="%{text}<extra></extra>",
                                   marker=dict(color=C[grp], size=10, line=dict(color=C["surface"], width=2))))
        for name, x, yv, body in tg:
            g.add_trace(go.Scatter(x=[x], y=[yv], mode="markers+text", name=name, text=[name], textposition="top center",
                                   marker=dict(color=C[body], size=16, symbol="star", line=dict(color=C["ink"], width=1))))
        g.update_layout(title="Mapa de parecidos (PCA con la estadística terrestre)", plot_bgcolor=C["surface"],
                        paper_bgcolor=C["surface"], xaxis_title=f"Componente 1 ({100 * ev[0]:.0f} %)",
                        yaxis_title=f"Componente 2 ({100 * ev[1]:.0f} %)", font=dict(color=C["ink"]))
        h = out / "mapa_parecidos.html"
        g.write_html(h, include_plotlyjs="cdn")
        files.append(h)
    except Exception:
        pass
    return files
