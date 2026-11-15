// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { dataUrl, useData, type RankingIndex } from "../data";
import { num, TARGET_NAMES } from "../i18n";
import { useSettings } from "../settings";

const SOURCES: [string, string, string][] = [
  ["NASA POWER", "https://power.larc.nasa.gov/", "clima / climate"],
  ["NASA MODIS MOD13Q1 (ORNL DAAC)", "https://modis.ornl.gov/data/modis_webservice.html", "NDVI"],
  ["NASA EMIT L2B Mineral (LP DAAC)", "https://lpdaac.usgs.gov/products/emitl2bminv002/", "minerales / minerals"],
  ["NASA NSSDC Fact Sheets", "https://nssdc.gsfc.nasa.gov/planetary/factsheet/", "Tierra, Marte, Luna / Earth, Mars, Moon"],
  ["Copernicus DEM GLO-30 (ESA)", "https://registry.opendata.aws/copernicus-dem/", "relieve / relief"],
  ["Natural Earth", "https://www.naturalearthdata.com/", "mapa base / base map"],
];

export function HowPage() {
  const { t, lang, level } = useSettings();
  const { data: index } = useData<RankingIndex>("ranking/index.json");
  const v = index?.validation;
  return (
    <div className="container section">
      <h1>{t("how.title")}</h1>
      <div className="grid grid-2" style={{ marginTop: 16 }}>
        {[1, 2, 3, 4].map((i) => (
          <div className="card" key={i}>
            <div style={{ fontSize: 30 }}>{["📡", "⚖️", "🎲", "📖"][i - 1]}</div>
            <h3>{t(`how.s${i}.t`)}</h3>
            <p className="muted" style={{ margin: 0 }}>{t(`how.s${i}.d`)}</p>
          </div>
        ))}
      </div>

      <h2 style={{ marginTop: 40 }}>{t("how.validation.t")}</h2>
      {v && v.auc !== null && (
        <>
          <p>{t("how.validation.d", { auc: num(lang, v.auc, 2), lo: num(lang, v.auc_ci90?.[0], 2), hi: num(lang, v.auc_ci90?.[1], 2) })}</p>
          {level !== "explorador" && (
            <div className="table-wrap" style={{ maxWidth: 640 }}>
              <table>
                <thead><tr><th>{t("map.target")}</th><th className="num">AUC</th><th className="num">IC 90 %</th><th className="num">n+</th></tr></thead>
                <tbody>
                  {Object.entries(v.by_target).map(([id, x]) => (
                    <tr key={id}><td>{TARGET_NAMES[id]?.[lang] ?? id}</td><td className="num">{x.auc === null ? "—" : num(lang, x.auc, 2)}</td>
                      <td className="num">{x.auc_ci90 ? `${num(lang, x.auc_ci90[0], 2)}–${num(lang, x.auc_ci90[1], 2)}` : "—"}</td>
                      <td className="num">{x.n_pos ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2 style={{ marginTop: 40 }}>{t("how.limits.t")}</h2>
      <ul>{[1, 2, 3, 4].map((i) => <li key={i}>{t(`how.limits.${i}`)}</li>)}</ul>

      {level !== "explorador" && (
        <>
          <h2 style={{ marginTop: 40 }}>{t("how.plots.t")}</h2>
          <div className="grid grid-2">
            <figure className="card" style={{ margin: 0 }}>
              <img src={dataUrl("plots/mapa_parecidos.png")} alt="PCA" style={{ width: "100%", borderRadius: 8, background: "#fcfcfb" }} loading="lazy" />
            </figure>
            <figure className="card" style={{ margin: 0 }}>
              <img src={dataUrl("plots/mapa_calor_mars_global.png")} alt="Heat map Bolivia" style={{ width: "100%", borderRadius: 8, background: "#fcfcfb" }} loading="lazy" />
            </figure>
          </div>
        </>
      )}

      <h2 style={{ marginTop: 40 }}>{t("how.sources.t")}</h2>
      <ul>
        {SOURCES.map(([n, u, d]) => <li key={n}><a href={u} target="_blank" rel="noreferrer">{n}</a> <span className="muted">— {d}</span></li>)}
      </ul>

      <h2 style={{ marginTop: 40 }}>{t("how.ai.t")}</h2>
      <p>{t("how.ai.d")}</p>
    </div>
  );
}
