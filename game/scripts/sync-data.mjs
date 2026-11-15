// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Copia los productos del motor (data/shared) a public/data para que la web y el juego los sirvan.
// No modifica data/shared. Si falta algo, avisa y sigue.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, "..", "..", "data", "shared");
const out = join(here, "..", "public", "data");
mkdirSync(out, { recursive: true });

const items = ["ranking", "terrain", "imagery", "sites_index.json", "discover_mars_global.json", "ranking.csv", "plots"];
// fotos reales elegidas (sin las candidatas descartadas)
const ph = join(shared, "photos");
if (existsSync(ph)) {
  mkdirSync(join(out, "photos"), { recursive: true });
  for (const f of readdirSync(ph)) if (f.endsWith(".jpg") || f === "photos.json") cpSync(join(ph, f), join(out, "photos", f));
}
for (const it of items) {
  const src = join(shared, it);
  if (!existsSync(src)) {
    console.warn(`[sync-data] falta ${it} (corre el motor: python -m seal all && python -m seal terrain)`);
    continue;
  }
  cpSync(src, join(out, it), { recursive: true });
}
// Resumen para el globo: el objetivo concreto (no "global") más parecido de Marte y de la Luna para cada sitio.
// Mismo criterio que el ranking de la web: IFA conservador (ifa_min).
try {
  const idx = JSON.parse(readFileSync(join(shared, "ranking", "index.json"), "utf8"));
  const best = {};
  for (const t of idx.targets) {
    if (t.id.endsWith("_global")) continue;
    const f = JSON.parse(readFileSync(join(shared, t.file), "utf8"));
    for (const r of f.results) {
      if (r.ifa_min == null || r.insufficient) continue;
      const b = (best[r.site_id] ??= {});
      if (!b[t.body] || r.ifa_min > b[t.body].ifa_min) b[t.body] = { target: t.id, name: t.name, ifa: r.ifa, ifa_min: r.ifa_min, coverage: r.coverage };
    }
  }
  writeFileSync(join(out, "best.json"), JSON.stringify(best));
} catch (e) {
  console.warn(`[sync-data] no se pudo hacer best.json: ${e.message}`);
}
const n = existsSync(join(out, "ranking")) ? readdirSync(join(out, "ranking")).length : 0;
console.log(`[sync-data] datos del motor copiados a public/data (${n} archivos de ranking)`);
