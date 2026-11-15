// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { useMemo, useState } from "react";
import { dataUrl, rankValue, useData, type RankingIndex, type Result, type SiteInfo, type TargetFile } from "../data";
import { COUNTRY_EN, num, pct, TARGET_NAMES } from "../i18n";
import { go, useSettings, type Route } from "../settings";
import { TargetSelect } from "./MapPage";

type Col = "site" | "country" | "role" | "ifa" | "ifa_min" | "coverage" | "p_top3" | "median_rank" | "limiting";

export function RankingPage({ route }: { route: Route }) {
  const { t, lang } = useSettings();
  const target = route.query.get("target") ?? "mars_gale";
  const { data: index } = useData<RankingIndex>("ranking/index.json");
  const tinfo = index?.targets.find((x) => x.id === target) ?? index?.targets[0];
  const { data: tfile } = useData<TargetFile>(tinfo ? tinfo.file : null);
  const { data: sitesIdx } = useData<{ sites: SiteInfo[] }>("sites_index.json");
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "ifa_min", dir: -1 });
  const [q, setQ] = useState("");

  const siteMap = useMemo(() => new Map((sitesIdx?.sites ?? []).map((s) => [s.id, s])), [sitesIdx]);
  const rows = useMemo(() => {
    const val = (r: Result, c: Col): number | string => {
      const s = siteMap.get(r.site_id);
      switch (c) {
        case "site": return s?.name ?? r.site_id;
        case "country": return s?.country ?? "";
        case "role": return r.role;
        case "ifa": return r.ifa ?? -1;
        case "ifa_min": return rankValue(r);
        case "coverage": return r.coverage;
        case "p_top3": return r.robust?.p_top3 ?? -1;
        case "median_rank": return -(r.robust?.median_rank ?? 999);
        case "limiting": return r.limiting ?? "";
      }
    };
    return [...(tfile?.results ?? [])]
      .filter((r) => !q || (siteMap.get(r.site_id)?.name ?? r.site_id).toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => {
        const A = val(a, sort.col), B = val(b, sort.col);
        return (A < B ? -1 : A > B ? 1 : 0) * sort.dir;
      });
  }, [tfile, sort, q, siteMap]);

  if (!index || !tinfo) return <p className="container section">{t("loading")}</p>;
  const v = index.validation.by_target[tinfo.id];
  const head = (c: Col, label: string, isNum = false) => (
    <th className={isNum ? "num" : ""} aria-sort={sort.col === c ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => setSort((s) => ({ col: c, dir: s.col === c ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {label}{sort.col === c ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div className="container section" style={{ paddingTop: 24 }}>
      <h1 style={{ fontSize: "clamp(1.6rem,3vw,2.2rem)" }}>{t("rank.title")}</h1>
      <p className="muted">{t("rank.desc")}</p>
      <div className="row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
        <TargetSelect index={index} value={tinfo.id} onChange={(id) => go("ranking", { target: id })} />
        <label className="field">{t("rank.search")}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("rank.search")} /></label>
        <span className="spacer" />
        <a className="btn small" href={dataUrl("ranking.csv")} download>⬇ {t("rank.download")}</a>
      </div>
      {v && (
        <p className="note honest">
          {t("rank.validation")} ({TARGET_NAMES[tinfo.id]?.[lang]}): AUC {v.auc === null ? "—" : num(lang, v.auc, 2)}
          {v.auc_ci90 ? ` (IC 90 %: ${num(lang, v.auc_ci90[0], 2)}–${num(lang, v.auc_ci90[1], 2)})` : ""} · n+ {v.n_pos ?? "—"} · n {v.n_rand ?? "—"}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>{head("site", t("rank.col.site"))}{head("country", t("rank.col.country"))}{head("role", t("rank.col.role"))}
              {head("ifa", t("rank.col.ifa"), true)}{head("ifa_min", t("rank.col.ifamin"), true)}{head("coverage", t("rank.col.cov"), true)}
              {head("p_top3", t("rank.col.top3"), true)}{head("median_rank", t("rank.col.rank"), true)}{head("limiting", t("rank.col.lim"))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const s = siteMap.get(r.site_id);
              return (
                <tr key={r.site_id} className={s?.country === "Bolivia" ? "bolivia" : ""}>
                  <td className="num">{i + 1}</td>
                  <td><a href={`#/mapa?target=${tinfo.id}&site=${r.site_id}`}>{s?.name ?? r.site_id}</a></td>
                  <td>{lang === "en" ? COUNTRY_EN[s?.country ?? ""] ?? s?.country : s?.country}</td>
                  <td>{t(`role.${r.role}`)}</td>
                  <td className="num">{num(lang, r.ifa, 1)}</td>
                  <td className="num">{num(lang, r.ifa_min, 1)}</td>
                  <td className="num">{pct(lang, r.coverage)}</td>
                  <td className="num">{pct(lang, r.robust?.p_top3)}</td>
                  <td className="num">{num(lang, r.robust?.median_rank, 0)}</td>
                  <td>{r.limiting ? t(`dim.${r.limiting}`) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
