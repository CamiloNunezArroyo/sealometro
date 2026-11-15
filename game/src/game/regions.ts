// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Regiones del globo (un pin por región, como en el prototipo). Agrupación y nombres: decisión de diseño.
import type { GameSite } from "../data";

export interface Region { id: string; es: string; en: string; country: string; lat: number; lon: number; sites: GameSite[] }

const R: Record<string, [string, string, string[]]> = {
  bo_altiplano_sur: ["Altiplano sur (Potosí)", "Southern Altiplano (Potosí)", ["siloli", "laguna_colorada", "sol_de_manana", "laguna_verde_licancabur", "uyuni_incahuasi"]],
  bo_oruro: ["Altiplano central (Oruro)", "Central Altiplano (Oruro)", ["coipasa", "poopo", "sajama"]],
  bo_lapaz: ["La Paz y Cordillera Real", "La Paz & Cordillera Real", ["valle_de_la_luna", "valle_de_las_animas", "canones_de_palca", "chacaltaya", "cordillera_real_glaciar_roca"]],
  bo_torotoro: ["Torotoro (norte de Potosí)", "Torotoro (northern Potosí)", ["torotoro_umajalanta"]],
  bo_santacruz: ["Santa Cruz", "Santa Cruz", ["ciudad_santa_cruz"]],
  cl_atacama: ["Atacama", "Atacama", ["atacama_yungay"]],
  ar_catamarca: ["Puna de Catamarca", "Catamarca Puna", ["campo_piedra_pomez"]],
  ar_mendoza: ["Mendoza", "Mendoza", ["payunia"]],
  br_amazonas: ["Amazonas", "Amazonas", ["amazonia_manaus"]],
  br_pantanal: ["Pantanal", "Pantanal", ["pantanal"]],
  us_hawaii: ["Hawái", "Hawaii", ["mauna_kea_puu_hiwahine"]],
  us_arizona: ["Arizona", "Arizona", ["cinder_lake_az"]],
  us_california: ["California", "California", ["lava_beds_ca"]],
  mx_sonora: ["Sonora", "Sonora", ["pinacate"]],
  ca_nunavut: ["Nunavut (isla Devon)", "Nunavut (Devon Island)", ["haughton_devon"]],
  is_highlands: ["Tierras altas", "Highlands", ["askja_iceland", "vatnajokull_kverkfjoll"]],
  no_svalbard: ["Svalbard", "Svalbard", ["svalbard_bockfjorden"]],
  es_canarias: ["Islas Canarias", "Canary Islands", ["teide", "lanzarote"]],
  es_andalucia: ["Andalucía", "Andalusia", ["rio_tinto"]],
  it_sicilia: ["Sicilia", "Sicily", ["etna_italy"]],
  de_baviera: ["Baviera", "Bavaria", ["ries"]],
  na_namib: ["Namib", "Namib", ["namib_sossusvlei"]],
  eg_farafra: ["Desierto Occidental", "Western Desert", ["desierto_blanco"]],
  et_afar: ["Afar", "Afar", ["danakil_dallol"]],
  jo_wadirum: ["Wadi Rum", "Wadi Rum", ["wadi_rum"]],
  ir_kerman: ["Kerman", "Kerman", ["dasht_e_lut"]],
  tr_capadocia: ["Capadocia", "Cappadocia", ["capadocia"]],
  id_java: ["Java Oriental", "East Java", ["bromo"]],
  aq_victoria: ["Tierra de Victoria", "Victoria Land", ["dry_valleys_wright"]],
};

/** Agrupa los sitios del juego; un sitio que no esté en la tabla forma su propia región (no se pierde). */
export function buildRegions(sites: GameSite[]): Region[] {
  const byId = new Map(sites.map((s) => [s.id, s]));
  const used = new Set<string>();
  const out: Region[] = [];
  for (const [id, [es, en, ids]] of Object.entries(R)) {
    const ss = ids.map((i) => byId.get(i)).filter((s): s is GameSite => !!s);
    if (!ss.length) continue;
    ss.forEach((s) => used.add(s.id));
    out.push({ id, es, en, country: ss[0].country, lat: avg(ss.map((s) => s.lat)), lon: avgLon(ss.map((s) => s.lon)), sites: ss });
  }
  for (const s of sites) if (!used.has(s.id)) out.push({ id: s.id, es: s.name, en: s.name, country: s.country, lat: s.lat, lon: s.lon, sites: [s] });
  return out;
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const avgLon = (a: number[]) => (Math.max(...a) - Math.min(...a) > 180 ? a[0] : avg(a));

export function regionOf(regions: Region[], siteId: string): Region | undefined {
  return regions.find((r) => r.sites.some((s) => s.id === siteId));
}
