// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Panel de la ESTACIÓN (/estacion): conecta la caja (ESP32) y el celular por la nube, analiza la calidad de los datos
// (sensores baratos y caseros), arma la medición para el motor y crea el lugar jugable para manejar el rover ahí.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { useSettings, type Route } from "../settings";
import { useData, type GameSite, type Val } from "../data";
import { encodeCfg, getConfig, parseConfig, saveConfig, type FbConfig } from "../station/cloud";
import { newCode, useCloud, usePersisted, type Mode as CloudMode } from "../station/useStation";
import { SIM_SCENARIOS, type SimScenario } from "../station/sim";
import { analyze, type SensorReport, type Verdict } from "../station/quality";
import { serialSupported } from "../station/serial";
import { autoConnectUsb, connectUsb, disconnectUsb, onUsbReading, setUsbRelay, subscribeUsb, usbBuffer, usbHealth, usbState } from "../station/usbLink";
import { fetchElevation, fetchMeteo, type Meteo } from "../station/reference";
import { fieldJson, nearestSites, summarize, type Summary } from "../station/field";
import { checkImage, type PhotoCheck } from "../station/media";
import type { Media, Reading, ScanMeta, SessionDoc, TrackPt } from "../station/types";
import { ArenaBuilder, type PlayRequest } from "./ArenaBuilder";
import { AnalogPanel } from "./AnalogPanel";
import { FLOORS, PLACE_KINDS } from "./PhonePage";
import { Game } from "../game/Game";
import { cellOf } from "../game/core/arena";

const VCOL: Record<Verdict, string> = { bueno: "#2fbf71", aceptable: "#f2b134", dudoso: "#d95926", malo: "#ef5b5b", sin_dato: "#8e9bb8" };
const VTXT: Record<Verdict, [string, string]> = { bueno: ["bueno", "good"], aceptable: ["aceptable", "acceptable"], dudoso: ["dudoso", "doubtful"], malo: ["malo", "bad"], sin_dato: ["sin dato", "no data"] };
const ENGINE_URL = "http://localhost:8765";

function Spark({ xs, color }: { xs: number[]; color: string }) {
  const v = xs.filter(Number.isFinite);
  if (v.length < 2) return <svg className="spark" />;
  const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * 100},${28 - ((y - mn) / rg) * 26}`).join(" ");
  return <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" /></svg>;
}

export default function StationPage(_props: { route: Route }) {
  const { lang } = useSettings();
  const L = (es: string, en: string) => (lang === "es" ? es : en);
  const [mode, setMode] = usePersisted("seal.st.mode", getConfig() ? "firebase" : "sim");
  const [scenario, setScenario] = usePersisted("seal.st.sim", "ok");
  const [device, setDevice] = usePersisted("seal.st.device", "seal-box-01");
  const [code, setCode] = usePersisted("seal.st.code", newCode());
  const [cfg, setCfg] = useState<FbConfig | null>(getConfig());
  const [cfgText, setCfgText] = useState("");
  const { cloud, err } = useCloud(mode as CloudMode, scenario as SimScenario, cfg);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [sess, setSess] = useState<SessionDoc | null>(null);
  const [track, setTrack] = useState<TrackPt[]>([]);
  const [media, setMedia] = useState<[string, Media][]>([]);
  const [scans, setScans] = useState<[string, ScanMeta][]>([]);
  const [checks, setChecks] = useState<Record<string, PhotoCheck>>({});
  const [meteo, setMeteo] = useState<Meteo | null>(null);
  // calibración de nivel del MPU-6050 (gravedad con la caja plana), guardada en este navegador
  const [mpuRef, setMpuRef] = useState<[number, number, number] | null>(() => { try { const v = localStorage.getItem("seal.mpu.ref"); return v ? JSON.parse(v) : null; } catch { return null; } });
  const [dem, setDem] = useState<number | null>(null);
  const [refErr, setRefErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [qr, setQr] = useState("");
  const [baseUrl, setBaseUrl] = useState(() => `${location.origin}${location.pathname}`);
  const [rec, setRec] = useState<{ start: number; until: number } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [engineRes, setEngineRes] = useState<{ ok: boolean; text: string; top?: { target_id: string; ifa: number; coverage: number }[] } | null>(null);
  const [play, setPlay] = useState<PlayRequest | null>(null);
  // plan B: caja por cable USB (Web Serial). La conexión vive en station/usbLink: sigue aunque se cambie de sección.
  const usbSt = useSyncExternalStore(subscribeUsb, usbState);
  const usb = usbSt.on;
  const addReading = (r: Reading) => setReadings((rs) => (rs.length && rs[rs.length - 1].seq === r.seq && rs[rs.length - 1].boot === r.boot ? rs : [...rs.slice(-599), r]));
  // con Firebase: la laptop reenvía a la nube lo que llega por cable (el celular y otras compus lo ven igual)
  useEffect(() => { setUsbRelay(cloud?.kind === "firebase" ? (r) => { cloud.putStation(device, r).catch(() => {}); } : null); }, [cloud, device]);
  useEffect(() => { autoConnectUsb(); }, []);
  useEffect(() => {
    if (!usb) return;
    setReadings(usbBuffer());
    return onUsbReading(addReading);
  }, [usb]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleUsb = async () => {
    if (usb) { await disconnectUsb(); return; }
    try { await connectUsb(); } catch (e) { if (!String(e).includes("No port selected")) alert(String(e)); }
  };
  const [open, setOpen] = useState<string | null>(null);
  const gs = useData<{ sites: GameSite[] }>("terrain/game_sites.json");
  const refAt = useRef<{ lat: number; lon: number; t: number } | null>(null);

  // suscripciones
  useEffect(() => {
    if (!cloud || usb) return;   // con el cable USB conectado, las lecturas vienen del cable
    setReadings([]);
    let alive = true;
    cloud.stationHistory(device, 120).then((h) => alive && setReadings((r) => (r.length ? r : h.map((x) => ({ ...x, received: x.ts ?? Date.now() })))));
    const u = cloud.onStation(device, (r) => r && addReading(r));
    return () => { alive = false; u(); };
  }, [cloud, device, usb]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cloud) return;
    setMedia([]); setTrack([]);
    cloud.updateSession(code, { created: Date.now(), device }).catch(() => {});
    const u1 = cloud.onSession(code, setSess), u2 = cloud.onTrack(code, setTrack);
    const u3 = cloud.onMedia(code, (id, m) => setMedia((ms) => (ms.some(([i]) => i === id) ? ms : [...ms, [id, m]])));
    const u4 = cloud.onScans(code, setScans);
    return () => { u1(); u2(); u3(); u4(); };
  }, [cloud, code, device]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // QR para el celular
  const phoneUrl = useMemo(() => {
    const envCfg = !!import.meta.env.VITE_FIREBASE_API_KEY;
    return `${baseUrl}#/movil?s=${code}&d=${encodeURIComponent(device)}${mode === "sim" ? "&sim=1" : ""}${mode === "firebase" && cfg && !envCfg ? `&cfg=${encodeCfg(cfg)}` : ""}`;
  }, [baseUrl, code, device, mode, cfg]);
  useEffect(() => { QRCode.toDataURL(phoneUrl, { margin: 1, width: 240 }).then(setQr).catch(() => setQr("")); }, [phoneUrl]);

  // posición: GPS de la caja si tiene señal; si no, la del celular
  const last = readings[readings.length - 1];
  const phone = sess?.phone?.gps ?? null;
  const pos = last?.gps.fix && last.gps.lat !== undefined ? { lat: last.gps.lat, lon: last.gps.lon!, src: "caja" } : phone ? { lat: phone.lat, lon: phone.lon, src: "celular" } : null;
  useEffect(() => {
    if (!pos) return;
    const p = refAt.current;
    if (p && Math.abs(p.lat - pos.lat) < 0.005 && Math.abs(p.lon - pos.lon) < 0.005 && Date.now() - p.t < 600000) return;
    refAt.current = { lat: pos.lat, lon: pos.lon, t: Date.now() };
    fetchMeteo(pos.lat, pos.lon).then((m) => { setMeteo(m); setRefErr(null); }).catch((e) => setRefErr(String(e)));
    fetchElevation(pos.lat, pos.lon).then(setDem).catch(() => {});
  }, [pos?.lat, pos?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = sess?.place ?? null;
  const report = useMemo(() => analyze(readings, { indoor: place ? place.indoor : null, meteo, demElev: dem, phone, now, mpuRef }), [readings, meteo, dem, phone, place, now, mpuRef]);

  // medición de 60 s
  useEffect(() => {
    if (!rec || now < rec.until) return;
    const rs = readings.filter((r) => (r.received ?? 0) >= rec.start);
    setSummary(summarize(rs, phone, analyze(rs, { indoor: place ? place.indoor : null, meteo, demElev: dem, phone, now, mpuRef }).sensors));
    setRec(null);
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const useLast = () => { const rs = readings.slice(-60); setSummary(summarize(rs, phone, analyze(rs, { indoor: place ? place.indoor : null, meteo, demElev: dem, phone, now, mpuRef }).sensors)); };

  // revisión de fotos
  useEffect(() => {
    for (const [id, m] of media) if (!checks[id]) checkImage(m.data).then((c) => setChecks((x) => ({ ...x, [id]: c }))).catch(() => {});
  }, [media]); // eslint-disable-line react-hooks/exhaustive-deps

  const json = summary ? fieldJson(summary, place, media.map(([id]) => id), cloud?.kind === "sim") : null;
  const download = () => {
    if (!json) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
    a.download = `campo_${code}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const sendEngine = async () => {
    if (!json) return;
    setEngineRes({ ok: true, text: L("Enviando al motor…", "Sending to the engine…") });
    try {
      const r = await fetch(`${ENGINE_URL}/field?name=campo_${code}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setEngineRes({ ok: true, text: L("Listo: el motor calculó el % de analogía del lugar.", "Done: the engine computed the place's analogy %."), top: j.results?.slice(0, 4) });
    } catch (e) {
      setEngineRes({ ok: false, text: L(`No se pudo conectar con el motor en ${ENGINE_URL}. En la laptop corre: python -m seal serve  (${e})`, `Could not reach the engine at ${ENGINE_URL}. On the laptop run: python -m seal serve  (${e})`) });
    }
  };
  const near = summary && gs.data ? nearestSites(summary, gs.data.sites) : [];

  const playSetup = useMemo(() => {
    if (!play) return null;
    const s = play.runtime.spec;
    const climate: Record<string, Val | null> = summary ? {
      t_air: summary.t_c !== null ? { value: summary.t_c + 273.15, unit: "K", status: "measured", source: `SEAL-BOX ${summary.device}` } : null,
      rh: summary.rh !== null ? { value: summary.rh, unit: "%", status: "measured", source: `SEAL-BOX ${summary.device}` } : null,
      pressure: summary.p_hpa !== null ? { value: summary.p_hpa / 10, unit: "kPa", status: "measured", source: `SEAL-BOX ${summary.device}` } : null,
      uv_index: summary.uvi !== null ? { value: summary.uvi, unit: "1", status: "estimated", source: "GUVA-S12SD, mV/100 sin calibrar" } : null,
    } : {};
    let maxH = 0;
    for (const h of s.heights) maxH = Math.max(maxH, h);
    const site: GameSite = {
      id: `arena_${code}`, name: play.name, country: "", lat: play.center?.lat ?? 0, lon: play.center?.lon ?? 0, role: "candidate", file: "",
      n: s.n, size_m: s.size, m_per_px: cellOf(s), h_min: s.elev0, h_max: s.elev0 + maxH, water_level: null,
      biome: s.floor === "pasto" ? "vegetado" : s.floor === "tierra" || s.floor === "arena" ? "desierto" : s.floor, cave: false, minerals: null, climate, terrain_stats: {},
    };
    return { site, imagery: { id: site.id, file: play.preview, date: L("hoy", "today"), credit: L("mapa del lugar del equipo", "team's place map"), source: "", cloud_pct: 0 } };
  }, [play]); // eslint-disable-line react-hooks/exhaustive-deps
  if (play && playSetup) {
    // sitio e imagen congelados al tocar "Manejar" (ver playSetup): no se rearman con cada lectura de la caja
    return <Game site={playSetup.site} mode={play.mode} gravity={play.gravity} weather="clear" arena={play.runtime}
      imagery={playSetup.imagery} onExit={() => setPlay(null)} onGlobe={() => setPlay(null)} stationRows={report.sensors} />;
  }

  const secureForPhone = baseUrl.startsWith("https://") && !/\/\/(localhost|127\.)/.test(baseUrl);
  // en español los decimales van con coma (21,4 °C); en inglés con punto
  const dec = (x: string) => (lang === "es" ? x.replace(/(\d)\.(\d)/g, "$1,$2") : x);
  const repCard = (r: SensorReport) => {
    const series: Record<string, number[]> = {
      t: readings.slice(-120).map((x) => x.bme.t_c ?? NaN), rh: readings.slice(-120).map((x) => x.bme.rh_pct ?? NaN), p: readings.slice(-120).map((x) => x.bme.p_hpa ?? NaN),
      uv: readings.slice(-120).map((x) => x.uv.mv), light: readings.slice(-120).map((x) => x.light.pct), gas: readings.slice(-120).map((x) => x.gas.raw),
      mpu: readings.slice(-120).map((x) => Math.hypot(x.mpu.ax ?? 0, x.mpu.ay ?? 0, x.mpu.az ?? 0)), gps: readings.slice(-120).map((x) => x.gps.sats),
    };
    const isOpen = open === r.id;
    return (
      <article key={r.id} className="sensor" style={{ borderLeftColor: VCOL[r.verdict] }}>
        <button className="sensor-head" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
          <span className="s-name">{r.name[lang]}</span>
          <span className="s-val">{dec(r.value)}</span>
          <span className="s-badge" style={{ background: VCOL[r.verdict] }}>{VTXT[r.verdict][lang === "es" ? 0 : 1]}</span>
        </button>
        {series[r.id] && <Spark xs={series[r.id]} color={VCOL[r.verdict]} />}
        {(isOpen || r.verdict === "malo" || r.verdict === "dudoso") && (
          <div className="s-body">
            {r.reasons.map((x, i) => <p key={i}>• {dec(x[lang])}</p>)}
            {r.tips.map((x, i) => <p key={i} className="tip">💡 {dec(x[lang])}</p>)}
            <p className="muted small-print">{L("Para qué sirve", "What it is for")}: {r.use[lang]}</p>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="container section station">
      <div className="kicker">📡 SEAL-BOX</div>
      <h1>{L("Estación de campo", "Field station")}</h1>
      <p className="lead">{L("La caja mide el aire, el celular da el GPS, las fotos y el video, y esta página revisa si los datos son buenos, los compara con el satélite y arma el lugar para manejar el rover ahí mismo.",
        "The box measures the air, the phone gives GPS, photos and video, and this page checks whether the data are good, compares them with the satellite and builds the place to drive the rover right there.")}</p>

      <div className="grid grid-2">
        {/* conexión */}
        <section className="card">
          <h3>1 · {L("Conexión", "Connection")}</h3>
          <div className="seg" role="group">
            <button aria-pressed={mode === "firebase"} onClick={() => setMode("firebase")}>☁️ Firebase</button>
            <button aria-pressed={mode === "sim"} onClick={() => setMode("sim")}>🧪 {L("Simulador", "Simulator")}</button>
          </div>
          {mode === "firebase" && !cfg && (
            <div className="cfg-box">
              <p className="small-print">{L("Pega aquí la configuración web de tu proyecto de Firebase (Consola → Configuración del proyecto → Tus apps → Configuración). Se guarda solo en este navegador.",
                "Paste your Firebase project's web config here (Console → Project settings → Your apps → Config). It is stored only in this browser.")}</p>
              <textarea rows={6} value={cfgText} onChange={(e) => setCfgText(e.target.value)} placeholder={'const firebaseConfig = {\n  apiKey: "...",\n  databaseURL: "https://...firebaseio.com",\n  ...\n};'} />
              <button className="btn primary" onClick={() => { const c = parseConfig(cfgText); if (!c) { alert(L("No reconozco la configuración: falta apiKey o databaseURL.", "Config not recognized: apiKey or databaseURL missing.")); return; } saveConfig(c); setCfg(c); }}>{L("Guardar", "Save")}</button>
              <p className="small-print muted">{L("Guía paso a paso: docs/CONEXION_ESTACION.md", "Step-by-step guide: docs/CONEXION_ESTACION.md")}</p>
            </div>
          )}
          {mode === "firebase" && cfg && <p className="small-print">✅ {L("Proyecto", "Project")}: <b>{cfg.projectId ?? cfg.databaseURL}</b> <button className="btn ghost small" onClick={() => { saveConfig(null); setCfg(getConfig()); }}>{L("cambiar", "change")}</button></p>}
          {mode === "sim" && (
            <div>
              <p className="note small-print">🧪 {L("Datos INVENTADOS para probar y ensayar sin la caja. Elige una falla típica para ver cómo la detecta el análisis:", "MADE-UP data to test and rehearse without the box. Pick a typical failure to see how the analysis detects it:")}</p>
              <select value={scenario} onChange={(e) => setScenario(e.target.value)}>{SIM_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s[lang]}</option>)}</select>
            </div>
          )}
          <div className="usb-box">
            <button className={`btn ${usb ? "primary" : ""}`} disabled={!serialSupported()} onClick={toggleUsb}>
              🔌 {usb ? L("Desconectar cable USB", "Disconnect USB cable") : L("Leer la caja por cable USB (plan B)", "Read the box over USB (plan B)")}</button>
            <p className="small-print muted">{serialSupported()
              ? L("Sin Wi-Fi: conecta la caja a esta compu con el cable USB y elige su puerto (COM…). Cierra antes el Monitor Serie del Arduino IDE. Al conectar, el ESP32 se reinicia (30 s de calentamiento).",
                "No Wi-Fi: plug the box into this computer by USB and choose its port (COM…). Close the Arduino IDE Serial Monitor first. Connecting restarts the ESP32 (30 s warm-up).")
              : L("El cable USB solo funciona en Chrome o Edge de computadora.", "USB only works in desktop Chrome or Edge.")}</p>
            {(() => { const h = usbHealth(usbSt, now); return h && <p className={`note ${h.level === "ok" ? "" : "bad-note"}`}>{h.level === "ok" ? "✅" : h.level === "warn" ? "⏳" : "⚠️"} {lang === "es" ? h.es : h.en}
              <span className="muted small-print"> · {usbSt.bytes.toLocaleString()} bytes</span></p>; })()}
            {usbSt.log.length > 0 && <pre className="usb-log">{usbSt.log.join("\n")}</pre>}
          </div>
          <label className="field">{L("Nombre de la caja (DEVICE_ID del firmware)", "Box name (firmware DEVICE_ID)")}<input value={device} onChange={(e) => setDevice(e.target.value.trim())} /></label>
          <p className="small-print">{cloud ? `✅ ${L("Conectado", "Connected")}` : err ? `⚠️ ${err}` : `⏳ ${L("Conectando…", "Connecting…")}`}</p>
          {err?.includes("admin-restricted") || err?.includes("operation-not-allowed") ? <p className="note bad-note">{L("Activa el inicio de sesión ANÓNIMO en Firebase → Authentication.", "Enable ANONYMOUS sign-in in Firebase → Authentication.")}</p> : null}
        </section>

        {/* sesión + celular */}
        <section className="card">
          <h3>2 · {L("Celular", "Phone")} · {L("sesión", "session")} <span className="code">{code}</span> <button className="btn ghost small" onClick={() => setCode(newCode())}>↻</button></h3>
          <div className="qr-row">
            {qr && <img src={qr} alt={L("Código QR para el celular", "QR code for the phone")} className="qr" />}
            <div>
              <p className="small-print">{L("Escanéalo con la cámara del celular.", "Scan it with the phone camera.")}</p>
              <p className="small-print"><a href={phoneUrl} target="_blank" rel="noreferrer">{L("Abrir la página del celular", "Open the phone page")}</a></p>
              <label className="field small-print">{L("Dirección de esta página para el celular", "This page's address for the phone")}<input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
              {!secureForPhone && <p className="note bad-note small-print">⚠️ {L("El celular necesita HTTPS y la IP de la compu (no 'localhost'). Corre 'npm run dev:https' y abre esta página con la dirección 'Network: https://…' que muestra, o usa la página publicada.",
                "The phone needs HTTPS and the computer's IP (not 'localhost'). Run 'npm run dev:https' and open this page with the 'Network: https://…' address it prints, or use the published page.")}</p>}
            </div>
          </div>
          <p className="small-print">{phone ? `📱 ${L("Celular", "Phone")}: ${phone.lat.toFixed(5)}, ${phone.lon.toFixed(5)} ±${Math.round(phone.acc)} m · ${Math.round((now - (sess?.phone?.seen ?? now)) / 1000)} s`
            : `📱 ${L("El celular todavía no se conectó.", "The phone has not connected yet.")}`}</p>
          <div className="chips">{PLACE_KINDS.map((k) => <button key={k.id} className={`chip ${place?.kind === k.id ? "on" : ""}`}
            onClick={() => cloud?.updateSession(code, { "place/kind": k.id, "place/indoor": k.indoor })}>{k[lang]}</button>)}</div>
          <div className="chips">{FLOORS.map((f) => <button key={f.id} className={`chip ${place?.floor === f.id ? "on" : ""}`} onClick={() => cloud?.updateSession(code, { "place/floor": f.id })}>{f[lang]}</button>)}</div>
        </section>
      </div>

      {/* análisis en vivo */}
      <section className="card" style={{ marginTop: 16 }}>
        <h3>3 · {L("Datos en vivo y su calidad", "Live data and their quality")}</h3>
        <p className="small-print muted">{L("Sensores baratos y caseros: no se exige precisión de laboratorio. Se revisa que el dato sea posible, que no esté trabado y que coincida con referencias independientes. Toca un sensor para ver el detalle.",
          "Cheap homemade sensors: lab precision is not expected. We check the value is possible, not stuck, and agrees with independent references. Tap a sensor for details.")}</p>
        {repCard(report.link)}
        <div className="sensors">{report.sensors.map((r) => repCard(r))}</div>
        <div className="row">
          <button className="btn small" disabled={!readings.length || !readings[readings.length - 1].mpu?.ok} onClick={() => {
            const w = readings.slice(-10).filter((r) => r.mpu?.ok);
            const ref: [number, number, number] = [0, 1, 2].map((k) => w.reduce((a, r) => a + ([r.mpu.ax, r.mpu.ay, r.mpu.az][k] ?? 0), 0) / w.length) as [number, number, number];
            setMpuRef(ref); try { localStorage.setItem("seal.mpu.ref", JSON.stringify(ref)); } catch { /* sin almacenamiento */ }
          }}>📐 {L("Calibrar nivel (caja plana y quieta)", "Calibrate level (box flat and still)")}</button>
          {mpuRef && <button className="btn small ghost" onClick={() => { setMpuRef(null); try { localStorage.removeItem("seal.mpu.ref"); } catch { /* */ } }}>{L("Quitar calibración", "Remove calibration")}</button>}
        </div>
        <p className="small-print muted">
          {pos ? `📍 ${L("Posición", "Position")} (${pos.src === "caja" ? L("GPS de la caja", "box GPS") : L("GPS del celular", "phone GPS")}): ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}` : `📍 ${L("Sin posición: activa el GPS del celular (página del celular).", "No position: turn on the phone GPS (phone page).")}`}
          {meteo && ` · ${L("Referencia", "Reference")}: ${meteo.t_c} °C, ${meteo.rh} %, ${meteo.p_hpa} hPa, UV ${meteo.uvi} (Open-Meteo, CC BY 4.0)`}
          {dem !== null && ` · ${L("relieve", "terrain")} ${Math.round(dem)} m (Copernicus DEM GLO-90)`}
          {refErr && ` · ⚠️ ${refErr}`}
        </p>
      </section>

      {/* medición */}
      <section className="card" style={{ marginTop: 16 }}>
        <h3>4 · {L("Medición para el motor", "Measurement for the engine")}</h3>
        <div className="row">
          <button className="btn primary" disabled={!!rec || readings.length < 5} onClick={() => setRec({ start: Date.now(), until: Date.now() + 60000 })}>
            ⏺ {rec ? L(`Midiendo… ${Math.max(0, Math.ceil((rec.until - now) / 1000))} s`, `Measuring… ${Math.max(0, Math.ceil((rec.until - now) / 1000))} s`) : L("Medir 60 s (caja quieta)", "Measure 60 s (box still)")}</button>
          <button className="btn" disabled={readings.length < 10} onClick={useLast}>{L("Usar los últimos 60 s", "Use the last 60 s")}</button>
        </div>
        {summary && json && (
          <div className="measure">
            <table><tbody>
              <tr><td>{L("Lecturas", "Readings")}</td><td className="num">{summary.n}</td></tr>
              <tr><td>{L("Presión", "Pressure")}</td><td className="num">{summary.p_hpa?.toFixed(1) ?? "—"} hPa</td></tr>
              <tr><td>{L("Temperatura", "Temperature")}</td><td className="num">{summary.t_c?.toFixed(1) ?? "—"} °C</td></tr>
              <tr><td>{L("Humedad", "Humidity")}</td><td className="num">{summary.rh?.toFixed(0) ?? "—"} %</td></tr>
              <tr><td>UV (≈)</td><td className="num">{summary.uvi?.toFixed(1) ?? "—"}</td></tr>
              <tr><td>GPS</td><td className="num">{summary.gps.fix ? `${summary.gps.lat!.toFixed(5)}, ${summary.gps.lon!.toFixed(5)} (${summary.gps.source})` : "—"}</td></tr>
            </tbody></table>
            <p className="small-print muted">{L("Lo marcado 'malo' en el análisis no se incluye (queda vacío).", "Anything marked 'bad' in the analysis is left out (empty).")}</p>
            {summary.p_hpa !== null && (
              <p className="note">🔴 {L(`Marte: ~6,4 hPa en promedio (NASA NSSDC) → tu aire tiene ${Math.round(summary.p_hpa / 6.36)} veces más presión. Luna: casi vacío. Por eso ningún lugar de la Tierra es Marte: la presión es el límite más grande de cualquier análogo.`,
                `Mars: ~6.4 hPa on average (NASA NSSDC) → your air has ${Math.round(summary.p_hpa / 6.36)} times more pressure. Moon: almost vacuum. That is why no place on Earth is Mars: pressure is every analog's biggest limit.`)}</p>
            )}
            {near.length > 0 && <p>🗺️ {L("Por presión, humedad y UV se parece más a", "By pressure, humidity and UV it is closest to")}: {near.map((x) => x.name).join(" · ")}</p>}
            <div className="row">
              <button className="btn" onClick={download}>⬇️ {L("Descargar JSON (para el motor)", "Download JSON (for the engine)")}</button>
              <button className="btn" onClick={sendEngine}>🧮 {L("Calcular % de analogía con el motor", "Compute analogy % with the engine")}</button>
            </div>
            {engineRes && (
              <div className={engineRes.ok ? "note" : "note bad-note"}>
                <p>{engineRes.text}</p>
                {engineRes.top && <ul>{engineRes.top.map((r) => <li key={r.target_id}>{r.target_id}: {Math.round(r.ifa)}/100 ({L("cobertura", "coverage")} {Math.round(r.coverage * 100)} %)</li>)}</ul>}
              </div>
            )}
          </div>
        )}
      </section>

      <AnalogPanel L={L} lang={lang} summary={summary} readings={readings} meteo={meteo} dem={dem} pos={pos} place={place ?? null} track={track} mpuRef={mpuRef} />

      {/* fotos */}
      <section className="card" style={{ marginTop: 16 }}>
        <h3>5 · {L("Fotos y video del lugar", "Photos and video of the place")} ({media.length})</h3>
        {!media.length && <p className="muted small-print">{L("Las fotos que tome el celular aparecen aquí.", "Photos taken with the phone appear here.")}</p>}
        <div className="gallery">
          {media.map(([id, m]) => {
            const c = checks[id];
            const flags = c ? [c.dark && L("oscura", "dark"), c.burnt && L("quemada", "overexposed"), c.blurry && L("movida", "blurry")].filter(Boolean) : [];
            return (
              <figure key={id}>
                <img src={m.data} alt="" loading="lazy" />
                <figcaption>
                  {m.kind === "frame" ? `🎥 ${(m.idx ?? 0) + 1}/${m.of}` : "📷"} {m.lat !== undefined ? `· ±${Math.round(m.acc ?? 0)} m` : `· ${L("sin GPS", "no GPS")}`}
                  {c && <span className={flags.length ? "bad" : "ok"}> · {flags.length ? flags.join(", ") : L("bien", "ok")}</span>}
                  {c && <span className="swatch" style={{ background: `rgb(${c.ground.map(Math.round).join(",")})` }} title={L("color del suelo", "ground color")} />}
                </figcaption>
              </figure>
            );
          })}
        </div>
        <p className="small-print muted">{L("Revisión automática simple: brillo (oscura/quemada) y nitidez (movida). Las fotos y el video arman el mapa: paredes, piso, colores y muebles (ver sección 6, “Lo que entendimos de tus fotos”).",
          "Simple automatic check: brightness (dark/overexposed) and sharpness (blurry). Photos and video build the map: walls, floor, colors and furniture (see section 6, “What we understood from your photos”).")}</p>
      </section>

      {/* lugar jugable */}
      <section className="card" style={{ marginTop: 16 }}>
        <h3>6 · {L("Manejar el rover en nuestro lugar", "Drive the rover in our place")}</h3>
        <ArenaBuilder place={place} track={track} media={media} summary={summary} onPlay={setPlay}
          scans={scans} fetchScan={(id) => cloud!.getScan(code, id)}
          boxGps={last?.gps.fix && last.gps.lat !== undefined ? { lat: last.gps.lat, lon: last.gps.lon! } : phone ? { lat: phone.lat, lon: phone.lon } : null} />
      </section>
    </div>
  );
}
