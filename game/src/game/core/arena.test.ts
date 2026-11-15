// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it } from "vitest";
import { ARENA_SCALE, buildArenaWorld, camClamp, clearanceAt, clearanceMap, freeBounds, fromBox, fromPolygon, fromScan, insidePolygon, isFree, planArena,
  polygonArea, scannerLevel, simplify, sizeCheck, toLocal } from "./arena";
import { G, initialState, makeParams, step, type Env } from "./physics";

describe("arena: el lugar real como mapa jugable", () => {
  it("un cuarto de 4 × 5 m es muy chico; un coliseo de 30 × 20 m sí sirve", () => {
    expect(sizeCheck(fromBox(4, 5, { name: "cuarto", indoor: true, floor: "interior" })).ok).toBe(false);
    const c = sizeCheck(fromBox(30, 20, { name: "coliseo", indoor: true, floor: "cemento" }));
    expect(c.ok).toBe(true);
    expect(c.area).toBeGreaterThan(560);
    expect(c.area).toBeLessThan(680);
  });
  it("geometría: área, punto dentro, simplificación y conversión GPS → metros", () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
    expect(insidePolygon([[0, 0], [10, 0], [10, 10], [0, 10]], 5, 5)).toBe(true);
    expect(insidePolygon([[0, 0], [10, 0], [10, 10], [0, 10]], 15, 5)).toBe(false);
    expect(simplify([[0, 0], [1, 0.05], [2, 0], [3, 0.02], [4, 0]], 0.5)).toEqual([[0, 0], [4, 0]]);
    const [x, z] = toLocal(-19, -65, -19.001, -65);
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(111.2, 0); // al sur = +z
  });
  it("si es cerrado, el rover NO sale: choca con la pared y queda adentro", () => {
    const s = fromPolygon([[-15, -10], [15, -10], [15, 10], [-15, 10]], { name: "cancha", indoor: false, floor: "cemento", source: "polygon" });
    const w = buildArenaWorld(s, "free");
    const env: Env = { height: () => 0, soil: w.soilAt, rocksNear: w.rocksNear, half: s.size / 2 };
    const p = makeParams(G.earth, "explorador");
    const st = initialState(0, 0, Math.PI / 2, env, p); // hacia +x (la pared está a 15 m)
    for (let i = 0; i < 20 * 120; i++) step(st, { throttle: 0.5, steer: 0, brake: false }, env, p, 1 / 120);
    expect(Math.abs(st.x)).toBeLessThan(15.5);
    expect(isFree(s, st.x, st.z) || Math.abs(st.x) < 15.5).toBe(true);
  });
  it("escaneo 3D: encuentra el piso, marca una mesa como obstáculo y deja afuera lo que no se escaneó", () => {
    const pts: number[] = [];
    for (let x = -12; x <= 12; x += 0.25) for (let z = -8; z <= 8; z += 0.25) pts.push(x, 0, z, 1);       // piso 24 × 16 m
    for (let x = 2; x <= 4; x += 0.2) for (let z = 1; z <= 2; z += 0.2) pts.push(x, 0.75, z, 1);           // mesa
    const s = fromScan(new Float32Array(pts), { name: "salón", indoor: true, floor: "interior" });
    expect(isFree(s, -6, 0)).toBe(true);
    expect(isFree(s, 3, 1.5)).toBe(false);   // la mesa
    expect(isFree(s, 20, 0)).toBe(false);    // fuera del escaneo
    expect(sizeCheck(s).ok).toBe(true);
  });
  it("escaneo con las caras del piso al revés (normal hacia abajo) y con techo: igual encuentra el piso", () => {
    const pts: number[] = [];
    for (let x = -12; x <= 12; x += 0.25) for (let z = -8; z <= 8; z += 0.25) pts.push(x, 0, z, -1, x, 3.5, z, -1); // piso + techo
    const s = fromScan(new Float32Array(pts), { name: "coliseo", indoor: true, floor: "cemento" });
    expect(isFree(s, 0, 0)).toBe(true);
    expect(sizeCheck(s).ok).toBe(true);
  });
  it("el mundo de la arena pone salida, estación y puntos de interés en zona libre", () => {
    const s = fromBox(40, 25, { name: "plaza", indoor: false, floor: "pasto" });
    s.pois = [{ x: 10, z: 5, label: "foto 1" }, { x: -12, z: -6, label: "foto 2" }];
    const w = buildArenaWorld(s, "mission");
    for (const p of [w.spawn, w.station, ...w.samples]) expect(isFree(s, p.x, p.z)).toBe(true);
    expect(w.samples.length).toBeGreaterThanOrEqual(3);
  });
});

describe("arena chica: reparto de la misión y cámara dentro del lugar", () => {
  const room = () => fromBox(20, 15, { name: "salón", indoor: true, floor: "interior", wallH: 4 });
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  it("despeje: 0 en la pared, crece hacia el centro del salón", () => {
    const s = room(), clr = clearanceMap(s);
    expect(clearanceAt(s, clr, 30, 0)).toBe(0);              // afuera
    expect(clearanceAt(s, clr, 9.5, 0)).toBeLessThan(1.1);   // pegado a la pared (x = 10)
    expect(clearanceAt(s, clr, 0, 0)).toBeGreaterThan(6.5);  // centro: 7,5 m a la pared más cercana
    const b = freeBounds(s);
    expect(b.w).toBeGreaterThan(18); expect(b.w).toBeLessThanOrEqual(20);
    expect(b.l).toBeGreaterThan(13); expect(b.l).toBeLessThanOrEqual(15);
  });
  it("en un salón de 20 × 15 m los objetivos usan todo el espacio (no quedan amontonados)", () => {
    for (const seed of [undefined, 1, 77, 12345]) {
      const s = room(), p = planArena(s, seed), clr = clearanceMap(s);
      expect(dist(p.spawn, p.station)).toBeGreaterThan(14);                 // estación en la zona opuesta
      expect(p.samples.length).toBe(3);
      const pts = [p.spawn, p.station, ...p.samples];
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(dist(pts[i], pts[j])).toBeGreaterThan(5);
      for (const q of [...pts, ...p.gates]) expect(clearanceAt(s, clr, q.x, q.z)).toBeGreaterThanOrEqual(0.9); // el rover (radio 0,6 m) entra
      // balizas: junto a las paredes, lejos de la salida y cubriendo casi todo el largo y el ancho del salón
      expect(p.perimeter.length).toBeGreaterThanOrEqual(4);
      for (const q of p.perimeter) {
        expect(isFree(s, q.x, q.z)).toBe(true);
        expect(clearanceAt(s, clr, q.x, q.z)).toBeLessThan(2.5);
        expect(dist(q, p.spawn)).toBeGreaterThan(4);
      }
      const xs = p.perimeter.map((q) => q.x), zs = p.perimeter.map((q) => q.z);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(14);
      expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(10);
      expect(p.gates.length).toBeGreaterThanOrEqual(3);
    }
  });
  it("con otra semilla las muestras escondidas cambian de lugar; sin semilla el plan es siempre el mismo", () => {
    const a = planArena(room(), 1).samples, b = planArena(room(), 999).samples;
    expect(a.some((p, i) => dist(p, b[i]) > 1)).toBe(true);
    expect(planArena(room()).samples).toEqual(planArena(room()).samples);
  });
  it("respeta los obstáculos de un escaneo y los puntos con GPS del perímetro caminado", () => {
    const pts: number[] = [];
    for (let x = -12; x <= 12; x += 0.25) for (let z = -8; z <= 8; z += 0.25) pts.push(x, 0, z, 1);
    for (let x = -2; x <= 2; x += 0.2) for (let z = -2; z <= 2; z += 0.2) pts.push(x, 0.8, z, 1);          // mesa grande al centro
    const s = fromScan(new Float32Array(pts), { name: "salón", indoor: true, floor: "interior" });
    const p = planArena(s, 5);
    for (const q of [p.spawn, p.station, ...p.samples, ...p.perimeter, ...p.gates]) expect(isFree(s, q.x, q.z)).toBe(true);
    const g = fromPolygon([[-20, -12], [20, -12], [20, 12], [-20, 12]], { name: "cancha", indoor: false, floor: "pasto", source: "polygon" });
    g.pois = [{ x: 12, z: -6, label: "📷 1" }, { x: -10, z: 7, label: "📷 2" }, { x: 0, z: -8, label: "📷 3" }];
    g.station = { x: -15, z: -8 };
    const pg = planArena(g, 3);
    expect(dist(pg.station, g.station)).toBeLessThan(1);
    for (const poi of g.pois) expect(Math.min(...pg.samples.map((q) => dist(q, poi)))).toBeLessThan(1);
  });
  it("cámara: en medio del salón llega a donde quiere; contra la pared se acerca al rover y nunca queda afuera", () => {
    const s = room(), clr = clearanceMap(s);
    expect(camClamp(s, clr, 0, 0, 4, 0)).toBe(1);
    // rover a 1,2 m de la pared de x = +10 mirando al centro: la cámara quiere estar 4,5 m atrás (x = 13,3, afuera)
    const t = camClamp(s, clr, 8.8, 0, 13.3, 0);
    expect(t).toBeLessThan(0.3);
    const cx = 8.8 + (13.3 - 8.8) * t;
    expect(cx).toBeLessThan(10 - 0.25);            // al menos 25 cm dentro de la pared
    expect(isFree(s, cx, 0)).toBe(true);
    // en diagonal hacia una esquina tampoco sale
    const t2 = camClamp(s, clr, 8, 6, 12, 10), x2 = 8 + 4 * t2, z2 = 6 + 4 * t2;
    expect(x2).toBeLessThan(9.75); expect(z2).toBeLessThan(7.25);
    expect(camClamp(s, clr, 3, 3, 3, 3)).toBe(1);
  });
  it("escáner de muestras: 1 encima, 0 lejos, y crece al acercarse", () => {
    expect(scannerLevel(0, 12)).toBe(1);
    expect(scannerLevel(20, 12)).toBe(0);
    expect(scannerLevel(3, 12)).toBeGreaterThan(scannerLevel(6, 12));
  });
  it("el rover a escala (1,2 m) choca con la pared y queda adentro del salón", () => {
    const s = room(), w = buildArenaWorld(s, "mission", 9);
    expect(w.samples.length).toBe(3);
    expect(w.perimeter.length).toBeGreaterThanOrEqual(4);
    const env: Env = { height: () => 0, soil: w.soilAt, rocksNear: w.rocksNear, half: s.size / 2 };
    const p = makeParams(G.earth, "explorador");
    p.length *= ARENA_SCALE; p.width *= ARENA_SCALE; p.radius *= ARENA_SCALE; p.clearance *= ARENA_SCALE; p.maxSpeed = 2.8;
    const st = initialState(0, 0, Math.PI / 2, env, p);
    for (let i = 0; i < 15 * 120; i++) step(st, { throttle: 1, steer: 0, brake: false }, env, p, 1 / 120);
    expect(st.x).toBeGreaterThan(8);       // llegó hasta la pared
    expect(st.x).toBeLessThan(10);         // y no la cruzó
  });
});
