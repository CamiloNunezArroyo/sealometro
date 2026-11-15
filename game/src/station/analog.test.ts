// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Los números esperados salieron del MOTOR en Python (engine/seal/score/similarity.py) con los mismos datos.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffTable, missionFit, parsePower, scoreTarget, siteValues, type FieldTargets, type SiteVals } from "./analog";

const ft = JSON.parse(readFileSync(resolve(__dirname, "../../public/data/engine/field_targets.json"), "utf-8")) as FieldTargets;
const jez = ft.targets.find((t) => t.id === "mars_jezero")!;
const site: SiteVals = {
  t_mean: { value: 285, status: "modeled", source: "x" }, t_range_diurnal: { value: 14, status: "modeled", source: "x" },
  precip: { value: 600, status: "modeled", source: "x" }, soil_moisture: { value: 0.5, status: "modeled", source: "x" },
  rh: { value: 60, status: "modeled", source: "x" }, pressure: { value: 73, status: "measured", source: "caja" },
};

describe("analogía en la página = motor en Python", () => {
  it("mismas similitudes, IFA, cobertura y regla de suficiencia que el motor", () => {
    const r = scoreTarget(site, jez, ft);
    const s = Object.fromEntries(r.dims.map((d) => [d.id, d.s]));
    expect(s.t_mean).toBeCloseTo(0.01111, 4);
    expect(s.t_range_diurnal).toBeCloseTo(0.22263, 4);
    expect(s.precip).toBeCloseTo(0.02105, 4);
    expect(s.soil_moisture).toBeCloseTo(0.00387, 4);
    expect(r.ifaRaw!).toBeCloseTo(5.9817, 3);
    expect(r.coverage).toBeCloseTo(0.36, 3);
    expect(r.ifa).toBeNull();                 // < 40 %: el motor tampoco da puntaje oficial
    expect(r.why).toMatch(/cobertura 36/);
  });
  it("presión: brecha → progreso hacia Marte (Sucre 73 kPa ≈ 5,7 % del camino)", () => {
    const g = scoreTarget(site, jez, ft).gaps.find((x) => x.id === "pressure")!;
    expect(g.po).toBeCloseTo(0.05748, 4);
  });
  it("POWER: lee la climatología y corrige por elevación como el motor", () => {
    const c = parsePower({ properties: { parameter: { T2M: { ANN: 12 }, T2M_RANGE: { ANN: 14 }, RH2M: { ANN: 60 }, PRECTOTCORR: { ANN: 2 }, GWETTOP: { ANN: 0.5 }, PS: { ANN: 75 }, ALLSKY_SFC_UV_INDEX: { ANN: -999 } } }, geometry: { coordinates: [-65, -19, 3000] } });
    expect(c.uv).toBeNull();
    expect(c.precip_mm_y).toBeCloseTo(730.5, 1);
    const v = siteValues(c, 2800, null);
    expect(v.t_mean!.value).toBeCloseTo(285.15 + 1.3, 2);   // 200 m más abajo → +1,3 K
    expect(v.t_mean!.status).toBe("derived");
    expect(v.pressure!.value).toBeGreaterThan(75);
    expect(siteValues(c, 2800, 730).pressure!.status).toBe("measured");
  });
});

describe("medido vs referencia y aptitud", () => {
  it("la presión coincide dentro de la tolerancia; adentro no compara UV", () => {
    const rows = diffTable({ t_c: 20.7, rh: 53, p_hpa: 730.8, uvi: 1.4 }, { t_c: 11.3, rh: 100, p_hpa: 735, uvi: 0 }, null, true);
    const p = rows.find((r) => r.id === "p")!;
    expect(p.ok).toBe(true);
    expect(rows.find((r) => r.id === "uv")).toBeUndefined();
    expect(rows.find((r) => r.id === "t")!.ok).toBe(false);
  });
  it("aptitud: salón chico de cemento < campo grande de tierra", () => {
    const base = { indoor: false, tiltStd_deg: 0.5, gasAlert: false, light_pct: 80, gpsFix: true, gpsAcc_m: 5 };
    const a = missionFit({ ...base, area_m2: 160, minSide_m: 12, floor: "cemento" }).score!;
    const b = missionFit({ ...base, area_m2: 900, minSide_m: 30, floor: "tierra" }).score!;
    expect(b).toBeGreaterThan(a);
    expect(missionFit({ ...base, area_m2: 900, minSide_m: 30, floor: "tierra", gasAlert: true }).score!).toBeLessThan(b);
  });
});
