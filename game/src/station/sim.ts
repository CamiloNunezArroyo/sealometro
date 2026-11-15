// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Simulador de la caja: lecturas INVENTADAS (se dice en pantalla) para probar la página sin hardware, y escenarios con
// fallas típicas de sensores caseros para practicar el análisis de calidad. Valores base: un día de sol en Sucre.
import type { Reading } from "./types";

export type SimScenario = "ok" | "caliente" | "bmp280" | "humo_sin_divisor" | "interior" | "cortes";
export const SIM_SCENARIOS: { id: SimScenario; es: string; en: string }[] = [
  { id: "ok", es: "Todo bien (exterior, sol)", en: "All good (outdoors, sunny)" },
  { id: "caliente", es: "Caja recalentada al sol", en: "Box overheating in the sun" },
  { id: "bmp280", es: "Módulo BMP280 (sin humedad)", en: "BMP280 module (no humidity)" },
  { id: "humo_sin_divisor", es: "Sensor de humo sin divisor de voltaje", en: "Smoke sensor without voltage divider" },
  { id: "interior", es: "Bajo techo (sin GPS)", en: "Indoors (no GPS)" },
  { id: "cortes", es: "Wi-Fi débil (se cortan datos)", en: "Weak Wi-Fi (data drops)" },
];

let seed = 7;
const noise = (a: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return ((seed / 4294967296) - 0.5) * 2 * a; };

/** Lectura simulada número t (segundos desde que arrancó). En "cortes" devuelve un paquete con seq salteado. */
export function simReading(sc: SimScenario, t: number): Reading {
  const indoor = sc === "interior";
  const tC = indoor ? 19.2 + noise(0.05) : sc === "caliente" ? Math.min(41, 22 + t * 0.06) + noise(0.05) : 21.4 + Math.sin(t / 300) * 0.3 + noise(0.05);
  const p = 737.6 + Math.sin(t / 900) * 0.2 + noise(0.04);
  const uvMv = indoor ? 18 + noise(4) : 820 + noise(25);
  const light = indoor ? 31 + Math.round(noise(1)) : 86 + Math.round(noise(2));
  const gasRaw = sc === "humo_sin_divisor" ? 4095 : 910 + Math.round(noise(8));
  const tilt = 0.05;
  return {
    device: "seal-box-sim", fw: "sim", seq: sc === "cortes" ? Math.floor(t * 1.6) : t, boot: 1, uptime_s: 30 + t,
    t_dev: Math.floor(Date.now() / 1000),
    bme: { ok: true, t_c: +tC.toFixed(2), rh_pct: sc === "bmp280" ? 0 : +(indoor ? 41 + noise(0.3) : 34 + noise(0.4)).toFixed(1), p_hpa: +p.toFixed(2),
      alt_baro_m: +(44330 * (1 - Math.pow(p / 1013.25, 0.1903))).toFixed(1) },
    mpu: { ok: true, ax: +(tilt + noise(0.01)).toFixed(3), ay: +noise(0.01).toFixed(3), az: +(0.998 + noise(0.01)).toFixed(3),
      gx: +(-1.2 + noise(0.3)).toFixed(2), gy: +(0.8 + noise(0.3)).toFixed(2), gz: +(0.4 + noise(0.3)).toFixed(2), t_c: +(tC + 6 + noise(0.2)).toFixed(1) },
    uv: { model: "GUVA-S12SD", mv: Math.round(uvMv), uvi_est: +(uvMv / 100).toFixed(2), saturated: uvMv >= 1700, calibrated: false },
    light: { raw: Math.round(light * 40.95), pct: light, inverted: false },
    gas: { model: "MQ", raw: gasRaw, baseline: 900, delta: gasRaw - 900, alert: gasRaw - 900 > 200, warmup_s: 30 + t, clipped: gasRaw >= 4090 },
    gps: indoor ? { fix: false, sats: 1, hdop: 99.9 }
      : { fix: true, sats: 9, hdop: 0.9, lat: -19.04327 + noise(0.00002), lon: -65.25918 + noise(0.00002), alt_m: +(2812 + noise(2)).toFixed(1), kmh: 0.3, age_ms: 400 },
    wifi_rssi: sc === "cortes" ? -86 : -58,
  };
}
