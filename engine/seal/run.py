# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Orquestación de `score`: une valores de sitios, objetivos, estadística terrestre y funciones puras de score/."""
from __future__ import annotations

from typing import Mapping, Sequence

from .schema import FeatureDef, Profile, Target, Value
from .score.profiles import score_pair
from .score.similarity import percentile_earth, progress


def score_site_target(features: Sequence[FeatureDef], profiles: Sequence[Profile], site_vals: Mapping[str, Value],
                      target: Target, stats: Mapping[str, dict]) -> dict:
    pr = score_pair(features, profiles, site_vals, target.values)
    dims = []
    for f in features:
        d = pr.total.dims[f.id]
        sv, tv = site_vals.get(f.id), target.values.get(f.id)
        po = pct = None
        if f.kind == "numeric" and sv is not None and sv.usable() and tv is not None and tv.usable() and f.id in stats:
            po = progress(sv.value, tv, stats[f.id]["median"], f.space)
            pct = percentile_earth(sv.value, tv, stats[f.id]["values"], f.space)
        dims.append({"id": f.id, "s": d.s, "skipped": d.skipped, "po": po, "pct_earth": pct,
                     "analogable": f.analogable, "weight": pr.total.weights.get(f.id, 0.0)})
    return {
        "ifa": pr.total.ifa, "ifa_min": pr.total.ifa_min, "ifa_raw": pr.total.ifa_raw,
        "insufficient": pr.total.insufficient, "coverage": pr.total.coverage, "limiting": pr.total.limiting,
        "profiles": {k: {"score": p.score, "raw": p.raw, "coverage": p.coverage, "limiting": p.limiting,
                         "gates_failed": p.gates_failed, "gates_unknown": p.gates_unknown}
                     for k, p in pr.profiles.items()},
        "dims": dims,
    }


def merge_site_values(fetched: Mapping[str, Value], literature: Mapping[str, Value]) -> dict[str, Value]:
    """Lo de sites.yaml (literatura/medido) manda sobre lo descargado cuando existe y es usable."""
    out = dict(fetched)
    for k, v in literature.items():
        if v.usable() or k not in out:
            out[k] = v
    return out
