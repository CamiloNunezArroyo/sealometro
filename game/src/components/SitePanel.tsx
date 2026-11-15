// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Ficha de un lugar contra un objetivo, en 3 niveles de lectura. Todos los números vienen de ranking/<objetivo>.json.
import { useState } from "react";
import type { Dim, Result, SiteInfo, TargetInfo, Val } from "../data";
import { ramp } from "../colors";
import { COUNTRY_EN, num, pct, TARGET_NAMES, type Lang } from "../i18n";
import { go, useSettings } from "../settings";

const CLASS_NAMES: Record<string, { es: string; en: string }> = {
  sulfato: { es: "sulfatos", en: "sulfates" }, cloruro: { es: "cloruros (sal)", en: "chlorides (salt)" },
  arcilla: { es: "arcillas", en: "clays" }, carbonato: { es: "carbonatos", en: "carbonates" },
  silice_hidratada: { es: "sílice hidratada", en: "hydrated silica" }, oxido_fe: { es: "óxidos de hierro", en: "iron oxides" },
  basalto: { es: "basalto", en: "basalt" }, anortosita: { es: "anortosita", en: "anorthosite" },
};
const UNIT_EN: Record<string, string> = { "mm/año": "mm/yr", grados: "°" };

export function fmtVal(lang: Lang, v: Val | null | undefined): string {
  if (!v || v.status === "pending") return "—";
  if (v.classes) return v.classes.length ? v.classes.map((c) => CLASS_NAMES[c]?.[lang] ?? c).join(", ") : "∅";
  const unit = v.unit === "1" ? "" : " " + (lang === "en" ? UNIT_EN[v.unit] ?? v.unit : v.unit === "grados" ? "°" : v.unit);
  if ((v.value === null || v.value === undefined) && v.range) return `${num(lang, v.range[0], 2)}–${num(lang, v.range[1], 2)}${unit}`;
  const x = v.value ?? 0;
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  const s = Math.abs(x) > 0 && Math.abs(x) < 1e-3 ? x.toExponential(1) : num(lang, x, d);
  return s + unit;
}

export function Badge({ status }: { status: string }) {
  const { t } = useSettings();
  return <span className={`badge ${status}`}>{t(`status.${status}`)}</span>;
}

export function DimBars({ dims, body }: { dims: Dim[]; body: "mars" | "moon" }) {
  const { t, lang } = useSettings();
  const rows = dims.filter((d) => d.s !== null && (d.weight > 0 || !d.analogable));
  return (
    <div role="list">
      {rows.map((d) => (
        <div className="dim" role="listitem" key={d.id} title={d.analogable ? "" : t("site.gap")}>
          <span>{t(`dim.${d.id}`)}{!d.analogable && <span className="muted"> · {t("site.gap")}</span>}</span>
          <span className="track" aria-hidden="true"><span style={{ width: `${Math.max(2, 100 * (d.s ?? 0))}%`, background: ramp(body, 0.25 + 0.75 * (d.s ?? 0)) }} /></span>
          <span className="val">{num(lang, d.s, 2)}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressBars({ dims }: { dims: Dim[] }) {
  const { t, lang } = useSettings();
  const rows = dims.filter((d) => d.po !== null).sort((a, b) => (b.po ?? 0) - (a.po ?? 0));
  return (
    <div role="list">
      {rows.map((d) => (
        <div className="dim" role="listitem" key={d.id}>
          <span>{t(`dim.${d.id}`)}</span>
          <span className="track" aria-hidden="true"><span style={{ width: `${Math.max(2, 100 * (d.po ?? 0))}%`, background: "linear-gradient(90deg,#3987e5,#e8743b)" }} /></span>
          <span className="val">{pct(lang, d.po)}</span>
        </div>
      ))}
    </div>
  );
}

function WeightSlider({ g, body }: { g: number; body: "mars" | "moon" }) {
  const { t, lang } = useSettings();
  const [kg, setKg] = useState(40);
  const kg2 = (kg * g) / 9.82;
  return (
    <div className="card tight">
      <h4>⚖️ {t("site.weight")}</h4>
      <input type="range" min={10} max={120} value={kg} onChange={(e) => setKg(+e.target.value)} aria-label={t("site.weight")} />
      <p style={{ margin: 0 }}>{t("site.weight.here", { kg })}</p>
      <p className="big-number" style={{ fontSize: "2rem", margin: "4px 0" }}>{num(lang, kg2, 1)} kg</p>
      <p className="muted" style={{ margin: 0 }}>{t("site.weight.there", { body: t(`body.${body}`), kg2: num(lang, kg2, 1) })} · g = {num(lang, g, 2)} m/s² (NASA NSSDC)</p>
    </div>
  );
}

import { SitePhoto, usePhotos } from "./SitePhoto";

export function SitePanel({ site, result, target, rank, total, onClose }: {
  site: SiteInfo; result: Result; target: TargetInfo; rank: number; total: number; onClose: () => void;
}) {
  const { t, lang, level } = useSettings();
  const photo = usePhotos().get(site.id);
  const body = target.body;
  const tname = TARGET_NAMES[target.id]?.[lang] ?? target.name;
  const story = lang === "en" && result.story_en ? result.story_en : result.story;
  const used = result.dims.filter((d) => d.s !== null && d.weight > 0);
  const alike = [...used].sort((a, b) => (b.s ?? 0) - (a.s ?? 0)).filter((d) => (d.s ?? 0) >= 0.5).slice(0, 3);
  const notAlike = [...used].sort((a, b) => (a.s ?? 0) - (b.s ?? 0)).filter((d) => (d.s ?? 0) < 0.3).slice(0, 3);
  const grav = result.gaps.find((g) => g.id === "gravity");
  const press = result.gaps.find((g) => g.id === "pressure");
  const shownIfa = result.ifa ?? result.ifa_min;
  const country = lang === "en" ? COUNTRY_EN[site.country] ?? site.country : site.country;
  const refs = new Map<string, string>();
  for (const d of result.dims) for (const v of [d.site, d.target]) if (v?.source && v.status !== "pending") refs.set(v.source, v.ref ?? "");

  return (
    <article className="card" aria-labelledby="site-title">
      <div className="row">
        <span className="kicker">{country} · {t(`role.${site.role}`)}</span>
        <span className="spacer" />
        <button className="btn small ghost" onClick={onClose} aria-label={t("site.close")}>✕</button>
      </div>
      <h2 id="site-title" style={{ marginTop: 6 }}>{site.name}</h2>
      {photo && <SitePhoto photo={photo} alt={site.name} height={180} />}

      <div className="row" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="muted">{t("site.ifa", { target: tname })}</div>
          <div className="big-number" style={{ color: ramp(body, 0.35 + 0.65 * ((shownIfa ?? 0) / 100)) }}>
            {num(lang, shownIfa, 0)}<span style={{ fontSize: "1.2rem" }}>/100</span>
          </div>
          <div className="muted" style={{ fontSize: "0.85rem" }}>
            {result.ifa === null ? t("site.noifa", { v: num(lang, result.ifa_min, 1) }) : t("site.cover", { pct: pct(lang, result.coverage) })}
          </div>
        </div>
        <span className="spacer" />
        <span className="pill">🏅 {t("site.rank", { r: rank, n: total })}</span>
      </div>

      <div className="row" style={{ margin: "12px 0" }}>
        <button className="btn primary" onClick={() => go("jugar", { site: site.id })}>🚙 {t("site.drive")}</button>
      </div>

      {(alike.length > 0 || notAlike.length > 0) && (
        <div className="grid grid-2" style={{ gap: 10 }}>
          <div className="card tight"><div className="kicker">✅ {t("site.alike")}</div>
            <ul>{alike.map((d) => <li key={d.id}>{t(`dim.${d.id}`)}</li>)}{alike.length === 0 && <li className="muted">—</li>}</ul></div>
          <div className="card tight"><div className="kicker">❌ {t("site.notalike")}</div>
            <ul>{notAlike.map((d) => <li key={d.id}>{t(`dim.${d.id}`)}</li>)}{notAlike.length === 0 && <li className="muted">—</li>}</ul></div>
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>{t("site.story")}</h3>
      <p>{level === "explorador" ? story.explorador : level === "cadete" ? story.cadete : story.cientifico}</p>

      {grav && typeof grav.target === "number" && <WeightSlider g={grav.target} body={body} />}

      {level !== "explorador" && (
        <>
          <h3 style={{ marginTop: 16 }}>{t("site.dims")}</h3>
          <DimBars dims={result.dims} body={body} />
          <h3 style={{ marginTop: 16 }}>{t("site.progress", { target: t(`body.${body}`) })}</h3>
          <ProgressBars dims={result.dims} />
          <h3 style={{ marginTop: 16 }}>{t("site.profiles")}</h3>
          <div className="row">
            {Object.entries(result.profiles).map(([k, v]) => (
              <span key={k} className="pill">{t(`prof.${k}`)}: {v === null ? "—" : num(lang, v, 0)}</span>
            ))}
          </div>
          {result.robust && result.robust.median_rank !== null && (
            <>
              <h3 style={{ marginTop: 16 }}>{t("site.robust")}</h3>
              <p>{t("site.robust.text", { n: result.robust.n, p: pct(lang, result.robust.p_top3), m: num(lang, result.robust.median_rank, 0) })}</p>
            </>
          )}
          <h3 style={{ marginTop: 16 }}>{t("site.gaps")}</h3>
          <ul>
            {grav && typeof grav.target === "number" && <li>{t("gap.gravity.t", { body: t(`body.${body}`), pct: pct(lang, grav.ratio) })}</li>}
            {press && press.ratio !== undefined && <li>{t("gap.pressure.t", { ratio: (press.ratio ?? 0) < 0.01 ? (lang === "es" ? "menos del 1 %" : "less than 1%") : pct(lang, press.ratio) })}</li>}
            <li className="muted">{t("gap.dose.t")}</li>
          </ul>
        </>
      )}

      {level === "cientifico" && (
        <>
          <h3 style={{ marginTop: 16 }}>IFA · {t("site.table.dim")}</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("site.table.dim")}</th><th>{t("site.table.site")}</th><th>{t("site.table.target")}</th>
                <th className="num">s</th><th className="num">{t("site.table.po")}</th><th className="num">{t("site.table.pct")}</th></tr></thead>
              <tbody>
                {result.dims.map((d) => (
                  <tr key={d.id}>
                    <td>{d.id}{!d.analogable && <span className="muted"> ({t("site.gap")})</span>}</td>
                    <td>{fmtVal(lang, d.site)} {d.site && <Badge status={d.site.status} />}</td>
                    <td>{fmtVal(lang, d.target)} {d.target && <Badge status={d.target.status} />}</td>
                    <td className="num">{num(lang, d.s, 2)}</td>
                    <td className="num">{pct(lang, d.po)}</td>
                    <td className="num">{num(lang, d.pct_earth, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: "0.85rem" }}>
            IFA {num(lang, result.ifa, 1)} · IFA cons. {num(lang, result.ifa_min, 1)} · {t("rank.col.cov")} {pct(lang, result.coverage)} · {t("rank.col.lim")}: {result.limiting ?? "—"}
            {site.lat !== null && <> · {t("site.coords")}: {num(lang, site.lat, 4)}, {num(lang, site.lon, 4)} <Badge status={site.coord_status} /></>}
          </p>
          <h4>{t("site.sources")}</h4>
          <ul style={{ fontSize: "0.85rem" }}>
            {[...refs.entries()].slice(0, 14).map(([src, ref]) => (
              <li key={src}>{ref ? <a href={ref} target="_blank" rel="noreferrer">{src}</a> : src}</li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
