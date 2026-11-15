// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Escalas secuenciales de UN solo tono (de apagado a brillante sobre fondo oscuro): naranja = Marte, azul plata = Luna.
const MARS = ["#3a2a26", "#6b3524", "#a8492a", "#e0682f", "#ffa36e", "#ffd4b8"];
const MOON = ["#1f2940", "#2c4370", "#3f62a3", "#6188d0", "#93b4ef", "#d3e2ff"];

function hex(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const A = hex(a), B = hex(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
/** v en 0..1 → color de la escala del cuerpo. */
export function ramp(body: "mars" | "moon", v: number): string {
  const r = body === "mars" ? MARS : MOON;
  const x = Math.max(0, Math.min(1, v)) * (r.length - 1);
  const i = Math.min(r.length - 2, Math.floor(x));
  return mix(r[i], r[i + 1], x - i);
}
export function rampStops(body: "mars" | "moon"): string[] {
  return body === "mars" ? MARS : MOON;
}
export const ROLE_COLOR = { candidate: "#3987e5", control_pos: "#199e70", control_neg: "#8e9bb8" } as const;
export const BOLIVIA = "#c98500";
