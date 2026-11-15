// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Alrededor REAL del lugar al aire libre: OpenStreetMap (Overpass API) y relieve (Open-Meteo, Copernicus DEM GLO-90).
// Con el GPS se piden los edificios (con su altura si OSM la tiene), árboles, zonas verdes, canchas, calles, muros,
// rejas y agua en un radio de ~200 m, y se pasan a metros locales (x = este, z = sur) para dibujarlos en su lugar.
// Datos: © OpenStreetMap contributors, licencia ODbL (https://www.openstreetmap.org/copyright).
// Lo que OSM no trae (altura de muchos edificios, colores, texturas) se completa con valores de juego y se dice así.
// parseOsm, pitchAt, surfaceFloor y elevAt son puras (pruebas en osm.test.ts); fetchOsm/fetchElevation usan la red.
import { fromLocal, insidePolygon, polygonArea, toLocal, type Floor } from "../game/core/arena";

type P2 = [number, number];
export interface OsmBuilding { poly: P2[]; h: number; hFrom: "height" | "levels" | "default"; name?: string; kind: string }
export interface OsmPitch { poly: P2[]; kind: "pitch" | "stadium" | "track"; sport?: string; surface?: string; name?: string; area: number }
export interface OsmScene {
  buildings: OsmBuilding[]; trees: P2[]; green: { poly: P2[]; kind: string }[]; pitches: OsmPitch[];
  roads: { line: P2[]; width: number; kind: string }[]; barriers: { line: P2[]; kind: string; h: number }[]; water: P2[][];
  counts: { buildings: number; withHeight: number; trees: number; pitches: number; roads: number; green: number; barriers: number; water: number };
}
type LatLon = { lat: number; lon: number };
interface OsmEl { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: LatLon[]; members?: { role: string; geometry?: LatLon[] }[] }
export interface OsmJson { elements: OsmEl[] }

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";
export const ELEV_ATTRIBUTION = "Open-Meteo Elevation API (Copernicus DEM GLO-90)";

export function overpassQuery(lat: number, lon: number, r = 200): string {
  const a = `(around:${Math.round(r)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:25];(
way["building"]${a};relation["building"]${a};
node["natural"="tree"]${a};way["natural"~"^(tree_row|wood|scrub|water)$"]${a};
way["leisure"~"^(pitch|stadium|park|garden|track|playground)$"]${a};relation["leisure"~"^(pitch|stadium|park)$"]${a};
way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green)$"]${a};
way["highway"]${a};way["barrier"~"^(wall|fence|hedge|retaining_wall)$"]${a};way["waterway"]${a};
);out tags geom;`;
}

const ROAD_W: Record<string, number> = { motorway: 14, trunk: 12, primary: 10, secondary: 8, tertiary: 7, residential: 6, unclassified: 6, living_street: 5, service: 4, pedestrian: 5, footway: 2, path: 1.5, cycleway: 2, steps: 2, track: 3 };
const BUILD_H: Record<string, number> = { house: 6, residential: 6, detached: 6, apartments: 12, church: 12, cathedral: 18, commercial: 9, retail: 6, office: 12, school: 8, university: 10, hospital: 12, garage: 3, garages: 3, shed: 3, roof: 4, kiosk: 3, hut: 3 };
/** Altura de un edificio: etiqueta height, o pisos × 3 m, o un valor típico por tipo (de juego). */
export function buildingHeight(t: Record<string, string>): { h: number; hFrom: OsmBuilding["hFrom"] } {
  const hv = parseFloat((t.height ?? "").replace(",", "."));
  if (Number.isFinite(hv) && hv > 0.5 && hv < 400) return { h: hv, hFrom: "height" };
  const lv = parseFloat(t["building:levels"] ?? "");
  if (Number.isFinite(lv) && lv > 0 && lv < 100) return { h: lv * 3 + 1, hFrom: "levels" };
  return { h: BUILD_H[t.building] ?? 7, hFrom: "default" };
}
/** Tipo de piso del juego según la etiqueta `surface` de una cancha OSM (si la tiene). */
export function surfaceFloor(surface?: string): Floor | null {
  if (!surface) return null;
  if (/grass|artificial_turf/.test(surface)) return "pasto";
  if (/sand/.test(surface)) return "arena";
  if (/dirt|earth|clay|ground|gravel|compacted|tartan/.test(surface)) return "tierra";
  if (/concrete|asphalt|paved|paving_stones|acrylic|wood/.test(surface)) return "cemento";
  return null;
}

/** OSM (lat/lon) → metros locales alrededor de (lat0, lon0), restando `off` (el centro del mapa del juego). */
export function parseOsm(j: OsmJson, lat0: number, lon0: number, off: P2 = [0, 0], maxR = 650): OsmScene {
  const L = (g: LatLon): P2 => { const [x, z] = toLocal(lat0, lon0, g.lat, g.lon); return [x - off[0], z - off[1]]; };
  const far = (p: P2) => Math.hypot(p[0] + off[0], p[1] + off[1]) > maxR;
  const ring = (g?: LatLon[]): P2[] | null => {
    if (!g || g.length < 3) return null;
    const p = g.map(L);
    if (p.length > 3 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
    const cx = p.reduce((s, q) => s + q[0], 0) / p.length, cz = p.reduce((s, q) => s + q[1], 0) / p.length;
    return far([cx, cz]) ? null : p;
  };
  const line = (g?: LatLon[]): P2[] | null => {
    if (!g || g.length < 2) return null;
    const p = g.map(L).filter((q) => !far(q));          // las calles largas se recortan al radio
    return p.length >= 2 ? p : null;
  };
  const polys = (e: OsmEl): P2[][] => e.type === "way" ? [ring(e.geometry)].filter(Boolean) as P2[][]
    : (e.members ?? []).filter((m) => m.role === "outer").map((m) => ring(m.geometry)).filter(Boolean) as P2[][];
  const s: OsmScene = { buildings: [], trees: [], green: [], pitches: [], roads: [], barriers: [], water: [], counts: { buildings: 0, withHeight: 0, trees: 0, pitches: 0, roads: 0, green: 0, barriers: 0, water: 0 } };
  for (const e of j.elements ?? []) {
    const t = e.tags ?? {};
    if (e.type === "node") {
      if (t.natural === "tree" && e.lat !== undefined && e.lon !== undefined) { const p = L({ lat: e.lat, lon: e.lon }); if (!far(p)) s.trees.push(p); }
      continue;
    }
    if (t.building && t.building !== "no") {
      const { h, hFrom } = buildingHeight(t);
      for (const poly of polys(e)) s.buildings.push({ poly, h, hFrom, name: t.name, kind: t.building });
      continue;
    }
    if (t.leisure === "pitch" || t.leisure === "stadium" || t.leisure === "track") {
      for (const poly of polys(e)) s.pitches.push({ poly, kind: t.leisure as OsmPitch["kind"], sport: t.sport, surface: t.surface, name: t.name, area: polygonArea(poly) });
      if (t.barrier === "wall" || t.barrier === "fence") for (const poly of polys(e)) s.barriers.push({ line: [...poly, poly[0]], kind: t.barrier, h: t.barrier === "wall" ? 2.5 : 2 });
      continue;
    }
    if (t.natural === "water" || t.waterway === "riverbank") { s.water.push(...polys(e)); continue; }
    if (t.waterway) { const l = line(e.geometry); if (l) s.roads.push({ line: l, width: t.waterway === "river" ? 12 : 3, kind: "waterway" }); continue; }
    if (t.natural === "tree_row") {               // fila de árboles: un árbol cada ~7 m sobre la línea
      const l = line(e.geometry);
      if (l) for (let i = 0; i + 1 < l.length; i++) {
        const d = Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]), n = Math.max(1, Math.round(d / 7));
        for (let k = 0; k < n; k++) s.trees.push([l[i][0] + ((l[i + 1][0] - l[i][0]) * k) / n, l[i][1] + ((l[i + 1][1] - l[i][1]) * k) / n]);
      }
      continue;
    }
    const greenKind = t.leisure ?? t.landuse ?? t.natural;
    if (greenKind && /^(park|garden|playground|grass|forest|meadow|recreation_ground|village_green|wood|scrub)$/.test(greenKind)) {
      for (const poly of polys(e)) s.green.push({ poly, kind: greenKind });
      continue;
    }
    if (t.barrier) { const l = line(e.geometry); if (l) s.barriers.push({ line: l, kind: t.barrier, h: t.barrier === "fence" ? 1.8 : t.barrier === "hedge" ? 1.4 : 2.2 }); continue; }
    if (t.highway) { const l = line(e.geometry); if (l) s.roads.push({ line: l, width: ROAD_W[t.highway] ?? 4, kind: t.highway }); }
  }
  s.counts = { buildings: s.buildings.length, withHeight: s.buildings.filter((b) => b.hFrom !== "default").length, trees: s.trees.length, pitches: s.pitches.length,
    roads: s.roads.filter((r) => r.kind !== "waterway").length, green: s.green.length, barriers: s.barriers.length, water: s.water.length + s.roads.filter((r) => r.kind === "waterway").length };
  return s;
}
/** Cancha/estadio OSM que contiene el punto (la más chica: la cancha antes que el estadio que la rodea). */
export function pitchAt(s: OsmScene, x = 0, z = 0): OsmPitch | null {
  const inside = s.pitches.filter((p) => p.poly.length >= 3 && insidePolygon(p.poly, x, z));
  inside.sort((a, b) => (a.kind === "stadium" ? 1 : 0) - (b.kind === "stadium" ? 1 : 0) || a.area - b.area);
  return inside[0] ?? null;
}

// ------------------------------------------------------------------ relieve alrededor (Open-Meteo)
export interface ElevRing { center: number; radii: number[]; nA: number; rel: Float32Array }   // rel[k * nA + a]: altura relativa al centro (m)
export const ELEV_RADII = [60, 120, 250, 450, 800], ELEV_ANGLES = 12;
/** Puntos (x, z) donde se pide la altura: centro + anillos (orden: centro, luego radio por radio, ángulo por ángulo). */
export function elevSamples(): P2[] {
  const out: P2[] = [[0, 0]];
  for (const r of ELEV_RADII) for (let a = 0; a < ELEV_ANGLES; a++) { const t = (a / ELEV_ANGLES) * 2 * Math.PI; out.push([Math.cos(t) * r, Math.sin(t) * r]); }
  return out;
}
export function elevRingFrom(values: number[]): ElevRing | null {
  if (values.length !== 1 + ELEV_RADII.length * ELEV_ANGLES || !values.every(Number.isFinite)) return null;
  return { center: values[0], radii: ELEV_RADII, nA: ELEV_ANGLES, rel: Float32Array.from(values.slice(1), (v) => v - values[0]) };
}
/** Altura relativa (m) en (x, z) interpolando el anillo (lineal en radio y ángulo). Puro. */
export function elevAt(e: ElevRing, x: number, z: number): number {
  const r = Math.hypot(x, z), th = ((Math.atan2(z, x) / (2 * Math.PI)) * e.nA + e.nA) % e.nA;
  const a0 = Math.floor(th), a1 = (a0 + 1) % e.nA, fa = th - a0;
  const at = (k: number) => e.rel[k * e.nA + a0] * (1 - fa) + e.rel[k * e.nA + a1] * fa;
  if (r <= e.radii[0]) return at(0) * (r / e.radii[0]);
  for (let k = 0; k + 1 < e.radii.length; k++) if (r <= e.radii[k + 1]) { const f = (r - e.radii[k]) / (e.radii[k + 1] - e.radii[k]); return at(k) * (1 - f) + at(k + 1) * f; }
  return at(e.radii.length - 1);
}

// ------------------------------------------------------------------ red (navegador)
// servidor principal y espejos públicos de Overpass (si uno está caído o saturado se prueba el siguiente)
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const mem = new Map<string, unknown>();
function cached<T>(key: string): T | null {
  if (mem.has(key)) return mem.get(key) as T;
  try { const v = localStorage.getItem(key); if (v) { const j = JSON.parse(v) as T; mem.set(key, j); return j; } } catch { /* sin almacenamiento */ }
  return null;
}
function store(key: string, v: unknown) {
  mem.set(key, v);
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* muy grande o bloqueado: queda en memoria */ }
}
async function timed(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(t); }
}
/** Pide a Overpass todo lo de alrededor (radio r m). Prueba un segundo servidor si el primero falla. */
export async function fetchOsm(lat: number, lon: number, r = 200): Promise<OsmJson> {
  const key = `seal.osm.${lat.toFixed(4)},${lon.toFixed(4)},${r}`;
  const c = cached<OsmJson>(key);
  if (c) return c;
  let last: unknown = null;
  for (const [k, url] of ENDPOINTS.entries()) {
    try {
      const res = await timed(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(overpassQuery(lat, lon, r)) }, k === 0 ? 20000 : 45000); // los espejos son más lentos
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const j = (await res.json()) as OsmJson;
      if (!Array.isArray(j.elements)) throw new Error("respuesta sin elementos");
      // solo lo que se usa (se guarda en el navegador: si en la demo se cae el internet, el lugar ya consultado sigue andando)
      const slim: OsmJson = { elements: j.elements.map((e) => ({ type: e.type, id: e.id, lat: e.lat, lon: e.lon, tags: e.tags, geometry: e.geometry,
        members: e.members?.filter((m) => m.role === "outer").map((m) => ({ role: m.role, geometry: m.geometry })) })) };
      store(key, slim);
      return slim;
    } catch (e) { last = e; }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
/** Altura del terreno alrededor (anillos hasta 800 m) desde Open-Meteo. null si falla. */
export async function fetchElevation(lat: number, lon: number): Promise<ElevRing | null> {
  const key = `seal.elev.${lat.toFixed(4)},${lon.toFixed(4)}`;
  const c = cached<number[]>(key);
  if (c) return elevRingFrom(c);
  const pts = elevSamples().map(([x, z]) => fromLocal(lat, lon, x, z));
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p[0].toFixed(5)).join(",")}&longitude=${pts.map((p) => p[1].toFixed(5)).join(",")}`;
  try {
    const res = await timed(url, {}, 15000);
    if (!res.ok) return null;
    const j = (await res.json()) as { elevation?: number[] };
    const ring = elevRingFrom(j.elevation ?? []);
    if (ring) store(key, j.elevation);
    return ring;
  } catch { return null; }
}
