# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Perfiles de misión (MOTOR_SIMILITUD.md §5.3). Funciones PURAS.

- Cada perfil es un IFA con sus propios pesos (design), solo sobre dimensiones analogables.
- Compuertas (ley del mínimo): si una compuerta tiene s < min_s, el perfil queda TOPADO en 100·s de esa
  compuerta ("un perfil no puede valer más que su compuerta más débil"). Si la compuerta está pending,
  no se aplica, pero se informa en `gates_unknown`.
- Factor limitante: la dimensión con peso y peor s.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping, Optional, Sequence

from ..schema import FeatureDef, Profile, Value
from .similarity import Kernel, ScoreResult, score


@dataclass
class ProfileResult:
    id: str
    score: Optional[float]  # 0..100, ya con compuertas aplicadas
    raw: Optional[float]  # 0..100, sin compuertas
    coverage: float
    limiting: Optional[str]
    gates_failed: list[str] = field(default_factory=list)
    gates_unknown: list[str] = field(default_factory=list)


@dataclass
class PairResult:
    """Resultado de un par sitio × objetivo: IFA total + perfiles."""
    total: ScoreResult
    profiles: dict[str, ProfileResult]


def check_profile(profile: Profile, features: Sequence[FeatureDef]) -> None:
    by_id = {f.id: f for f in features}
    for k in list(profile.weights) + [g.feature for g in profile.gates]:
        if k not in by_id:
            raise KeyError(f"perfil {profile.id}: dimensión desconocida {k!r}")
    brechas = [k for k in profile.weights if not by_id[k].analogable]
    if brechas:
        raise ValueError(f"perfil {profile.id}: usa brechas {brechas}; los perfiles solo usan dimensiones analogables")


#: Cobertura mínima (fracción del peso del perfil con datos) para dar un número. Decisión de diseño:
#: con menos, el perfil diría "rover 98" midiendo solo viento y albedo.
MIN_PROFILE_COVERAGE = 0.5


def score_profile(profile: Profile, features: Sequence[FeatureDef], site_values: Mapping[str, Value],
                  target_values: Mapping[str, Value], kernel_kind: Kernel = "gaussian",
                  weights: Optional[Mapping[str, float]] = None,
                  min_coverage: float = MIN_PROFILE_COVERAGE) -> ProfileResult:
    check_profile(profile, features)
    res = score(features, site_values, target_values, weights or profile.weights, kernel_kind, min_coverage=0.0)
    final = res.ifa if res.coverage >= min_coverage else None
    failed, unknown = [], []
    for g in profile.gates:
        s = res.dims[g.feature].s
        if s is None:
            unknown.append(g.feature)
        elif s < g.min_s:
            failed.append(g.feature)
            if final is not None:
                final = min(final, 100.0 * s)
    if unknown:  # compuerta sin dato → "no evaluable": no puede ganarle a un sitio que sí la pasó o la falló
        final = None
    return ProfileResult(profile.id, final, res.ifa_raw, res.coverage, res.limiting, failed, unknown)


def score_pair(features: Sequence[FeatureDef], profiles: Sequence[Profile], site_values: Mapping[str, Value],
               target_values: Mapping[str, Value], kernel_kind: Kernel = "gaussian") -> PairResult:
    total = score(features, site_values, target_values, None, kernel_kind)
    return PairResult(total, {p.id: score_profile(p, features, site_values, target_values, kernel_kind)
                              for p in profiles})
