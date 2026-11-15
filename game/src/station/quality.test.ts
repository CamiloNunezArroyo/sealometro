// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it } from "vitest";
import { analyze, distM, trendPerMin } from "./quality";
import { simReading, type SimScenario } from "./sim";
import { isaPressure, type Meteo } from "./reference";

const meteo: Meteo = { t_c: 21, rh: 36, p_hpa: 737.9, uvi: 8, is_day: true, cloud: 10, time: "", elev_m: 2810 };
const run = (sc: SimScenario, secs = 90, indoor: boolean | null = false) => {
  const now = Date.now();
  const rs = Array.from({ length: secs }, (_, t) => ({ ...simReading(sc, t), received: now - (secs - t) * 1000 }));
  return analyze(rs, { indoor, meteo: indoor ? null : meteo, demElev: 2810, phone: { lat: -19.0433, lon: -65.2592, acc: 8, t: now }, now });
};
const v = (r: ReturnType<typeof run>, id: string) => r.sensors.find((s) => s.id === id)!.verdict;

describe("análisis de calidad de la caja", () => {
  it("todo bien: presión, temperatura, GPS e inclinación buenos; UV nunca 'bueno' (sin calibrar)", () => {
    const r = run("ok");
    expect(r.link.verdict).toBe("bueno");
    expect(v(r, "p")).toBe("bueno");
    expect(v(r, "t")).toBe("bueno");
    expect(v(r, "gps")).toBe("bueno");
    expect(v(r, "mpu")).toBe("bueno");
    expect(v(r, "uv")).toBe("aceptable");
  });
  it("caja recalentada al sol: la temperatura queda dudosa y se explica por qué", () => {
    const r = run("caliente", 300);
    expect(v(r, "t")).toBe("dudoso");
    expect(r.sensors.find((s) => s.id === "t")!.tips.join(" ").length).toBeGreaterThan(10);
  });
  it("BMP280 sin humedad: humedad 'malo' con la explicación del módulo", () => {
    const r = run("bmp280");
    expect(v(r, "rh")).toBe("malo");
    expect(JSON.stringify(r.sensors.find((s) => s.id === "rh"))).toContain("BMP280");
  });
  it("humo sin divisor de voltaje: 'malo' y advierte del daño al pin", () => {
    const r = run("humo_sin_divisor");
    expect(v(r, "gas")).toBe("malo");
    expect(JSON.stringify(r.sensors.find((s) => s.id === "gas"))).toContain("divisor");
  });
  it("bajo techo: sin GPS no es un error y el UV casi 0 está bien", () => {
    const r = run("interior", 90, true);
    expect(v(r, "gps")).toBe("sin_dato");
    expect(v(r, "uv")).toBe("aceptable");
  });
  it("Wi-Fi débil: se detectan las lecturas perdidas", () => {
    const r = run("cortes");
    expect(["dudoso", "aceptable"]).toContain(r.link.verdict);
  });
  it("sin lecturas: lo dice, sin inventar", () => {
    const r = analyze([], { indoor: null, meteo: null, demElev: null, phone: null, now: Date.now() });
    expect(r.link.verdict).toBe("sin_dato");
    expect(r.sensors.length).toBe(0);
  });
  it("utilidades: atmósfera estándar, distancia y tendencia", () => {
    expect(isaPressure(0)).toBeCloseTo(1013.25, 1);
    expect(isaPressure(2810)).toBeGreaterThan(715);
    expect(isaPressure(2810)).toBeLessThan(735);
    expect(distM({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 })).toBeCloseTo(111.2, 0);
    expect(trendPerMin(Array.from({ length: 60 }, (_, i) => i / 60))).toBeCloseTo(1, 3);
  });
});

import { fieldJson, nearestSites, summarize } from "./field";
describe("resumen de la medición → JSON del contrato de la caja", () => {
  it("BMP280: la humedad 0 % (marcada 'malo') NO se manda al motor; la presión sí", () => {
    const now = Date.now();
    const rs = Array.from({ length: 60 }, (_, t) => ({ ...simReading("bmp280", t), received: now - (60 - t) * 1000 }));
    const rep = analyze(rs, { indoor: false, meteo, demElev: 2810, phone: null, now });
    const s = summarize(rs, null, rep.sensors);
    const j = fieldJson(s, { kind: "plaza", indoor: false, floor: "cemento" }, []);
    expect(j.air.rh_pct).toBeNull();
    expect(j.air.p_hpa).toBeGreaterThan(730);
    expect(j.gps.fix).toBe(true);
    expect(j.uv.calibrated).toBe(false);
  });
  it("sin GPS en la caja usa el del celular y lo dice", () => {
    const now = Date.now();
    const rs = Array.from({ length: 30 }, (_, t) => ({ ...simReading("interior", t), received: now - (30 - t) * 1000 }));
    const s = summarize(rs, { lat: -19.04, lon: -65.26, acc: 12, t: now }, analyze(rs, { indoor: true, meteo: null, demElev: null, phone: null, now }).sensors);
    expect(s.gps.source).toBe("celular");
  });
  it("lugar más parecido por presión/humedad/UV", () => {
    const s = summarize(Array.from({ length: 30 }, (_, t) => simReading("ok", t)), null, []);
    const top = nearestSites(s, [
      { id: "alto", name: "Alto", climate: { pressure: { value: 73.5 }, rh: { value: 35 }, uv_index: { value: 8 } } },
      { id: "bajo", name: "Bajo", climate: { pressure: { value: 100.5 }, rh: { value: 80 }, uv_index: { value: 3 } } },
    ]);
    expect(top[0].id).toBe("alto");
  });
});

import { parseLine } from "./serial";
describe("plan B por cable USB", () => {
  it("lee la línea SEALJSON del firmware e ignora los otros mensajes", () => {
    const r = simReading("ok", 3);
    const line = "SEALJSON " + JSON.stringify({ ...r, received: undefined, ts: undefined });
    const p = parseLine(line, 1000)!;
    expect(p.bme.p_hpa).toBe(r.bme.p_hpa);
    expect(p.received).toBe(1000);
    expect(parseLine("BME280 NO encontrado")).toBeNull();
    expect(parseLine("SEALJSON {roto")).toBeNull();
  });
});
