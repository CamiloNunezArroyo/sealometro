// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Conexión por cable USB que vive FUERA de la página /estacion: sigue leyendo (y reenviando a la nube) aunque se
// cambie de sección, y al volver se ve todo lo recibido. Guarda cuántos bytes llegan para saber si la caja está muda.
import { grantedPorts, onPortConnect, openSerial, serialSupported, type SerialPortLike } from "./serial";
import type { Reading } from "./types";

export interface UsbState { on: boolean; opened: number; bytes: number; lastByte: number; lastReading: number; readings: number; log: string[] }
const EMPTY: UsbState = { on: false, opened: 0, bytes: 0, lastByte: 0, lastReading: 0, readings: 0, log: [] };
const FLAG = "seal.st.usb";

let st: UsbState = EMPTY;
let stopFn: (() => Promise<void>) | null = null;
let busy = false;
const buf: Reading[] = [];
const subs = new Set<() => void>();
const rsubs = new Set<(r: Reading) => void>();
let relay: ((r: Reading) => void) | null = null;

const set = (p: Partial<UsbState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const flag = (v?: boolean) => { try { if (v === undefined) return localStorage.getItem(FLAG) === "1"; if (v) localStorage.setItem(FLAG, "1"); else localStorage.removeItem(FLAG); } catch { /* sin almacenamiento */ } return false; };

export const usbState = () => st;
export function subscribeUsb(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
export function onUsbReading(cb: (r: Reading) => void) { rsubs.add(cb); return () => { rsubs.delete(cb); }; }
/** Lecturas recibidas por cable (últimas 600), para mostrarlas al volver a la sección. */
export const usbBuffer = () => buf.slice();
/** A quién reenviar cada lectura (p. ej. Firebase). Se mantiene aunque se cambie de sección. */
export function setUsbRelay(fn: ((r: Reading) => void) | null) { relay = fn; }

export async function connectUsb(port?: SerialPortLike): Promise<void> {
  if (st.on || busy || !serialSupported()) return;
  busy = true;
  try {
    buf.length = 0;
    const now = Date.now();
    set({ ...EMPTY, opened: now, log: [] });
    stopFn = await openSerial((r) => {
      buf.push(r); if (buf.length > 600) buf.shift();
      set({ readings: st.readings + 1, lastReading: Date.now() });
      rsubs.forEach((f) => f(r));
      try { relay?.(r); } catch { /* sin nube */ }
    }, (line) => set({ log: [...st.log.slice(-7), line] }),
    { port, onBytes: (n) => set({ bytes: st.bytes + n, lastByte: Date.now() }), onClosed: () => { stopFn = null; set({ on: false }); } });
    set({ on: true, opened: Date.now() });
    flag(true);
  } catch (e) {
    const msg = String(e);
    if (!msg.includes("No port selected")) set({ log: [...st.log.slice(-7), `(no se pudo abrir el puerto: ${msg})`] });
    throw e;
  } finally { busy = false; }
}
export async function disconnectUsb() {
  flag(false);
  const f = stopFn; stopFn = null;
  set({ on: false });
  await f?.().catch(() => {});
}

let autoInit = false;
/** Al cargar la página: si se usaba el cable, reconecta sin preguntar; y reconecta al volver a enchufarlo. */
export function autoConnectUsb() {
  if (autoInit || !serialSupported()) return;
  autoInit = true;
  if (flag()) grantedPorts().then((ps) => { if (ps.length === 1) connectUsb(ps[0]).catch(() => {}); });
  onPortConnect((p) => { if (flag() && !st.on) setTimeout(() => connectUsb(p).catch(() => {}), 1500); });
}

/** Diagnóstico simple del cable para mostrar en la página. */
export function usbHealth(s: UsbState, now = Date.now()): { level: "ok" | "warn" | "bad"; es: string; en: string } | null {
  if (!s.on) return null;
  const since = (now - s.opened) / 1000;
  if (s.lastReading && now - s.lastReading < 5000) return { level: "ok", es: `Recibiendo: ${s.readings} lecturas`, en: `Receiving: ${s.readings} readings` };
  if (!s.bytes) {
    if (since < 40) return { level: "warn", es: `Esperando a la caja (${Math.round(since)} s): al conectar se reinicia y calienta 30 s.`, en: `Waiting for the box (${Math.round(since)} s): it restarts and warms up 30 s.` };
    return { level: "bad", es: "La caja no manda NADA por el cable. Aprieta el botón EN (reset) de la placa o desenchufa y vuelve a enchufar el cable. Si la pantalla de la caja está congelada, la caja se colgó.",
      en: "The box sends NOTHING over the cable. Press the board's EN (reset) button or unplug and replug the cable. If the box screen is frozen, it hung." };
  }
  const quiet = Math.round((now - Math.max(s.lastByte, s.lastReading)) / 1000);
  if (!s.readings) return { level: since < 40 ? "warn" : "bad", es: `Llegan datos (${s.bytes} bytes) pero sin lecturas: mira los mensajes de abajo.`, en: `Data arrives (${s.bytes} bytes) but no readings: see the messages below.` };
  return { level: "bad", es: `La última lectura llegó hace ${quiet} s. Aprieta EN (reset) en la placa o reconecta el cable.`, en: `Last reading ${quiet} s ago. Press EN (reset) on the board or reconnect the cable.` };
}
