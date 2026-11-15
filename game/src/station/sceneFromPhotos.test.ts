// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Pruebas del análisis de fotos con imágenes sintéticas (píxeles generados): baldosas, pasto, cemento, tierra, arena.
import { describe, expect, it } from "vitest";
import { analyzePixels, combineScenes, panoramaPlan, periodicity, propCount, type RGB } from "./sceneFromPhotos";

const W = 160, H = 120;
/** Imagen sintética: f(x, y, ruido) → color de cada píxel. Ruido determinista. */
function img(f: (x: number, y: number, n: number) => RGB): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  let s = 12345;
  const R = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = f(x, y, R() - 0.5), i = 4 * (y * W + x);
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return px;
}
const top = (y: number) => y < H * 0.3, mid = (y: number) => y >= H * 0.3 && y < H * 0.62;
const add = (c: RGB, k: number): RGB => [c[0] + k, c[1] + k, c[2] + k];

describe("análisis de fotos: piso, interior/exterior, luz y objetos", () => {
  it("baldosas con juntas bajo un techo blanco → baldosa, interior", () => {
    const s = analyzePixels(img((x, y, n) => top(y) ? add([236, 234, 228], n * 6) : mid(y) ? add([200, 180, 150], n * 6)
      : x % 12 < 2 || y % 10 < 2 ? [90, 85, 80] : add([205, 200, 190], n * 8)), W, H);
    expect(s.tile).toBeGreaterThan(0.5);
    expect(s.floor.kind).toBe("baldosa");
    expect(s.indoor.value).toBe(true);
  });
  it("baldosas en perspectiva (juntas cada vez más separadas) también son baldosa", () => {
    const rows = new Set<number>();
    for (let y = Math.round(H * 0.63), d = 3; y < H; y += Math.round(d), d *= 1.25) { rows.add(y); rows.add(y + 1); }
    const s = analyzePixels(img((x, y, n) => top(y) ? add([215, 212, 205], n * 6) : mid(y) ? add([90, 120, 170], n * 6)
      : rows.has(y) || Math.abs(((x - W / 2) * 30) / (10 + (y - H * 0.62) * 3) % 12) < 1 ? [100, 95, 88] : add([200, 194, 182], n * 8)), W, H);
    expect(s.tile).toBeGreaterThan(0.4);
    expect(s.floor.kind).toBe("baldosa");
  });
  it("una pared pintada de verde (lisa) no hace que parezca exterior; dos rayas de cancha no son baldosas", () => {
    const s = analyzePixels(img((_x, y, n) => top(y) ? add([210, 208, 200], n * 4) : mid(y) ? add([80, 160, 90], n * 4)
      : y === 100 || y === 110 ? [240, 240, 240] : add([150, 148, 144], n * 40)), W, H);
    expect(s.indoor.value).toBe(true);
    expect(s.floor.kind).toBe("cemento");
  });
  it("pasto bajo cielo azul → pasto, exterior", () => {
    const s = analyzePixels(img((_x, y, n) => top(y) ? add([110, 160, 225], n * 8) : mid(y) ? add([70, 120, 50], n * 40)
      : add([75, 130, 50], n * 50)), W, H);
    expect(s.floor.kind).toBe("pasto");
    expect(s.floor.conf).toBeGreaterThan(0.5);
    expect(s.indoor.value).toBe(false);
    expect(s.top.sky).toBeGreaterThan(0.8);
  });
  it("cemento gris con grano, tierra café y arena clara se distinguen", () => {
    const sky = (y: number, n: number): RGB | null => (top(y) ? add([120, 165, 230], n * 6) : null);
    const cem = analyzePixels(img((_x, y, n) => sky(y, n) ?? add([150, 148, 144], n * 40)), W, H);
    const tie = analyzePixels(img((_x, y, n) => sky(y, n) ?? [140 + n * 40, 100 + n * 30, 64 + n * 20]), W, H);
    const are = analyzePixels(img((_x, y, n) => sky(y, n) ?? [218 + n * 12, 192 + n * 12, 140 + n * 10]), W, H);
    expect(cem.floor.kind).toBe("cemento");
    expect(tie.floor.kind).toBe("tierra");
    expect(are.floor.kind).toBe("arena");
  });
  it("muchos bordes en la franja del medio = muchos objetos; pared lisa = pocos", () => {
    const busy = analyzePixels(img((x, y, n) => mid(y) ? ((Math.floor(x / 7) + Math.floor(y / 5)) % 2 ? [40, 40, 40] : [220, 210, 200]) : add([180, 180, 180], n * 4)), W, H);
    const calm = analyzePixels(img((_x, _y, n) => add([190, 185, 175], n * 4)), W, H);
    expect(busy.clutter.level).toBe("muchos");
    expect(calm.clutter.level).toBe("pocos");
    expect(calm.light.level).toBe("brillante");
  });
  it("un perfil periódico tiene autocorrelación alta; ruido, baja", () => {
    const p = new Float32Array(100).map((_, i) => (i % 10 === 0 ? 5 : 0));
    let s = 7;
    const q = new Float32Array(100).map(() => { s = (s * 16807) % 2147483647; return s / 2147483647; });
    expect(periodicity(p)).toBeGreaterThan(0.7);
    expect(periodicity(q)).toBeLessThan(0.45);
  });
  it("combinar fotos: vota el piso y promedia la paleta; las casi negras no votan", () => {
    const g = analyzePixels(img((_x, y, n) => top(y) ? add([110, 160, 225], n * 8) : add([75, 130, 50], n * 50)), W, H);
    const dark = analyzePixels(img(() => [5, 5, 5]), W, H);
    const sum = combineScenes([g, g, dark])!;
    expect(sum.n).toBe(2);
    expect(sum.floor.kind).toBe("pasto");
    expect(sum.indoor.value).toBe(false);
    expect(sum.palette.floor[1]).toBeGreaterThan(sum.palette.floor[0]);
    expect(combineScenes([dark])).toBeNull();
    expect(propCount(0, 600)).toBe(0);
    expect(propCount(1, 600)).toBe(14);
  });
  it("panorámica: usa el video con más fotogramas, en orden, cada uno con su dirección", () => {
    const fr = (v: string, idx: number) => ({ id: `${v}${idx}`, data: `d${v}${idx}`, t: 100 - idx, kind: "frame" as const, video: v, idx });
    const plan = panoramaPlan([fr("a", 2), fr("a", 0), fr("b", 0), fr("a", 1), fr("a", 3), { id: "p", data: "p", t: 1, kind: "photo" }]);
    expect(plan.source).toBe("video");
    expect(plan.parts.map((p) => p.id)).toEqual(["a0", "a1", "a2", "a3"]);
    expect(plan.parts[1].a0).toBeCloseTo(Math.PI / 2);
    expect(plan.parts[3].a1).toBeCloseTo(2 * Math.PI);
    const photos = panoramaPlan([{ id: "x", data: "x", t: 2, kind: "photo" }, { id: "y", data: "y", t: 1, kind: "photo" }]);
    expect(photos.source).toBe("photos");
    expect(photos.parts.map((p) => p.id)).toEqual(["y", "x", "y", "x"]);
    expect(panoramaPlan([]).source).toBe("none");
  });
});
