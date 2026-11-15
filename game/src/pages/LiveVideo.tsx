// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// "Video" con la cámara EN VIVO (getUserMedia): se graba girando ~10 s y se toman 6 fotogramas mientras tanto.
// Por qué no un archivo de video: el iPhone graba en HDR (Dolby Vision/HEVC) y Safari suele dibujar esos videos
// en negro en un canvas. La imagen en vivo de la cámara es normal (SDR) y se dibuja bien en iPhone y Android.
import { useEffect, useRef, useState } from "react";

export interface LiveFrame { data: string; w: number; h: number; bytes: number }

export function LiveVideo({ L, seconds = 10, n = 6, onDone, onClose }: {
  L: (es: string, en: string) => string; seconds?: number; n?: number;
  onDone: (frames: LiveFrame[], duration: number) => void; onClose: () => void;
}) {
  const vid = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [shots, setShots] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (vid.current) { vid.current.srcObject = s; await vid.current.play().catch(() => {}); }
      } catch (e) {
        const name = (e as Error)?.name;
        setErr(name === "NotAllowedError" ? L("Permiso de cámara negado: actívalo en Ajustes → Safari → Cámara (o en el candado del navegador).", "Camera permission denied: enable it in Settings → Safari → Camera (or the browser lock icon).")
          : L(`No se pudo abrir la cámara: ${e}`, `Could not open the camera: ${e}`));
      }
    })();
    return () => { alive = false; timers.current.forEach(clearTimeout); stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grab = (): LiveFrame | null => {
    const v = vid.current;
    if (!v || !v.videoWidth) return null;
    const k = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    const data = c.toDataURL("image/jpeg", 0.72);
    return { data, w, h, bytes: Math.round((data.length * 3) / 4) };
  };

  const record = () => {
    const frames: LiveFrame[] = [];
    const t0 = Date.now();
    setLeft(seconds); setShots(0);
    for (let s = 1; s <= seconds; s++) timers.current.push(window.setTimeout(() => setLeft(seconds - s), s * 1000));
    for (let i = 0; i < n; i++) {
      timers.current.push(window.setTimeout(() => {
        const f = grab();
        if (f) { frames.push(f); setShots(frames.length); }
        if (i === n - 1) { stream.current?.getTracks().forEach((t) => t.stop()); onDone(frames, (Date.now() - t0) / 1000); }
      }, ((i + 0.5) / n) * seconds * 1000));
    }
  };

  return (
    <div className="live-video">
      <video ref={vid} playsInline muted autoPlay />
      <div className="live-bar">
        {err ? <p className="bad">{err}</p>
          : left === null ? <button className="btn primary big" onClick={record}>⏺ {L(`Grabar ${seconds} s`, `Record ${seconds} s`)}</button>
          : <p className="live-count">⏺ {left} s · 📸 {shots}/{n} — {L("gira despacio", "turn slowly")}</p>}
        <button className="btn ghost" onClick={onClose}>✕ {L("Cerrar", "Close")}</button>
      </div>
    </div>
  );
}
