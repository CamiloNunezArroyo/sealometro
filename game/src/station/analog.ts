// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// "¿Qué tanto se parece este lugar a Marte / la Luna?" en la página /estacion, con la MISMA matemática del motor
// (engine/seal/score/similarity.py): núcleo gaussiano s = exp(-½ (d/τ)²), d = distancia al rango del objetivo en el
// espacio de la dimensión (lineal / log / log1p); IFA = promedio ponderado de s; cobertura = peso con datos / peso total.
// Datos: valores de Marte/Luna con fuente y pesos/τ exportados del motor (data/engine/field_targets.json,
// engine/seal/export/field_targets.py); clima del punto con NASA POWER (climatología); la caja aporta la presión
// (brecha: solo "progreso") y la comparación medido-vs-referencia.
//
// Honestidad: sin pendiente/rugosidad/NDVI/minerales (los pone el motor completo con `python -m seal serve`), la
// cobertura queda baja: se muestra como "IFA parcial (solo clima)", una REFERENCIA, no el puntaje oficial.

export type Space = "linear" | "log" | "log1p";
export interface FtFeature { label: string; unit: string; space: Space; tau: number | null; weight: number; analogable: boolean; note?: string | null }
export interface FtValue { value: number | null; lo: number | null; hi: number | null; unit: string; status: string; source: string; ref?: string | null; usable: boolean }
export interface FtTarget { id: string; body: "mars" | "moon"; name: string; values: Record<string, FtValue> }
export interface FieldTargets { features: Record<string, FtFeature>; earth_median: Record<string, number | null>; targets: FtTarget[]; ifa_weights_all: Record<string, number>; min_ifa_coverage: number }

export interface SiteVal { value: number; status: "measured" | "modeled" | "derived"; source: string; note?: string }
export type SiteVals = Partial<Record<string, SiteVal>>;

const FIRM = new Set(["measured", "modeled", "literature", "derived"]);

export function transform(x: number, space: Space): number | null {
  if (space === "linear") return x;
  if (space === "log") return x > 0 ? Math.log10(x) : null;
  return x > -1 ? Math.log10(1 + x) : null;
}
export const distToInterval = (x: number, a: number, b: number) => (x >= a && x <= b ? 0 : Math.min(Math.abs(x - a), Math.abs(x - b)));
export const gauss = (d: number, tau: number) => Math.exp(-0.5 * (d / tau) ** 2);

/** s (0..1) de una dimensión, o null si falta algo. */
export function dimSimilarity(x: number, t: FtValue, f: FtFeature): number | null {
  if (!t.usable || t.lo === null || t.hi === null || !f.tau) return null;
  const xt = transform(x, f.space), at = transform(t.lo, f.space), bt = transform(t.hi, f.space);
  if (xt === null || at === null || bt === null) return null;
  return gauss(distToInterval(xt, at, bt), f.tau);
}

/** Progreso hacia el objetivo desde la mediana terrestre (0 = como la Tierra típica, 1 = llegó). Para brechas. */
export function progress(x: number, t: FtValue, median: number, space: Space): number | null {
  if (!t.usable || t.lo === null || t.hi === null) return null;
  const xt = transform(x, space), mt = transform(median, space), at = transform(t.lo, space), bt = transform(t.hi, space);
  if (xt === null || mt === null || at === null || bt === null) return null;
  const tt = Math.min(Math.max(mt, Math.min(at, bt)), Math.max(at, bt));
  if (tt === mt) return null;
  return Math.min(1, Math.max(0, (xt - mt) / (tt - mt)));
}

export interface DimOut { id: string; label: string; unit: string; x: number; xSource: string; xStatus: string; lo: number; hi: number; tStatus: string; tSource: string; s: number; w: number }
export interface GapOut { id: string; label: string; unit: string; x: number; xSource: string; lo: number; hi: number; po: number; tSource: string }
export interface TargetScore { id: string; name: string; body: "mars" | "moon"; ifa: number | null; ifaRaw: number | null; coverage: number; why: string | null; limiting: string | null; dims: DimOut[]; gaps: GapOut[] }

export function scoreTarget(site: SiteVals, t: FtTarget, ft: FieldTargets): TargetScore {
  const total = Object.values(ft.ifa_weights_all).reduce((a, b) => a + b, 0);
  const dims: DimOut[] = [], gaps: GapOut[] = [];
  for (const [id, f] of Object.entries(ft.features)) {
    const x = site[id], tv = t.values[id];
    if (!x || !tv || !tv.usable || tv.lo === null || tv.hi === null) continue;
    if (f.analogable && f.weight > 0) {
      const s = dimSimilarity(x.value, tv, f);
      if (s !== null) dims.push({ id, label: f.label, unit: f.unit, x: x.value, xSource: x.source, xStatus: x.status, lo: tv.lo, hi: tv.hi, tStatus: tv.status, tSource: tv.source, s, w: f.weight });
    } else {
      const med = ft.earth_median[id];
      const po = med != null ? progress(x.value, tv, med, f.space) : null;
      if (po !== null) gaps.push({ id, label: f.label, unit: f.unit, x: x.value, xSource: x.source, lo: tv.lo, hi: tv.hi, po, tSource: tv.source });
    }
  }
  const cw = dims.reduce((a, d) => a + d.w, 0);
  const ifaRaw = cw > 0 ? (100 * dims.reduce((a, d) => a + d.w * d.s, 0)) / cw : null;
  const coverage = total > 0 ? cw / total : 0;
  let why: string | null = null;
  if (ifaRaw === null) why = "sin dimensiones con datos";
  else if (coverage < ft.min_ifa_coverage) why = `cobertura ${Math.round(100 * coverage)} % < ${Math.round(100 * ft.min_ifa_coverage)} % (mínimo del motor)`;
  else if (!dims.some((d) => FIRM.has(d.tStatus))) why = "los valores usados del objetivo son simplificaciones (estimated/design)";
  const limiting = dims.length ? [...dims].sort((a, b) => a.s - b.s)[0].id : null;
  return { id: t.id, name: t.name, body: t.body, ifa: why ? null : ifaRaw, ifaRaw, coverage, why, limiting, dims, gaps };
}

// ------------------------------------------------------------------ NASA POWER (climatología del punto)
export interface PowerClim { t_mean_k: number | null; t_range_k: number | null; rh: number | null; precip_mm_y: number | null; soil: number | null; ps_kpa: number | null; uv: number | null; cellElev: number | null }
export const POWER_REF = "https://power.larc.nasa.gov/docs/";

export function parsePower(j: { properties?: { parameter?: Record<string, Record<string, number>> }; geometry?: { coordinates?: number[] } }): PowerClim {
  const p = j.properties?.parameter ?? {};
  const ann = (k: string) => { const v = p[k]?.ANN; return v === undefined || v <= -998 ? null : v; };
  const t = ann("T2M"), pr = ann("PRECTOTCORR");
  return { t_mean_k: t === null ? null : t + 273.15, t_range_k: ann("T2M_RANGE"), rh: ann("RH2M"), precip_mm_y: pr === null ? null : pr * 365.25,
    soil: ann("GWETTOP"), ps_kpa: ann("PS"), uv: ann("ALLSKY_SFC_UV_INDEX"), cellElev: j.geometry?.coordinates?.[2] ?? null };
}
export async function fetchPowerClimate(lat: number, lon: number): Promise<PowerClim> {
  const u = "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_RANGE,RH2M,PRECTOTCORR,GWETTOP,PS,ALLSKY_SFC_UV_INDEX"
    + `&community=RE&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&format=JSON`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`NASA POWER HTTP ${r.status}`);
  return parsePower(await r.json());
}

const isaKpa = (h: number) => 101.325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
/** Valores del sitio para el puntaje: clima de POWER corregido por elevación (como el motor) + presión medida por la caja. */
export function siteValues(c: PowerClim | null, siteElev: number | null, boxP_hpa: number | null): SiteVals {
  const v: SiteVals = {};
  if (c) {
    const dh = c.cellElev !== null && siteElev !== null ? siteElev - c.cellElev : 0;
    const corr = Math.abs(dh) >= 50;
    const src = "NASA POWER (climatología)";
    if (c.t_mean_k !== null) v.t_mean = { value: c.t_mean_k - (corr ? 0.0065 * dh : 0), status: corr ? "derived" : "modeled", source: src + (corr ? `, corregida por elevación (${dh > 0 ? "+" : ""}${Math.round(dh)} m, 6,5 K/km)` : ", T2M") };
    if (c.t_range_k !== null) v.t_range_diurnal = { value: c.t_range_k, status: "modeled", source: src + ", T2M_RANGE" };
    if (c.rh !== null) v.rh = { value: c.rh, status: "modeled", source: src + ", RH2M" };
    if (c.precip_mm_y !== null) v.precip = { value: c.precip_mm_y, status: "modeled", source: src + ", PRECTOTCORR × 365,25" };
    if (c.soil !== null) v.soil_moisture = { value: c.soil, status: "modeled", source: src + ", GWETTOP" };
    if (c.ps_kpa !== null && boxP_hpa === null) v.pressure = { value: corr && c.cellElev !== null && siteElev !== null ? c.ps_kpa * isaKpa(siteElev) / isaKpa(c.cellElev) : c.ps_kpa, status: corr ? "derived" : "modeled", source: src + ", PS" };
  }
  if (boxP_hpa !== null) v.pressure = { value: boxP_hpa / 10, status: "measured", source: "SEAL-BOX (BME280)" };
  return v;
}

// ------------------------------------------------------------------ medido vs referencia
export interface DiffRow { id: string; es: string; en: string; unit: string; measured: number; ref: number; refSrc: string; diff: number; tol: number; ok: boolean; noteEs: string; noteEn: string }
/** Compara la caja con referencias independientes. tol = incertidumbre del sensor + la de la referencia (decisión nuestra, design). */
export function diffTable(s: { t_c: number | null; rh: number | null; p_hpa: number | null; uvi: number | null; alt_gps?: number | null },
  now: { t_c: number; rh: number; p_hpa: number; uvi: number } | null, demElev: number | null, indoor: boolean | null): DiffRow[] {
  const out: DiffRow[] = [];
  const row = (id: string, es: string, en: string, unit: string, m: number | null, r: number | null, refSrc: string, tol: number, noteEs = "", noteEn = "") => {
    if (m === null || r === null) return;
    const diff = m - r;
    out.push({ id, es, en, unit, measured: m, ref: r, refSrc, diff, tol, ok: Math.abs(diff) <= tol, noteEs, noteEn });
  };
  const inside = indoor === true;
  if (now) {
    row("t", "Temperatura del aire", "Air temperature", "°C", s.t_c, now.t_c, "Open-Meteo (ahora)", 1 + 2,
      inside ? "Bajo techo es normal que difiera: el modelo da el aire de afuera." : "BME280 ±1 °C + modelo ±2 °C.", inside ? "Indoors it differs by nature: the model gives outdoor air." : "BME280 ±1 °C + model ±2 °C.");
    row("rh", "Humedad relativa", "Relative humidity", "%", s.rh, now.rh, "Open-Meteo (ahora)", 3 + 10,
      inside ? "Bajo techo cambia con la calefacción y la gente." : "BME280 ±3 % + modelo ±10 %.", inside ? "Indoors it changes with heating and people." : "BME280 ±3% + model ±10%.");
    row("p", "Presión del aire", "Air pressure", "hPa", s.p_hpa, now.p_hpa, "Open-Meteo (ahora, a la altura del terreno)", 1 + 3 + 1,
      "BME280 ±1 hPa + modelo ±3 hPa + altura del DEM ±10 m (≈ ±1 hPa; cada piso de un edificio resta ~0,4 hPa). La presión SÍ es igual adentro y afuera: es la mejor prueba del sensor.",
      "BME280 ±1 hPa + model ±3 hPa + DEM height ±10 m (≈ ±1 hPa; each building floor takes ~0.4 hPa). Pressure IS the same indoors: best sensor check.");
    if (!inside) row("uv", "Índice UV", "UV index", "", s.uvi, now.uvi, "Open-Meteo (ahora)", 2,
      "Sensor sin calibrar (≈ mV/100): ±2 es lo mejor esperable.", "Uncalibrated sensor (≈ mV/100): ±2 at best.");
  }
  if (s.alt_gps != null && demElev !== null) row("h", "Altura (GPS vs DEM)", "Height (GPS vs DEM)", "m", s.alt_gps, demElev, "Copernicus DEM GLO-90 (Open-Meteo)", 15 + 10,
    "Altura del GPS ±15 m + DEM ±10 m.", "GPS height ±15 m + DEM ±10 m.");
  return out;
}

// ------------------------------------------------------------------ aptitud del lugar para una prueba de rover
export interface FitItem { id: string; es: string; en: string; score: number | null; w: number; whyEs: string; whyEn: string }
/** Pesos y umbrales: DECISIÓN NUESTRA (design), para elegir dónde hacer la prueba. No es ciencia ni se compara con Marte. */
export function missionFit(o: { area_m2: number | null; minSide_m: number | null; floor: string | null; indoor: boolean | null; tiltStd_deg: number | null;
  gasAlert: boolean; light_pct: number | null; gpsFix: boolean; gpsAcc_m: number | null }): { score: number | null; coverage: number; items: FitItem[] } {
  const it: FitItem[] = [];
  const add = (id: string, es: string, en: string, score: number | null, w: number, whyEs: string, whyEn: string) => it.push({ id, es, en, score: score === null ? null : Math.max(0, Math.min(1, score)), w, whyEs, whyEn });
  const a = o.area_m2;
  add("space", "Espacio para manejar", "Room to drive", a === null ? null : a >= 600 ? 1 : a >= 150 ? 0.4 + 0.6 * (a - 150) / 450 : a / 150 * 0.4, 3,
    a === null ? "Falta el tamaño (camina el borde o da las medidas)." : `${Math.round(a)} m² (ideal ≥ 600 m²; mínimo 150 m²).`, a === null ? "Size missing (walk the edge or give measurements)." : `${Math.round(a)} m² (ideal ≥ 600 m²; min 150 m²).`);
  const fl = o.floor;
  const fs: Record<string, number> = { tierra: 1, arena: 1, cemento: 0.6, interior: 0.45, pasto: 0.3 };
  add("floor", "Suelo parecido a regolito", "Regolith-like ground", fl ? fs[fl] ?? 0.5 : null, 2,
    fl ? ({ tierra: "Tierra suelta: lo más parecido al regolito.", arena: "Arena: parecida al regolito (ojo, el rover se puede hundir).", cemento: "Cemento: firme y plano, sin textura de regolito.", interior: "Piso interior: liso, nada de regolito.", pasto: "Pasto: vegetación, lo menos marciano." } as Record<string, string>)[fl] ?? fl : "Elige el tipo de suelo.",
    fl ? ({ tierra: "Loose dirt: closest to regolith.", arena: "Sand: regolith-like (the rover may sink).", cemento: "Concrete: firm and flat, no regolith texture.", interior: "Indoor floor: smooth, no regolith.", pasto: "Grass: vegetation, least Mars-like." } as Record<string, string>)[fl] ?? fl : "Pick the ground type.");
  add("stable", "Caja quieta y nivelada", "Box still and level", o.tiltStd_deg === null ? null : o.tiltStd_deg < 1 ? 1 : o.tiltStd_deg < 5 ? 0.6 : 0.2, 1,
    o.tiltStd_deg === null ? "Sin datos del MPU-6050." : `Variación de inclinación ${o.tiltStd_deg.toFixed(1)}° en la medición.`, o.tiltStd_deg === null ? "No MPU-6050 data." : `Tilt variation ${o.tiltStd_deg.toFixed(1)}° during the measurement.`);
  add("safe", "Aire sin alerta de gas/humo", "No gas/smoke alert", o.gasAlert ? 0 : 1, 2, o.gasAlert ? "El MQ dio alerta: revisa antes de seguir." : "Sin alerta del sensor MQ.", o.gasAlert ? "The MQ alerted: check before continuing." : "No MQ alert.");
  add("light", "Luz para cámaras y fotos", "Light for cameras", o.light_pct === null ? null : o.light_pct >= 30 ? 1 : o.light_pct / 30, 1,
    o.light_pct === null ? "Sin dato de luz." : `Luz relativa ${Math.round(o.light_pct)} %.`, o.light_pct === null ? "No light data." : `Relative light ${Math.round(o.light_pct)}%.`);
  if (o.indoor === false || o.indoor === null) add("gps", "Posición GPS (navegación)", "GPS position (navigation)", o.gpsFix ? (o.gpsAcc_m !== null && o.gpsAcc_m > 15 ? 0.6 : 1) : 0, 1,
    o.gpsFix ? `Con posición${o.gpsAcc_m !== null ? ` (±${Math.round(o.gpsAcc_m)} m)` : ""}.` : "Sin posición GPS.", o.gpsFix ? `Position fixed${o.gpsAcc_m !== null ? ` (±${Math.round(o.gpsAcc_m)} m)` : ""}.` : "No GPS position.");
  const have = it.filter((x) => x.score !== null);
  const tw = it.reduce((s, x) => s + x.w, 0), hw = have.reduce((s, x) => s + x.w, 0);
  return { score: hw > 0 ? (100 * have.reduce((s, x) => s + x.w * x.score!, 0)) / hw : null, coverage: tw ? hw / tw : 0, items: it };
}
