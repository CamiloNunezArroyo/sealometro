# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Carga de los YAML del motor (features, perfiles, sitios, objetivos). Lee archivos: no va en score/."""
from __future__ import annotations

from pathlib import Path

import yaml

from .schema import FeatureDef, Profile, Site, Target

PKG = Path(__file__).resolve().parent


def _yaml(path: Path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def load_features(path: Path = PKG / "features.yaml") -> list[FeatureDef]:
    feats = [FeatureDef(**d) for d in _yaml(path)["features"]]
    ids = [f.id for f in feats]
    if len(ids) != len(set(ids)):
        raise ValueError("features.yaml tiene ids repetidos")
    return feats


def load_profiles(path: Path = PKG / "profiles.yaml") -> list[Profile]:
    return [Profile(**d) for d in _yaml(path)["profiles"]]


def load_sites(path: Path = PKG / "sites" / "sites.yaml") -> list[Site]:
    return [Site(**d) for d in (_yaml(path) or {}).get("sites", [])]


def load_targets(folder: Path = PKG / "targets") -> list[Target]:
    targets = [Target(**_yaml(p)) for p in sorted(folder.glob("*.yaml"))]
    return resolve_inheritance(targets)


def resolve_inheritance(targets: list[Target]) -> list[Target]:
    """Completa las dimensiones `inherit_dims` pending con el valor del objetivo padre (sin cambiar su status)."""
    by_id = {t.id: t for t in targets}
    out = []
    for t in targets:
        if t.inherit_from:
            parent = by_id[t.inherit_from]
            vals = dict(t.values)
            for k in t.inherit_dims:
                own, pv = vals.get(k), parent.values.get(k)
                if (own is None or not own.usable()) and pv is not None and pv.usable():
                    note = f"Heredado de {parent.id}: no hay valor propio del sitio. " + (pv.note or "")
                    vals[k] = pv.model_copy(update={"note": note.strip()})
            t = t.model_copy(update={"values": vals})
        out.append(t)
    return out
