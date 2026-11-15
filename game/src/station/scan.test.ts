// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { scanToArena } from "./scan";

/** Salón 20 × 15 m, paredes de 4 m, malla de DOS lados con vértices compartidos y sin normales (caso difícil). */
function salon(): THREE.Mesh {
  const W = 20, L = 15, H = 4, pos: number[] = [], idx: number[] = [];
  const quad = (q: number[][]) => { const n = pos.length / 3; q.forEach((v) => pos.push(...v)); idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2); };
  quad([[0, 0, 0], [W, 0, 0], [W, 0, L], [0, 0, L]]);
  for (const [x0, z0, x1, z1] of [[0, 0, W, 0], [W, 0, W, L], [W, L, 0, L], [0, L, 0, 0]]) quad([[x0, 0, z0], [x1, 0, z1], [x1, H, z1], [x0, H, z0]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g);
}

describe("escaneo → mapa jugable", () => {
  it("detecta el piso de una malla de dos lados sin normales", () => {
    const { spec } = scanToArena(salon(), false, 1, { name: "t", indoor: true, floor: "interior" });
    const c = spec.size / (spec.n - 1), free = spec.blocked.filter((b) => !b).length * c * c;
    expect(free).toBeGreaterThan(200);   // 300 m² menos el borde de paredes
    expect(free).toBeLessThan(320);
  });
});
