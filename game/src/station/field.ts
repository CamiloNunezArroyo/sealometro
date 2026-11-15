// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Resumen de una medición → JSON del contrato de la caja (docs/CAJA_CAMPO.md §3) para el motor (`seal field`),
// y comparación rápida en el navegador con los 41 lugares analizados. Puro (testeable).
import { stat, type SensorReport, type Verdict } from "./quality";
import type { PhoneGps, Place, Reading } from "./types";

export interface Summary {
  n: number; t_utc: string; device: string; fw: string;
  t_c: number | null; rh: number | null; p_hpa: number | null; alt_baro: number | null; uv_mv: number | null; uvi: number | null; uv_sat: boolean;
  light_pct: number | null; light_sat: boolean; gas_raw: number | null; gas_warmup: number; gas_clipped: boolean;
  gps: { fix: boolean; lat?: number; lon?: number; alt_m?: number; hdop?: number; sats?: number; source: "caja" | "celular" | "ninguno"; acc_m?: number };
  verdicts: Record<string, Verdict>;
}

export function summarize(rs: Reading[], phone: PhoneGps | null, reps: SensorReport[]): Summary {
  const v = Object.fromEntries(reps.map((r) => [r.id, r.verdict])) as Record<string, Verdict>;
  const ok = (id: string) => v[id] !== "malo";            // lo que el análisis marcó "malo" NO se manda al motor
  const m = (xs: (number | undefined)[]) => stat(xs)?.mean ?? null;
  const last = rs[rs.length - 1];
  const fixes = rs.filter((r) => r.gps.fix && r.gps.lat !== undefined);
  const gps: Summary["gps"] = fixes.length
    ? { fix: true, lat: m(fixes.map((r) => r.gps.lat))!, lon: m(fixes.map((r) => r.gps.lon))!, alt_m: m(fixes.map((r) => r.gps.alt_m)) ?? undefined,
      hdop: m(fixes.map((r) => r.gps.hdop)) ?? undefined, sats: Math.round(m(fixes.map((r) => r.gps.sats)) ?? 0), source: "caja" }
    : phone ? { fix: true, lat: phone.lat, lon: phone.lon, alt_m: phone.alt ?? undefined, source: "celular", acc_m: phone.acc } : { fix: false, source: "ninguno" };
  const when = last?.ts ?? last?.received ?? Date.now();
  return {
    n: rs.length, t_utc: new Date(when).toISOString().replace(/\.\d+Z$/, "Z"), device: last?.device ?? "?", fw: last?.fw ?? "?",
    t_c: ok("t") ? m(rs.map((r) => r.bme.t_c)) : null, rh: ok("rh") ? m(rs.map((r) => r.bme.rh_pct)) : null,
    p_hpa: ok("p") ? m(rs.map((r) => r.bme.p_hpa)) : null, alt_baro: ok("p") ? m(rs.map((r) => r.bme.alt_baro_m)) : null,
    uv_mv: ok("uv") ? m(rs.map((r) => r.uv.mv)) : null, uvi: ok("uv") ? (m(rs.map((r) => r.uv.mv)) ?? 0) / 100 : null, uv_sat: rs.some((r) => r.uv.saturated),
    light_pct: ok("light") ? m(rs.map((r) => r.light.pct)) : null, light_sat: rs.filter((r) => r.light.pct >= 99).length > rs.length / 2,
    gas_raw: ok("gas") ? m(rs.map((r) => r.gas.raw)) : null, gas_warmup: last?.gas.warmup_s ?? 0, gas_clipped: rs.some((r) => r.gas.clipped),
    gps, verdicts: v,
  };
}

const r2 = (x: number | null, d = 2) => (x === null ? null : +x.toFixed(d));
/** JSON con el esquema de docs/CAJA_CAMPO.md §3 (lo lee `python -m seal field` y el servidor del motor). */
export function fieldJson(s: Summary, place: Place | null, photos: string[], simulated = false) {
  return {
    ...(simulated ? { ejemplo: true, _nota: "Datos del SIMULADOR de la página: inventados, no son una medición real." } : {}),
    device: s.device, fw: s.fw, t_utc: s.t_utc,
    gps: s.gps.fix ? { fix: true, lat: r2(s.gps.lat!, 6), lon: r2(s.gps.lon!, 6), alt_m: r2(s.gps.alt_m ?? null, 1), hdop: r2(s.gps.hdop ?? null, 1), sats: s.gps.sats ?? null,
      source: s.gps.source, acc_m: s.gps.acc_m ?? null } : { fix: false },
    air: { t_c: r2(s.t_c), rh_pct: r2(s.rh, 1), p_hpa: r2(s.p_hpa), alt_baro_m: r2(s.alt_baro, 1) },
    uv: { model: "GUVA-S12SD", mv: r2(s.uv_mv, 0), uvi_est: r2(s.uvi), saturated: s.uv_sat, calibrated: false },
    light: { model: "analógico (relativo)", pct: r2(s.light_pct, 0), lux_est: null, saturated: s.light_sat },
    gas: { model: "MQ", raw: r2(s.gas_raw, 0), mv: null, warmup_s: s.gas_warmup, calibrated: false, clipped: s.gas_clipped },
    photos, n_samples: s.n,
    notes: place ? `${place.kind}${place.indoor ? " (interior)" : ""}${place.floor ? `, suelo: ${place.floor}` : ""}` : "",
    quality: s.verdicts,
  };
}

/** Lugar analizado más parecido en lo que mide la caja (presión, humedad, UV). Escalas: decisión de diseño. */
export function nearestSites(s: Summary, sites: { id: string; name: string; climate: Record<string, { value?: number | null } | null> }[]) {
  const dims: [keyof Summary, string, number, (x: number) => number][] = [
    ["p_hpa", "pressure", 10, (x) => x / 10], ["rh", "rh", 20, (x) => x], ["uvi", "uv_index", 3, (x) => x]];
  const out = sites.map((site) => {
    let d = 0, k = 0;
    for (const [mk, sk, scale, conv] of dims) {
      const mv = s[mk] as number | null, sv = site.climate[sk]?.value;
      if (mv === null || typeof sv !== "number") continue;
      d += Math.abs(conv(mv) - sv) / scale; k++;
    }
    return { id: site.id, name: site.name, d: k ? d / k : Infinity, k };
  }).filter((x) => x.k > 0).sort((a, b) => a.d - b.d);
  return out.slice(0, 3);
}
