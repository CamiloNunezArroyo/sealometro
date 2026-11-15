// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Señal de radio por línea de vista sobre el relieve: si un cerro se interpone, la señal cae.
// Repetidores: un nodo está conectado si ve a la base o a otro nodo conectado (cadena).
export interface Node { x: number; z: number; y: number; range: number }

/** ¿Hay línea de vista entre a y b? `blocked(x,z,yLine)` devuelve true si el suelo tapa la línea en ese punto. */
export function lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  blocked: (x: number, z: number, yLine: number) => boolean, stepM = 12): boolean {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.max(2, Math.ceil(d / stepM));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blocked(ax + (bx - ax) * t, az + (bz - az) * t, ay + (by - ay) * t)) return false;
  }
  return true;
}

/** Fuerza 0..1 desde un nodo: cae con la distancia; sin línea de vista queda una señal residual muy débil. */
export function strength(dist: number, range: number, los: boolean): number {
  const f = Math.max(0, 1 - dist / range);
  return los ? Math.sqrt(f) : 0.12 * f;
}

/** Nodos conectados a la base (índice 0) por saltos con línea de vista y dentro de alcance. */
export function connected(nodes: Node[], los: (a: Node, b: Node) => boolean): boolean[] {
  const ok = nodes.map((_, i) => i === 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < nodes.length; i++) {
      if (ok[i]) continue;
      for (let j = 0; j < nodes.length; j++) {
        if (!ok[j]) continue;
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
        if (d <= Math.min(nodes[i].range, nodes[j].range) && los(nodes[i], nodes[j])) { ok[i] = true; changed = true; break; }
      }
    }
  }
  return ok;
}

export function roverSignal(nodes: Node[], ok: boolean[], rx: number, ry: number, rz: number,
  los: (a: Node, x: number, y: number, z: number) => boolean): number {
  let best = 0;
  nodes.forEach((n, i) => {
    if (!ok[i]) return;
    const d = Math.hypot(rx - n.x, rz - n.z);
    if (d > n.range) return;
    best = Math.max(best, strength(d, n.range, los(n, rx, ry, rz)));
  });
  return best;
}
