# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Robustez del ranking por Monte Carlo (MOTOR_SIMILITUD.md §5.4). Función PURA (numpy, sin red ni archivos).

En cada uno de N escenarios (semilla fija):
  1. pesos ~ Dirichlet(α · w / Σw)          (α = ALPHA_TOTAL: decisión de diseño; ~±40 % relativo en un peso de 0,1)
  2. valor del sitio ~ Normal(x, σ)          (en el espacio de la dimensión; σ del Value o, si no hay, el σ por
                                              defecto de features.yaml, que es 'estimated')
  3. distancia al RANGO del objetivo [a, b], igual que el IFA (0 si cae dentro). (Antes se muestreaba un punto
     dentro del rango: eso calculaba otro índice que el del ranking; se corrigió tras la revisión del 2026-11-14.)
El IFA de cada escenario es el CONSERVADOR (ifa_min: lo que falta cuenta como 0), el mismo con que se ordena el ranking.
Las dimensiones de conjunto/binarias (minerales, cuevas) no tienen ruido: solo cambian sus pesos.
Salida por sitio: mediana del puesto, intervalo de 90 % (p5–p95) y P(top-3).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Optional, Sequence

import numpy as np

from ..schema import FeatureDef, Value
from .similarity import Kernel, default_weights, dim_similarity, transform

ALPHA_TOTAL = 50.0
N_DEFAULT = 2000
SEED = 20261114


@dataclass
class RobustResult:
    median_rank: Optional[float]
    p90: Optional[tuple[int, int]]
    p_top3: float
    ifa_median: Optional[float]


def _sigma_t(v: Value, f: FeatureDef) -> float:
    if v.sigma is not None and v.value is not None:
        if f.space == "linear":
            return float(v.sigma)
        if f.space == "log" and v.value > 0:
            return float(v.sigma) / (v.value * math.log(10))
        if f.space == "log1p":
            return float(v.sigma) / ((1 + v.value) * math.log(10))
    return float(f.sigma or 0.0)


def monte_carlo(features: Sequence[FeatureDef], sites: Mapping[str, Mapping[str, Value]], target: Mapping[str, Value],
                weights: Optional[Mapping[str, float]] = None, n: int = N_DEFAULT, seed: int = SEED,
                alpha_total: float = ALPHA_TOTAL, kernel_kind: Kernel = "gaussian") -> dict[str, RobustResult]:
    w = dict(default_weights(features) if weights is None else weights)
    feats = [f for f in features if w.get(f.id, 0) > 0]
    ids = list(sites)
    S, D = len(ids), len(feats)
    if S == 0 or D == 0:
        return {}
    rng = np.random.default_rng(seed)

    mask = np.zeros((S, D), bool)
    det = np.full((S, D), np.nan)  # s fija (dims no numéricas)
    xt = np.full((S, D), np.nan)
    sg = np.zeros((S, D))
    at = np.full(D, np.nan)
    bt = np.full(D, np.nan)
    tau = np.ones(D)
    numeric = np.array([f.kind == "numeric" for f in feats])
    for j, f in enumerate(feats):
        tv = target.get(f.id)
        if f.kind == "numeric" and tv is not None and tv.usable():
            a, b = tv.interval()
            at[j], bt[j], tau[j] = transform(a, f.space), transform(b, f.space), f.tau
        for i, sid in enumerate(ids):
            sv = sites[sid].get(f.id)
            r = dim_similarity(f, sv, tv, kernel_kind)
            if r.s is None:
                continue
            mask[i, j] = True
            if f.kind == "numeric":
                xt[i, j] = transform(sv.value, f.space)
                sg[i, j] = _sigma_t(sv, f)
            else:
                det[i, j] = r.s

    w0 = np.array([w[f.id] for f in feats], float)
    W = rng.dirichlet(alpha_total * w0 / w0.sum(), size=n)  # (n, D)
    X = xt[None] + sg[None] * rng.standard_normal((n, S, D))  # (n, S, D)
    d = np.maximum(0.0, np.maximum(at - X, X - bt))  # distancia al intervalo [a, b] (nan si el objetivo es pending)
    sim = np.exp(-0.5 * (d / tau) ** 2) if kernel_kind == "gaussian" else np.clip(1 - d / tau, 0, 1)
    sim = np.where(numeric[None, None, :], sim, det[None])
    sim = np.where(mask[None], np.nan_to_num(sim), 0.0)
    Wm = W[:, None, :] * mask[None]
    has = Wm.sum(-1) > 0
    ifa = np.where(has, 100 * (Wm * sim).sum(-1) / W.sum(-1)[:, None], np.nan)  # (n, S): conservador

    valid = np.isfinite(ifa)
    order = np.argsort(-np.where(valid, ifa, -np.inf), axis=1)
    ranks = np.empty_like(order)
    ranks[np.arange(n)[:, None], order] = np.arange(1, S + 1)[None]
    out = {}
    for i, sid in enumerate(ids):
        if not valid[:, i].any():
            out[sid] = RobustResult(None, None, 0.0, None)
            continue
        rk = ranks[valid[:, i], i]
        out[sid] = RobustResult(float(np.median(rk)), (int(np.percentile(rk, 5)), int(np.percentile(rk, 95))),
                                float((rk <= 3).mean()), float(np.nanmedian(ifa[:, i])))
    return out
