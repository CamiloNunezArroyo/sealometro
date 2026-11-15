# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Brechas: lo que la Tierra NO puede imitar. Números de las fichas NSSDC (comprobadas el 2026-11-14).

- Gravedad: Tierra 9,820 m/s² (media), Marte 3,73, Luna 1,62.
- Atmósfera: Tierra 78,08 % N2, 20,95 % O2, 420 ppm CO2; Marte 95,1 % CO2, 2,59 % N2, 1,94 % Ar, 0,16 % O2;
  Luna: sin atmósfera (exosfera; presión nocturna 3×10⁻¹⁵ bar).
- Presión: la del sitio (POWER corregida) contra la del objetivo.
- Dosis de radiación ionizante: SIN fuente verificada todavía → no se da un número (pending).
"""
from __future__ import annotations

from typing import Mapping, Optional

from ..schema import Target, Value

EARTH_FACT = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html"
MARS_FACT = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html"
MOON_FACT = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html"
EARTH_G = Value(value=9.820, unit="m/s²", status="literature", source="NASA NSSDC Earth Fact Sheet (gravedad superficial media)",
                ref=EARTH_FACT, retrieved="2026-11-14")
ATMOSPHERE = {
    "earth": {"text": "78,08 % nitrógeno, 20,95 % oxígeno, 420 ppm de CO₂", "o2_pct": 20.95, "co2_pct": 0.042, "ref": EARTH_FACT},
    "mars": {"text": "95,1 % CO₂, 2,59 % nitrógeno, 1,94 % argón, 0,16 % oxígeno", "o2_pct": 0.16, "co2_pct": 95.1, "ref": MARS_FACT},
    "moon": {"text": "sin atmósfera (solo una exosfera tenue)", "o2_pct": None, "co2_pct": None, "ref": MOON_FACT},
}


def gaps(target: Target, site_values: Mapping[str, Value]) -> list[dict]:
    out: list[dict] = []
    g = target.gravity
    if g.usable():
        out.append({"id": "gravity", "earth": EARTH_G.value, "target": g.value, "unit": "m/s²",
                    "ratio": round(g.value / EARTH_G.value, 3), "text_key": "gap.gravity",
                    "ref": [EARTH_G.ref, g.ref], "status": "literature"})
    p_site, p_t = site_values.get("pressure"), target.values.get("pressure")
    if p_site is not None and p_site.usable() and p_t is not None and p_t.usable():
        out.append({"id": "pressure", "earth": p_site.value, "target": p_t.value, "unit": "kPa",
                    "ratio": p_t.value / p_site.value, "text_key": "gap.pressure", "status": p_site.status,
                    "ref": [p_site.ref, p_t.ref]})
    a_e, a_t = ATMOSPHERE["earth"], ATMOSPHERE.get(target.body)
    if a_t:
        out.append({"id": "atmosphere", "earth": a_e["text"], "target": a_t["text"], "unit": None,
                    "text_key": "gap.atmosphere", "status": "literature", "ref": [a_e["ref"], a_t["ref"]]})
    out.append({"id": "ionizing_dose", "earth": None, "target": None, "unit": "mSv/año", "text_key": "gap.dose",
                "status": "pending", "ref": [],
                "note": "Sin fuente verificada todavía (candidatas: MSL RAD, Hassler et al. 2014; LRO CRaTER). No se da un número."})
    return out


def gravity_pct(target: Target) -> Optional[float]:
    return 100 * target.gravity.value / EARTH_G.value if target.gravity.usable() else None
