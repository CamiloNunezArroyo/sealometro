# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Similitud por dimensión (MOTOR_SIMILITUD.md §5.1) y progreso / percentil terrestre (§5.2).

Funciones PURAS: no hacen red ni leen archivos.

Núcleos:
- "gaussian" (por defecto, §5.1): s = exp(-½ (d/τ)²), con d = distancia al rango [a, b] del objetivo.
- "linear" (compatible con el juego, referencias/juego/score.ts): s = max(0, 1 - d/τ). Con objetivo puntual,
  space="linear" reproduce `similarityLinear` y space="log" reproduce `similarityLog` (τ en décadas).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Literal, Mapping, Optional, Sequence

from ..schema import FeatureDef, Value

Kernel = Literal["gaussian", "linear"]
SkipReason = Literal["site_pending", "target_pending", "invalid", "unit_mismatch"]

SKIP_TEXT: dict[str, str] = {
    "site_pending": "falta el dato del sitio",
    "target_pending": "falta el valor del objetivo",
    "invalid": "valores no comparables",
    "unit_mismatch": "unidades distintas",
}


# ----------------------------------------------------------------------------- transformaciones
def transform(x: float, space: str) -> Optional[float]:
    """Lleva x al espacio de comparación. Devuelve None si no es válido (p. ej. log de 0)."""
    if x is None or not math.isfinite(x):
        return None
    if space == "linear":
        return float(x)
    if space == "log":
        return math.log10(x) if x > 0 else None
    if space == "log1p":
        return math.log10(1.0 + x) if x > -1 else None
    raise ValueError(f"espacio desconocido: {space}")


def distance_to_interval(x: float, a: float, b: float) -> float:
    """0 si a ≤ x ≤ b; si no, distancia al borde más cercano."""
    if a <= x <= b:
        return 0.0
    return min(abs(x - a), abs(x - b))


def kernel(d: float, tau: float, kind: Kernel = "gaussian") -> float:
    if kind == "gaussian":
        return math.exp(-0.5 * (d / tau) ** 2)
    if kind == "linear":
        return max(0.0, 1.0 - d / tau)
    raise ValueError(f"núcleo desconocido: {kind}")


# ----------------------------------------------------------------------------- una dimensión
@dataclass
class DimResult:
    id: str
    s: Optional[float]
    skipped: Optional[str] = None
    d: Optional[float] = None  # distancia en el espacio de la dimensión


def dim_similarity(feat: FeatureDef, site: Optional[Value], target: Optional[Value],
                   kernel_kind: Kernel = "gaussian") -> DimResult:
    if target is None or not target.usable():
        return DimResult(feat.id, None, "target_pending")
    if site is None or not site.usable():
        return DimResult(feat.id, None, "site_pending")
    if site.unit != target.unit or site.unit != feat.unit:
        return DimResult(feat.id, None, "unit_mismatch")

    if feat.kind == "set":
        t = set(target.classes or [])
        if site.detectable is not None:  # solo lo que el instrumento del sitio puede ver
            t &= set(site.detectable)
        if not t or site.classes is None:
            return DimResult(feat.id, None, "invalid")
        s = len(t & set(site.classes)) / len(t)
        return DimResult(feat.id, s, d=1.0 - s)

    if feat.kind == "binary":
        if site.value is None or target.value is None:
            return DimResult(feat.id, None, "invalid")
        s = 1.0 if round(site.value) == round(target.value) else 0.0
        return DimResult(feat.id, s, d=1.0 - s)

    a, b = target.interval()
    xt, at, bt = transform(site.value, feat.space), transform(a, feat.space), transform(b, feat.space)
    if xt is None or at is None or bt is None:
        return DimResult(feat.id, None, "invalid")
    d = distance_to_interval(xt, at, bt)
    return DimResult(feat.id, kernel(d, feat.tau, kernel_kind), d=d)


# ----------------------------------------------------------------------------- varias dimensiones
#: Decisiones de diseño (revisión del 2026-11-14): sin estas reglas, un sitio con pocas dimensiones le ganaba a uno con
#: muchas, y objetivos hechos solo de simplificaciones ("lluvia 0 por definición") producían rankings con P(top-3) 0,94.
MIN_IFA_COVERAGE = 0.4
FIRM = frozenset({"measured", "modeled", "literature", "derived"})  # 'estimated' y 'design' no cuentan como firmes


@dataclass
class ScoreResult:
    """IFA (0..100) sobre las dimensiones con peso; `coverage` = fracción del peso con datos (0..1).

    - ifa: renormalizado sobre lo que tiene datos (None si la cobertura < MIN_IFA_COVERAGE o si ningún valor del
      objetivo usado es firme). Responde "¿cuánto se parece en lo que sabemos?".
    - ifa_min: conservador, lo que falta cuenta como 0. Se usa para ORDENAR: un dato que falta no puede subir a un sitio.
    """
    ifa: Optional[float]
    coverage: float
    dims: dict[str, DimResult] = field(default_factory=dict)
    weights: dict[str, float] = field(default_factory=dict)
    limiting: Optional[str] = None  # dimensión con peso y peor s
    ifa_min: Optional[float] = None
    ifa_raw: Optional[float] = None  # renormalizado sin las reglas de suficiencia (transparencia)
    insufficient: Optional[str] = None  # razón si ifa es None


def default_weights(features: Iterable[FeatureDef]) -> dict[str, float]:
    """Pesos del IFA total: solo dimensiones analogables con peso > 0."""
    return {f.id: f.weight for f in features if f.analogable and f.weight > 0}


def score(features: Sequence[FeatureDef], site_values: Mapping[str, Value], target_values: Mapping[str, Value],
          weights: Optional[Mapping[str, float]] = None, kernel_kind: Kernel = "gaussian",
          min_coverage: float = MIN_IFA_COVERAGE) -> ScoreResult:
    """Calcula s por dimensión (todas, incluidas las brechas) y el IFA con renormalización de pesos.

    Una dimensión `pending` (en el sitio o en el objetivo) se excluye; su peso no cuenta como 0
    sino que se descuenta de la cobertura.
    """
    w = dict(default_weights(features) if weights is None else weights)
    by_id = {f.id: f for f in features}
    unknown = set(w) - set(by_id)
    if unknown:
        raise KeyError(f"pesos para dimensiones desconocidas: {sorted(unknown)}")
    dims = {f.id: dim_similarity(f, site_values.get(f.id), target_values.get(f.id), kernel_kind) for f in features}

    total_w = sum(v for v in w.values() if v > 0)
    ok = [(k, v) for k, v in w.items() if v > 0 and dims[k].s is not None]
    covered_w = sum(v for _, v in ok)
    num = sum(v * dims[k].s for k, v in ok)
    raw = 100.0 * num / covered_w if covered_w > 0 else None
    ifa_min = 100.0 * num / total_w if total_w > 0 else None
    cov = covered_w / total_w if total_w > 0 else 0.0
    limiting = min(ok, key=lambda kv: (dims[kv[0]].s, kv[0]))[0] if ok else None
    why = None
    if raw is None:
        why = "sin dimensiones con datos"
    elif cov < min_coverage:
        why = f"cobertura {100 * cov:.0f} % < {100 * min_coverage:.0f} %"
    elif not any(target_values[k].status in FIRM for k, _ in ok):
        why = "todos los valores usados del objetivo son simplificaciones (estimated/design)"
    return ScoreResult(ifa=None if why else raw, coverage=cov, dims=dims, weights=w, limiting=limiting,
                       ifa_min=ifa_min, ifa_raw=raw, insufficient=why)


def target_coverage(features: Sequence[FeatureDef], target_values: Mapping[str, Value],
                    weights: Optional[Mapping[str, float]] = None) -> float:
    """Fracción del peso del IFA (0..1) que el OBJETIVO tiene con datos (cota superior de la cobertura de un par)."""
    w = default_weights(features) if weights is None else weights
    total = sum(v for v in w.values() if v > 0)
    ok = sum(v for k, v in w.items() if v > 0 and target_values.get(k) is not None and target_values[k].usable())
    return ok / total if total > 0 else 0.0


# ----------------------------------------------------------------------------- §5.2 progreso y percentil
def _nearest_in_interval(x: float, a: float, b: float) -> float:
    return min(max(x, a), b)


def progress(x: float, target: Value, earth_median: float, space: str) -> Optional[float]:
    """PO = clip((x − m_T) / (t − m_T), 0, 1) en el espacio de la dimensión.

    t = punto del rango del objetivo más cercano a la mediana terrestre (el "comienzo" del objetivo).
    Si x ya está dentro del rango o más allá, PO = 1. None si no se puede calcular.
    """
    if not target.usable():
        return None
    a, b = target.interval()
    xt, mt = transform(x, space), transform(earth_median, space)
    at, bt = transform(a, space), transform(b, space)
    if None in (xt, mt, at, bt):
        return None
    tt = _nearest_in_interval(mt, at, bt)
    if tt == mt:  # la mediana terrestre ya está dentro del objetivo
        return None
    return min(1.0, max(0.0, (xt - mt) / (tt - mt)))


def percentile_earth(x: float, target: Value, earth_values: Sequence[float], space: str) -> Optional[float]:
    """% de la muestra terrestre que está MÁS LEJOS del rango del objetivo que x (0..100).

    Los empates cuentan la mitad, para que un sitio igual a toda la muestra quede en 50.
    """
    if not target.usable():
        return None
    a, b = target.interval()
    xt, at, bt = transform(x, space), transform(a, space), transform(b, space)
    if None in (xt, at, bt):
        return None
    dx = distance_to_interval(xt, at, bt)
    ds = [distance_to_interval(t, at, bt) for t in (transform(e, space) for e in earth_values) if t is not None]
    if not ds:
        return None
    farther = sum(1 for d in ds if d > dx)
    ties = sum(1 for d in ds if d == dx)
    return 100.0 * (farther + 0.5 * ties) / len(ds)
