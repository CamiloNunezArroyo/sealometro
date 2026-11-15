// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Cueva / tubo de lava de JUEGO (procedural, determinista por sitio). Inspirada en los tubos de lava que se estudian
// como refugio para bases lunares y marcianas; su forma NO es la de una cueva real medida.
import { hashSeed, rng } from "./terrain";
import type { Rock } from "./physics";
import { connected, roverSignal, type Node } from "./signal";

export type CaveKind = "lava" | "karst" | "ice";
/** Tipo de cueva de cada sitio (según la fuente del motor: sites.yaml → cave_lava_tube). */
export const CAVE_KIND: Record<string, CaveKind> = {
  lava_beds_ca: "lava", lanzarote: "lava", etna_italy: "lava", teide: "lava", torotoro_umajalanta: "karst", vatnajokull_kverkfjoll: "ice",
};
export type CaveHazardKind = "rockfall" | "crevice" | "pool" | "ice";
/** Peligro en un tramo [i0, i1] del camino. Grieta/poza: ocupa de `from` a la pared del lado `side` (offset lateral). */
export interface CaveHazard { kind: CaveHazardKind; i0: number; i1: number; side: 1 | -1; from: number; x: number; z: number }
export interface CavePt { x: number; z: number; floor: number; w: number; s: number }
export interface CaveData {
  pts: CavePt[]; length: number; samples: { x: number; z: number }[]; end: { x: number; z: number };
  rocks: Rock[]; kind: CaveKind; hazards: CaveHazard[];
  /** Peligro bajo el punto (grieta, poza o hielo) o null. */
  hazardAt: (x: number, z: number) => CaveHazard | null;
  nearest: (x: number, z: number) => { i: number; d: number; s: number; floor: number; w: number; t: number };
  heightAt: (x: number, z: number) => number;
  losInside: (ax: number, az: number, bx: number, bz: number) => boolean;
}

/** Repetidores en la cueva: los que hacen falta (calculados para ESA cueva) + un margen según el nivel. */
export const CAVE_RELAY_RANGE = 110;
export const CAVE_RELAY_MARGIN = { explorador: 4, cadete: 3, cientifico: 2 } as const;

export function buildCave(siteId: string): CaveData {
  const R = rng(hashSeed(siteId + ":cave"));
  const kind: CaveKind = CAVE_KIND[siteId] ?? "lava";
  const step = 4, N = 100 + Math.floor(R() * 36);
  const maxCurv = kind === "karst" ? 0.12 : kind === "ice" ? 0.1 : 0.08;
  const pts: CavePt[] = [];
  let x = 0, z = 0, yaw = 0, curv = 0, floor = 0;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    curv = Math.max(-maxCurv, Math.min(maxCurv, curv + (R() - 0.5) * 0.05));
    yaw += curv;
    floor += (R() - 0.5) * 0.9;
    floor = Math.max(-14, Math.min(6, floor - (t < 0.2 ? 0.35 : 0))); // la entrada baja un poco
    const chamber = Math.exp(-(((t - 0.36) / 0.05) ** 2)) + Math.exp(-(((t - 0.68) / 0.05) ** 2)) + Math.exp(-(((t - 0.97) / 0.06) ** 2));
    const w = (kind === "lava" ? 5.6 : 5.0) + 1.2 * Math.sin(i * 0.37) + 5 * Math.min(1, chamber);
    pts.push({ x, z, floor, w, s: i * step });
    x += Math.sin(yaw) * step;
    z += Math.cos(yaw) * step;
  }
  const at = (t: number) => pts[Math.round(t * (N - 1))];
  const samples = [0.36, 0.68].map((t) => { const p = at(t); return { x: p.x + (R() - 0.5) * 4, z: p.z + (R() - 0.5) * 4 }; });
  const endP = pts[N - 3];

  const nearest = (qx: number, qz: number) => {
    let best = { i: 0, d: Infinity, s: 0, floor: 0, w: 5, t: 0 };
    for (let i = 0; i < N - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const L2 = ex * ex + ez * ez;
      let tt = ((qx - a.x) * ex + (qz - a.z) * ez) / L2;
      tt = Math.max(0, Math.min(1, tt));
      const px = a.x + ex * tt, pz = a.z + ez * tt;
      const d = Math.hypot(qx - px, qz - pz);
      if (d < best.d) best = { i, d, s: a.s + step * tt, floor: a.floor + (b.floor - a.floor) * tt, w: a.w + (b.w - a.w) * tt, t: tt };
    }
    return best;
  };
  const heightAt = (qx: number, qz: number) => {
    const n = nearest(qx, qz);
    return n.floor + 0.035 * n.d * n.d;
  };
  const losInside = (ax: number, az: number, bx: number, bz: number) => {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(d / 3));
    for (let i = 1; i < n; i++) {
      const q = nearest(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n);
      if (q.d > q.w - 0.6) return false;
    }
    return true;
  };
  // signo del lado: + a la izquierda del sentido de avance
  const lateral = (qx: number, qz: number) => {
    const n = nearest(qx, qz), a = pts[n.i], b = pts[n.i + 1];
    const cx = a.x + (b.x - a.x) * n.t, cz = a.z + (b.z - a.z) * n.t;
    const ex = b.x - a.x, ez = b.z - a.z;
    return { n, lat: Math.sign(ex * (qz - cz) - ez * (qx - cx)) * n.d };
  };

  // peligros (de juego): lejos de la entrada, de las muestras y del fondo
  const sampleIdx = samples.map((sp) => nearest(sp.x, sp.z).i);
  const hazards: CaveHazard[] = [];
  const freeIdx = (i0: number, i1: number) => i0 > 12 && i1 < N - 8 && sampleIdx.every((k) => k < i0 - 4 || k > i1 + 4) &&
    hazards.every((h) => i1 < h.i0 - 3 || i0 > h.i1 + 3);
  const want = { rockfall: kind === "ice" ? 3 : 4, crevice: kind === "ice" ? 2 : 3, pool: kind === "karst" ? 3 : 0, ice: kind === "ice" ? 5 : kind === "lava" ? 1 : 0 };
  for (const hk of ["crevice", "pool", "rockfall", "ice"] as CaveHazardKind[]) {
    for (let tries = 0, made = 0; tries < 200 && made < want[hk]; tries++) {
      const i0 = 12 + Math.floor(R() * (N - 22)), len = hk === "rockfall" ? 1 : 2 + Math.floor(R() * 3), i1 = i0 + len;
      if (!freeIdx(i0, i1)) continue;
      const w = Math.min(...pts.slice(i0, i1 + 1).map((p) => p.w));
      if ((hk === "crevice" || hk === "pool") && w < 5) continue;
      // el resto del ancho queda libre: el centro del rover tiene ≥ 3 m de paso (lo comprueba un test)
      const from = hk === "crevice" || hk === "pool" ? Math.max(0.6, w - Math.min(w * 0.55, 2 * w - 1.2 - 3.4)) : hk === "ice" ? -99 : 0;
      const p = pts[Math.round((i0 + i1) / 2)];
      hazards.push({ kind: hk, i0, i1, side: R() < 0.5 ? 1 : -1, from, x: p.x, z: p.z });
      made++;
    }
  }
  const hazardAt = (qx: number, qz: number): CaveHazard | null => {
    const { n, lat } = lateral(qx, qz);
    for (const h of hazards) {
      if (n.i < h.i0 || n.i > h.i1 || h.kind === "rockfall") continue;
      if (h.kind === "ice" || lat * h.side > h.from) return h;
    }
    return null;
  };

  const rocks: Rock[] = [];
  for (let i = 8; i < N - 6; i += 3) {
    if (R() < 0.5) continue;
    if (hazards.some((h) => i >= h.i0 - 2 && i <= h.i1 + 2)) continue; // no tapar el paso junto a una grieta
    const p = pts[i], q = pts[i + 1];
    const nx = -(q.z - p.z) / step, nz = (q.x - p.x) / step;
    const side = R() < 0.5 ? -1 : 1, off = side * (p.w - 1.5 - R() * 1.5);
    const r = 0.4 + R() * 1.1;
    rocks.push({ x: p.x + nx * off, z: p.z + nz * off, r, h: r * 0.8 });
  }
  return { pts, length: (N - 1) * step, samples, end: { x: endP.x, z: endP.z }, rocks, kind, hazards, hazardAt, nearest, heightAt, losInside };
}

/**
 * Cuántos repetidores necesita un jugador cuidadoso: avanza por el centro y deja uno en el último punto con buena
 * señal (≥ 0,3) cuando la señal baja de 0,3. Devuelve también el tramo más largo sin señal (m) con esa estrategia.
 */
export function relaysNeeded(c: CaveData, maxRelays = 40): { relays: number; maxLostM: number } {
  const nodes: Node[] = [{ x: c.pts[0].x, z: c.pts[0].z, y: c.pts[0].floor + 2, range: CAVE_RELAY_RANGE }];
  const los = (a: { x: number; z: number }, x: number, z: number) => c.losInside(a.x, a.z, x, z);
  const sig = (k: number) => {
    const p = c.pts[k];
    const ok = connected(nodes, (a, b) => los(a, b.x, b.z));
    return roverSignal(nodes, ok, p.x, p.floor + 1.7, p.z, (a, x, _y, z) => los(a, x, z));
  };
  let used = 0, lastGood = 1, lostRun = 0, maxLost = 0;
  const endIdx = c.pts.length - 3;
  for (let k = 1; k <= endIdx; k++) {
    const s = sig(k);
    if (s < 0.3 && used < maxRelays && lastGood < k) {
      const p = c.pts[lastGood];
      nodes.push({ x: p.x, z: p.z, y: p.floor + 2.2, range: CAVE_RELAY_RANGE });
      used++;
      k = lastGood;
      continue;
    }
    if (s >= 0.3) lastGood = k;
    lostRun = s < 0.08 ? lostRun + 1 : 0;
    maxLost = Math.max(maxLost, lostRun);
  }
  return { relays: used, maxLostM: maxLost * 4 };
}
