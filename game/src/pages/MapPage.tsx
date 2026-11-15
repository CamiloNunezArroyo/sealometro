// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { useMemo } from "react";
import { rankValue, useData, type Discover, type RankingIndex, type Result, type SiteInfo, type TargetFile } from "../data";
import { WorldMap } from "../components/WorldMap";
import { SitePanel } from "../components/SitePanel";
import { COUNTRY_EN, num, TARGET_NAMES } from "../i18n";
import { go, useSettings, type Route } from "../settings";

export function TargetSelect({ index, value, onChange }: { index: RankingIndex; value: string; onChange: (id: string) => void }) {
  const { t, lang } = useSettings();
  const groups: ["mars" | "moon", string][] = [["mars", t("map.mars")], ["moon", t("map.moon")]];
  return (
    <label className="field">{t("map.target")}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {groups.map(([b, label]) => (
          <optgroup key={b} label={label}>
            {index.targets.filter((x) => x.body === b).map((x) => (
              <option key={x.id} value={x.id}>{TARGET_NAMES[x.id]?.[lang] ?? x.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function MapPage({ route }: { route: Route }) {
  const { t, lang, level } = useSettings();
  const target = route.query.get("target") ?? "mars_gale";
  const selected = route.query.get("site");
  const heatOn = route.query.get("heat") === "1";
  const boliviaOnly = route.query.get("bo") === "1";
  const { data: index, error } = useData<RankingIndex>("ranking/index.json");
  const tinfo = index?.targets.find((x) => x.id === target) ?? index?.targets[0];
  const { data: tfile } = useData<TargetFile>(tinfo ? tinfo.file : null);
  const { data: sitesIdx } = useData<{ sites: SiteInfo[] }>("sites_index.json");
  const { data: heat } = useData<Discover>(heatOn && tinfo?.id === "mars_global" ? "discover_mars_global.json" : null);

  const results = useMemo(() => new Map<string, Result>((tfile?.results ?? []).map((r) => [r.site_id, r])), [tfile]);
  const ordered = useMemo(() => [...(tfile?.results ?? [])].sort((a, b) => rankValue(b) - rankValue(a)), [tfile]);
  const maxIfa = useMemo(() => Math.max(10, ...ordered.map((r) => r.ifa ?? 0)), [ordered]);
  const allNull = ordered.length > 0 && ordered.every((r) => r.ifa === null);

  const set = (q: Record<string, string | undefined>) =>
    go("mapa", { target, site: selected ?? undefined, heat: heatOn ? "1" : undefined, bo: boliviaOnly ? "1" : undefined, ...q });

  if (error) return <p className="container section">{t("error.data")}</p>;
  if (!index || !tinfo || !sitesIdx) return <p className="container section">{t("loading")}</p>;
  const siteMap = new Map(sitesIdx.sites.map((s) => [s.id, s]));
  const sel = selected ? siteMap.get(selected) : undefined;
  const selRes = selected ? results.get(selected) : undefined;
  const rank = selected ? ordered.findIndex((r) => r.site_id === selected) + 1 : 0;

  return (
    <div className="container section" style={{ paddingTop: 24 }}>
      <div className="row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
        <h1 style={{ fontSize: "clamp(1.6rem,3vw,2.2rem)", margin: 0 }}>{t("map.title")}</h1>
        <span className="spacer" />
        <TargetSelect index={index} value={tinfo.id} onChange={(id) => set({ target: id, heat: id === "mars_global" && heatOn ? "1" : undefined })} />
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={boliviaOnly} onChange={(e) => set({ bo: e.target.checked ? "1" : undefined })} /> {t("map.filter.bolivia")}</label>
        {tinfo.id === "mars_global" && (
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={heatOn} onChange={(e) => set({ heat: e.target.checked ? "1" : undefined })} /> {t("map.heat")}</label>
        )}
      </div>
      {allNull && <p className="note">{t("map.insufficient")}</p>}
      {heatOn && heat && <p className="note honest">{t("map.heat.note")}</p>}
      <div className="map-layout">
        <div>
          <WorldMap sites={sitesIdx.sites} results={results} body={tinfo.body} selected={selected} maxIfa={maxIfa}
            onSelect={(id) => set({ site: id })} heat={heatOn ? heat : null} boliviaOnly={boliviaOnly} />
          <div className="card" style={{ marginTop: 16 }}>
            <h3>🏆 {t("home.top.title", { target: TARGET_NAMES[tinfo.id]?.[lang] ?? tinfo.name })}</h3>
            <ol style={{ margin: 0, paddingLeft: 22 }}>
              {ordered.slice(0, level === "explorador" ? 5 : 10).map((r) => {
                const s = siteMap.get(r.site_id);
                return (
                  <li key={r.site_id} style={{ margin: "6px 0" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "2px 10px" }}>
                    <span>
                    <a href={`#/mapa?target=${tinfo.id}&site=${r.site_id}`}>{s?.name ?? r.site_id}</a>
                    <span className="muted"> · {lang === "en" ? COUNTRY_EN[s?.country ?? ""] ?? s?.country : s?.country}</span>
                    {s?.country === "Bolivia" && <span className="pill" style={{ marginLeft: 6, borderColor: "#c98500" }}>BO</span>}
                    </span>
                    <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>IFA {num(lang, r.ifa, 0)}{level !== "explorador" && r.robust ? ` · P(top-3) ${num(lang, 100 * r.robust.p_top3, 0)}${lang === "es" ? " %" : "%"}` : ""}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        <aside className="side-panel" aria-live="polite">
          {sel && selRes ? (
            <SitePanel site={sel} result={selRes} target={tinfo} rank={rank} total={ordered.length} onClose={() => set({ site: undefined })} />
          ) : (
            <div className="card"><p style={{ margin: 0 }}>👆 {t("map.pick")}</p></div>
          )}
        </aside>
      </div>
    </div>
  );
}
