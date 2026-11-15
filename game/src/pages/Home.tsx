// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { rankValue, useData, type RankingIndex, type SiteInfo, type TargetFile } from "../data";
import { pct, num, TARGET_NAMES } from "../i18n";
import { useSettings } from "../settings";

const FEATURED = "siloli";

export function Home() {
  const { t, lang, level } = useSettings();
  const { data: index } = useData<RankingIndex>("ranking/index.json");
  const { data: gale } = useData<TargetFile>("ranking/mars_gale.json");
  const { data: global } = useData<TargetFile>("ranking/mars_global.json");
  const { data: sitesIdx } = useData<{ sites: SiteInfo[] }>("sites_index.json");
  const siteMap = new Map((sitesIdx?.sites ?? []).map((s) => [s.id, s]));
  const featured = global?.results.find((r) => r.site_id === FEATURED);
  const prog = (featured?.dims ?? []).filter((d) => d.po !== null && d.analogable).sort((a, b) => (b.po ?? 0) - (a.po ?? 0)).slice(0, 4);
  const top = [...(gale?.results ?? [])].sort((a, b) => rankValue(b) - rankValue(a)).slice(0, 3);
  const nSites = (sitesIdx?.sites ?? []).filter((s) => s.processed).length || 41;

  return (
    <>
      <section className="hero">
        <div className="stars" />
        <div className="container hero-grid">
          <div>
            <div className="kicker">{t("home.kicker")}</div>
            <h1 style={{ marginTop: 8 }}>{t("home.title")}</h1>
            <p className="lead">{t("home.lead", { n: nSites })}</p>
            <div className="row" style={{ marginTop: 18 }}>
              <a className="btn primary" href="#/mapa?target=mars_gale">🗺️ {t("home.cta.map")}</a>
              <a className="btn" href="#/jugar">🚙 {t("home.cta.play")}</a>
              <a className="btn ghost" href="#/como-funciona">{t("home.cta.how")}</a>
            </div>
          </div>
          <div className="card">
            <div className="kicker">🇧🇴 {t("home.bolivia.title")}</div>
            <h3 style={{ marginTop: 6 }}>{t("home.journey.title", { site: siteMap.get(FEATURED)?.name ?? "Siloli" })}</h3>
            <div className="journey">
              {prog.map((d) => (
                <div key={d.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}><span>{t(`dim.${d.id}`)}</span><strong>{pct(lang, d.po)}</strong></div>
                  <div className="bar" aria-hidden="true"><span style={{ width: `${100 * (d.po ?? 0)}%` }} /></div>
                </div>
              ))}
              {prog.length === 0 && <p className="muted">{t("loading")}</p>}
            </div>
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 10 }}>🌍 → 🔴 · {t("home.journey.note")}</p>
            <a className="btn small" href={`#/mapa?target=mars_global&site=${FEATURED}`}>{t("home.cta.map")} →</a>
          </div>
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 8 }}>
        <div className="grid grid-3">
          {[1, 2, 3, 4].map((i) => (
            <div className="card" key={i}>
              <div style={{ fontSize: 28 }}>{["🛰️", "🧭", "👩‍🚀", "🚙"][i - 1]}</div>
              <h3>{t(`home.cards.t${i}`)}</h3>
              {level !== "explorador" || i < 3 ? <p className="muted" style={{ margin: 0 }}>{t(`home.cards.d${i}`)}</p> : null}
            </div>
          ))}
        </div>
      </section>

      {top.length > 0 && (
        <section className="container section" style={{ paddingTop: 0 }}>
          <h2>🏆 {t("home.top.title", { target: TARGET_NAMES.mars_gale[lang] })}</h2>
          <div className="grid grid-3">
            {top.map((r, i) => {
              const s = siteMap.get(r.site_id);
              return (
                <a key={r.site_id} className="card" style={{ textDecoration: "none", color: "inherit" }} href={`#/mapa?target=mars_gale&site=${r.site_id}`}>
                  <div className="kicker">#{i + 1} · {s?.country} · {t(`role.${r.role}`)}</div>
                  <h3 style={{ marginTop: 6 }}>{s?.name}</h3>
                  <div className="big-number" style={{ fontSize: "2.4rem" }}>{num(lang, r.ifa, 0)}<span style={{ fontSize: "1rem" }}>/100</span></div>
                  {r.robust && <p className="muted" style={{ margin: 0 }}>P(top-3): {pct(lang, r.robust.p_top3)}</p>}
                </a>
              );
            })}
          </div>
          {index && index.validation.auc !== null && level !== "explorador" && (
            <p className="note honest" style={{ marginTop: 16 }}>
              {t("how.validation.d", { auc: num(lang, index.validation.auc, 2), lo: num(lang, index.validation.auc_ci90?.[0], 2), hi: num(lang, index.validation.auc_ci90?.[1], 2) })}
            </p>
          )}
        </section>
      )}
    </>
  );
}
