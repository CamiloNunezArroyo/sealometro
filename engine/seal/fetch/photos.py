# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
"""Fotos REALES de cada lugar desde Wikimedia Commons (solo licencias libres: CC0, dominio público, CC BY, CC BY-SA).

1) `candidates`: busca fotos geolocalizadas a ≤ 10 km del sitio (y, si no hay, por nombre), descarta mapas, logos,
   carteles, interiores, etc., y guarda hasta 4 candidatas (1280 px) con autor y licencia.
2) Una persona revisa las candidatas (que muestren el paisaje del lugar y SIN personas reconocibles: regla de menores
   de la competencia) y elige una por sitio con `choose`.
La atribución (autor, licencia, enlace) se muestra junto a cada foto en la web.
"""
from __future__ import annotations

import html
import re
import time
from pathlib import Path

from .http import session

API = "https://commons.wikimedia.org/w/api.php"
OK_LICENSE = re.compile(r"^(cc0|public domain|pd|cc[ -]by(-sa)?([ -][0-9.]+)?([ -][a-z]+)?)", re.I)
BAD_LICENSE = re.compile(r"nc|nd", re.I)
BAD_WORDS = re.compile(r"\b(map|mapa|karte|logo|sign|cartel|letrero|hotel|selfie|portrait|retrato|people|gente|family|familia|"
                       r"car|auto|bus|truck|cami[oó]n|plan|diagram|flag|bandera|menu|interior|museum|museo|church|iglesia|"
                       r"restaurant|bed|room|ticket|poster|screenshot|stamp|coin|drawing|dibujo|painting|chart|graph)\b", re.I)


def _strip(s: str | None) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def _get(url: str, params: dict | None = None):
    """GET amable con Wikimedia: pausa entre pedidos y reintento si pide esperar (429)."""
    for attempt in range(6):
        time.sleep(1.2)
        r = session().get(url, params=params, timeout=90)
        if r.status_code == 429:
            time.sleep(float(r.headers.get("Retry-After", 0) or 0) or 10 * (attempt + 1))
            continue
        r.raise_for_status()
        return r
    r.raise_for_status()
    return r


def _query(params: dict) -> list[dict]:
    base = {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|extmetadata|size|mime",
            "iiurlwidth": 1280, "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Categories|ImageDescription|GPSLatitude|GPSLongitude"}
    r = _get(API, {**base, **params})
    pages = (r.json().get("query") or {}).get("pages") or {}
    out = []
    for pg in pages.values():
        ii = (pg.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata") or {}
        out.append({
            "title": pg.get("title", ""), "mime": ii.get("mime"), "w": ii.get("width", 0), "h": ii.get("height", 0),
            "thumb": ii.get("thumburl"), "page": ii.get("descriptionurl"),
            "license": _strip((md.get("LicenseShortName") or {}).get("value")), "license_url": (md.get("LicenseUrl") or {}).get("value", ""),
            "artist": _strip((md.get("Artist") or {}).get("value"))[:120], "categories": (md.get("Categories") or {}).get("value", ""),
            "desc": _strip((md.get("ImageDescription") or {}).get("value"))[:200],
            "dist": float(pg["coordinates"][0].get("dist", 0)) if pg.get("coordinates") else None,
        })
    return out


def _good(c: dict) -> bool:
    if c["mime"] != "image/jpeg" or not c["thumb"] or c["w"] < 1100 or c["h"] < 600:
        return False
    if not (1.15 <= c["w"] / max(1, c["h"]) <= 2.4):     # paisaje
        return False
    lic = c["license"]
    if not OK_LICENSE.match(lic) or BAD_LICENSE.search(lic.replace("CC", "")):
        return False
    return not BAD_WORDS.search(c["title"] + " " + c["desc"])


def _score(c: dict) -> float:
    cats = c["categories"].lower()
    q = 3 if "featured pictures" in cats else 2 if "quality images" in cats else 1 if "valued images" in cats else 0
    d = c["dist"] if c["dist"] is not None else 8000
    return q * 3 - d / 2500 + min(c["w"], 4000) / 4000


def candidates(site_id: str, name: str, lat: float, lon: float, out_dir: Path, k: int = 4, query: str | None = None) -> dict:
    if query:  # búsqueda por nombre indicada por una persona (cuando las geolocalizadas no sirven)
        found = _query({"generator": "search", "gsrsearch": f"{query} filetype:bitmap", "gsrnamespace": 6, "gsrlimit": 50})
        good = [c for c in found if _good(c)]
    else:
        found = _query({"generator": "geosearch", "ggscoord": f"{lat}|{lon}", "ggsradius": 10000, "ggslimit": 80,
                        "ggsnamespace": 6, "prop": "imageinfo|coordinates", "colimit": 80})
        good = [c for c in found if _good(c)]
    if len(good) < 2 and not query:  # sin fotos geolocalizadas: por nombre
        q = re.sub(r"[–—(].*$", "", name).strip()
        good += [c for c in _query({"generator": "search", "gsrsearch": f'"{q}" filetype:bitmap', "gsrnamespace": 6, "gsrlimit": 40}) if _good(c)]
    good.sort(key=_score, reverse=True)
    seen, picked = set(), []
    for c in good:
        if c["title"] in seen:
            continue
        seen.add(c["title"])
        picked.append(c)
        if len(picked) >= k:
            break
    out_dir.mkdir(parents=True, exist_ok=True)
    for i, c in enumerate(picked):
        r = _get(c["thumb"])
        (out_dir / f"{site_id}_{i}.jpg").write_bytes(r.content)
        c["file"] = f"{site_id}_{i}.jpg"
    return {"id": site_id, "candidates": picked, "n_found": len(found), "n_good": len(good)}
