// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Comprueba, con el relieve REAL de los 41 lugares, que cada partida de superficie se pueda ganar:
// cada muestra / puerta tiene señal desde la base, o se arregla con un repetidor puesto en un punto con buena señal.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Heightfield } from "./terrain";
import { buildWorld, type Mode } from "./world";
import { connected, lineOfSight, roverSignal, type Node } from "./signal";

const DIR = join(process.cwd(), "public", "data", "terrain");
const META = join(DIR, "game_sites.json");
const sites: { id: string; file: string; n: number; size_m: number; h_min: number; h_max: number; biome: string;
  water_level: number | null; cave: boolean; terrain_stats?: { roughness_100m?: { value: number } | null } }[] =
  existsSync(META) ? JSON.parse(readFileSync(META, "utf8")).sites : [];

function check(site: (typeof sites)[number], mode: Mode) {
  const buf = readFileSync(join(DIR, site.file.replace(/^terrain\//, "")));
  const q = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
  const detail = site.biome === "salar" ? 0.12 : site.biome === "lago" ? 0.3 : 0.6;
  const hf = Heightfield.fromUint16(site.n, site.size_m, q, site.h_min, site.h_max, site.id.length * 7919, detail);
  const w = buildWorld(hf, { id: site.id, biome: site.biome, water_level: site.water_level, h_min: site.h_min, cave: site.cave,
    roughness: site.terrain_stats?.roughness_100m?.value ?? null }, mode);
  const bx = w.spawn.x + 7, bz = w.spawn.z - 6;
  const base: Node = { x: bx, z: bz, y: hf.heightAt(bx, bz) + 5.6, range: 1400 };
  const blocked = (x: number, z: number, y: number) => hf.heightAt(x, z) > y;
  const sigAt = (nodes: Node[], x: number, z: number) => {
    const ok = connected(nodes, (a, b) => lineOfSight(a.x, a.y, a.z, b.x, b.y, b.z, blocked));
    return roverSignal(nodes, ok, x, hf.heightAt(x, z) + 1.7, z, (a, X, Y, Z) => lineOfSight(a.x, a.y, a.z, X, Y, Z, blocked));
  };
  const targets = mode === "free" ? w.gates : w.samples;
  const wet = [w.station, w.spawn, ...targets].filter((t) => w.inWater(t.x, t.z)).map((t) => `agua@${t.x.toFixed(0)},${t.z.toFixed(0)}`);
  let relays = 2;
  const nodes = [base];
  // en misión, la estación instalada repite la señal (se instala primero: es el objetivo 1)
  if (mode === "mission") nodes.push({ x: w.station.x, z: w.station.z, y: hf.heightAt(w.station.x, w.station.z) + 2.2, range: 650 });
  const bad: string[] = [];
  for (const tg of targets) {
    if (sigAt(nodes, tg.x, tg.z) >= 0.08) continue;
    // buscar un punto para un repetidor: con buena señal y que vea el objetivo
    let fixed = false;
    for (let k = 0; k < 400 && !fixed && relays > 0; k++) {
      const a = (k * 2.39996) % (2 * Math.PI), r = 20 + (k % 20) * 25;
      const x = tg.x + r * Math.cos(a), z = tg.z + r * Math.sin(a);
      if (!hf.inside(x, z, 40) || sigAt(nodes, x, z) < 0.3) continue;
      const cand = [...nodes, { x, z, y: hf.heightAt(x, z) + 2.2, range: 650 }];
      if (sigAt(cand, tg.x, tg.z) >= 0.08) { nodes.push(cand[cand.length - 1]); relays--; fixed = true; }
    }
    if (!fixed) bad.push(`${tg.x.toFixed(0)},${tg.z.toFixed(0)}`);
  }
  return [...bad, ...wet];
}

describe.skipIf(!sites.length)("superficie: cada partida se puede ganar (relieve real)", () => {
  for (const mode of ["mission", "free"] as Mode[]) {
    it(mode, () => {
      const fails = sites.map((s) => [s.id, check(s, mode)] as const).filter(([, b]) => b.length);
      expect(fails).toEqual([]);
    });
  }
});
