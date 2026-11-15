// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Juego: lienzo 3D + HUD + controles (teclado y táctil) + mapa grande, análisis de muestras, modo foto,
// estación, pausa y pantallas de "rover perdido" / "misión cumplida" con el progreso.
import { useEffect, useMemo, useRef, useState } from "react";
import { GameEngine, type ArenaRuntime, type EndResult, type Gravity, type HudSnapshot, type SampleRecord, type Weather } from "./engine";
import type { SensorReport } from "../station/quality";
import type { Mode } from "./core/world";
import { CAVE_KIND } from "./core/cave";
import { dataUrl, type GameSite, type Val } from "../data";
import { num, type Lang } from "../i18n";
import { useSettings } from "../settings";
import { Badge, fmtVal } from "../components/SitePanel";
import type { Imagery } from "../pages/PlayPage";
import { Lab } from "./lab/Lab";
import { pickSamples } from "./lab/samples";
import { MINERAL_BY_ID, prettyFormula } from "./lab/minerals";

const MINERAL: Record<string, { es: string; en: string }> = {
  sulfato: { es: "sulfatos", en: "sulfates" }, cloruro: { es: "sal (cloruros)", en: "salt (chlorides)" },
  arcilla: { es: "arcillas", en: "clays" }, carbonato: { es: "carbonatos", en: "carbonates" },
  silice_hidratada: { es: "sílice hidratada", en: "hydrated silica" }, oxido_fe: { es: "óxidos de hierro", en: "iron oxides" },
  basalto: { es: "basalto", en: "basalt" }, anortosita: { es: "anortosita", en: "anorthosite" },
};
export function mineralLabel(site: GameSite, lang: Lang): string {
  const c = site.minerals?.classes?.[0];
  return c ? MINERAL[c]?.[lang] ?? c : lang === "es" ? "suelo (regolito)" : "soil (regolith)";
}

function Meter({ icon, label, value, color, text }: { icon: string; label: string; value: number; color: string; text: string }) {
  return (
    <div className="meter" title={label} aria-label={`${label}: ${text}`}>
      <span aria-hidden="true">{icon}</span>
      <span className="m-track"><span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></span>
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{text}</span>
    </div>
  );
}

type Map2D = HudSnapshot["map"];
/** Dibuja el mapa (mini o grande): imagen satelital real de fondo, peligros conocidos y objetivos. */
function drawMap(ctx: CanvasRenderingContext2D, W: number, m: Map2D, bg: CanvasImageSource | null, big: boolean) {
  ctx.clearRect(0, 0, W, W);
  let P: (x: number, z: number) => readonly [number, number];
  let sc = 1;
  if (m.cave) {
    ctx.fillStyle = "#0b0d14"; ctx.fillRect(0, 0, W, W);
    const xs = m.cave.map((p) => p.x), zs = m.cave.map((p) => p.z);
    const minX = Math.min(...xs) - 10, maxX = Math.max(...xs) + 10, minZ = Math.min(...zs) - 10, maxZ = Math.max(...zs) + 10;
    sc = (W - 10) / Math.max(maxX - minX, maxZ - minZ);
    P = (x, z) => [5 + (x - minX) * sc, 5 + (z - minZ) * sc] as const;
    ctx.strokeStyle = "#5b4a40"; ctx.lineWidth = big ? 14 : 7; ctx.lineCap = "round"; ctx.beginPath();
    m.cave.forEach((p, i) => { const [a, b] = P(p.x, p.z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
    ctx.stroke();
    for (const h of m.hazards) {
      const [a, b] = P(h.x, h.z);
      ctx.fillStyle = h.kind === "crevice" ? "#000" : h.kind === "pool" ? "#2b8fd6" : h.kind === "ice" ? "#cfeaff" : "#d95926";
      ctx.beginPath(); ctx.arc(a, b, big ? 5 : 2.5, 0, 7); ctx.fill();
    }
  } else {
    // arena: el mapa muestra solo el lugar (no los 30 m de margen de la rejilla)
    const v = m.view ?? { cx: 0, cz: 0, size: m.size };
    ctx.fillStyle = m.view ? "#1c2028" : "#3a3026"; ctx.fillRect(0, 0, W, W);
    if (bg) {
      const bw = (bg as HTMLImageElement | HTMLCanvasElement).width, k = bw / m.size;
      ctx.drawImage(bg, (v.cx - v.size / 2 + m.size / 2) * k, (v.cz - v.size / 2 + m.size / 2) * k, v.size * k, v.size * k, 0, 0, W, W);
    }
    sc = W / v.size;
    P = (x, z) => [(x - v.cx + v.size / 2) * sc, (z - v.cz + v.size / 2) * sc] as const;
    ctx.lineWidth = 1;
    for (const s of m.sand) { const [a, b] = P(s.x, s.z); ctx.strokeStyle = "rgba(255,214,150,0.85)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(a, b, Math.max(2, s.r * sc), 0, 7); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const p of m.puddles) { const [a, b] = P(p.x, p.z); ctx.fillStyle = p.deep > 0 ? "rgba(40,120,200,0.85)" : "rgba(90,170,230,0.8)"; ctx.beginPath(); ctx.arc(a, b, Math.max(1.5, p.r * sc), 0, 7); ctx.fill(); }
    for (const v of m.vents) { const [a, b] = P(v.x, v.z); ctx.fillStyle = "#ef5b5b"; ctx.beginPath(); ctx.arc(a, b, big ? 4 : 2, 0, 7); ctx.fill(); }
    for (const d of m.devils) { const [a, b] = P(d.x, d.z); ctx.strokeStyle = "#ffd28a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(a, b, big ? 8 : 4, 0, 5); ctx.stroke(); }
  }
  const R = big ? 1.8 : 1;
  for (const bc of m.beacons ?? []) { const [a, b] = P(bc.x, bc.z); ctx.fillStyle = "#35c8ff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(a, b, 2.6 * R, 0, 7); ctx.fill(); ctx.stroke(); }
  if (m.base) { const [a, b] = P(m.base.x, m.base.z); ctx.fillStyle = "#7fb2ff"; ctx.fillRect(a - 4 * R, b - 4 * R, 8 * R, 8 * R); }
  m.targets.forEach((tg, i) => {
    const [a, b] = P(tg.x, tg.z);
    ctx.fillStyle = i === 0 ? "#ffa04d" : "rgba(255,160,77,0.55)"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(a, b, (i === 0 ? 4.5 : 3) * R, 0, 7); ctx.fill(); ctx.stroke();
    if (big) { ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.fillText(String(i + 1), a + 9, b + 4); }
  });
  m.relays.forEach((r) => { const [a, b] = P(r.x, r.z); ctx.fillStyle = "#5cff8a"; ctx.beginPath(); ctx.arc(a, b, 3 * R, 0, 7); ctx.fill(); });
  const [x, y] = P(m.x, m.z);
  const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw), k = big ? 1.7 : 1;
  ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + fx * 9 * k, y + fz * 9 * k);
  ctx.lineTo(x - fx * 5 * k + fz * 5 * k, y - fz * 5 * k - fx * 5 * k);
  ctx.lineTo(x - fx * 5 * k - fz * 5 * k, y - fz * 5 * k + fx * 5 * k);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  if (big && !m.cave) { // escala y norte (fila 0 del DEM = norte)
    const barM = m.view ? (m.view.size < 60 ? 5 : 20) : 500, L = barM * sc;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(10, W - 34, L + 20, 24);
    ctx.fillStyle = "#fff"; ctx.fillRect(20, W - 20, L, 4);
    ctx.font = "12px sans-serif"; ctx.fillText(`${barM} m`, 20 + L / 2 - 16, W - 24);
    if (!m.view || m.view.north) ctx.fillText("N ↑", W - 34, 20); // medidas a mano o escaneo: no se sabe dónde está el norte
  }
}

export function Game({ site, mode, gravity, weather, imagery, onExit, onGlobe, arena, stationRows }: {
  site: GameSite; mode: Mode; gravity: Gravity; weather: Weather; imagery: Imagery | null; onExit: () => void; onGlobe: () => void;
  arena?: ArenaRuntime; stationRows?: SensorReport[];
}) {
  const { t, lang, level } = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const eng = useRef<GameEngine | null>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const cropRef = useRef<HTMLCanvasElement>(null);
  const bg = useRef<HTMLImageElement | ImageData | null>(null);
  const bgCanvas = useRef<HTMLCanvasElement | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [end, setEnd] = useState<EndResult | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [bigMap, setBigMap] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [hour, setHour] = useState(11);
  const [withData, setWithData] = useState(true);
  const [lastShot, setLastShot] = useState<string | null>(null);
  const [labOpen, setLabOpen] = useState<number | null>(null);
  const [identified, setIdentified] = useState<Record<number, string>>({});
  // mineral de cada muestra de esta partida (decisión de juego basada en los minerales del sitio: ver lab/samples.ts)
  const samplesPlan = useMemo(() => pickSamples(site, mode === "cave" ? 2 : 3, mode === "cave", run * 7919 + 13), [site, mode, run]);
  const mineralOf = (n: number) => { const p = samplesPlan[(n - 1) % samplesPlan.length]; return { plan: p, m: MINERAL_BY_ID.get(p.id)! }; };
  const touch = typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;

  // fondo del mapa: la imagen satelital real (o el sombreado del relieve si no hay)
  useEffect(() => {
    if (!imagery) return;
    const im = new Image();
    im.onload = () => { bg.current = im; };
    im.src = imagery.file.startsWith("data:") ? imagery.file : dataUrl(imagery.file);
  }, [imagery]);

  useEffect(() => {
    if (!box.current) return;
    setEnd(null); setHud(null); setShowProgress(false); setBigMap(false); setLastShot(null); setLabOpen(null); setIdentified({});
    const e = new GameEngine(box.current, {
      site, mode, gravity, level, mineralLabel: mineralLabel(site, lang), weather,
      imagery: imagery ? { file: imagery.file, credit: imagery.credit, date: imagery.date } : null, arena,
    }, (r) => setEnd(r));
    eng.current = e;
    if (import.meta.env.DEV) (window as unknown as { __eng?: GameEngine }).__eng = e; // solo para depurar en desarrollo
    e.init().then(() => {
      if (!bg.current) {
        const sh = e.hillshade();
        if (sh) { const c = document.createElement("canvas"); c.width = sh.width; c.height = sh.height; c.getContext("2d")!.putImageData(sh, 0, 0); bgCanvas.current = c; }
      }
    }).catch((x) => setErr(String(x)));
    const id = setInterval(() => setHud(e.hud()), 100);
    return () => { clearInterval(id); e.dispose(); eng.current = null; };
  }, [site, mode, gravity, level, weather, run]); // eslint-disable-line react-hooks/exhaustive-deps

  const openMap = (v: boolean) => { setBigMap(v); eng.current?.setPaused(v); };

  // teclado
  useEffect(() => {
    const keys = new Set<string>();
    const apply = () => {
      const f = keys.has("w") || keys.has("arrowup"), b = keys.has("s") || keys.has("arrowdown");
      const l = keys.has("a") || keys.has("arrowleft"), r = keys.has("d") || keys.has("arrowright");
      eng.current?.setInput({ throttle: (f ? 1 : 0) - (b ? 1 : 0), steer: (r ? 1 : 0) - (l ? 1 : 0), brake: keys.has(" ") });
      eng.current?.setAction(keys.has("e"));
    };
    const down = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) ev.preventDefault();
      if (ev.repeat) return;
      const e = eng.current;
      if (!e) return;
      const h = e.hud();
      if (h?.photo) { if (k === "escape" || k === "p") e.setPhotoMode(false); return; }
      if (h?.analysis && (k === "q" || k === "enter" || k === "escape")) { e.closeAnalysis(); return; }
      if (k === "m") { setBigMap((v) => { e.setPaused(!v); return !v; }); return; }
      if (k === "p") { e.setPhotoMode(true); return; }
      if (k === "r") e.dropRelay();
      if (k === "l") e.toggleLights();
      if (k === "c") e.cycleCamera();
      if (k === "escape") { setBigMap(false); e.setPaused(!e.paused); }
      keys.add(k);
      apply();
    };
    const up = (ev: KeyboardEvent) => { keys.delete(ev.key.toLowerCase()); apply(); };
    const blur = () => { keys.clear(); apply(); };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur); };
  }, []);

  // minimapa y mapa grande
  useEffect(() => {
    if (!hud) return;
    const src = bg.current instanceof HTMLImageElement ? bg.current : bgCanvas.current;
    const c = mapRef.current;
    if (c) drawMap(c.getContext("2d")!, c.width, hud.map, src, false);
    const b = bigRef.current;
    if (b && bigMap) drawMap(b.getContext("2d")!, b.width, hud.map, src, true);
  }, [hud, bigMap]);

  // recorte satelital alrededor de la muestra analizada
  useEffect(() => {
    const a = hud?.analysis, c = cropRef.current, im = bg.current;
    if (!a || !c || !(im instanceof HTMLImageElement) || a.cave) return;
    const size = site.size_m, span = 160; // 160 m alrededor del punto
    const u = ((a.x + size / 2) / size) * im.width, v = ((a.z + size / 2) / size) * im.height, w = (span / size) * im.width;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, u - w / 2, v - w / 2, w, w, 0, 0, c.width, c.height);
    ctx.strokeStyle = "#ffa04d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.width / 2, c.height / 2, 9, 0, 7); ctx.stroke();
  }, [hud?.analysis, site.size_m]);

  // joystick táctil
  const joy = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const knob = useRef<HTMLDivElement>(null);
  const onJoy = (e: React.PointerEvent, phase: "down" | "move" | "up") => {
    const el = e.currentTarget as HTMLDivElement;
    if (phase === "down") {
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      joy.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    if (!joy.current || joy.current.id !== e.pointerId) return;
    if (phase === "up") {
      joy.current = null;
      eng.current?.setInput({ throttle: 0, steer: 0 });
      if (knob.current) knob.current.style.transform = "";
      return;
    }
    const dx = e.clientX - joy.current.cx, dy = e.clientY - joy.current.cy;
    const R = 55, d = Math.min(R, Math.hypot(dx, dy)), a = Math.atan2(dy, dx);
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    if (knob.current) knob.current.style.transform = `translate(${x}px, ${y}px)`;
    eng.current?.setInput({ throttle: -y / R, steer: x / R });
  };

  // modo foto: arrastrar para girar, rueda para acercar
  const drag = useRef<{ x: number; y: number } | null>(null);
  const photoPointer = (e: React.PointerEvent, phase: "down" | "move" | "up") => {
    if (!hud?.photo) return;
    if (phase === "down") { drag.current = { x: e.clientX, y: e.clientY }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); return; }
    if (phase === "up") { drag.current = null; return; }
    if (!drag.current) return;
    eng.current?.orbitBy(-(e.clientX - drag.current.x) * 0.008, (e.clientY - drag.current.y) * 0.006);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const shoot = () => {
    const cap = withData
      ? arena ? `${site.name} · ${t("arena.photo.cap")} · Seal Hackathon Team`
        : `${site.name} · ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)} · ${t("photo.cap.src")}${imagery ? " · " + imagery.credit : ""} · Seal Hackathon Team`
      : null;
    const url = eng.current?.takePhoto(cap);
    if (!url) return;
    setLastShot(url);
    const d = new Date(), p2 = (n: number) => String(n).padStart(2, "0");
    const a = document.createElement("a");
    a.href = url;
    a.download = `rover_${site.id}_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
    a.click();
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const climateKeys: [string, string][] = [["t_mean", "dim.t_mean"], ["t_range_diurnal", "dim.t_range_diurnal"], ["pressure", "dim.pressure"],
    ["uv_index", "dim.uv_index"], ["rh", "dim.rh"], ["precip", "dim.precip"], ["wind", "dim.wind"], ["soil_moisture", "dim.soil_moisture"]];
  // temperatura absoluta: K → °C; una DIFERENCIA de temperatura en K es la misma en °C (no se resta 273,15)
  const tC = (k: string, v: Val | null) => (v && v.unit === "K" && typeof v.value === "number"
    ? { ...v, value: k === "t_mean" ? v.value - 273.15 : v.value, unit: "°C" } : v);
  const m1 = (x: number, d = 0) => num(lang, x, d);
  const lesson = end?.reason ? `g.lesson.${end.reason}` : null;
  const stars = end ? "★".repeat(end.stars) + "☆".repeat(3 - end.stars) : "";
  const wIcon = hud?.weather.kind === "rain" ? "🌧️" : hud?.weather.kind === "snow" ? "❄️" : "☀️";

  const renderAnalysis = (a: SampleRecord) => (
    <div className="overlay">
      <div className="card analysis-card" role="dialog" aria-labelledby="an-title">
        <div className="kicker">🧪 {t("an.kicker")}</div>
        <h3 id="an-title">{t("an.title", { n: a.n, site: site.name })}</h3>
        {arena && (() => {
          const p = arena.spec.pois.filter((q) => q.photo).sort((u, v) => Math.hypot(u.x - a.x, u.z - a.z) - Math.hypot(v.x - a.x, v.z - a.z))[0];
          return p ? <div className="an-top"><img src={p.photo} alt="" className="poi-photo" /><p className="muted small-print">{t("arena.poi.photo")}</p></div> : null;
        })()}
        {!a.cave && !arena && (
          <div className="an-top">
            {imagery ? <canvas ref={cropRef} width={160} height={160} aria-label={t("an.crop")} /> : null}
            <p className="muted small-print">{imagery ? t("an.crop.note", { date: imagery.date }) : ""}</p>
          </div>
        )}
        <h4>{t("an.point")}</h4>
        <table><tbody>
          {!a.cave && !arena && <tr><td>{t("an.elev")}</td><td className="num">{m1(a.elev, 0)} m</td><td><Badge status="modeled" /></td></tr>}
          {!a.cave && !arena && <tr><td>{t("an.slope")}</td><td className="num">{m1(a.slope, 1)}°</td><td><Badge status="derived" /></td></tr>}
          {arena && arena.spec.elev0 !== 0 && <tr><td>{t("arena.an.elev")}</td><td className="num">{m1(arena.spec.elev0, 0)} m</td><td><Badge status="measured" /></td></tr>}
          <tr><td>{t("an.soil")}</td><td className="num">{a.soil}{a.wet ? ` · ${t("an.wet")}` : ""}</td><td><Badge status="gameplay" /></td></tr>
          {a.cave && <tr><td>{t("an.cave")}</td><td className="num">{t(`cave.${CAVE_KIND[site.id] ?? "lava"}`)}</td><td><Badge status="literature" /></td></tr>}
        </tbody></table>
        <h4>{t("an.site")}</h4>
        <table><tbody>
          <tr><td>{t("an.minerals")}</td><td className="num">{site.minerals?.classes?.length ? site.minerals.classes.map((c) => MINERAL[c]?.[lang] ?? c).join(", ") : t("an.nominerals")}</td>
            <td>{site.minerals ? <Badge status={site.minerals.status} /> : <Badge status="pending" />}</td></tr>
          {(["t_mean", "precip", "uv_index"] as const).filter((k) => site.climate?.[k]).map((k) => {
            const v = tC(k, site.climate[k] ?? null);
            return <tr key={k}><td>{t(`dim.${k}`)}</td><td className="num">{fmtVal(lang, v)}</td><td>{v && <Badge status={v.status} />}</td></tr>;
          })}
        </tbody></table>
        {site.minerals?.source && <p className="muted small-print">{site.minerals.source}</p>}
        <div className="an-lab">
          {identified[a.n]
            ? <p>✅ {t("lab.identified")}: <b>{MINERAL_BY_ID.get(identified[a.n])!.name[lang]}</b> ({prettyFormula(MINERAL_BY_ID.get(identified[a.n])!.formulaShown ?? MINERAL_BY_ID.get(identified[a.n])!.formula)})</p>
            : <><p>{t("lab.unknown")}</p><button className="btn primary" onClick={() => setLabOpen(a.n)}>🔬 {t("lab.open")}</button></>}
        </div>
        <h4>{t("an.notmeasured")}</h4>
        <ul className="muted small-print">{[1, 2, 3, 4].map((i) => <li key={i}>{t(`an.nm${i}`)}</li>)}</ul>
        <button className="btn primary" onClick={() => eng.current?.closeAnalysis()}>{t("g.card.close")} (Q)</button>
      </div>
    </div>
  );

  const renderProgress = (r: EndResult) => (
    <div className="progress-view">
      <h3>{t("pr.objectives")}</h3>
      <ul className="objectives">{r.objectives.map((o, i) => <li key={i} className={o.done ? "done" : ""}>{o.done ? "✅" : "⬜"} {t(o.key, o.vars)}{o.progress ? ` (${o.progress})` : ""}</li>)}</ul>
      {r.records.length > 0 && (
        <>
          <h3>{t("pr.samples")}</h3>
          <table><thead><tr><th>#</th><th>{t("lab.mineral")}</th>{!arena && <th>{t("an.elev")}</th>}{!arena && <th>{t("an.slope")}</th>}<th>{t("an.soil")}</th></tr></thead>
            <tbody>{r.records.map((x) => <tr key={x.n}><td>{x.n}</td><td>{identified[x.n] ? `✅ ${MINERAL_BY_ID.get(identified[x.n])!.name[lang]}` : t("lab.notyet")}</td>
              {!arena && <td className="num">{x.cave ? "—" : `${m1(x.elev)} m`}</td>}{!arena && <td className="num">{x.cave ? "—" : `${m1(x.slope, 1)}°`}</td>}<td>{x.soil}</td></tr>)}</tbody></table>
        </>
      )}
      <h3>{t("pr.stats")}</h3>
      <div className="stat-grid">
        <span>🛣️ {t("pr.distance")}<b>{m1(r.stats.distance)} m</b></span>
        <span>⏱ {t("g.time")}<b>{fmtTime(r.time)}</b></span>
        <span>🚀 {t("pr.maxspeed")}<b>{m1(r.stats.maxSpeed)} km/h</b></span>
        <span>🛠️ {t("g.damage")}<b>{m1(r.damage)}%</b></span>
        <span>🌪️ {t("pr.devils")}<b>{r.stats.devils}</b></span>
        <span>🪨 {t("pr.boulders")}<b>{r.stats.boulders}</b></span>
        <span>♨️ {t("pr.geysers")}<b>{r.stats.geysers}</b></span>
        <span>☢️ {t("pr.storms")}<b>{r.stats.storms}</b></span>
        <span>⛏️ {t("pr.rockfalls")}<b>{r.stats.rockfalls}</b></span>
        <span>📡 {t("pr.relays")}<b>{r.stats.relays}</b></span>
        <span>📷 {t("pr.photos")}<b>{r.stats.photos}</b></span>
        <span>{r.weather === "rain" ? "🌧️" : r.weather === "snow" ? "❄️" : "☀️"} {t("w.title")}<b>{t(`w.kind.${r.weather}`)}</b></span>
      </div>
    </div>
  );

  return (
    <div className="game-root" role="application" aria-label={t("play.title")}
      onPointerDown={(e) => photoPointer(e, "down")} onPointerMove={(e) => photoPointer(e, "move")} onPointerUp={(e) => photoPointer(e, "up")}
      onWheel={(e) => { if (hud?.photo) eng.current?.orbitBy(0, 0, Math.exp(e.deltaY * 0.001)); }}>
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
      {!hud && !err && <div className="overlay"><div className="card"><h3>{t(arena ? "arena.loading" : "g.loading")}</h3><p className="muted">{arena?.note ?? t(arena ? (arena.spec.source === "scan" ? "arena.honesty.scan" : "arena.honesty") : "play.honesty")}</p></div></div>}
      {err && <div className="overlay"><div className="card"><h3>⚠️</h3><p>{err}</p><button className="btn" onClick={onExit}>{t("g.exit")}</button></div></div>}

      {hud && !hud.photo && (
        <div className="hud">
          <div className="top-left">
            <div className="panel">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{site.name}</div>
              <Meter icon="⚡" label={t("g.battery")} value={hud.battery} color={hud.battery < 20 ? "#ef5b5b" : "#2fbf71"} text={`${m1(hud.battery)}%`} />
              <Meter icon="📡" label={t("g.signal")} value={hud.signal * 100} color={hud.signal < 0.08 ? "#ef5b5b" : hud.signal < 0.3 ? "#f2b134" : "#5ad1ff"}
                text={hud.lostTime > 0 ? `${m1(hud.lostLimit - hud.lostTime)} s` : `${m1(hud.signal * 100)}%`} />
              <Meter icon="🛠️" label={t("g.damage")} value={hud.damage} color={hud.damage > 60 ? "#ef5b5b" : "#f2b134"} text={`${m1(hud.damage)}%`} />
              <div className="row" style={{ justifyContent: "space-between", marginTop: 6, fontSize: 13 }}>
                <span>🚙 {m1(hud.speedKmh)} km/h</span>
                <span title={t("g.tilt")} style={{ color: Math.max(Math.abs(hud.pitchDeg), Math.abs(hud.rollDeg)) > 25 ? "#ffb38a" : undefined }}>
                  ↗ {m1(hud.pitchDeg)}° · ↔ {m1(hud.rollDeg)}°</span>
                <span>⏱ {fmtTime(hud.time)}</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {t("g.grav", { g: num(lang, hud.g, 2) })}{hud.delay ? ` · ${t("g.delay", { s: num(lang, hud.delay, 1) })}` : ""}
                {` · ${t("g.relays")}: ${hud.relaysLeft}`}
                {!hud.map.cave && <> · {wIcon} {hud.weather.on ? t(`w.kind.${hud.weather.kind}`) : t("w.prob", { p: m1(hud.weather.prob * 100) })}</>}
              </div>
            </div>
            <div className="panel">
              <ul className="objectives" style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {hud.objectives.map((o, i) => (
                  <li key={i} className={o.done ? "done" : ""}>{t(o.key, o.vars)}{o.progress ? ` (${o.progress})` : ""}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="top-right">
            <canvas ref={mapRef} width={160} height={160} className="minimap" aria-label={t("map.open")} title={t("map.open")}
              onClick={() => openMap(true)} style={{ cursor: "zoom-in", pointerEvents: "auto" }} />
            {hud.scanner !== null && (() => {
              const lv = hud.scanner >= 0.86 ? 3 : hud.scanner >= 0.62 ? 2 : hud.scanner >= 0.35 ? 1 : 0;
              return (
                <div className="panel scanner" aria-label={t("arena.scanner")}>
                  <div style={{ fontSize: 12 }} className="muted">📡 {t("arena.scanner")}</div>
                  <div className="scan-bars" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <i key={i} className={i < Math.round(hud.scanner! * 10) ? `on l${lv}` : ""} />)}</div>
                  <b className={`scan-l${lv}`}>{t(`arena.scanner.${lv}`)}</b>
                </div>
              );
            })()}
            {hud.targetBearing !== null && (
              <div className="panel" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ display: "inline-block", fontSize: 26, transform: `rotate(${-hud.targetBearing}rad)` }}>⬆</span>
                <span>{t("g.target", { d: m1(hud.targetDist ?? 0) })}</span>
              </div>
            )}
            <div className="row" style={{ pointerEvents: "auto", justifyContent: "flex-end" }}>
              <button className="btn small" onClick={() => openMap(true)}>🗺️ {t("map.btn")}</button>
              <button className="btn small" onClick={() => eng.current?.setPhotoMode(true)}>📷 {t("photo.btn")}</button>
              <button className="btn small" onClick={() => eng.current?.setPaused(true)}>⏸ {t("g.pause")}</button>
            </div>
          </div>

          {hud.storm > 0 && <div className="storm-banner" role="alert">☢️ {t("g.haz.storm.banner", { s: m1(hud.storm) })}</div>}
          {hud.drill && <div className="storm-banner" role="alert">☢️ {hud.drill.late ? t("arena.drill.banner.late") : t("arena.drill.banner", { s: m1(Math.ceil(hud.drill.left)) })}</div>}

          <div className="bottom-center" style={{ bottom: touch ? "48%" : 16 }}>
            {hud.hint && !hud.analysis && <div className="toast">{t(hud.hint, { n: hud.relaysLeft })}{hud.action > 0 && ` · ${m1(hud.action * 100)}%`}</div>}
            {hud.warn && <div className={`toast ${hud.warn.kind}`}>{t(hud.warn.key)}</div>}
            {hud.toast && <div className="toast">{t(hud.toast.key, hud.toast.vars)}</div>}
            {!touch && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t("g.controls.kb")} · {t("g.controls.kb2")}</div>}
            <div className="muted" style={{ fontSize: 11 }}>{arena ? arena.note ?? t(arena.spec.source === "scan" ? "arena.hud.scan" : arena.spec.indoor ? "arena.hud" : "arena.hud.out") : `${t("g.honesty")}${imagery ? ` · ${imagery.credit}` : ""}`}</div>
          </div>

          {touch && (
            <div className="touch">
              <div className="joy" onPointerDown={(e) => onJoy(e, "down")} onPointerMove={(e) => onJoy(e, "move")}
                onPointerUp={(e) => onJoy(e, "up")} onPointerCancel={(e) => onJoy(e, "up")}>
                <div className="knob" ref={knob} />
              </div>
              <div className="tbtns">
                <button onPointerDown={() => eng.current?.setAction(true)} onPointerUp={() => eng.current?.setAction(false)} onPointerLeave={() => eng.current?.setAction(false)}>{t("g.act")}</button>
                <button onPointerDown={() => eng.current?.setInput({ brake: true })} onPointerUp={() => eng.current?.setInput({ brake: false })} onPointerLeave={() => eng.current?.setInput({ brake: false })}>{t("g.brake")}</button>
                <button onClick={() => eng.current?.dropRelay()}>{t("g.relay")}</button>
                <button onClick={() => eng.current?.cycleCamera()}>{t("g.cam")}</button>
                <button onClick={() => eng.current?.toggleLights()}>{t("g.light")}</button>
              </div>
            </div>
          )}

          {hud.stationCard && (
            <div className="overlay">
              <div className="card">
                <div className="kicker">📡 {t("g.ok.station")}</div>
                <h3>{t("g.station.card")}: {site.name}</h3>
                {arena && stationRows ? (
                  <>
                    <table><tbody>
                      {stationRows.map((r) => <tr key={r.id}><td>{r.name[lang]}</td><td className="num">{r.value}</td><td><span className={`vbadge v-${r.verdict}`}>{t(`v.${r.verdict}`)}</span></td></tr>)}
                    </tbody></table>
                    <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>{t("arena.station.note")}</p>
                  </>
                ) : <>
                <table><tbody>
                  {climateKeys.filter(([k]) => site.climate?.[k]).map(([k, label]) => {
                    const v = tC(k, site.climate[k] ?? null);
                    return <tr key={k}><td>{t(label)}</td><td className="num">{fmtVal(lang, v)}</td><td>{v && <Badge status={v.status} />}</td></tr>;
                  })}
                </tbody></table>
                <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>NASA POWER (MERRA-2/CERES) · {t("map.heat.note").split(":")[0]}</p>
                </>}
                <p className="muted" style={{ fontSize: 13 }}>{t("g.station.relay")}</p>
                <button className="btn primary" onClick={() => eng.current?.closeStationCard()}>{t("g.card.close")}</button>
              </div>
            </div>
          )}

          {hud.analysis && !hud.stationCard && labOpen === null && renderAnalysis(hud.analysis)}
          {labOpen !== null && (
            <Lab mineral={mineralOf(labOpen).m} why={mineralOf(labOpen).plan.why} siteName={site.name}
              onClose={(ok) => { if (ok) setIdentified((x) => ({ ...x, [labOpen]: mineralOf(labOpen).m.id })); setLabOpen(null); }} />
          )}

          {bigMap && (
            <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) openMap(false); }}>
              <div className="card bigmap-card" role="dialog" aria-label={t("map.btn")}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}>🗺️ {site.name}</h3>
                  <button className="btn small" onClick={() => openMap(false)}>✕ (M)</button>
                </div>
                <canvas ref={bigRef} width={640} height={640} className="bigmap" />
                <p className="bigmap-legend small-print">
                  <span><i style={{ background: "#fff" }} />{t("map.lg.rover")}</span>
                  <span><i style={{ background: "#7fb2ff" }} />{t("map.lg.base")}</span>
                  <span><i style={{ background: "#ffa04d" }} />{t("map.lg.target")}</span>
                  <span><i style={{ background: "#5cff8a" }} />{t("map.lg.relay")}</span>
                  {arena && hud.map.beacons && <span><i style={{ background: "#35c8ff" }} />{t("map.lg.beacon")}</span>}
                  {!hud.map.cave && !arena && <span><i style={{ background: "#5aaae6" }} />{t("map.lg.water")}</span>}
                  {!hud.map.cave && !arena && <span><i style={{ border: "2px dashed #ffd696" }} />{t("map.lg.sand")}</span>}
                  {!hud.map.cave && !arena && <span><i style={{ background: "#ef5b5b" }} />{t("map.lg.vent")}</span>}
                  {!hud.map.cave && !arena && <span><i style={{ border: "2px solid #ffd28a" }} />{t("map.lg.devil")}</span>}
                  {hud.map.cave && <span><i style={{ background: "#000", border: "1px solid #888" }} />{t("map.lg.crevice")}</span>}
                  {hud.map.cave && <span><i style={{ background: "#2b8fd6" }} />{t("map.lg.pool")}</span>}
                  {hud.map.cave && <span><i style={{ background: "#d95926" }} />{t("map.lg.rockfall")}</span>}
                </p>
                <p className="muted small-print">{arena ? t("arena.map.note") : hud.map.cave ? t("map.cave.note") : t("map.sat.note", { date: imagery?.date ?? "—", credit: imagery?.credit ?? "" })}</p>
              </div>
            </div>
          )}

          {hud.paused && !hud.stationCard && !hud.analysis && !bigMap && !end && (
            <div className="overlay">
              <div className="card">
                <h3>⏸ {t("g.pause")}</h3>
                <p className="muted">{t("g.controls.kb")} · {t("g.controls.kb2")}</p>
                {hud.delay > 0 && <p className="note">{t("g.lesson.delay")}</p>}
                <div className="row">
                  <button className="btn primary" onClick={() => eng.current?.setPaused(false)}>{t("g.resume")}</button>
                  <button className="btn" onClick={() => setRun((r) => r + 1)}>{t("g.restart")}</button>
                  <button className="btn ghost" onClick={onExit}>{t("g.exit")}</button>
                  <button className="btn ghost" onClick={onGlobe}>🌍 {t("end.globe")}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {hud?.photo && (
        <div className="photo-bar" onPointerDown={(e) => e.stopPropagation()}>
          <span className="muted small-print">{t("photo.hint")}</span>
          <label className="photo-hour">☀️ {t("photo.hour")} {String(Math.floor(hour)).padStart(2, "0")}:{hour % 1 ? "30" : "00"}
            <input type="range" min={5.5} max={18.5} step={0.5} value={hour} onChange={(e) => { const h = Number(e.target.value); setHour(h); eng.current?.setSunHour(h); }} />
          </label>
          <label><input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} /> {t("photo.data")}</label>
          <div className="row">
            <button className="btn small" onClick={() => eng.current?.orbitBy(0, 0, 0.8)}>＋</button>
            <button className="btn small" onClick={() => eng.current?.orbitBy(0, 0, 1.25)}>－</button>
            <button className="btn primary" onClick={shoot}>📸 {t("photo.shoot")}</button>
            <button className="btn ghost" onClick={() => { eng.current?.setPhotoMode(false); setHour(11); }}>✕ {t("photo.exit")}</button>
          </div>
          {lastShot && <img className="photo-thumb" src={lastShot} alt={t("photo.last")} />}
        </div>
      )}

      {end && (
        <div className={`overlay end-overlay ${end.win ? "win" : "lost"}`}>
          <div className="card end-card" role="alertdialog" aria-labelledby="end-title">
            <h2 id="end-title" className="end-title">{end.win ? `🏆 ${t("end.win")}` : `📡 ${t("end.lost")}`}</h2>
            {end.win ? (
              <p className="big-number" style={{ color: "#ffc23d" }} aria-label={`${end.stars} ${t("g.stars")}`}>{stars}</p>
            ) : (
              <p className="end-reason">{t(`g.fail.${end.reason}`)}</p>
            )}
            {lesson && <p className="note honest">💡 {t(lesson)}</p>}
            <p className="muted">⏱ {fmtTime(end.time)} · 🛠️ {m1(end.damage)}% · 🧪 {end.samples}{end.win ? ` · ${t("g.score")} ${m1(end.score)}` : ""}</p>
            {showProgress && renderProgress(end)}
            <div className="row end-btns">
              <button className="btn" onClick={() => setShowProgress((v) => !v)}>📊 {showProgress ? t("end.hideprogress") : t("end.progress")}</button>
              <button className="btn primary" onClick={() => setRun((r) => r + 1)}>↻ {t("g.restart")}</button>
              <button className="btn" onClick={onExit}>⚙️ {t("end.menu")}</button>
              <button className="btn" onClick={onGlobe}>🌍 {t("end.globe")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
