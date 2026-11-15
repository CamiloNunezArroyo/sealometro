// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Mundo de juego para un sitio (puro, determinista por semilla). Rocas, suelo blando, fumarolas, muestras, estación,
// puertas y entrada de cueva son ELEMENTOS DE JUEGO. Lo que sale de datos reales: el relieve (DEM), la cantidad de rocas
// (escala con la rugosidad medida por el motor) y el tipo de suelo (bioma de diseño a partir de los datos).
import { hashSeed, rng, type Heightfield } from "./terrain";
import type { Rock, Soil } from "./physics";
import { lineOfSight } from "./signal";

export type Mode = "free" | "mission" | "cave";
export interface Spot { x: number; z: number }
export interface Patch extends Spot { r: number }
export interface SiteMeta {
  id: string; biome: string; water_level: number | null; h_min: number; cave: boolean;
  roughness?: number | null;
}
export interface Puddle extends Patch { deep: number; rain?: boolean }   // deep: fracción del radio que es honda (0 = todo bajo)
export interface World {
  rocks: Rock[]; sand: Patch[]; vents: Patch[];
  puddles: Puddle[];          // charcos (salar) y los que deja la lluvia; se pueden agregar en la partida
  lowSpots: Spot[];           // puntos bajos del relieve real: ahí se junta el agua de lluvia
  spawn: Spot & { yaw: number };
  station: Spot; samples: Spot[]; gates: Spot[]; cave: Spot | null;
  waterRel: number | null;   // altura del agua relativa al mínimo del sitio
  firm: Soil; soft: Soil; softName: string;
  rocksNear: (x: number, z: number, radius: number) => Rock[];
  soilAt: (x: number, z: number) => Soil;
  inSand: (x: number, z: number) => boolean;
  ventNear: (x: number, z: number) => number;   // 0..1 intensidad
  inWater: (x: number, z: number) => boolean;
  puddleAt: (x: number, z: number) => Puddle | null;
}

const FIRM: Record<string, Soil> = {
  desierto: { mu: 0.75, crr: 0.05, soft: false, kind: "firme" },
  salar: { mu: 0.68, crr: 0.03, soft: false, kind: "sal" },
  volcanico: { mu: 0.85, crr: 0.07, soft: false, kind: "roca" },
  frio: { mu: 0.55, crr: 0.05, soft: false, kind: "helado" },
  lago: { mu: 0.7, crr: 0.05, soft: false, kind: "orilla" },
  vegetado: { mu: 0.8, crr: 0.06, soft: false, kind: "suelo" },
};
const SOFT_NAME: Record<string, string> = { desierto: "arena", volcanico: "ceniza", salar: "costra", lago: "barro", frio: "nieve", vegetado: "barro" };
const SAND_COUNT: Record<string, number> = { desierto: 16, volcanico: 9, salar: 6, lago: 7, frio: 6, vegetado: 4 };
// rocas por bioma (decisión de diseño): base + extra por rugosidad del DEM (dato real del motor)
const ROCK_BASE: Record<string, number> = { volcanico: 900, desierto: 650, salar: 160, lago: 380, frio: 750, vegetado: 220 };
const PUDDLE_SOIL: Soil = { mu: 0.42, crr: 0.12, soft: false, kind: "charco" };
const GEOTHERMAL = new Set(["sol_de_manana", "sajama", "danakil_dallol"]);

function gauss(R: () => number) { return Math.sqrt(-2 * Math.log(R() + 1e-9)) * Math.cos(2 * Math.PI * R()); }

export function buildWorld(hf: Heightfield, meta: SiteMeta, mode: Mode): World {
  const R = rng(hashSeed(meta.id + ":" + mode));
  const biome = FIRM[meta.biome] ? meta.biome : "desierto";
  const waterRel = meta.water_level !== null ? meta.water_level - meta.h_min : null;
  const puddles: Puddle[] = [];
  const puddleAt = (x: number, z: number): Puddle | null => {
    for (const p of puddles) if (Math.hypot(x - p.x, z - p.z) < p.r) return p;
    return null;
  };
  const inWater = (x: number, z: number) => {
    if (waterRel !== null && hf.heightAt(x, z) < waterRel + 0.05) return true;
    const p = puddleAt(x, z);
    return !!p && p.deep > 0 && Math.hypot(x - p.x, z - p.z) < p.r * p.deep;
  };
  const lim = hf.half - 60;
  const ok = (x: number, z: number, maxSlope: number) =>
    Math.abs(x) < lim && Math.abs(z) < lim && !inWater(x, z) && hf.slopeDeg(x, z) < maxSlope;

  // salida: el lugar más plano cerca del centro
  let spawn = { x: 0, z: 0, s: Infinity };
  // (si el centro del sitio cae en una laguna, se sigue buscando más lejos hasta encontrar tierra firme)
  for (let r = 0; r <= 1300; r += 20) {
    for (let a = 0; a < 24; a++) {
      const x = r * Math.cos((a / 24) * 2 * Math.PI), z = r * Math.sin((a / 24) * 2 * Math.PI);
      if (!ok(x, z, 90) || inWater(x + 25, z) || inWater(x - 25, z) || inWater(x, z + 25) || inWater(x, z - 25)) continue;
      const s = hf.slopeDeg(x, z, 10) + r / 80;
      if (s < spawn.s) spawn = { x, z, s };
    }
    if (spawn.s < 4 || (r >= 240 && spawn.s < Infinity)) break;
  }
  const blocked = (x: number, z: number, yLine: number) => hf.heightAt(x, z) > yLine;
  // antena de la base: mismo punto y altura que dibuja el motor (spawn + (7, −6), 5,6 m sobre el suelo)
  const baseX = spawn.x + 7, baseZ = spawn.z - 6, baseY = hf.heightAt(baseX, baseZ) + 5.6;

  const pickRing = (rmin: number, rmax: number, maxSlope: number, tries = 200): Spot => {
    for (let i = 0; i < tries; i++) {
      const a = R() * 2 * Math.PI, r = rmin + R() * (rmax - rmin);
      const x = spawn.x + r * Math.cos(a), z = spawn.z + r * Math.sin(a);
      if (ok(x, z, maxSlope)) return { x, z };
    }
    return { x: spawn.x + rmin, z: spawn.z };
  };

  // estación: punto alto con línea de vista a la base
  let station: Spot | null = null;
  let bestH = -Infinity;
  for (let i = 0; i < 60; i++) {
    const c = pickRing(200, 480, 14, 40);
    const y = hf.heightAt(c.x, c.z) + 2;
    if (lineOfSight(baseX, baseY, baseZ, c.x, y, c.z, blocked) && y > bestH) { bestH = y; station = c; }
  }
  station ??= pickRing(200, 420, 14);

  // muestras: lejos de la estación y, si se puede, con línea de vista a la base (una muestra en un cañón cerrado
  // no se podría alcanzar sin perder la señal; el test "superficie: cada partida se puede ganar" lo vigila)
  // la estación instalada también repite la señal (antena a 2,2 m), igual que en el motor
  const st = station, stY = hf.heightAt(st.x, st.z) + 2.2;
  const seesBase = (s: Spot) => {
    const y = hf.heightAt(s.x, s.z) + 1.7;
    return lineOfSight(baseX, baseY, baseZ, s.x, y, s.z, blocked) ||
      (Math.hypot(s.x - st.x, s.z - st.z) < 600 && lineOfSight(st.x, stY, st.z, s.x, y, s.z, blocked));
  };
  const samples: Spot[] = [];
  const farFromOthers = (c: Spot) => Math.hypot(c.x - st.x, c.z - st.z) > 120 && samples.every((o) => Math.hypot(c.x - o.x, c.z - o.z) > 90);
  for (let k = 0; k < 3; k++) {
    let pick: Spot | null = null;
    // 1) en su anillo, con señal; 2) en un anillo más amplio, con señal; 3) cualquiera (último recurso)
    const tries: [number, number, number, boolean][] = [[220 + k * 90, 380 + k * 120, 14, true], [150, 750, 18, true], [220, 600, 18, false]];
    for (const [r0, r1, sl, needSig] of tries) {
      for (let i = 0; i < 250 && !pick; i++) {
        const a = R() * 2 * Math.PI, r = r0 + R() * (r1 - r0);
        const c = { x: spawn.x + r * Math.cos(a), z: spawn.z + r * Math.sin(a) };
        if (ok(c.x, c.z, sl) && farFromOthers(c) && (!needSig || seesBase(c))) pick = c;
      }
      if (pick) break;
    }
    samples.push(pick ?? pickRing(250, 600, 18));
  }

  const gates: Spot[] = [];
  const nG = 7;
  for (let k = 0; k < nG; k++) {
    const base = (k / nG) * 2 * Math.PI;
    let g: Spot | null = null;
    for (let i = 0; i < 60 && !g; i++) {
      const a = base + (R() - 0.5) * 0.5, r = (k % 2 ? 170 : 290) + (R() - 0.5) * 80;
      const x = spawn.x + r * Math.cos(a), z = spawn.z + r * Math.sin(a);
      // en manejo libre no hay estación: la puerta debe verse desde la antena de la base
      if (ok(x, z, 16) && lineOfSight(baseX, baseY, baseZ, x, hf.heightAt(x, z) + 1.7, z, blocked)) g = { x, z };
    }
    for (let i = 0; i < 300 && !g; i++) { // respaldo: cualquier punto firme y seco en un anillo más amplio
      const a = R() * 2 * Math.PI, r = 120 + R() * 450;
      const x = spawn.x + r * Math.cos(a), z = spawn.z + r * Math.sin(a);
      if (ok(x, z, 22) && lineOfSight(baseX, baseY, baseZ, x, hf.heightAt(x, z) + 1.7, z, blocked) &&
        gates.every((o) => Math.hypot(o.x - x, o.z - z) > 60)) g = { x, z };
    }
    gates.push(g ?? pickRing(100, 600, 30));
  }
  const cave = meta.cave ? pickRing(240, 320, 15) : null;

  const reserved: Patch[] = [{ ...spawn, r: 32 }, { ...station, r: 12 }, ...samples.map((s) => ({ ...s, r: 10 })),
    ...gates.map((g) => ({ ...g, r: 11 })), ...(cave ? [{ ...cave, r: 16 }] : [])];
  const free = (x: number, z: number, pad: number) => reserved.every((p) => Math.hypot(x - p.x, z - p.z) > p.r + pad);

  // rocas: más cuanto más rugoso es el lugar según el DEM; prefieren laderas (como los derrubios reales) y
  // un 40 % aparece en grupos (campos de bloques). En el salar solo hay rocas donde hay relieve (islas).
  const rough = meta.roughness ?? 0.6;
  const nRocks = Math.round(Math.min(1700, (ROCK_BASE[biome] ?? 500) * (0.7 + 0.6 * Math.min(1, rough / 1.5))));
  const rocks: Rock[] = [];
  const clusters = Array.from({ length: 14 }, () => pickRing(40, 900, 40, 3));
  for (let i = 0; i < nRocks * 6 && rocks.length < nRocks; i++) {
    let x: number, z: number;
    if (R() < 0.4) { // en grupo
      const c = clusters[Math.floor(R() * clusters.length)];
      const a = R() * 2 * Math.PI, d = Math.abs(gauss(R)) * 26;
      x = c.x + Math.cos(a) * d; z = c.z + Math.sin(a) * d;
    } else {
      const a = R() * 2 * Math.PI, d = Math.sqrt(R()) * 1150; // densidad mayor cerca de la zona de juego
      x = spawn.x + Math.cos(a) * d; z = spawn.z + Math.sin(a) * d;
    }
    if (Math.abs(x) > lim + 40 || Math.abs(z) > lim + 40 || inWater(x, z) || !free(x, z, 3)) continue;
    const sl = hf.slopeDeg(x, z, 10);
    if (biome === "salar" && sl < 3) continue;
    if (R() > 0.35 + sl / 25) continue; // laderas: más rocas
    const u = R();
    const r = 0.25 + 2.3 * u * u * u;
    rocks.push({ x, z, r, h: r * (0.55 + R() * 0.55) });
  }

  // charcos del salar (decisión de diseño inspirada en el agua que se junta sobre la costra en época de lluvias):
  // varios chicos y uno grande; el resto queda sal seca
  if (biome === "salar") {
    const big = pickRing(380, 700, 6, 60);
    if (free(big.x, big.z, 90)) puddles.push({ ...big, r: 75 + R() * 35, deep: 0.45 });
    for (let i = 0; i < 300 && puddles.length < 10; i++) {
      const p = pickRing(70, 900, 4, 1);
      if (free(p.x, p.z, 16) && !puddleAt(p.x, p.z)) puddles.push({ ...p, r: 4 + R() * 10, deep: 0 });
    }
  }
  // puntos bajos del relieve real (mínimos locales del DEM) para la lluvia
  const lowSpots: (Spot & { d: number })[] = [];
  for (let gx = -900; gx <= 900; gx += 45) for (let gz = -900; gz <= 900; gz += 45) {
    const x = spawn.x + gx, z = spawn.z + gz;
    if (Math.abs(x) > lim || Math.abs(z) > lim || !free(x, z, 6) || inWater(x, z)) continue;
    const h0 = hf.demAt(x, z);
    let ring = 0;
    for (let k = 0; k < 8; k++) ring += hf.demAt(x + 18 * Math.cos(k * 0.785), z + 18 * Math.sin(k * 0.785));
    const d = ring / 8 - h0;
    if (d > 0.25) lowSpots.push({ x, z, d });
  }
  lowSpots.sort((a, b) => b.d - a.d);
  if (lowSpots.length < 6) for (let i = 0; i < 8; i++) { const p = pickRing(60, 700, 6, 3); lowSpots.push({ ...p, d: 0 }); } // terreno muy plano

  const sand: Patch[] = [];
  for (let i = 0; i < 400 && sand.length < (SAND_COUNT[biome] ?? 8); i++) {
    const s = pickRing(60, 650, 10, 1);
    if (!free(s.x, s.z, 18)) continue;
    sand.push({ ...s, r: 10 + R() * 22 });
  }
  const vents: Patch[] = [];
  if (GEOTHERMAL.has(meta.id)) {
    for (let i = 0; i < 200 && vents.length < 7; i++) {
      const s = pickRing(80, 520, 18, 1);
      if (free(s.x, s.z, 10)) vents.push({ ...s, r: 6 });
    }
  }

  const CELL = 20;
  const grid = new Map<string, Rock[]>();
  for (const r of rocks) {
    const k = `${Math.floor(r.x / CELL)},${Math.floor(r.z / CELL)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(r);
  }
  const rocksNear = (x: number, z: number, radius: number) => {
    const out: Rock[] = [];
    const c = Math.ceil(radius / CELL) + 1;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) {
      const l = grid.get(`${cx + i},${cz + j}`);
      if (l) out.push(...l);
    }
    return out;
  };
  const firm = FIRM[biome];
  const soft: Soil = { mu: 0.38, crr: 0.22, soft: true, kind: SOFT_NAME[biome] ?? "arena" };
  const inSand = (x: number, z: number) => sand.some((p) => Math.hypot(x - p.x, z - p.z) < p.r);
  return {
    rocks, sand, vents, spawn: { x: spawn.x, z: spawn.z, yaw: Math.atan2(station.x - spawn.x, station.z - spawn.z) },
    station, samples, gates, cave, waterRel, firm, soft, softName: soft.kind,
    rocksNear, soilAt: (x, z) => (puddleAt(x, z) ? PUDDLE_SOIL : inSand(x, z) ? soft : firm), inSand,
    puddles, lowSpots: lowSpots.slice(0, 14).map(({ x, z }) => ({ x, z })), puddleAt,
    ventNear: (x, z) => vents.reduce((m, v) => Math.max(m, Math.max(0, 1 - Math.hypot(x - v.x, z - v.z) / (v.r + 4))), 0),
    inWater,
  };
}
