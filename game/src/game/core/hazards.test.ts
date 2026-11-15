// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it } from "vitest";
import { boulderSpawn, devilCount, devilPush, geyserPhase, pickWeather, solarStormTime, updateBoulder, type Boulder } from "./hazards";
import { buildCave, CAVE_KIND } from "./cave";
import { Heightfield, rng } from "./terrain";
import { buildWorld } from "./world";

describe("clima según la lluvia real", () => {
  const freq = (precip: number, t = 290) => {
    let n = 0;
    for (let s = 1; s <= 2000; s++) if (pickWeather("auto", precip, t, s).kind !== "clear") n++;
    return n / 2000;
  };
  it("Atacama (7 mm/año) casi nunca llueve; Amazonía (~2000 mm) la mitad de las veces", () => {
    expect(freq(7)).toBeLessThan(0.02);
    expect(freq(1983)).toBeGreaterThan(0.44);
    expect(freq(1983)).toBeLessThan(0.56);
  });
  it("con media bajo 0 °C cae nieve, no lluvia; 'clear' y 'rain' fuerzan el clima", () => {
    expect(pickWeather("rain", 100, 250, 3).kind).toBe("snow");
    expect(pickWeather("rain", 100, 290, 3).kind).toBe("rain");
    expect(pickWeather("clear", 3000, 290, 3).kind).toBe("clear");
  });
});

describe("peligros", () => {
  it("no hay remolinos de polvo en la Luna (sin aire) ni en lugares lluviosos", () => {
    expect(devilCount(10, "moon")).toBe(0);
    expect(devilCount(1500, "mars")).toBe(0);
    expect(devilCount(10, "mars")).toBeGreaterThan(0);
  });
  it("el remolino solo empuja dentro de su radio", () => {
    const d = { x: 0, z: 0, vx: 0, vz: 0, r: 10, life: 10, spin: 0 };
    expect(devilPush(d, 20, 0).k).toBe(0);
    expect(devilPush(d, 3, 0).k).toBeGreaterThan(0.5);
  });
  it("una roca rueda pendiente abajo y se detiene en lo plano", () => {
    const h = (x: number) => (x < 0 ? -x * 0.6 : 0); // ladera a la izquierda, plano a la derecha
    const b: Boulder = { x: -40, z: 0, y: 0, vx: 0, vz: 0, r: 1, alive: true, t: 0 };
    for (let i = 0; i < 2000 && b.alive; i++) updateBoulder(b, 0.02, 3.73, (x) => h(x));
    expect(b.x).toBeGreaterThan(0);  // bajó y salió al plano
    expect(b.alive).toBe(false);      // y se detuvo
  });
  it("solo aparece una roca si hay ladera empinada arriba del rover", () => {
    const R = rng(5);
    expect(boulderSpawn(R, 0, 0, () => 2, () => 0)).toBeNull();
    expect(boulderSpawn(R, 0, 0, () => 25, (x, z) => Math.hypot(x, z) * 0.5)).not.toBeNull();
  });
  it("el géiser avisa antes de la erupción", () => {
    const phases: string[] = [];
    for (let t = 0; t < 60; t += 0.5) phases.push(geyserPhase(t, 3));
    const i = phases.indexOf("erupt");
    expect(i).toBeGreaterThan(0);
    expect(phases.slice(Math.max(0, i - 4), i)).toContain("warn");
  });
  it("no hay tormenta solar con gravedad de la Tierra", () => {
    for (let s = 0; s < 50; s++) expect(solarStormTime("earth", s)).toBeNull();
  });
});

describe("cuevas: los peligros dejan paso", () => {
  for (const id of Object.keys(CAVE_KIND)) {
    it(id, () => {
      const c = buildCave(id);
      expect(c.hazards.length).toBeGreaterThan(2);
      for (const h of c.hazards) {
        if (h.kind !== "crevice" && h.kind !== "pool") continue;
        for (let i = h.i0; i <= h.i1; i++) {
          const w = c.pts[i].w;
          // el centro del rover puede ir de −(w − 1,2) (pared) hasta `from` (borde de la grieta): ≥ 3 m
          expect(h.from + (w - 1.2)).toBeGreaterThanOrEqual(3);
        }
      }
      // ni las muestras ni el fondo caen en una grieta o poza
      for (const p of [...c.samples, c.end]) expect(["crevice", "pool"]).not.toContain(c.hazardAt(p.x, p.z)?.kind);
    });
  }
});

describe("salar: charcos y sal seca", () => {
  it("hay un charco grande con centro hondo y varios chicos, sin tapar los objetivos", () => {
    const n = 65, size = 3000, h = new Float32Array(n * n); // salar plano
    const hf = new Heightfield(n, size, h, 1, 0.12);
    const w = buildWorld(hf, { id: "uyuni_test", biome: "salar", water_level: null, h_min: 3656, cave: false }, "mission");
    const big = w.puddles.filter((p) => p.deep > 0);
    expect(big.length).toBe(1);
    expect(w.puddles.length).toBeGreaterThan(4);
    for (const s of [w.station, ...w.samples, w.spawn]) expect(w.inWater(s.x, s.z)).toBe(false);
    expect(w.soilAt(big[0].x + big[0].r * 0.8, big[0].z).kind).toBe("charco"); // la orilla se puede pisar
  });
});
