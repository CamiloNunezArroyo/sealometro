// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Qué mineral sale en cada muestra (decisión de JUEGO, explicada en pantalla):
//  1) "site": de las clases de minerales documentadas para el sitio (EMIT o literatura, del motor);
//  2) "place": propio de ese lugar real (p. ej. salitre en Atacama, pirita en Río Tinto, azufre en Dallol);
//  3) "terrain": típico de su tipo de terreno (bioma de diseño).
import { hashSeed, rng } from "../core/terrain";
import { CAVE_KIND } from "../core/cave";

export type Why = "site" | "place" | "terrain";
const BY_CLASS: Record<string, string[]> = {
  cloruro: ["halita", "silvita"], sulfato: ["yeso", "anhidrita", "jarosita", "epsomita"], arcilla: ["montmorillonita", "caolinita"],
  carbonato: ["calcita", "dolomita", "magnesita", "aragonito"], silice_hidratada: ["opalo"], oxido_fe: ["hematita", "goethita"],
  basalto: ["olivino", "diopsido", "anortita", "magnetita"], anortosita: ["anortita"],
};
const BY_PLACE: Record<string, string[]> = {
  atacama_yungay: ["nitratina", "perclorato", "halita"], uyuni_incahuasi: ["ulexita", "halita", "yeso"], coipasa: ["ulexita", "halita"],
  rio_tinto: ["pirita", "jarosita", "goethita"], danakil_dallol: ["azufre", "halita", "silvita"], sol_de_manana: ["azufre", "opalo"],
  laguna_colorada: ["yeso", "ulexita"], vatnajokull_kverkfjoll: ["hielo", "azufre", "opalo"], dry_valleys_wright: ["hielo", "yeso"],
  torotoro_umajalanta: ["calcita", "aragonito"], mauna_kea_puu_hiwahine: ["olivino", "hematita"], lanzarote: ["olivino", "diopsido"],
  amazonia_manaus: ["caolinita", "goethita"], desierto_blanco: ["calcita"], poopo: ["yeso", "halita"],
};
const BY_BIOME: Record<string, string[]> = {
  salar: ["halita", "yeso", "silvita"], desierto: ["cuarzo", "ortoclasa", "albita", "hematita", "calcita"],
  volcanico: ["olivino", "diopsido", "anortita", "magnetita", "ilmenita", "albita"], frio: ["hielo", "cuarzo", "albita"],
  lago: ["yeso", "halita", "calcita", "montmorillonita"], vegetado: ["caolinita", "cuarzo", "goethita"],
  // lugares del equipo: cemento y yeso de construcción contienen calcita y yeso; la arena es sobre todo cuarzo
  cemento: ["calcita", "yeso", "cuarzo"], interior: ["yeso", "calcita", "cuarzo"],
};
const BY_CAVE: Record<string, string[]> = { lava: ["olivino", "anortita", "magnetita", "ilmenita", "diopsido"], karst: ["calcita", "aragonito", "dolomita"], ice: ["hielo", "opalo", "azufre"] };

export function samplePool(site: { id: string; biome: string; minerals: { classes: string[] } | null }, cave: boolean): { id: string; why: Why }[] {
  const out: { id: string; why: Why }[] = [];
  const add = (ids: string[], why: Why) => { for (const id of ids) if (!out.some((o) => o.id === id)) out.push({ id, why }); };
  if (cave) add(BY_CAVE[CAVE_KIND[site.id] ?? "lava"], "place");
  for (const c of site.minerals?.classes ?? []) add(BY_CLASS[c] ?? [], "site");
  add(BY_PLACE[site.id] ?? [], "place");
  add(BY_BIOME[site.biome] ?? BY_BIOME.desierto, "terrain");
  return out;
}

/** Elige n minerales distintos, prefiriendo los documentados del sitio. Cambia con la partida (seed). */
export function pickSamples(site: { id: string; biome: string; minerals: { classes: string[] } | null }, n: number, cave: boolean, seed: number) {
  const pool = samplePool(site, cave);
  const R = rng(hashSeed(site.id) ^ seed);
  const weight = (w: Why) => (w === "site" ? 3 : w === "place" ? 2.5 : 1);
  const left = [...pool], out: typeof pool = [];
  while (out.length < n && left.length) {
    const tot = left.reduce((a, p) => a + weight(p.why), 0);
    let r = R() * tot, k = 0;
    while (k < left.length - 1 && (r -= weight(left[k].why)) > 0) k++;
    out.push(left.splice(k, 1)[0]);
  }
  while (out.length < n) out.push(pool[out.length % pool.length]);
  return out;
}
