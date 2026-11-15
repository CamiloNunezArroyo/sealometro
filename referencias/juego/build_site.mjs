#!/usr/bin/env node
/**
 * Pipeline de datos REALES para un sitio, en Node (no requiere Python).
 * Equivale a tools/build_site.py: descarga NASA POWER y un DEM, y reescribe el JSON del sitio
 * y el heightmap que lee el juego. Se ejecuta una vez por sitio; el juego no llama a ninguna API.
 *
 *   1. NASA POWER (climatología): temperatura, presión, humedad, viento, radiación, UV, albedo y lluvia.
 *      Se pide UN parámetro por consulta: si uno falla, los demás siguen y ese dato queda "pending"
 *      (nunca se rellena con un número inventado).
 *   2. DEM Copernicus GLO-30 (30 m, AWS Open Data): recorte cuadrado centrado en el sitio, remuestreado
 *      a N x N y guardado como Float32 little-endian (fila 0 = norte). De ahí salen la elevación central
 *      y la pendiente media (status "derived").
 *
 * Uso (desde la raíz del proyecto):
 *   npm run data:uyuni
 *   node tools/build_site.mjs --site public/data/sites/uyuni.json [--size-m 6000] [--n 256]
 *        [--dem archivo.tif|URL] [--skip-power] [--skip-dem]
 *
 * Estados que escribe: POWER -> "modeled"; DEM -> "modeled" (elevación/terreno) y "derived" (pendiente).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fromFile, fromUrl } from "geotiff";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_SITE = path.join(ROOT, "public", "data", "sites", "uyuni.json");

export const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point";
const POWER_DOCS = "https://power.larc.nasa.gov/docs/";
export const POWER_PARAMS = [
  "T2M", "T2M_MAX", "T2M_MIN", "PS", "RH2M", "WS10M",
  "ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_UV_INDEX", "PRECTOTCORR", "ALLSKY_SRF_ALB",
];
const POWER_SOURCE = "NASA POWER, climatología (modelo/reanálisis de rejilla gruesa, ~50 km)";
const POWER_NOTE_GRID = "Es un valor de celda de rejilla, no una medición en el punto exacto.";
const COPERNICUS_SOURCE = "Copernicus DEM GLO-30 (ESA), AWS Open Data";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// --------------------------------------------------------------------------- NASA POWER

/** Consulta la API de NASA POWER para un parámetro. Reintenta ante errores temporales. */
export async function fetchPowerJson(lat, lon, param, { community = "RE", retries = 3 } = {}) {
  const q = new URLSearchParams({ parameters: param, community, longitude: lon.toFixed(4), latitude: lat.toFixed(4), format: "JSON" });
  let last;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${POWER_URL}?${q}`, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return await res.json();
      if ([400, 404, 422].includes(res.status)) throw Object.assign(new Error(`POWER rechazó ${param} (HTTP ${res.status})`), { fatal: true });
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (e.fatal) throw e;
      last = e;
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`No se pudo consultar POWER para ${param}: ${last?.message ?? last}`);
}

/** Extrae {JAN: v, ..., ANN: v}; los valores de relleno (-999) pasan a null. */
export function parsePowerTable(response, param) {
  const raw = response.properties.parameter[param];
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v === null || v === undefined || Number(v) <= -998 ? null : Number(v);
  return out;
}

/** @param {(lat:number, lon:number, param:string) => Promise<any>} fetcher */
export async function fetchPower(lat, lon, fetcher = fetchPowerJson, { pauseMs = 300 } = {}) {
  const data = { tables: {}, elevationM: null, retrieved: new Date().toISOString().slice(0, 10), errors: [] };
  for (const param of POWER_PARAMS) {
    try {
      const response = await fetcher(lat, lon, param);
      data.tables[param] = parsePowerTable(response, param);
      const coords = response.geometry?.coordinates;
      if (data.elevationM === null && Array.isArray(coords) && typeof coords[2] === "number") data.elevationM = coords[2];
    } catch (e) {
      data.errors.push(`${param}: ${e.message}`);
    }
    if (pauseMs) await sleep(pauseMs);
  }
  return data;
}

function metric(value, unit, param, retrieved, note = "", extra = {}) {
  return {
    value: round(value, 3),
    unit,
    status: "modeled",
    source: `${POWER_SOURCE}, parámetro ${param}`,
    retrieved,
    ref: POWER_DOCS,
    ...extra,
    note: `${note} ${POWER_NOTE_GRID}`.trim(),
  };
}

/** Escribe en `site` lo que POWER devolvió. Devuelve las rutas actualizadas. */
export function applyPower(site, power) {
  const t = power.tables;
  const r = power.retrieved;
  const updated = [];
  const ann = (p) => t[p]?.ANN ?? null;
  const monthly = (p) => MONTHS.map((m) => t[p]?.[m] ?? null);
  const clim = site.climate;

  if (ann("T2M") !== null) {
    clim.meanTemp = metric(ann("T2M") + 273.15, "K", "T2M", r, "Promedio anual de la temperatura a 2 m.");
    updated.push("climate.meanTemp");
  }
  const tmax = ann("T2M_MAX");
  const tmin = ann("T2M_MIN");
  if (tmax !== null && tmin !== null) {
    clim.dailyRange = metric(tmax - tmin, "K", "T2M_MAX / T2M_MIN", r,
      "Promedio anual de máximos y mínimos diarios; el rango es [mínima media, máxima media].",
      { range: [round(tmin + 273.15, 2), round(tmax + 273.15, 2)] });
    updated.push("climate.dailyRange");
  }
  if (ann("PS") !== null) {
    let note = "Presión superficial.";
    if (power.elevationM !== null) note += ` POWER reporta una elevación de celda de ${power.elevationM.toFixed(0)} m; compárala con la del DEM.`;
    clim.pressure = metric(ann("PS"), "kPa", "PS", r, note);
    updated.push("climate.pressure");
  }
  for (const [key, param, unit] of [["humidity", "RH2M", "%"], ["wind", "WS10M", "m/s"], ["albedo", "ALLSKY_SRF_ALB", "-"]]) {
    if (ann(param) !== null) {
      clim[key] = metric(ann(param), unit, param, r);
      updated.push(`climate.${key}`);
    }
  }
  const tMaxM = monthly("T2M_MAX");
  const tMinM = monthly("T2M_MIN");
  if ([...tMaxM, ...tMinM].every((v) => v !== null)) {
    clim.monthly = {
      tMaxC: tMaxM.map((v) => round(v, 2)),
      tMinC: tMinM.map((v) => round(v, 2)),
      status: "modeled",
      source: `${POWER_SOURCE}, parámetros T2M_MAX / T2M_MIN (climatología mensual)`,
      note: `Recuperado el ${r}. ${POWER_NOTE_GRID}`,
    };
    updated.push("climate.monthly");
  }
  if (ann("ALLSKY_SFC_SW_DWN") !== null) {
    site.radiation.solarSurface = metric(ann("ALLSKY_SFC_SW_DWN"), "kWh/m²/día", "ALLSKY_SFC_SW_DWN", r, "Promedio anual, cielo real.");
    updated.push("radiation.solarSurface");
  }
  if (ann("ALLSKY_SFC_UV_INDEX") !== null) {
    site.radiation.uvIndex = metric(ann("ALLSKY_SFC_UV_INDEX"), "índice UV", "ALLSKY_SFC_UV_INDEX", r);
    updated.push("radiation.uvIndex");
  }
  if (ann("PRECTOTCORR") !== null) {
    site.water.precipitation = metric(ann("PRECTOTCORR") * 365.25, "mm/año", "PRECTOTCORR", r, "Promedio diario anual (mm/día) multiplicado por 365,25.");
    updated.push("water.precipitation");
  }
  return updated;
}

// --------------------------------------------------------------------------- Corrección por elevación

/** Gradiente térmico vertical estándar de la atmósfera (OACI/ISA): 6,5 K por km. */
export const LAPSE_K_PER_M = 0.0065;
/** Por debajo de esta diferencia de altura entre la celda de POWER y el sitio no se corrige. */
export const ELEV_CORRECTION_MIN_M = 300;

/** Presión (kPa) de la atmósfera estándar internacional a una elevación (m). */
export function isaPressureKpa(h) {
  return 101.325 * (1 - 2.25577e-5 * h) ** 5.25588;
}

const isRawPower = (m) => m && m.status === "modeled" && typeof m.value === "number" && String(m.source).startsWith("NASA POWER");

/**
 * POWER entrega valores de una celda de ~50 km cuya elevación media (cellElevM) puede ser muy distinta de la del sitio
 * (siteElevM, del DEM). En el altiplano la diferencia llega a >1000 m: la presión y la temperatura de la celda NO son las
 * del sitio. Aquí se ajustan con física estándar (presión por ISA, temperatura por gradiente de 6,5 K/km) y se marcan
 * "derived", conservando el valor bruto de POWER en la nota. Es idempotente (solo toca valores "modeled" de POWER).
 * Devuelve las rutas corregidas.
 */
export function correctClimateForElevation(site, cellElevM, siteElevM) {
  if (!Number.isFinite(cellElevM) || !Number.isFinite(siteElevM)) return [];
  const dh = siteElevM - cellElevM;
  if (Math.abs(dh) < ELEV_CORRECTION_MIN_M) return [];
  const dT = -LAPSE_K_PER_M * dh;
  const clim = site.climate;
  const done = [];
  const sign = dh > 0 ? "+" : "";
  const how = `Corregido por elevación: la celda de POWER está a ${cellElevM.toFixed(0)} m y el sitio (DEM) a ${siteElevM.toFixed(0)} m (${sign}${dh.toFixed(0)} m).`;
  const lapse = "Método aproximado: gradiente estándar de 6,5 K/km; no considera inversiones térmicas ni efectos locales.";

  if (isRawPower(clim.meanTemp)) {
    const raw = clim.meanTemp;
    clim.meanTemp = { ...raw, value: round(raw.value + dT, 2), status: "derived",
      source: `${raw.source}, ajustada por elevación`,
      note: `${how} Valor POWER sin corregir: ${raw.value} K. ${lapse}` };
    done.push("climate.meanTemp");
  }
  if (isRawPower(clim.dailyRange) && Array.isArray(clim.dailyRange.range)) {
    const raw = clim.dailyRange;
    clim.dailyRange = { ...raw, range: raw.range.map((v) => round(v + dT, 2)), status: "derived",
      source: `${raw.source}, rango ajustado por elevación`,
      note: `${how} La amplitud (valor) no cambia; el rango [mínima, máxima] se desplaza ${dT.toFixed(2)} K. ${lapse}` };
    done.push("climate.dailyRange");
  }
  if (isRawPower(clim.pressure)) {
    const raw = clim.pressure;
    const ratio = isaPressureKpa(siteElevM) / isaPressureKpa(cellElevM);
    clim.pressure = { ...raw, value: round(raw.value * ratio, 2), status: "derived",
      source: `${raw.source}, ajustada por elevación (atmósfera estándar ISA)`,
      note: `${how} Valor POWER sin corregir: ${raw.value} kPa (factor ${ratio.toFixed(3)}).` };
    done.push("climate.pressure");
  }
  const mo = clim.monthly;
  if (mo && mo.status === "modeled" && Array.isArray(mo.tMaxC) && Array.isArray(mo.tMinC)) {
    clim.monthly = { ...mo, tMaxC: mo.tMaxC.map((v) => round(v + dT, 2)), tMinC: mo.tMinC.map((v) => round(v + dT, 2)), status: "derived",
      source: `${mo.source}, ajustada por elevación`, note: `${how} Los valores mensuales se desplazan ${dT.toFixed(2)} °C. ${lapse}` };
    done.push("climate.monthly");
  }
  return done;
}

// --------------------------------------------------------------------------- Agua (a partir del DEM)

export const WATER_MIN_PIXELS = 400;
/** Si la "meseta de agua" cubre más de esta fracción del recorte, es un salar/llanura plana y no un lago: se descarta. */
export const WATER_MAX_FRACTION = 0.5;

/**
 * Los DEM de Copernicus aplanan los cuerpos de agua a una cota constante. Si el recorte contiene una meseta de píxeles con
 * EXACTAMENTE la misma cota y conectados entre sí (>= WATER_MIN_PIXELS), se toma como superficie de un lago.
 * La conectividad evita falsos positivos en salares planos, donde el ruido repite cotas sueltas pero no en bloque.
 * Devuelve { level, pixels } o null.
 */
export function detectWaterLevel(arr, n) {
  return detectWaterLevels(arr, n)[0] ?? null;
}

/**
 * Como detectWaterLevel, pero devuelve TODOS los lagos del recorte: un elemento { level, pixels } por cada cota exacta
 * con al menos un bloque conectado de >= WATER_MIN_PIXELS píxeles (los píxeles se suman por cota). Ordenados de mayor a menor.
 */
export function detectWaterLevels(arr, n) {
  const counts = new Map();
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1);
  const candidates = [...counts.entries()].filter(([, c]) => c >= WATER_MIN_PIXELS).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const lakes = [];
  for (const [level] of candidates) {
    let total = 0;
    const seen = new Uint8Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      if (seen[i] || arr[i] !== level) continue;
      let size = 0;
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        size++;
        const r = Math.floor(j / n);
        const c = j % n;
        for (const k of [r > 0 ? j - n : -1, r < n - 1 ? j + n : -1, c > 0 ? j - 1 : -1, c < n - 1 ? j + 1 : -1]) {
          if (k >= 0 && !seen[k] && arr[k] === level) { seen[k] = 1; stack.push(k); }
        }
      }
      if (size >= WATER_MIN_PIXELS) total += size;
    }
    if (total > 0) lakes.push({ level, pixels: total });
  }
  return lakes.sort((a, b) => b.pixels - a.pixels);
}

/**
 * Guarda los lagos detectados en site.water: `surfaces` (todos) y `surface` (el mayor, por compatibilidad).
 * Sin lagos, borra ambos campos.
 */
export function applyWater(site, lakes, { mpp, sourceLabel, retrieved }) {
  site.water = site.water ?? {};
  if (!lakes.length) {
    delete site.water.surface;
    delete site.water.surfaces;
    return;
  }
  const metrics = lakes.map((w) => ({
    value: round(w.level, 3),
    unit: "m",
    status: "derived",
    source: `Derivada por este proyecto del ${sourceLabel}: meseta plana de ${w.pixels} píxeles (~${((w.pixels * mpp * mpp) / 1e6).toFixed(1)} km² dentro del recorte) con la misma cota exacta, que corresponde a un cuerpo de agua aplanado por el modelo`,
    retrieved,
    note: "Se detecta por la forma del DEM, no por una imagen satelital ni una medición del nivel. El borde de la máscara tiene la resolución del DEM (~30 m).",
  }));
  site.water.surface = metrics[0];
  site.water.surfaces = metrics;
}

// --------------------------------------------------------------------------- DEM

/** URL del mosaico COG de 1° x 1° de Copernicus GLO-30 que contiene el punto. */
export function copernicusTileUrl(lat, lon) {
  const la = Math.floor(lat);
  const lo = Math.floor(lon);
  const name = `Copernicus_DSM_COG_10_${la >= 0 ? "N" : "S"}${String(Math.abs(la)).padStart(2, "0")}_00_${lo >= 0 ? "E" : "W"}${String(Math.abs(lo)).padStart(3, "0")}_00_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
}

/**
 * Recorte cuadrado de `sizeM` metros centrado en (lat, lon), remuestreado a n x n (bilineal).
 * Devuelve Float32Array con la fila 0 = norte. El recorte se ajusta al píxel entero más cercano
 * (diferencia de escala <= ~1 %), porque geotiff solo lee ventanas de píxeles enteros.
 */
export async function readDem(pathOrUrl, lat, lon, sizeM, n) {
  const dlat = sizeM / 2 / 111_320;
  const dlon = sizeM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const tiff = /^https?:\/\//.test(pathOrUrl) ? await fromUrl(pathOrUrl) : await fromFile(pathOrUrl);
  const image = await tiff.getImage();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const W = image.getWidth();
  const H = image.getHeight();
  const x0 = Math.floor((lon - dlon - ox) / rx);
  const x1 = Math.ceil((lon + dlon - ox) / rx);
  const y0 = Math.floor((lat + dlat - oy) / ry);
  const y1 = Math.ceil((lat - dlat - oy) / ry);
  if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) {
    throw new Error(
      "El recorte sale del mosaico del DEM. Si las coordenadas están pegadas al borde de un mosaico de 1°×1° (latitud o longitud casi entera), muévelas ~0,1° hacia dentro; o usa un recorte menor (--size-m) " +
        "o un GeoTIFF propio que cubra la zona (--dem).",
    );
  }
  const [band] = await image.readRasters({ window: [x0, y0, x1, y1], width: n, height: n, resampleMethod: "bilinear", interleave: false });
  const noData = image.getGDALNoData();
  const arr = Float32Array.from(band, (v) => (noData !== null && v === noData ? NaN : v));
  if (!arr.every(Number.isFinite)) throw new Error("El recorte del DEM contiene huecos (NaN); prueba otro recorte o rellena el DEM.");
  return arr;
}

/** Pendiente media en grados con diferencias centrales (misma definición que Terrain.meanSlopeDeg). */
export function meanSlopeDeg(arr, n, metersPerPixel) {
  let sum = 0;
  let count = 0;
  for (let r = 1; r < n - 1; r++) {
    for (let c = 1; c < n - 1; c++) {
      const dx = (arr[r * n + c + 1] - arr[r * n + c - 1]) / (2 * metersPerPixel);
      const dz = (arr[(r + 1) * n + c] - arr[(r - 1) * n + c]) / (2 * metersPerPixel);
      sum += Math.atan(Math.hypot(dx, dz));
      count++;
    }
  }
  return ((sum / count) * 180) / Math.PI;
}

/** Float32 little-endian explícito (no depende del orden de bytes de la máquina). */
export function toFloat32LE(arr) {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i], i * 4);
  return buf;
}

export async function applyDem(site, arr, n, sizeM, sourceLabel, outBin, retrieved, { noWater = false } = {}) {
  const mpp = sizeM / n;
  await mkdir(path.dirname(outBin), { recursive: true });
  await writeFile(outBin, toFloat32LE(arr));
  let min = Infinity;
  let max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const center = arr[Math.floor(n / 2) * n + Math.floor(n / 2)];
  const slope = meanSlopeDeg(arr, n, mpp);

  Object.assign(site.terrain, {
    width: n,
    height: n,
    metersPerPixel: mpp,
    minElevationM: round(min, 3),
    maxElevationM: round(max, 3),
    status: "modeled",
    source: `${sourceLabel}; recorte de ${sizeM.toFixed(0)} m x ${sizeM.toFixed(0)} m remuestreado a ${n}x${n}`,
    note:
      "Es un modelo digital de SUPERFICIE (incluye vegetación y construcciones) y tiene ruido vertical de algunos metros; " +
      "en terreno muy plano el ruido infla la pendiente. El recorte se ajusta al píxel entero más cercano (escala ±1 %).",
  });
  site.terrain.slopeMean = {
    value: round(slope, 3),
    unit: "°",
    status: "derived",
    source: `Calculada por este proyecto sobre el DEM (${sourceLabel})`,
    retrieved,
    note: "Incluye el ruido del DEM; compárala con la de otros sitios solo a igual resolución.",
  };
  site.elevation = {
    value: round(center, 1),
    unit: "m",
    status: "modeled",
    source: `${sourceLabel}, píxel central del recorte`,
    retrieved,
    note: "Elevación del punto central (coordenadas del sitio), no del nivel medio del salar.",
  };
  let lakes = noWater ? [] : detectWaterLevels(arr, n);
  const covered = lakes.reduce((a, w) => a + w.pixels, 0) / arr.length;
  if (covered > WATER_MAX_FRACTION) {
    console.log(`  AVISO: la "meseta de agua" cubre ${(covered * 100).toFixed(0)} % del recorte: es una llanura/salar plano, no un lago. Se descarta.`);
    lakes = [];
  }
  applyWater(site, lakes, { mpp, sourceLabel, retrieved });
  return { min, max, center, slope, water: lakes[0] ?? null, lakes };
}

// --------------------------------------------------------------------------- CLI

export function parseArgs(argv) {
  const a = { site: DEFAULT_SITE, sizeM: 6000, n: 256, dem: null, skipPower: false, skipDem: false, noWater: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--site") a.site = path.resolve(argv[++i]);
    else if (k === "--size-m") a.sizeM = Number(argv[++i]);
    else if (k === "--n") a.n = Number(argv[++i]);
    else if (k === "--dem") a.dem = argv[++i];
    else if (k === "--skip-power") a.skipPower = true;
    else if (k === "--skip-dem") a.skipDem = true;
    else if (k === "--no-water") a.noWater = true;
    else throw new Error(`Opción desconocida: ${k}`);
  }
  if (!(a.sizeM > 0) || !Number.isInteger(a.n) || a.n < 16) throw new Error("--size-m debe ser > 0 y --n un entero >= 16");
  return a;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const site = JSON.parse(await readFile(args.site, "utf-8"));
  const { lat, lon } = site.coords;
  const today = new Date().toISOString().slice(0, 10);
  let ok = true;
  let powerElev = null;

  if (!args.skipPower) {
    console.log(`NASA POWER: ${lat}, ${lon} (${POWER_PARAMS.length} parámetros)...`);
    const power = await fetchPower(lat, lon);
    powerElev = power.elevationM;
    const updated = applyPower(site, power);
    console.log(`  actualizados: ${updated.join(", ") || "ninguno"}`);
    for (const err of power.errors) console.error(`  AVISO sin dato -> queda pendiente: ${err}`);
    ok = ok && updated.length > 0;
  }

  if (!args.skipDem) {
    const src = args.dem ?? copernicusTileUrl(lat, lon);
    console.log(`DEM: ${src}`);
    try {
      const arr = await readDem(src, lat, lon, args.sizeM, args.n);
      const label = args.dem ? `DEM local/propio (${path.basename(args.dem)})` : COPERNICUS_SOURCE;
      const outBin = path.join(ROOT, "public", site.terrain.file);
      const st = await applyDem(site, arr, args.n, args.sizeM, label, outBin, today, { noWater: args.noWater });
      console.log(`  heightmap -> ${outBin} · rango ${st.min.toFixed(1)}..${st.max.toFixed(1)} m`);
    } catch (e) {
      console.error(`  ERROR leyendo el DEM: ${e.message}`);
      ok = false;
    }
  }

  // Solo si se pidió POWER en esta corrida (sus valores son brutos) y hay elevación del DEM.
  const siteElev = site.elevation?.status === "modeled" ? site.elevation.value : null;
  if (powerElev !== null && siteElev !== null) {
    const fixed = correctClimateForElevation(site, powerElev, siteElev);
    if (fixed.length) console.log(`  corregido por elevación (celda POWER ${powerElev.toFixed(0)} m vs sitio ${siteElev} m): ${fixed.join(", ")}`);
  }
  for (const w of site.water?.surfaces ?? []) console.log(`  agua detectada en el DEM: nivel ${w.value} m`);

  await writeFile(args.site, JSON.stringify(site, null, 2) + "\n", "utf-8");
  console.log(`Sitio guardado: ${args.site}`);
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });
}
