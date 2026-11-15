// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Pantalla del juego: globo 3D → región → lugar (con su imagen satelital real) → configurar → manejar.
import { useEffect, useMemo, useRef, useState } from "react";
import { dataUrl, useData, type GameSite, type SiteInfo } from "../data";
import { COUNTRY_EN, num } from "../i18n";
import { go, useSettings, type Route } from "../settings";
import { Game } from "../game/Game";
import type { Gravity, Weather } from "../game/engine";
import type { Mode } from "../game/core/world";
import { Globe } from "../game/globe/Globe";
import { buildRegions, regionOf, type Region } from "../game/regions";
import { ramp } from "../colors";
import { SitePhoto, usePhotos } from "../components/SitePhoto";

type Body = "mars" | "moon";
interface Best { target: string; name: string; ifa: number; ifa_min: number; coverage: number }
export interface Imagery { id: string; file: string; date: string; credit: string; source: string; enhanced?: boolean; cloud_pct: number; error?: string }

const BIOME_ICON: Record<string, string> = { desierto: "🏜️", salar: "🧂", lago: "🌊", volcanico: "🌋", frio: "🧊", vegetado: "🌿" };

export default function PlayPage({ route }: { route: Route }) {
  const { t, lang, level } = useSettings();
  const gs = useData<{ sites: GameSite[] }>("terrain/game_sites.json");
  const bestD = useData<Record<string, Partial<Record<Body, Best>>>>("best.json");
  const imgD = useData<{ sites: Imagery[] }>("imagery/imagery.json");
  const idx = useData<{ sites: SiteInfo[] }>("sites_index.json");
  const sites = gs.data?.sites ?? null;
  const best = bestD.data ?? {};
  const imgs = useMemo(() => new Map((imgD.data?.sites ?? []).filter((x) => !x.error).map((x) => [x.id, x])), [imgD.data]);
  const info = useMemo(() => new Map((idx.data?.sites ?? []).map((x) => [x.id, x])), [idx.data]);
  const regions = useMemo(() => (sites ? buildRegions(sites) : []), [sites]);
  const photos = usePhotos();

  const [body, setBody] = useState<Body>("mars");
  const [region, setRegion] = useState<Region | null>(null);
  const [setup, setSetup] = useState<GameSite | null>(null);
  const [list, setList] = useState(false);
  const [mode, setMode] = useState<Mode>("mission");
  const [gravity, setGravity] = useState<Gravity>("mars");
  const [weather, setWeather] = useState<Weather>("auto");
  const [playing, setPlaying] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const globe = useRef<Globe | null>(null);

  // ?site=… (desde la ficha del mapa): abre su región y la configuración
  useEffect(() => {
    const id = route.query.get("site");
    if (!id || !sites) return;
    const s = sites.find((x) => x.id === id);
    const r = regionOf(regions, id);
    if (s && r) { setRegion(r); setSetup(s); }
  }, [sites, regions]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (playing || !box.current || !labels.current || !regions.length) return;
    const g = new Globe(box.current, labels.current, regions, (r) => setRegion(r));
    globe.current = g;
    return () => { g.dispose(); globe.current = null; };
  }, [regions, playing]);

  const regionScore = (r: Region, b: Body) => Math.max(-1, ...r.sites.map((s) => best[s.id]?.[b]?.ifa ?? -1));
  useEffect(() => {
    globe.current?.setPins(
      (r) => `${lang === "es" ? r.es : r.en}, ${lang === "en" ? COUNTRY_EN[r.country] ?? r.country : r.country}`,
      (r) => { const v = regionScore(r, body); return v < 0 ? "#8e9bb8" : ramp(body, 0.25 + 0.75 * (v / 100)); },
    );
  });
  useEffect(() => { globe.current?.focus(region); if (globe.current) globe.current.shift = region ? 0.27 : 0; }, [region, playing]);
  useEffect(() => { if (setup && mode === "cave" && !setup.cave) setMode("mission"); }, [setup, mode]);

  if (gs.error) return <div className="container section"><p className="note">⚠️ {gs.error}</p></div>;
  if (!sites) return <div className="container section"><p>{t("g.loading")}</p></div>;
  if (playing && setup) return <Game site={setup} mode={mode} gravity={gravity} weather={weather} imagery={imgs.get(setup.id) ?? null}
    onExit={() => setPlaying(false)} onGlobe={() => { setPlaying(false); setSetup(null); }} />;

  const country = (c: string) => (lang === "en" ? COUNTRY_EN[c] ?? c : c);
  const bodyName = (b: Body) => t(b === "mars" ? "play.gravity.mars" : "play.gravity.moon");
  const roleText = (s: GameSite) => {
    const i = info.get(s.id);
    if (s.role === "control_pos") return t("globe.role.known", { body: (i?.analog_for ?? ["mars"]).map((b) => bodyName(b as Body)).join(" / ") });
    if (s.role === "control_neg") return t("globe.role.neg");
    return t("globe.role.cand");
  };
  const simText = (s: GameSite) => {
    const b = best[s.id]?.[body];
    return b ? t("globe.sim", { target: b.name, v: num(lang, b.ifa, 0), c: num(lang, b.coverage * 100, 0) }) : t("globe.sim.none", { body: bodyName(body) });
  };

  const SiteCard = ({ s }: { s: GameSite }) => {
    const im = imgs.get(s.id);
    const ph = photos.get(s.id);
    const b = best[s.id]?.[body];
    return (
      <article className="region-site">
        {ph ? <SitePhoto photo={ph} alt={s.name} height={140} compact />
          : im && <img src={dataUrl(im.file)} alt={t("globe.img.alt", { name: s.name })} loading="lazy" title={`${im.credit} · ${im.date}`} />}
        <div className="rs-body">
          <h4>{BIOME_ICON[s.biome] ?? "⛰️"} {s.name}</h4>
          <p className="rs-meta">{t(`biome.${s.biome}`)} · {country(s.country)} · {s.lat.toFixed(3)}°, {s.lon.toFixed(3)}°</p>
          <p className="rs-role">{roleText(s)}</p>
          <p className="rs-sim" style={{ color: b ? ramp(body, 0.35 + 0.65 * (b.ifa / 100)) : undefined }}>{simText(s)}</p>
          <p className="rs-ok">✓ {t("globe.dem")}{im ? ` · ✓ ${t("globe.sat")}` : ""}{s.cave ? ` · 🕳️ ${t("play.mode.cave")}` : ""}</p>
          <div className="row">
            <button className="btn explore" onClick={() => setSetup(s)}>{t("globe.explore")}</button>
            <button className="btn ghost small" onClick={() => go("mapa", { site: s.id })}>{t("globe.card")}</button>
          </div>
        </div>
      </article>
    );
  };

  const im = setup ? imgs.get(setup.id) : undefined;
  const ph = setup ? photos.get(setup.id) : undefined;
  return (
    <div className="globe-page">
      <div ref={box} className="globe-canvas" />
      <div ref={labels} className="globe-labels" aria-hidden={list} />
      <div className="globe-title">
        <h1>{t("globe.title")}</h1>
        <p>{t("globe.hint")}</p>
        <button className="btn ghost small" onClick={() => setList((v) => !v)}>{list ? t("globe.list.close") : `☰ ${t("globe.list")}`}</button>
      </div>
      <div className="globe-compare">
        <span>{t("globe.compare")}</span>
        {(["mars", "moon"] as Body[]).map((b) => (
          <button key={b} className={`btn ${body === b ? "primary" : ""}`} aria-pressed={body === b} onClick={() => setBody(b)}>{bodyName(b)}</button>
        ))}
        <span className="globe-legend" aria-hidden="true">
          <i style={{ background: ramp(body, 0.25) }} /> {t("globe.low")} <i style={{ background: ramp(body, 1) }} /> {t("globe.high")} <i style={{ background: "#8e9bb8" }} /> {t("globe.nodata")}
        </span>
      </div>

      {list && (
        <div className="globe-list" role="dialog" aria-label={t("globe.list")}>
          {regions.map((r) => (
            <section key={r.id}>
              <h3>{lang === "es" ? r.es : r.en}, {country(r.country)}</h3>
              {r.sites.map((s) => <button key={s.id} className="linkish" onClick={() => { setList(false); setRegion(r); setSetup(s); }}>{s.name}</button>)}
            </section>
          ))}
        </div>
      )}

      {region && !list && (
        <aside className="region-panel" aria-label={lang === "es" ? region.es : region.en}>
          <header>
            <div><h2>{lang === "es" ? region.es : region.en}</h2><p>{country(region.country)}</p></div>
            <button className="btn ghost small" aria-label={t("g.card.close")} onClick={() => setRegion(null)}>✕</button>
          </header>
          {region.sites.map((s) => <SiteCard key={s.id} s={s} />)}
        </aside>
      )}

      {setup && (
        <div className="overlay setup-overlay" role="dialog" aria-labelledby="setup-title">
          <div className="card setup-card">
            <button className="btn ghost small setup-x" aria-label={t("g.card.close")} onClick={() => setSetup(null)}>✕</button>
            <div className="setup-media">
              {ph && <SitePhoto photo={ph} alt={setup.name} height={230} />}
              {im && (
                <figure className="setup-img">
                  <img src={dataUrl(im.file)} alt={t("globe.img.alt", { name: setup.name })} />
                  <figcaption>🛰️ {t("globe.img.cap", { date: im.date })}{im.enhanced ? ` · ${t("globe.img.enh")}` : ""} · {im.credit}</figcaption>
                </figure>
              )}
            </div>
            <h2 id="setup-title">{setup.name}</h2>
            <p className="muted">{roleText(setup)} · {simText(setup)}</p>
            <h3>{t("play.mode")}</h3>
            <div className="mode-pick">
              {(["free", "mission", "cave"] as Mode[]).map((m) => {
                const off = m === "cave" && !setup.cave;
                return (
                  <button key={m} aria-pressed={mode === m} disabled={off} onClick={() => setMode(m)}>
                    <span className="mp-t">{m === "free" ? "🏁" : m === "mission" ? "🛰️" : "🕳️"} {t(`play.mode.${m}`)}</span>
                    <span className="mp-d">{off ? t("play.cave.only") : t(`play.mode.${m}.d`)}</span>
                  </button>
                );
              })}
            </div>
            <div className="setup-row">
              <div>
                <h3>{t("play.gravity")}</h3>
                <div className="seg" role="group" aria-label={t("play.gravity")}>
                  {(["earth", "mars", "moon"] as Gravity[]).map((g) => (
                    <button key={g} aria-pressed={gravity === g} onClick={() => setGravity(g)}>{g === "earth" ? "🌍" : g === "mars" ? "🔴" : "🌕"} {t(`play.gravity.${g}`)}</button>
                  ))}
                </div>
              </div>
              <div>
                <h3>{t("w.title")}</h3>
                <div className="seg" role="group" aria-label={t("w.title")}>
                  {(["auto", "clear", "rain"] as Weather[]).map((w) => (
                    <button key={w} aria-pressed={weather === w} onClick={() => setWeather(w)}>{t(`w.${w}`)}</button>
                  ))}
                </div>
              </div>
            </div>
            <p className="muted small-print">{t("play.gravity.note")} {t("w.note")} {t("play.difficulty", { level: t(`level.${level}`) })}</p>
            <p className="note honest small-print">{t("play.honesty")}</p>
            <button className="btn primary big-start" onClick={() => setPlaying(true)}>▶ {t("play.start")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
