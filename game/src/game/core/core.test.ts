// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it } from "vitest";
import { Heightfield } from "./terrain";
import { G, initialState, makeParams, step, type Env, type Rock, type Soil } from "./physics";
import { connected, lineOfSight } from "./signal";
import { buildWorld } from "./world";
import { buildCave, CAVE_KIND, CAVE_RELAY_MARGIN, relaysNeeded } from "./cave";

const FIRM: Soil = { mu: 0.75, crr: 0.05, soft: false, kind: "firme" };
const SOFT: Soil = { mu: 0.38, crr: 0.22, soft: true, kind: "arena" };

function plane(slopeX: number, rocks: Rock[] = [], soil: Soil = FIRM): Env {
  return { height: (x) => x * slopeX, soil: () => soil, rocksNear: () => rocks, half: 1500 };
}
function run(env: Env, g: number, throttle: number, secs: number, yaw = 0, level: "explorador" | "cadete" | "cientifico" = "cadete") {
  const p = makeParams(g, level);
  const s = initialState(0, 0, yaw, env, p);
  const events: string[] = [];
  for (let i = 0; i < secs * 60; i++) events.push(...step(s, { throttle, steer: 0, brake: false }, env, p, 1 / 60).map((e) => e.type));
  return { s, events };
}

describe("terreno", () => {
  it("interpola un plano inclinado y mide su pendiente", () => {
    const n = 33, size = 320, h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = (i / (n - 1)) * size * 0.1; // 10 % hacia el este
    const hf = new Heightfield(n, size, h, 1, 0);
    expect(hf.demAt(0, 0)).toBeCloseTo(16, 1);
    expect(hf.slopeDeg(0, 0)).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 1);
  });
});

describe("física", () => {
  it("acelera en plano y respeta la velocidad máxima", () => {
    const { s } = run(plane(0), G.earth, 1, 6);
    expect(s.v).toBeGreaterThan(6.9);
    expect(s.v).toBeLessThanOrEqual(7.0001);
  });
  it("con menos gravedad hay menos agarre: en la Luna acelera más lento que en la Tierra", () => {
    const earth = run(plane(0), G.earth, 1, 0.8).s.v;
    const moon = run(plane(0), G.moon, 1, 0.8).s.v;
    expect(moon).toBeLessThan(earth * 0.6);
  });
  it("no puede subir una pendiente más empinada que su agarre (tan θ > μ) y resbala", () => {
    // yaw = 90° → mira al este, cuesta arriba con pendiente 0,9 (42°) > μ = 0,75
    const { s, events } = run(plane(0.9), G.earth, 1, 2, Math.PI / 2, "explorador");
    expect(s.v).toBeLessThan(0);
    expect(events).toContain("slide");
  });
  it("se vuelca si la inclinación lateral supera el límite", () => {
    const { events } = run(plane(1.2), G.earth, 0, 0.2, 0);
    expect(events).toContain("tip");
  });
  it("chocar rápido contra una roca grande es un choque", () => {
    const rock: Rock = { x: 0, z: 40, r: 1.5, h: 1.4 };
    const { events, s } = run(plane(0, [rock]), G.earth, 1, 8);
    expect(events).toContain("crash");
    expect(s.damage).toBeGreaterThan(0);
  });
  it("patinar en arena blanda sin avanzar termina atascado", () => {
    const env = plane(0.32, [], SOFT); // cuesta suave de arena: el rover patina
    const { events } = run(env, G.earth, 1, 9, Math.PI / 2);
    expect(events).toContain("sandWarn");
    expect(events).toContain("stuck");
  });
});

describe("señal", () => {
  it("un cerro entre la base y el rover corta la línea de vista", () => {
    const hill = (x: number) => (Math.abs(x - 100) < 20 ? 30 : 0);
    const blocked = (x: number, _z: number, y: number) => hill(x) > y;
    expect(lineOfSight(0, 4, 0, 200, 2, 0, blocked)).toBe(false);
    expect(lineOfSight(0, 4, 0, 60, 2, 0, blocked)).toBe(true);
  });
  it("los repetidores se conectan en cadena", () => {
    const nodes = [{ x: 0, z: 0, y: 0, range: 100 }, { x: 90, z: 0, y: 0, range: 100 }, { x: 180, z: 0, y: 0, range: 100 }];
    expect(connected(nodes, () => true)).toEqual([true, true, true]);
    expect(connected(nodes, (a, b) => !(a.x === 90 || b.x === 90))).toEqual([true, false, false]);
  });
});

describe("mundo y cueva", () => {
  const n = 65, size = 3000, h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = 20 * Math.sin(i / 6) * Math.cos(j / 7) + 30;
  const hf = new Heightfield(n, size, h, 7, 0.5);
  it("el mundo es determinista y deja libre la salida", () => {
    const meta = { id: "siloli", biome: "desierto", water_level: null, h_min: 0, cave: false, roughness: 0.8 };
    const a = buildWorld(hf, meta, "mission"), b = buildWorld(hf, meta, "mission");
    expect(a.rocks.length).toBe(b.rocks.length);
    expect(a.samples).toEqual(b.samples);
    expect(a.rocks.every((r) => Math.hypot(r.x - a.spawn.x, r.z - a.spawn.z) > 30)).toBe(true);
  });
  it("la cueva tiene un camino continuo con línea de vista corta en curvas", () => {
    const c = buildCave("lava_beds_ca");
    expect(c.length).toBeGreaterThan(400);
    const p = c.pts[50];
    expect(c.nearest(p.x, p.z).d).toBeLessThan(0.01);
    expect(c.losInside(c.pts[0].x, c.pts[0].z, c.pts[3].x, c.pts[3].z)).toBe(true);
  });
});

describe("cueva: se puede ganar con los repetidores disponibles", () => {
  // jugador cuidadoso (ver relaysNeeded): con los repetidores que da el juego nunca pasa más de ~10 m sin señal,
  // que a 3 m/s ida y vuelta entra en el tiempo de gracia del nivel Científico (7 s)
  for (const id of Object.keys(CAVE_KIND)) {
    it(id, () => {
      const c = buildCave(id);
      const need = relaysNeeded(c);
      const given = need.relays + CAVE_RELAY_MARGIN.cientifico;
      expect(relaysNeeded(c, given).maxLostM).toBeLessThanOrEqual(10);
      expect(need.relays).toBeLessThan(12); // y la cueva no exige un número absurdo
    });
  }
});

describe("suspensión: no despega por baches, sí en una cresta fuerte", () => {
  const envOf = (h: (x: number) => number): Env => ({ height: (x) => h(x), soil: () => FIRM, rocksNear: () => [], half: 5000 });
  const drive = (h: (x: number) => number, g: number, secs: number) => {
    const env = envOf(h), p = makeParams(g, "cadete");
    const s = initialState(-400, 0, Math.PI / 2, env, p); // avanza hacia +x
    s.v = p.maxSpeed;
    let air = 0, maxPitchJump = 0, prevPitch = s.pitch;
    for (let i = 0; i < secs * 120; i++) {
      step(s, { throttle: 1, steer: 0, brake: false }, env, p, 1 / 120);
      if (s.airborne) air++;
      maxPitchJump = Math.max(maxPitchJump, Math.abs(s.pitch - prevPitch));
      prevPitch = s.pitch;
    }
    return { air, maxPitchJump, s };
  };
  it("lomas suaves con baches chicos, a velocidad máxima en la Luna: siempre apoyado y sin saltos de inclinación", () => {
    const r = drive((x) => 3 * Math.sin(x / 80) + 0.12 * Math.sin(x / 2.5) + 0.06 * Math.sin(x * 1.7), G.moon, 60);
    expect(r.air).toBe(0);
    expect(r.maxPitchJump).toBeLessThan(0.02); // < 1,2° por paso de 1/120 s
  });
  it("una rampa que termina en caída a velocidad máxima en la Luna: vuela y aterriza", () => {
    let landed = false;
    const env = envOf((x) => (x < 0 ? 0 : x < 20 ? x * 0.35 : 0)), p = makeParams(G.moon, "explorador");
    const s = initialState(-30, 0, Math.PI / 2, env, p);
    s.v = p.maxSpeed;
    let flew = false;
    for (let i = 0; i < 20 * 120; i++) {
      const ev = step(s, { throttle: 1, steer: 0, brake: false }, env, p, 1 / 120);
      if (s.airborne) flew = true;
      if (ev.some((e) => e.type === "land")) landed = true;
    }
    expect(flew).toBe(true);
    expect(landed).toBe(true);
  });
  it("en el aire no copia la inclinación del suelo de abajo", () => {
    const env = envOf((x) => (x < 0 ? 0 : x < 20 ? x * 0.35 : (x < 40 ? -30 + x * 0 : -30))), p = makeParams(G.moon, "explorador");
    const s = initialState(-30, 0, Math.PI / 2, env, p);
    s.v = p.maxSpeed;
    let pitchInAir: number[] = [];
    for (let i = 0; i < 12 * 120; i++) {
      step(s, { throttle: 1, steer: 0, brake: false }, env, p, 1 / 120);
      if (s.airborne) pitchInAir.push(s.pitch);
    }
    expect(pitchInAir.length).toBeGreaterThan(10);
    expect(Math.max(...pitchInAir) - Math.min(...pitchInAir)).toBeLessThan(1e-9);
  });
});
