# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Esquemas de datos del motor.

`Value` es compatible con `Metric` del juego (referencias/juego/types.ts): mismos nombres de campo
(value, unit, range, status, source, retrieved, ref, note) más `sigma` (incertidumbre, CLAUDE.md §4)
y `classes` (para dimensiones de tipo conjunto, p. ej. clases de minerales).

Convención del motor para `range`: es SIEMPRE un intervalo [mín, máx] de la MISMA magnitud que `value`
(en un objetivo: "todo valor dentro de este rango cuenta como igual"). En el juego, `climate.dailyRange.range`
guarda [T mínima, T máxima]; al importar esos valores al motor, ese par va a la nota, no a `range`.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

Status = Literal["measured", "modeled", "literature", "derived", "estimated", "design", "gameplay", "pending"]
Role = Literal["candidate", "control_pos", "control_neg"]
Body = Literal["earth", "moon", "mars"]

#: Estados que pueden entrar al puntaje. `gameplay` y `pending` nunca entran.
SCORABLE: frozenset[str] = frozenset({"measured", "modeled", "literature", "derived", "estimated", "design"})


class Value(BaseModel):
    value: Optional[float] = None
    unit: str = ""
    status: Status = "pending"
    source: str = ""
    ref: Optional[str] = None
    retrieved: Optional[str] = None
    sigma: Optional[float] = None
    range: Optional[tuple[float, float]] = None
    note: Optional[str] = None
    classes: Optional[list[str]] = None  # solo para dimensiones kind="set"
    # Clases que el instrumento PUEDE detectar (p. ej. EMIT no ve sílice, cloruros ni basalto). Si existe, la similitud
    # de conjunto se calcula solo sobre clases_objetivo ∩ detectable: lo indetectable no cuenta como ausente.
    detectable: Optional[list[str]] = None

    @model_validator(mode="after")
    def _check(self) -> "Value":
        if self.range is not None and self.range[0] > self.range[1]:
            raise ValueError(f"range invertido: {self.range}")
        if self.status != "pending" and not self.source:
            raise ValueError("un Value que no es 'pending' necesita 'source'")
        return self

    @classmethod
    def pending(cls, unit: str = "", note: str = "") -> "Value":
        return cls(value=None, unit=unit, status="pending", source="", note=note or None)

    def usable(self) -> bool:
        """¿Puede entrar al puntaje? (no pending/gameplay y con número o clases)."""
        if self.status not in SCORABLE:
            return False
        if self.classes is not None:
            # una lista vacía solo es un dato si se sabe qué se podía detectar ("buscamos y no hay")
            return bool(self.classes) or self.detectable is not None
        if self.value is None and self.range is not None:  # objetivo dado solo como rango
            return True
        return self.value is not None and self.value == self.value  # descarta NaN

    def interval(self) -> tuple[float, float]:
        """[a, b] del objetivo; si es puntual, a = b = value."""
        if self.range is not None:
            return float(self.range[0]), float(self.range[1])
        assert self.value is not None
        return float(self.value), float(self.value)


class FeatureDef(BaseModel):
    id: str
    label: str
    unit: str
    kind: Literal["numeric", "binary", "set"] = "numeric"
    space: Literal["linear", "log", "log1p"] = "linear"
    tau: Optional[float] = None  # tolerancia en el espacio de `space` (décadas para log/log1p)
    tau_status: Status = "design"
    tau_note: str = ""
    sigma: Optional[float] = None  # incertidumbre por defecto del valor del sitio, en el espacio de `space` (estimated)
    sigma_note: str = ""
    analogable: bool = True  # False = brecha: la Tierra no puede acercarse; solo PO y percentil
    weight: float = 1.0  # peso en el IFA total (design)
    tier: Literal["T1", "T2", "T3"] = "T1"
    group: str = ""
    earth_source: str = ""
    note: str = ""

    @model_validator(mode="after")
    def _check(self) -> "FeatureDef":
        if self.kind == "numeric" and not (self.tau and self.tau > 0):
            raise ValueError(f"{self.id}: una dimensión numérica necesita tau > 0")
        return self


class Site(BaseModel):
    id: str
    name: str
    country: str = ""
    region: str = ""
    lat: Optional[float] = None
    lon: Optional[float] = None
    coord: Value = Field(default_factory=Value.pending)  # status/source de la coordenada
    role: Role = "candidate"
    analog_for: list[Literal["moon", "mars"]] = Field(default_factory=list)  # para control_pos: según su referencia
    refs: list[str] = Field(default_factory=list)
    rationale: str = ""
    values: dict[str, Value] = Field(default_factory=dict)

    def processable(self) -> bool:
        return self.lat is not None and self.lon is not None and self.coord.status != "pending"


class Target(BaseModel):
    id: str
    body: Body
    name: str
    group: str = ""
    gravity: Value = Field(default_factory=Value.pending)
    values: dict[str, Value] = Field(default_factory=dict)
    note: str = ""
    # Herencia: las dimensiones de `inherit_dims` que estén pending aquí se toman de `inherit_from`
    # (p. ej. la presión de Gusev desde mars_global); la nota del valor lo dice.
    inherit_from: Optional[str] = None
    inherit_dims: list[str] = Field(default_factory=list)


class Gate(BaseModel):
    feature: str
    min_s: float = Field(ge=0, le=1)


class Profile(BaseModel):
    id: str
    name: str
    weights: dict[str, float]
    gates: list[Gate] = Field(default_factory=list)
    note: str = ""
