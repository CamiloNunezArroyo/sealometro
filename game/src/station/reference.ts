// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Referencias externas para contrastar la caja EN VIVO (no reemplazan a la medición):
// - Open-Meteo (modelos meteorológicos; datos CC BY 4.0; sin clave): tiempo actual en la coordenada del GPS.
// - Open-Meteo Elevation (Copernicus DEM GLO-90, ESA): altura del terreno en esa coordenada.
// Las dos aceptan pedidos desde el navegador (CORS), comprobado.
export interface Meteo { t_c: number; rh: number; p_hpa: number; uvi: number; is_day: boolean; cloud: number; time: string; elev_m: number }

export async function fetchMeteo(lat: number, lon: number): Promise<Meteo> {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + "&current=temperature_2m,relative_humidity_2m,surface_pressure,uv_index,is_day,cloud_cover&timezone=auto";
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  const j = await r.json();
  const c = j.current;
  return { t_c: c.temperature_2m, rh: c.relative_humidity_2m, p_hpa: c.surface_pressure, uvi: c.uv_index ?? 0, is_day: c.is_day === 1,
    cloud: c.cloud_cover ?? 0, time: c.time, elev_m: j.elevation };
}

export async function fetchElevation(lat: number, lon: number): Promise<number> {
  const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`);
  if (!r.ok) throw new Error(`Elevation HTTP ${r.status}`);
  return (await r.json()).elevation[0];
}

/** Presión esperada (hPa) a una altura h con la atmósfera estándar (ISA). Solo orientativa: el tiempo la mueve ±10 hPa. */
export const isaPressure = (h: number) => 1013.25 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
