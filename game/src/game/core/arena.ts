// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// "Arena": el lugar REAL donde está el equipo convertido en mapa jugable (puro, testeable).
// Tres orígenes: escaneo 3D (piso y obstáculos), perímetro caminado con GPS, o medidas a mano.
// Regla de tamaño (decisión de diseño): en la arena el rover se dibuja a escala de un rover de prueba educativo
// (ARENA_SCALE × 3 m ≈ 1,2 m de largo); para manejar hace falta ≥ 150 m² libres y ≥ 10 m de lado.
// Un cuarto no alcanza; un salón grande, un coliseo, una cancha o una plaza sí.
import type { Rock, Soil } from "./physics";
import { rng } from "./terrain";
import type { Mode, Puddle, Spot, World } from "./world";

export type Floor = "cemento" | "interior" | "pasto" | "tierra" | "arena";
export interface Poi { x: number; z: number; label: string; photo?: string }
/** Mueble/objeto de juego (cantidad estimada de las fotos; posición y forma de juego). Bloquea su celda. */
export interface Prop { kind: "mesa" | "silla" | "caja" | "estante"; x: number; z: number; w: number; l: number; h: number; rot: number }
export interface ArenaSpec {
  name: string; source: "scan" | "polygon" | "box"; indoor: boolean; floor: Floor;
  n: number; size: number;                 // rejilla n×n de puntos sobre un cuadrado de `size` m (centro en 0,0)
  heights: Float32Array; blocked: Uint8Array;
  wallH: number;                           // altura de las paredes que se dibujan (m)
  polygon?: [number, number][];            // contorno (perímetro o caja), en m
  pois: Poi[]; station: Spot | null; spawn: Spot | null;
  elev0: number;                           // altura real del lugar (m) para el análisis de muestras
  offset?: { cx: number; cz: number; base: number };   // escaneo: cuánto se movió para centrarlo (para dibujar la malla igual)
  props?: Prop[];                          // muebles de juego (cuántos: según las fotos); sus celdas quedan bloqueadas
}
export const MIN_AREA = 150, MIN_SIDE = 10;
/** Escala del rover y de los marcadores en la arena (decisión de diseño): 3 m × 0,4 = 1,2 m, como un rover de prueba. */
export const ARENA_SCALE = 0.4;

export const cellOf = (s: Pick<ArenaSpec, "n" | "size">) => s.size / (s.n - 1);
export const idx = (s: Pick<ArenaSpec, "n">, i: number, j: number) => j * s.n + i;
export const posOf = (s: Pick<ArenaSpec, "n" | "size">, i: number, j: number): [number, number] => [-s.size / 2 + i * cellOf(s), -s.size / 2 + j * cellOf(s)];
export function cellAt(s: Pick<ArenaSpec, "n" | "size">, x: number, z: number): [number, number] {
  const c = cellOf(s);
  return [Math.round((x + s.size / 2) / c), Math.round((z + s.size / 2) / c)];
}
export function isFree(s: ArenaSpec, x: number, z: number) {
  const [i, j] = cellAt(s, x, z);
  return i >= 0 && j >= 0 && i < s.n && j < s.n && !s.blocked[idx(s, i, j)];
}

// ------------------------------------------------------------------ geometría
export function polygonArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return Math.abs(a) / 2;
}
export function insidePolygon(p: [number, number][], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** lat/lon → metros locales (x = este, z = sur) alrededor de un centro. Suficiente para lugares de < 1 km. */
export function toLocal(lat0: number, lon0: number, lat: number, lon: number): [number, number] {
  const R = 6371000, toR = Math.PI / 180;
  return [(lon - lon0) * toR * R * Math.cos(lat0 * toR), -(lat - lat0) * toR * R];
}
/** Inverso de toLocal: metros locales (x = este, z = sur) → [lat, lon]. */
export function fromLocal(lat0: number, lon0: number, x: number, z: number): [number, number] {
  const R = 6371000, toD = 180 / Math.PI;
  return [lat0 - (z / R) * toD, lon0 + (x / (R * Math.cos(lat0 / toD))) * toD];
}
/** Simplifica un recorrido (Douglas-Peucker) para quitar el temblor del GPS. */
export function simplify(p: [number, number][], tol: number): [number, number][] {
  if (p.length < 3) return p;
  const [ax, az] = p[0], [bx, bz] = p[p.length - 1];
  let best = -1, dmax = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const [x, z] = p[i], L = Math.hypot(bx - ax, bz - az) || 1e-9;
    const d = Math.abs((bz - az) * x - (bx - ax) * z + bx * az - bz * ax) / L;
    if (d > dmax) { dmax = d; best = i; }
  }
  if (dmax <= tol) return [p[0], p[p.length - 1]];
  return [...simplify(p.slice(0, best + 1), tol).slice(0, -1), ...simplify(p.slice(best), tol)];
}

function emptyGrid(extent: number): { n: number; size: number } {
  const size = Math.max(60, extent + 60);                  // 30 m de margen alrededor (el borde del mundo queda lejos)
  const n = Math.min(401, Math.max(121, Math.ceil(size / 0.5) + 1));
  return { n, size };
}

/** Desde un contorno (perímetro GPS o rectángulo): dentro libre, afuera bloqueado (paredes / reja). */
export function fromPolygon(poly: [number, number][], o: { name: string; indoor: boolean; floor: Floor; source: "polygon" | "box"; wallH?: number; elev0?: number }): ArenaSpec {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const P = poly.map(([x, z]) => [x - cx, z - cz] as [number, number]);
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  const { n, size } = emptyGrid(ext);
  const s: ArenaSpec = { name: o.name, source: o.source, indoor: o.indoor, floor: o.floor, n, size, heights: new Float32Array(n * n),
    blocked: new Uint8Array(n * n), wallH: o.wallH ?? (o.indoor ? 4 : 1.4), polygon: P, pois: [], station: null, spawn: null, elev0: o.elev0 ?? 0 };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const [x, z] = posOf(s, i, j); s.blocked[idx(s, i, j)] = insidePolygon(P, x, z) ? 0 : 1; }
  return s;
}
export function fromBox(w: number, l: number, o: { name: string; indoor: boolean; floor: Floor; wallH?: number; elev0?: number }): ArenaSpec {
  return fromPolygon([[-w / 2, -l / 2], [w / 2, -l / 2], [w / 2, l / 2], [-w / 2, l / 2]], { ...o, source: "box" });
}

/**
 * Desde un escaneo 3D: `pts` = muestras (x, y, z, ny) de la superficie, en metros, y arriba = +y.
 * Piso = la superficie horizontal más baja (el techo, más alto, no se confunde); obstáculo = algo entre 0,3 y 1,8 m sobre el piso
 * (paredes, muebles, árboles); celda sin piso = afuera. Se queda con la zona libre conectada más grande.
 */
export function fromScan(pts: Float32Array, o: { name: string; indoor: boolean; floor: Floor; elev0?: number }): ArenaSpec {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < pts.length; k += 4) { minX = Math.min(minX, pts[k]); maxX = Math.max(maxX, pts[k]); minZ = Math.min(minZ, pts[k + 2]); maxZ = Math.max(maxZ, pts[k + 2]); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const { n, size } = emptyGrid(Math.max(maxX - minX, maxZ - minZ));
  const s: ArenaSpec = { name: o.name, source: "scan", indoor: o.indoor, floor: o.floor, n, size, heights: new Float32Array(n * n),
    blocked: new Uint8Array(n * n).fill(1), wallH: 0, pois: [], station: null, spawn: null, elev0: o.elev0 ?? 0 };
  const floor = new Float32Array(n * n).fill(Infinity);
  for (let k = 0; k < pts.length; k += 4) {
    if (Math.abs(pts[k + 3]) < 0.7) continue; // superficies horizontales (algunos escaneos traen las caras al revés)
    const [i, j] = cellAt(s, pts[k] - cx, pts[k + 2] - cz);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const q = idx(s, i, j);
    floor[q] = Math.min(floor[q], pts[k + 1]);
  }
  const fin = [...floor].filter(Number.isFinite).sort((a, b) => a - b);
  const base = fin.length ? fin[Math.floor(fin.length * 0.1)] : 0;    // piso general (percentil 10)
  const obst = new Uint8Array(n * n);
  for (let k = 0; k < pts.length; k += 4) {
    const [i, j] = cellAt(s, pts[k] - cx, pts[k + 2] - cz);
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const q = idx(s, i, j), f = Number.isFinite(floor[q]) ? floor[q] : base, dy = pts[k + 1] - f;
    if (dy > 0.3 && dy < 1.8) obst[q] = 1;
  }
  for (let q = 0; q < n * n; q++) {
    const ok = Number.isFinite(floor[q]) && !obst[q] && Math.abs(floor[q] - base) < 1.2; // escalones grandes = no
    s.blocked[q] = ok ? 0 : 1;
    s.heights[q] = Number.isFinite(floor[q]) ? Math.max(0, floor[q] - base) : 0;
  }
  keepLargestRegion(s);
  s.offset = { cx, cz, base };
  return s;
}

/** Deja solo la zona libre conectada más grande (las demás quedan bloqueadas). */
export function keepLargestRegion(s: ArenaSpec) {
  const n = s.n, lab = new Int32Array(n * n).fill(-1);
  let bestLab = -1, bestSize = 0, cur = 0;
  for (let q0 = 0; q0 < n * n; q0++) {
    if (s.blocked[q0] || lab[q0] >= 0) continue;
    const stack = [q0];
    lab[q0] = cur;
    let size = 0;
    while (stack.length) {
      const q = stack.pop()!;
      size++;
      const i = q % n, j = (q - i) / n;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n) continue;
        const r = b * n + a;
        if (!s.blocked[r] && lab[r] < 0) { lab[r] = cur; stack.push(r); }
      }
    }
    if (size > bestSize) { bestSize = size; bestLab = cur; }
    cur++;
  }
  for (let q = 0; q < n * n; q++) if (lab[q] !== bestLab) s.blocked[q] = 1;
}

export function sizeCheck(s: ArenaSpec): { ok: boolean; area: number; w: number; l: number } {
  const c = cellOf(s);
  let count = 0, minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
  for (let j = 0; j < s.n; j++) for (let i = 0; i < s.n; i++) if (!s.blocked[idx(s, i, j)]) {
    count++; minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
  }
  const area = count * c * c, w = count ? (maxI - minI + 1) * c : 0, l = count ? (maxJ - minJ + 1) * c : 0;
  return { ok: area >= MIN_AREA && Math.min(w, l) >= MIN_SIDE, area, w, l };
}

/**
 * Pone `count` muebles de juego cerca de las paredes (como en un salón real: mesas, sillas, cajas y estantes contra
 * la pared), lejos entre sí, y bloquea sus celdas para que el rover choque. No deja que se pierda más del 12 % del
 * espacio libre. Devuelve los que pudo poner (también quedan en s.props).
 */
export function placeProps(s: ArenaSpec, count: number, seed = 5): Prop[] {
  s.props = [];
  if (count <= 0) return s.props;
  const clr = clearanceMap(s), c = cellOf(s), orig = s.blocked.slice(), before = sizeCheck(s).area;
  const kinds: Prop["kind"][] = ["mesa", "caja", "silla", "estante"];
  for (let n = count; n > 0; n--) {
    s.blocked.set(orig);
    const R = rng(seed), out: Prop[] = [];
    for (const p of spreadPoints(s, clr, n, { pad: 0.9, maxPad: 2.2, R })) {
      const kind = kinds[Math.floor(R() * kinds.length)];
      const [w, l, h] = kind === "mesa" ? [1.6, 0.8, 0.75] : kind === "silla" ? [0.5, 0.5, 0.9] : kind === "caja" ? [0.7 + R() * 0.4, 0.7 + R() * 0.3, 0.6 + R() * 0.4] : [1.4, 0.45, 1.8];
      // el lado largo paralelo a la pared más cercana: se mira hacia dónde baja el despeje
      const dx = clearanceAt(s, clr, p.x + 1, p.z) - clearanceAt(s, clr, p.x - 1, p.z), dz = clearanceAt(s, clr, p.x, p.z + 1) - clearanceAt(s, clr, p.x, p.z - 1);
      const rot = Math.abs(dx) > Math.abs(dz) ? Math.PI / 2 : 0;
      const hx = (rot ? l : w) / 2 + 0.1, hz = (rot ? w : l) / 2 + 0.1;
      for (let z = p.z - hz; z <= p.z + hz + 1e-6; z += c / 2) for (let x = p.x - hx; x <= p.x + hx + 1e-6; x += c / 2) {
        const [i, j] = cellAt(s, x, z);
        if (i >= 0 && j >= 0 && i < s.n && j < s.n) s.blocked[idx(s, i, j)] = 1;
      }
      out.push({ kind, x: p.x, z: p.z, w, l, h, rot });
    }
    keepLargestRegion(s);
    if (sizeCheck(s).area >= before * 0.88) { s.props = out; return out; }
  }
  s.blocked.set(orig);
  return s.props;
}

// ------------------------------------------------------------------ mundo de juego
const FLOOR_SOIL: Record<Floor, Soil> = {
  cemento: { mu: 0.8, crr: 0.03, soft: false, kind: "cemento" }, interior: { mu: 0.7, crr: 0.03, soft: false, kind: "piso" },
  pasto: { mu: 0.6, crr: 0.08, soft: false, kind: "pasto" }, tierra: { mu: 0.7, crr: 0.06, soft: false, kind: "tierra" },
  arena: { mu: 0.5, crr: 0.15, soft: false, kind: "arena" },
};
/** Punto libre más cercano a (x, z), lejos de las paredes al menos `pad` m. */
export function nearestFree(s: ArenaSpec, x: number, z: number, pad = 2.5): Spot {
  const c = cellOf(s), r = Math.ceil(pad / c);
  let best: Spot | null = null, bd = Infinity;
  for (let j = r; j < s.n - r; j++) for (let i = r; i < s.n - r; i++) {
    if (s.blocked[idx(s, i, j)]) continue;
    let clear = true;
    for (let dj = -r; dj <= r && clear; dj += Math.max(1, r)) for (let di = -r; di <= r; di += Math.max(1, r)) if (s.blocked[idx(s, i + di, j + dj)]) { clear = false; break; }
    if (!clear) continue;
    const [px, pz] = posOf(s, i, j), d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < bd) { bd = d; best = { x: px, z: pz }; }
  }
  return best ?? { x, z };
}

// ------------------------------------------------------------------ reparto de objetivos y cámara (puro)
/** Distancia aproximada (m) de cada celda libre a la celda bloqueada más cercana (chaflán de dos pasadas). */
export function clearanceMap(s: ArenaSpec): Float32Array {
  const n = s.n, c = cellOf(s), D = c * Math.SQRT2, d = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = j * n + i;
    d[q] = s.blocked[q] ? 0 : i === 0 || j === 0 || i === n - 1 || j === n - 1 ? c : 1e9;
  }
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const q = j * n + i;
    if (d[q] === 0) continue;
    d[q] = Math.min(d[q], d[q - 1] + c, d[q - n] + c, d[q - n - 1] + D, d[q - n + 1] + D);
  }
  for (let j = n - 2; j > 0; j--) for (let i = n - 2; i > 0; i--) {
    const q = j * n + i;
    if (d[q] === 0) continue;
    d[q] = Math.min(d[q], d[q + 1] + c, d[q + n] + c, d[q + n + 1] + D, d[q + n - 1] + D);
  }
  return d;
}
export function clearanceAt(s: ArenaSpec, clr: Float32Array, x: number, z: number): number {
  const [i, j] = cellAt(s, x, z);
  return i >= 0 && j >= 0 && i < s.n && j < s.n ? clr[idx(s, i, j)] : 0;
}
/** Caja que encierra la zona libre (m). */
export function freeBounds(s: ArenaSpec) {
  let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
  for (let j = 0; j < s.n; j++) for (let i = 0; i < s.n; i++) if (!s.blocked[idx(s, i, j)]) {
    minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
  }
  if (!Number.isFinite(minI)) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0, cx: 0, cz: 0, w: 0, l: 0 };
  const [minX, minZ] = posOf(s, minI, minJ), [maxX, maxZ] = posOf(s, maxI, maxJ);
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, l: maxZ - minZ };
}
/**
 * Reparte `count` puntos lo más lejos posible entre sí y de `taken` (muestreo del punto más lejano), solo en celdas
 * libres con despeje entre `pad` y `maxPad` m. Con `R` (azar) elige entre los casi-mejores: cada partida cambia.
 */
export function spreadPoints(s: ArenaSpec, clr: Float32Array, count: number,
  o: { pad: number; maxPad?: number; taken?: Spot[]; R?: () => number }): Spot[] {
  const xs: number[] = [], zs: number[] = [], maxPad = o.maxPad ?? Infinity;
  for (let j = 0; j < s.n; j++) for (let i = 0; i < s.n; i++) {
    const v = clr[idx(s, i, j)];
    if (v >= o.pad && v <= maxPad) { const [x, z] = posOf(s, i, j); xs.push(x); zs.push(z); }
  }
  const N = xs.length, out: Spot[] = [];
  if (!N) return out;
  const minD = new Float32Array(N).fill(Infinity);
  const upd = (p: Spot) => { for (let k = 0; k < N; k++) { const d = Math.hypot(xs[k] - p.x, zs[k] - p.z); if (d < minD[k]) minD[k] = d; } };
  (o.taken ?? []).forEach(upd);
  for (let m = 0; m < count; m++) {
    let best = 0, bd = -1;
    for (let k = 0; k < N; k++) if (minD[k] > bd) { bd = minD[k]; best = k; }
    if (bd <= 0) break;                                   // no queda lugar distinto
    if (o.R) {
      const ok: number[] = [], lim = Number.isFinite(bd) ? bd * 0.8 : bd;
      for (let k = 0; k < N; k++) if (minD[k] >= lim) ok.push(k);
      best = ok[Math.floor(o.R() * ok.length)] ?? best;
    }
    const p = { x: xs[best], z: zs[best] };
    out.push(p);
    upd(p);
  }
  return out;
}

export interface ArenaPlan { spawn: Spot; station: Spot; samples: Spot[]; perimeter: Spot[]; gates: Spot[]; pad: number }
/**
 * Plan de juego para un lugar chico: usa TODO el espacio. Salida en una esquina, estación en la zona más lejana,
 * muestras lejos entre sí (zonas distintas), balizas junto a las paredes para recorrer el perímetro y puertas de carrera
 * en circuito. Todo es de juego (no son mediciones). Los puntos con GPS (perímetro caminado) se respetan.
 */
export function planArena(s: ArenaSpec, seed?: number): ArenaPlan {
  const clr = clearanceMap(s), b = freeBounds(s), R = seed === undefined ? undefined : rng(seed);
  const pad = Math.max(0.9, Math.min(2.5, Math.min(b.w, b.l) * 0.12));
  const snap = (x: number, z: number, p = pad) => nearestFree(s, x, z, p);
  const spawn = s.spawn ? snap(s.spawn.x, s.spawn.z) : snap(b.cx + b.w * 0.36, b.cz + b.l * 0.36);
  const far = (count: number, taken: Spot[], o: { pad?: number; maxPad?: number; R?: () => number } = {}) => {
    if (count <= 0) return [];
    let pts = spreadPoints(s, clr, count, { pad: o.pad ?? pad, maxPad: o.maxPad, taken, R: o.R });
    if (pts.length < count) pts = spreadPoints(s, clr, count, { pad: 0.4, taken, R: o.R });
    return pts;
  };
  const station = s.station ? snap(s.station.x, s.station.z) : far(1, [spawn])[0] ?? snap(b.cx - b.w * 0.36, b.cz - b.l * 0.36);
  // muestras: primero los puntos con GPS real (si están lejos entre sí), el resto repartido
  const minSep = Math.max(3, Math.min(b.w, b.l) * 0.25);
  const samples: Spot[] = [];
  if (s.source === "polygon") for (const p of s.pois.slice(0, 6)) {
    const q = snap(p.x, p.z);
    if (samples.length < 3 && [spawn, station, ...samples].every((t) => Math.hypot(t.x - q.x, t.z - q.z) >= minSep)) samples.push(q);
  }
  samples.push(...far(3 - samples.length, [spawn, station, ...samples], { R }));
  // perímetro: balizas en la franja pegada a las paredes, ordenadas en vuelta
  const padP = Math.max(0.9, pad * 0.6), nP = Math.max(4, Math.min(8, Math.round((2 * (b.w + b.l)) / 12)));
  // (lejos de la salida: así la última tarea nunca termina al lado de la base y el simulacro final tiene sentido)
  let perimeter = spreadPoints(s, clr, nP, { pad: padP, maxPad: padP + 0.8, taken: [spawn] });
  if (perimeter.length < 3) perimeter = far(nP, [], { pad: 0.6 });
  const ang = (p: Spot) => Math.atan2(p.z - b.cz, p.x - b.cx), a0 = ang(spawn);
  const turn = (p: Spot) => (ang(p) - a0 + 4 * Math.PI) % (2 * Math.PI);
  perimeter.sort((p, q) => turn(p) - turn(q));
  // carrera: puntos con GPS si hay 3 o más; si no, circuito repartido
  let gates: Spot[] = s.source === "polygon" && s.pois.length >= 3 ? s.pois.slice(0, 6).map((p) => snap(p.x, p.z)) : [];
  if (gates.length < 3) { gates = far(5, [spawn]); gates.sort((p, q) => turn(p) - turn(q)); }
  if (!gates.length) gates = [station];
  return { spawn, station, samples, perimeter, gates, pad };
}

/**
 * Cámara dentro del lugar: avanza del rover (a) hacia donde la cámara quiere estar (b) y devuelve la fracción 0–1
 * hasta donde hay al menos `pad` m de despeje a paredes y obstáculos. 1 = puede ir hasta b.
 */
export function camClamp(s: ArenaSpec, clr: Float32Array, ax: number, az: number, bx: number, bz: number, pad = 0.75): number {
  const d = Math.hypot(bx - ax, bz - az);
  if (d < 1e-6) return 1;
  const steps = Math.max(1, Math.ceil(d / (cellOf(s) * 0.5)));
  let ok = 0;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    if (clearanceAt(s, clr, ax + (bx - ax) * t, az + (bz - az) * t) < pad) break;
    ok = t;
  }
  return ok;
}
/** Señal del escáner de muestras (de juego): 1 = encima, 0 = a `range` m o más. */
export const scannerLevel = (dist: number, range: number) => Math.max(0, Math.min(1, 1 - dist / range));

export interface ArenaWorld extends World { perimeter: Spot[]; plan: ArenaPlan }

export function buildArenaWorld(s: ArenaSpec, mode: Mode, seed?: number): ArenaWorld {
  const c = cellOf(s);
  // paredes: celdas bloqueadas junto a una libre → círculos de choque (altos: no se pueden pisar)
  const rocks: Rock[] = [];
  for (let j = 1; j < s.n - 1; j++) for (let i = 1; i < s.n - 1; i++) {
    if (!s.blocked[idx(s, i, j)]) continue;
    if (s.blocked[idx(s, i + 1, j)] && s.blocked[idx(s, i - 1, j)] && s.blocked[idx(s, i, j + 1)] && s.blocked[idx(s, i, j - 1)]) continue;
    const [x, z] = posOf(s, i, j);
    rocks.push({ x, z, r: c * 0.75, h: 3 });
  }
  const CELL = 8, grid = new Map<string, Rock[]>();
  for (const r of rocks) { const k = `${Math.floor(r.x / CELL)},${Math.floor(r.z / CELL)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(r); }
  const rocksNear = (x: number, z: number, radius: number) => {
    const out: Rock[] = [], k = Math.ceil(radius / CELL) + 1, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) { const l = grid.get(`${cx + a},${cz + b}`); if (l) out.push(...l); }
    return out;
  };
  // salida, estación, muestras, balizas del perímetro y puertas: repartidas por todo el lugar (ver planArena)
  const plan = planArena(s, seed);
  const { spawn, station } = plan;
  const firm = FLOOR_SOIL[s.floor];
  const puddles: Puddle[] = [];
  return {
    rocks, sand: [], vents: [], puddles, lowSpots: [],
    spawn: { ...spawn, yaw: Math.atan2(station.x - spawn.x, station.z - spawn.z) },
    station, samples: mode === "free" ? [] : plan.samples, gates: plan.gates, cave: null, perimeter: plan.perimeter, plan,
    waterRel: null, firm, soft: firm, softName: firm.kind,
    rocksNear, soilAt: () => firm, inSand: () => false, ventNear: () => 0, inWater: () => false, puddleAt: () => null,
  };
}
