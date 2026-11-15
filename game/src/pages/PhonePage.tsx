// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Página del CELULAR (/movil): GPS, lugar, perímetro caminado, fotos y video → nube. Funciona en iPhone y Android
// (página web, sin app). Necesita HTTPS para GPS y cámara.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings, type Route } from "../settings";
import { decodeCfg, getConfig, saveConfig, scanFileProblem } from "../station/cloud";
import { useCloud } from "../station/useStation";
import { compressImage, videoFrames } from "../station/media";
import { LiveVideo, type LiveFrame } from "./LiveVideo";
import { polygonArea, simplify, toLocal } from "../game/core/arena";
import type { Floor, PhoneGps, PlaceKind, Reading, SessionDoc, TrackPt } from "../station/types";

export const PLACE_KINDS: { id: PlaceKind; indoor: boolean; es: string; en: string }[] = [
  { id: "cuarto", indoor: true, es: "Cuarto / aula", en: "Room / classroom" },
  { id: "salon", indoor: true, es: "Salón grande / auditorio", en: "Large hall / auditorium" },
  { id: "coliseo", indoor: true, es: "Coliseo / gimnasio", en: "Indoor arena / gym" },
  { id: "cancha", indoor: false, es: "Cancha / estadio", en: "Field / stadium" },
  { id: "plaza", indoor: false, es: "Plaza / patio", en: "Square / yard" },
  { id: "campo", indoor: false, es: "Campo abierto", en: "Open field" },
];
export const FLOORS: { id: Floor; es: string; en: string }[] = [
  { id: "cemento", es: "Cemento", en: "Concrete" }, { id: "interior", es: "Piso interior", en: "Indoor floor" },
  { id: "pasto", es: "Pasto", en: "Grass" }, { id: "tierra", es: "Tierra", en: "Dirt" }, { id: "arena", es: "Arena", en: "Sand" },
];

export default function PhonePage({ route }: { route: Route }) {
  const { lang } = useSettings();
  const L = (es: string, en: string) => (lang === "es" ? es : en);
  const q = route.query;
  const [code, setCode] = useState((q.get("s") ?? "").toUpperCase());
  const [codeIn, setCodeIn] = useState(code);
  const device = q.get("d") ?? "seal-box-01";
  const sim = q.get("sim") === "1";
  const cfg = useMemo(() => { const c = q.get("cfg"); const d = c ? decodeCfg(c) : null; if (d) saveConfig(d); return d ?? getConfig(); }, [q]);
  const { cloud, err } = useCloud(sim ? "sim" : "firebase", "ok", cfg);
  const [sess, setSess] = useState<SessionDoc | null>(null);
  const [gps, setGps] = useState<PhoneGps | null>(null);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [walking, setWalking] = useState(false);
  const [track, setTrack] = useState<TrackPt[]>([]);
  const [box, setBox] = useState<Reading | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<{ thumb: string; kind: string }[]>([]);
  const [wake, setWake] = useState(false);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const lastTrack = useRef<TrackPt | null>(null);
  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!cloud || !code) return;
    const u1 = cloud.onSession(code, setSess);
    const u2 = cloud.onTrack(code, setTrack);
    return () => { u1(); u2(); };
  }, [cloud, code]);
  const dev = sess?.device ?? device;
  useEffect(() => { if (!cloud) return; return cloud.onStation(dev, setBox); }, [cloud, dev]);

  // GPS
  const startGps = () => {
    if (!("geolocation" in navigator)) { setGpsErr(L("Este navegador no tiene GPS.", "This browser has no GPS.")); return; }
    setGpsErr(null);
    watchId.current = navigator.geolocation.watchPosition((p) => {
      const g: PhoneGps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, altAcc: p.coords.altitudeAccuracy, t: p.timestamp };
      setGps(g);
      const now = Date.now();
      if (cloud && code && now - lastSent.current > 2000) {
        lastSent.current = now;
        cloud.updateSession(code, { "phone/gps": g, "phone/seen": now, "phone/ua": navigator.userAgent.slice(0, 80) }).catch(() => {});
      }
    }, (e) => setGpsErr(e.code === 1 ? L("Permiso de ubicación negado: actívalo en los ajustes del navegador.", "Location permission denied: enable it in the browser settings.")
      : L(`GPS: ${e.message}`, `GPS: ${e.message}`)), { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    setWatching(true);
  };
  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); }, []);

  // perímetro: se guarda un punto si la precisión es ≤ 15 m y se movió ≥ 3 m
  useEffect(() => {
    if (!walking || !gps || !cloud || !code) return;
    const prev = lastTrack.current;
    if (gps.acc > 15) return;
    if (prev) { const [dx, dz] = toLocal(prev.lat, prev.lon, gps.lat, gps.lon); if (Math.hypot(dx, dz) < 3) return; }
    const pt = { lat: gps.lat, lon: gps.lon, acc: gps.acc, t: gps.t };
    lastTrack.current = pt;
    cloud.pushTrack(code, pt).catch(() => {});
  }, [gps, walking]); // eslint-disable-line react-hooks/exhaustive-deps
  const trackInfo = useMemo(() => {
    if (track.length < 3) return null;
    const lat0 = track[0].lat, lon0 = track[0].lon;
    const pts = simplify(track.map((p) => toLocal(lat0, lon0, p.lat, p.lon)), 2);
    let len = 0;
    for (let i = 1; i < track.length; i++) { const [a, b] = toLocal(track[i - 1].lat, track[i - 1].lon, track[i].lat, track[i].lon); len += Math.hypot(a, b); }
    return { area: polygonArea(pts), len };
  }, [track]);

  // pantalla encendida (iPhone pausa el GPS si se apaga)
  const toggleWake = async () => {
    try {
      if (wakeRef.current) { await wakeRef.current.release(); wakeRef.current = null; setWake(false); return; }
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (!nav.wakeLock) { alert(L("Este navegador no puede mantener la pantalla encendida: no la bloquees.", "This browser cannot keep the screen on: do not lock it.")); return; }
      wakeRef.current = await nav.wakeLock.request("screen");
      setWake(true);
    } catch { setWake(false); }
  };

  const place = sess?.place;
  const setPlace = (patch: Record<string, unknown>) => cloud && code && cloud.updateSession(code, Object.fromEntries(Object.entries(patch).map(([k, v]) => [`place/${k}`, v])));

  const onPhoto = async (f: File | undefined) => {
    if (!f || !cloud || !code) return;
    setBusy(L("Comprimiendo la foto…", "Compressing the photo…"));
    try {
      const c = await compressImage(f);
      setBusy(L("Subiendo…", "Uploading…"));
      await cloud.pushMedia(code, { kind: "photo", t: Date.now(), ...c, ...(gps ? { lat: gps.lat, lon: gps.lon, acc: gps.acc } : {}) });
      setSent((s) => [{ thumb: c.data, kind: "📷" }, ...s].slice(0, 12));
    } catch (e) { alert(L("No se pudo subir la foto: ", "Could not upload the photo: ") + e); }
    setBusy(null);
  };
  const [live, setLive] = useState(false);
  const uploadFrames = async (frames: LiveFrame[], duration: number) => {
    if (!cloud || !code) return;
    const vid = `v${Date.now().toString(36)}`;
    try {
      for (let i = 0; i < frames.length; i++) {
        setBusy(L(`Subiendo fotograma ${i + 1} de ${frames.length}…`, `Uploading frame ${i + 1} of ${frames.length}…`));
        await cloud.pushMedia(code, { kind: "frame", t: Date.now(), ...frames[i], video: vid, idx: i, of: frames.length, duration, ...(gps ? { lat: gps.lat, lon: gps.lon, acc: gps.acc } : {}) });
        setSent((s) => [{ thumb: frames[i].data, kind: "🎥" }, ...s].slice(0, 12));
      }
    } catch (e) { alert(L("No se pudo subir: ", "Upload failed: ") + e); }
    setBusy(null);
  };
  const onVideo = async (f: File | undefined) => {
    if (!f || !cloud || !code) return;
    setBusy(L("Sacando fotogramas del video…", "Extracting video frames…"));
    try {
      // límite de tiempo: en algunos iPhone el video de la galería nunca termina de cargar
      const { frames, duration, black } = await Promise.race([videoFrames(f, 6),
        new Promise<never>((_, bad) => setTimeout(() => bad(new Error(L("tardó demasiado: usa “Grabar con la cámara”", "took too long: use “Record with camera”"))), 30000))]);
      if (!frames.length) {
        alert(L(`Los ${black} fotogramas salieron negros, así que no se subió nada.\n\nEn iPhone casi siempre es el Video HDR: Ajustes → Cámara → Grabar video → desactiva "Video HDR" y graba de nuevo.\nOtra opción: toma 3–4 fotos del lugar.`,
          `All ${black} frames came out black, nothing was uploaded.\n\nOn iPhone this is almost always HDR Video: Settings → Camera → Record Video → turn off "HDR Video" and record again.\nAlternative: take 3–4 photos of the place.`));
        setBusy(null); return;
      }
      const vid = `v${Date.now().toString(36)}`;
      for (let i = 0; i < frames.length; i++) {
        setBusy(L(`Subiendo fotograma ${i + 1} de ${frames.length}…`, `Uploading frame ${i + 1} of ${frames.length}…`));
        await cloud.pushMedia(code, { kind: "frame", t: Date.now(), ...frames[i], video: vid, idx: i, of: frames.length, duration, ...(gps ? { lat: gps.lat, lon: gps.lon, acc: gps.acc } : {}) });
        setSent((s) => [{ thumb: frames[i].data, kind: "🎥" }, ...s].slice(0, 12));
      }
      if (duration > 30) alert(L("Listo. Tip: videos de 10–20 s suben más rápido.", "Done. Tip: 10–20 s videos upload faster."));
    } catch (e) { alert(L("No se pudo leer el video: ", "Could not read the video: ") + e); }
    setBusy(null);
  };

  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const onScan = async (f: File | undefined) => {
    if (!f || !cloud || !code) return;
    const bad = scanFileProblem(f, lang === "es");
    if (bad) { setScanMsg(`⚠️ ${bad}`); return; }
    const mb = (f.size / 1048576).toFixed(1);
    try {
      await cloud.pushScan(code, f, (i, n) => setScanMsg(`⏳ ${L("Subiendo", "Uploading")} ${f.name} (${mb} MB): ${Math.round((i / n) * 100)} %`));
      setScanMsg(`✅ ${f.name} (${mb} MB) ${L("subido. En la laptop: sección 6 → Escaneo 3D → Usar.", "uploaded. On the laptop: section 6 → 3D scan → Use.")}`);
    } catch (e) { setScanMsg(`⚠️ ${L("No se pudo subir: ", "Upload failed: ")}${e}`); }
  };

  const secure = typeof window !== "undefined" && window.isSecureContext;
  if (!code) {
    return (
      <div className="container section phone">
        <h1>📱 {L("Celular de campo", "Field phone")}</h1>
        <p>{L("Escanea el código QR de la página /estacion, o escribe el código de la sesión:", "Scan the QR code on the /estacion page, or type the session code:")}</p>
        <div className="row"><input className="code-in" value={codeIn} onChange={(e) => setCodeIn(e.target.value.toUpperCase())} placeholder="ABCD12" maxLength={8} />
          <button className="btn primary" onClick={() => setCode(codeIn.trim())}>{L("Unirme", "Join")}</button></div>
      </div>
    );
  }
  return (
    <div className="container section phone">
      <h1>📱 {L("Celular de campo", "Field phone")} · <span className="code">{code}</span></h1>
      {!secure && <p className="note bad-note">⚠️ {L("Esta página no está en HTTPS: el navegador NO dará GPS ni cámara. Ábrela desde el enlace https (QR de la estación).",
        "This page is not on HTTPS: the browser will NOT give GPS or camera. Open it from the https link (station QR).")}</p>}
      {!sim && !cfg && <p className="note bad-note">⚠️ {L("Falta la configuración de Firebase: escanea el QR de la página /estacion.", "Firebase configuration missing: scan the QR on the /estacion page.")}</p>}
      {err && <p className="note bad-note">⚠️ {err}</p>}
      {sim && <p className="note">🧪 {L("Modo simulador: solo funciona en este mismo navegador.", "Simulator mode: works only in this same browser.")}</p>}
      <p className="muted small-print">{cloud ? `✅ ${L("Conectado", "Connected")} (${cloud.kind === "sim" ? L("simulador", "simulator") : "Firebase"})` : `⏳ ${L("Conectando…", "Connecting…")}`}</p>

      <section className="card phone-card">
        <h3>📍 GPS</h3>
        {!watching ? <button className="btn primary big" onClick={startGps}>{L("Activar GPS", "Turn on GPS")}</button> : gps ? (
          <p className="gps-line"><b>{gps.lat.toFixed(6)}, {gps.lon.toFixed(6)}</b> · ±{Math.round(gps.acc)} m{gps.alt != null ? ` · ${Math.round(gps.alt)} m` : ""}
            <br /><span className={gps.acc <= 10 ? "ok" : gps.acc <= 30 ? "warn" : "bad"}>{gps.acc <= 10 ? L("Precisión buena", "Good accuracy") : gps.acc <= 30 ? L("Precisión regular", "Fair accuracy") : L("Precisión mala: sal al aire libre", "Poor accuracy: go outdoors")}</span></p>
        ) : <p>{L("Buscando señal…", "Searching for signal…")}</p>}
        {gpsErr && <p className="bad">{gpsErr}</p>}
        <button className={`btn small ${wake ? "primary" : ""}`} onClick={toggleWake}>☀️ {wake ? L("Pantalla encendida ✓", "Screen kept on ✓") : L("Mantener pantalla encendida", "Keep screen on")}</button>
        <p className="muted small-print">{L("En iPhone, si la pantalla se apaga o cambias de app, el GPS se pausa.", "On iPhone, if the screen turns off or you switch apps, GPS pauses.")}</p>
      </section>

      <section className="card phone-card">
        <h3>🏠 {L("¿Dónde están?", "Where are you?")}</h3>
        <div className="chips">
          {PLACE_KINDS.map((k) => (
            <button key={k.id} className={`chip ${place?.kind === k.id ? "on" : ""}`} onClick={() => setPlace({ kind: k.id, indoor: k.indoor })}>{k[lang]}</button>
          ))}
        </div>
        <div className="chips">
          {FLOORS.map((f) => <button key={f.id} className={`chip ${place?.floor === f.id ? "on" : ""}`} onClick={() => setPlace({ floor: f.id })}>{f[lang]}</button>)}
        </div>
        {place?.kind === "cuarto" && <p className="note">{L("Un cuarto es muy chico para manejar el rover (mínimo ~150 m²). Sirve para medir, no para el mapa jugable.", "A room is too small to drive the rover (min ~150 m²). Good for measuring, not for the playable map.")}</p>}
      </section>

      {place && !place.indoor && (
        <section className="card phone-card">
          <h3>🚶 {L("Caminar el borde del lugar", "Walk the edge of the place")}</h3>
          <p className="muted small-print">{L("Camina por todo el borde y vuelve al inicio. Así el rover sabe hasta dónde puede ir.", "Walk the whole edge and return to the start. This tells the rover how far it can go.")}</p>
          <div className="row">
            <button className={`btn ${walking ? "" : "primary"}`} disabled={!gps} onClick={() => { setWalking((w) => !w); lastTrack.current = null; }}>{walking ? `⏹ ${L("Terminar", "Finish")}` : `▶ ${L("Empezar a caminar", "Start walking")}`}</button>
            <button className="btn ghost small" onClick={() => cloud?.clearTrack(code)}>{L("Borrar", "Clear")}</button>
          </div>
          <p>{track.length} {L("puntos", "points")}{trackInfo ? ` · ${Math.round(trackInfo.len)} m · ${L("área", "area")} ≈ ${Math.round(trackInfo.area)} m²` : ""}</p>
        </section>
      )}

      <section className="card phone-card">
        <h3>📷 {L("Fotos y video", "Photos and video")}</h3>
        <p className="muted small-print">{L("Fotos del suelo, del lugar y de la caja. Videos cortos (10–20 s) girando despacio. ¡Sin caras de personas!", "Photos of the ground, the place and the box. Short videos (10–20 s) turning slowly. No people's faces!")}</p>
        <div className="row">
          <label className="btn primary big">📷 {L("Tomar foto", "Take photo")}<input hidden type="file" accept="image/*" capture="environment" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button className="btn primary big" disabled={!!busy} onClick={() => setLive(true)}>🎥 {L("Grabar con la cámara (10 s)", "Record with camera (10 s)")}</button>
        </div>
        <label className="btn small ghost">🎞️ {L("o subir un video de la galería", "or upload a gallery video")}<input hidden type="file" accept="video/*" onChange={(e) => { onVideo(e.target.files?.[0]); e.target.value = ""; }} /></label>
        {live && <LiveVideo L={L} onClose={() => setLive(false)} onDone={(fr, d) => { setLive(false); uploadFrames(fr, d); }} />}
        {busy && <p className="note">⏳ {busy}</p>}
        <div className="thumbs">{sent.map((s, i) => <span key={i}><img src={s.thumb} alt="" />{s.kind}</span>)}</div>
        <p className="muted small-print">{L("Se suben 6 fotos del video (no el video completo). En iPhone usa “Grabar con la cámara”: los videos de la galería en HDR salen negros.", "6 frames of the video are uploaded (not the full video). On iPhone use “Record with camera”: HDR gallery videos come out black.")}</p>
      </section>

      {place?.indoor && (
        <section className="card phone-card">
          <h3>🧊 {L("Escaneo 3D del lugar", "3D scan of the place")}</h3>
          <ol className="small-print">
            <li>{L("Instala la app gratis Scaniverse (iPhone o Android). En iPhone Pro usa el LiDAR.", "Install the free Scaniverse app (iPhone or Android). iPhone Pro uses LiDAR.")}</li>
            <li>{L("Escanea caminando despacio por todo el lugar, apuntando al piso y a las paredes. Mejor sin gente.", "Scan walking slowly around the whole place, aiming at the floor and walls. Better without people.")}</li>
            <li>{L("Compartir → Exportar modelo → GLB → Guardar en Archivos.", "Share → Export model → GLB → Save to Files.")}</li>
            <li>{L("Aquí: “Subir escaneo” y elige ese archivo (máx. 30 MB).", "Here: “Upload scan” and pick that file (max 30 MB).")}</li>
          </ol>
          <label className="btn primary big">🧊 {L("Subir escaneo (.glb)", "Upload scan (.glb)")}<input hidden type="file" onChange={(e) => { onScan(e.target.files?.[0]); e.target.value = ""; }} /></label>
          {scanMsg && <p className="note">{scanMsg}</p>}
          <p className="muted small-print">{L("Con datos móviles: 30 MB gastan 30 MB de tu plan. Mejor con Wi-Fi.", "On mobile data: 30 MB uses 30 MB of your plan. Better on Wi-Fi.")}</p>
        </section>
      )}

      <section className="card phone-card">
        <h3>📡 {L("La caja", "The box")} ({dev})</h3>
        {box ? (
          <p className="box-mini">🌡️ {box.bme.t_c ?? "—"} °C · 💧 {box.bme.rh_pct ?? "—"} % · ⏲️ {box.bme.p_hpa ?? "—"} hPa · ☀️ UV ≈ {box.uv.uvi_est}
            <br />{box.gps.present !== false && <>🛰️ {box.gps.fix ? L("GPS con señal", "GPS fixed") : L("GPS sin señal", "GPS no fix")} ({box.gps.sats} sat.) · </>}📶 {box.wifi_rssi ?? "—"} dBm{box.lat_ms !== undefined && ` · ⏱️ ${L("retraso", "delay")} ${(box.lat_ms / 1000).toFixed(1)} s`}</p>
        ) : <p className="muted">{L("Todavía no llegan datos de la caja.", "No box data yet.")}</p>}
      </section>
    </div>
  );
}
