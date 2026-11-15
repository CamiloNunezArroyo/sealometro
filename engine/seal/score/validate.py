# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Validación (MOTOR_SIMILITUD.md §5.5). Funciones PURAS.

- AUC ROC = probabilidad de que un análogo reconocido (control positivo) puntúe más que un punto al azar de tierra
  firme (Mann-Whitney; empates cuentan ½). 0,5 = azar; 1 = separa perfecto.
- Para que sea justo, la validación usa SOLO dimensiones satelitales (numéricas): los puntos al azar no tienen
  literatura de minerales ni de cuevas, y darles ese dato a los controles inflaría el AUC.
- "Dejando una fuera": AUC sin cada dimensión → qué dimensión hace el trabajo.
- Controles negativos: en qué percentil de la muestra al azar caen.
- ADVERTENCIA DE CIRCULARIDAD: elegimos las dimensiones sabiendo que los desiertos fríos y secos son análogos;
  un AUC alto muestra que el motor es coherente con esa idea, no que la descubra de la nada.
"""
from __future__ import annotations

from typing import Mapping, Optional, Sequence

import numpy as np

from ..schema import FeatureDef, Value
from .similarity import default_weights, score

CIRCULARITY = ("Advertencia: las dimensiones se eligieron sabiendo que los desiertos fríos y secos son análogos de Marte; "
               "un AUC alto muestra coherencia con esa idea, no un descubrimiento independiente.")


def auc(pos: Sequence[float], neg: Sequence[float]) -> Optional[float]:
    p, q = np.asarray(pos, float), np.asarray(neg, float)
    if len(p) == 0 or len(q) == 0:
        return None
    gt = (p[:, None] > q[None]).sum()
    eq = (p[:, None] == q[None]).sum()
    return float((gt + 0.5 * eq) / (len(p) * len(q)))


def bootstrap_auc(pos: Sequence[float], neg: Sequence[float], n: int = 1000, seed: int = 7) -> Optional[tuple[float, float]]:
    if len(pos) < 2 or len(neg) < 2:
        return None
    rng = np.random.default_rng(seed)
    p, q = np.asarray(pos), np.asarray(neg)
    vals = [auc(rng.choice(p, len(p)), rng.choice(q, len(q))) for _ in range(n)]
    return float(np.percentile(vals, 5)), float(np.percentile(vals, 95))


def satellite_weights(features: Sequence[FeatureDef]) -> dict[str, float]:
    return {k: v for k, v in default_weights(features).items()
            if next(f for f in features if f.id == k).kind == "numeric"}


def _scores(features, vals_list, target, weights) -> list[Optional[float]]:
    return [score(features, v, target, weights).ifa for v in vals_list]


def validate_target(features: Sequence[FeatureDef], target: Mapping[str, Value],
                    positives: Mapping[str, Mapping[str, Value]], randoms: Sequence[Mapping[str, Value]],
                    negatives: Mapping[str, Mapping[str, Value]], min_random_coverage: float = 0.9) -> dict:
    w = satellite_weights(features)
    usable = [k for k in w if target.get(k) is not None and target[k].usable()]
    # Justicia: solo dimensiones que la muestra al azar tiene (≥ 90 % de los puntos). Si los controles tuvieran un
    # dato que los puntos al azar no tienen (p. ej. NDVI de MODIS, solo para sitios), el AUC compararía cosas distintas.
    n_r = max(len(randoms), 1)
    dropped = [k for k in usable if sum(1 for r in randoms if r.get(k) is not None and r[k].usable()) / n_r < min_random_coverage]
    w = {k: w[k] for k in usable if k not in dropped}
    if not w:
        return {"auc": None, "note": "El objetivo no tiene dimensiones satelitales con datos."}
    pos = {k: s for k, s in zip(positives, _scores(features, positives.values(), target, w)) if s is not None}
    if not pos:
        return {"auc": None, "dims": list(w), "note": "Datos insuficientes del objetivo: ningún IFA publicable "
                "(cobertura < 40 % o solo simplificaciones)."}
    rnd = [s for s in _scores(features, randoms, target, w) if s is not None]
    neg = {k: s for k, s in zip(negatives, _scores(features, negatives.values(), target, w)) if s is not None}
    a = auc(list(pos.values()), rnd)
    loo = {}
    if len(w) > 1:
        for k in w:
            w2 = {kk: vv for kk, vv in w.items() if kk != k}
            p2 = [s for s in _scores(features, positives.values(), target, w2) if s is not None]
            r2 = [s for s in _scores(features, randoms, target, w2) if s is not None]
            loo[k] = auc(p2, r2)
    r_arr = np.asarray(rnd)
    return {
        "auc": a, "auc_ci90": bootstrap_auc(list(pos.values()), rnd), "n_pos": len(pos), "n_rand": len(rnd),
        "dims": list(w), "dims_dropped_no_random_data": dropped, "leave_one_out": loo,
        "positives": {k: {"ifa": s, "pct_random": float((r_arr < s).mean() * 100)} for k, s in pos.items()},
        "negatives": {k: {"ifa": s, "pct_random": float((r_arr < s).mean() * 100)} for k, s in neg.items()},
        "random_median": float(np.median(r_arr)) if len(r_arr) else None,
        "note": CIRCULARITY,
    }
