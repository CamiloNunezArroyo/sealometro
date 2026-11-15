// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Peligros que se mueven o aparecen (lógica pura, sin Three.js, testeable). Todos son ELEMENTOS DE JUEGO inspirados en
// fenómenos reales: remolinos de polvo (Marte y desiertos de la Tierra), rocas que ruedan por pendientes, géiseres y
// fumarolas, tormentas solares (sin campo magnético ni atmósfera gruesa) y lluvia/nieve según el clima REAL del lugar.
import { rng } from "./terrain";

export interface Devil { x: number; z: number; vx: number; vz: number; r: number; life: number; spin: number }
export interface Boulder { x: number; z: number; y: number; vx: number; vz: number; r: number; alive: boolean; t: number }

/** Remolinos de polvo: solo en lugares secos (lluvia real < 500 mm/año) y nunca en la Luna (no hay aire). */
export function devilCount(precipMm: number | null, gravity: "earth" | "mars" | "moon"): number {
  if (gravity === "moon") return 0;
  const p = precipMm ?? 300;
  return p < 150 ? 3 : p < 500 ? 2 : 0;
}

export function spawnDevil(R: () => number, cx: number, cz: number, half: number): Devil {
  const a = R() * 2 * Math.PI, d = 180 + R() * 260, h = R() * 2 * Math.PI, sp = 2.5 + R() * 3;
  const x = Math.max(-half + 50, Math.min(half - 50, cx + Math.cos(a) * d));
  const z = Math.max(-half + 50, Math.min(half - 50, cz + Math.sin(a) * d));
  return { x, z, vx: Math.cos(h) * sp, vz: Math.sin(h) * sp, r: 7 + R() * 7, life: 60 + R() * 60, spin: 0 };
}

/** Avanza un remolino: deriva con cambios suaves de rumbo y se acerca de a poco al rover (más divertido). */
export function updateDevil(d: Devil, dt: number, R: () => number, rx: number, rz: number, half: number) {
  const ang = Math.atan2(d.vz, d.vx) + (R() - 0.5) * 0.9 * dt;
  const sp = Math.hypot(d.vx, d.vz);
  const toR = Math.atan2(rz - d.z, rx - d.x);
  const mix = Math.atan2(Math.sin(toR - ang), Math.cos(toR - ang)) * 0.12 * dt;
  d.vx = Math.cos(ang + mix) * sp;
  d.vz = Math.sin(ang + mix) * sp;
  d.x += d.vx * dt;
  d.z += d.vz * dt;
  d.spin += dt * 6;
  d.life -= dt;
  if (Math.abs(d.x) > half - 30 || Math.abs(d.z) > half - 30) d.life = 0;
}

/** Efecto sobre el rover: empuje lateral (m/s²) y fuerza 0..1 si está dentro del remolino. */
export function devilPush(d: Devil, rx: number, rz: number): { ax: number; az: number; k: number } {
  const dx = rx - d.x, dz = rz - d.z, dist = Math.hypot(dx, dz);
  if (dist > d.r) return { ax: 0, az: 0, k: 0 };
  const k = 1 - dist / d.r;
  // tangencial (gira) + un poco hacia afuera
  const tx = -dz / (dist || 1), tz = dx / (dist || 1);
  return { ax: (tx * 0.8 + (dx / (dist || 1)) * 0.3) * 6 * k, az: (tz * 0.8 + (dz / (dist || 1)) * 0.3) * 6 * k, k };
}

/** Busca un punto pendiente arriba (≥ 18°) cerca del rover para soltar una roca; null si no hay ladera. */
export function boulderSpawn(R: () => number, rx: number, rz: number, slopeDeg: (x: number, z: number) => number,
  heightAt: (x: number, z: number) => number): { x: number; z: number } | null {
  for (let i = 0; i < 30; i++) {
    const a = R() * 2 * Math.PI, d = 35 + R() * 55;
    const x = rx + Math.cos(a) * d, z = rz + Math.sin(a) * d;
    if (slopeDeg(x, z) >= 18 && heightAt(x, z) > heightAt(rx, rz) + 6) return { x, z };
  }
  return null;
}

/** Roca rodando: acelera pendiente abajo (g·senθ) con rozamiento; se detiene en terreno plano. */
export function updateBoulder(b: Boulder, dt: number, g: number, heightAt: (x: number, z: number) => number) {
  const e = 1.5;
  const hx = (heightAt(b.x + e, b.z) - heightAt(b.x - e, b.z)) / (2 * e);
  const hz = (heightAt(b.x, b.z + e) - heightAt(b.x, b.z - e)) / (2 * e);
  const slope = Math.hypot(hx, hz);
  const sin = slope / Math.sqrt(1 + slope * slope);
  if (slope > 1e-4) { b.vx += (-hx / slope) * g * sin * 0.7 * dt; b.vz += (-hz / slope) * g * sin * 0.7 * dt; }
  const sp = Math.hypot(b.vx, b.vz);
  const fr = Math.max(0, 1 - (0.35 + (sin < 0.12 ? 1.6 : 0)) * dt); // en lo plano frena rápido
  b.vx *= fr; b.vz *= fr;
  b.x += b.vx * dt; b.z += b.vz * dt;
  b.y = heightAt(b.x, b.z) + b.r * 0.9;
  b.t += dt;
  if ((sp < 0.4 && b.t > 3) || b.t > 40) b.alive = false;
}

/** Géiser / fumarola: ciclo determinista por semilla. 'warn' 3 s antes de la erupción (vapor creciente). */
export function geyserPhase(t: number, seed: number): "calm" | "warn" | "erupt" {
  const period = 22 + (seed % 9);
  const ph = (t + (seed % 13) * 1.7) % period;
  return ph < period - 8 ? "calm" : ph < period - 5 ? "warn" : "erupt";
}

export type WeatherKind = "clear" | "rain" | "snow";
export type WeatherChoice = "auto" | "clear" | "rain";
/**
 * Clima de la partida. "auto" = probabilidad de diseño a partir de la lluvia anual REAL (NASA POWER):
 * p = min(0,5; lluvia/1200 mm). Con temperatura media bajo 0 °C la precipitación cae como nieve.
 * Ej.: Atacama (7 mm/año) casi nunca llueve; Amazonía (1983 mm) 1 de cada 2 partidas.
 */
export function pickWeather(choice: WeatherChoice, precipMm: number | null, tMeanK: number | null, seed: number):
  { kind: WeatherKind; prob: number; start: number; intensity: number } {
  const prob = Math.min(0.5, Math.max(0, (precipMm ?? 0) / 1200));
  const R = rng(seed);
  const wet = choice === "rain" || (choice === "auto" && R() < prob);
  const kind: WeatherKind = !wet ? "clear" : (tMeanK ?? 285) < 273.15 ? "snow" : "rain";
  return { kind, prob, start: choice === "rain" ? 4 : 15 + R() * 60, intensity: 0.5 + R() * 0.5 };
}

/** Tormenta solar: solo con gravedad de Marte o la Luna (en la Tierra el campo magnético y el aire protegen). */
export function solarStormTime(gravity: "earth" | "mars" | "moon", seed: number): number | null {
  if (gravity === "earth") return null;
  const R = rng(seed ^ 0x5eed);
  return R() < 0.65 ? 70 + R() * 120 : null;
}
