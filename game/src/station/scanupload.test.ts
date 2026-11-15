// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it } from "vitest";
import { b64ToBytes, scanFileProblem } from "./cloud";

describe("subida de escaneo desde el celular", () => {
  it("acepta GLB y PLY de tamaño razonable", () => {
    expect(scanFileProblem({ name: "Coliseo.GLB", size: 12e6 })).toBeNull();
    expect(scanFileProblem({ name: "patio.ply", size: 5e6 })).toBeNull();
  });
  it("rechaza formatos de varios archivos, desconocidos, vacíos o muy pesados", () => {
    expect(scanFileProblem({ name: "x.obj", size: 5e6 })).toMatch(/GLB/);
    expect(scanFileProblem({ name: "x.usdz", size: 5e6 })).toMatch(/no soportado/);
    expect(scanFileProblem({ name: "x.glb", size: 40 * 1048576 })).toMatch(/30 MB/);
    expect(scanFileProblem({ name: "x.glb", size: 10 })).toMatch(/vacío/);
  });
  it("base64 → bytes sin perder nada", () => {
    const src = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    const b64 = btoa(String.fromCharCode(...src));
    expect([...b64ToBytes(b64)]).toEqual([...src]);
  });
});
