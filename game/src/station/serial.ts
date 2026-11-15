// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Plan B sin Wi-Fi: la caja conectada por cable USB a la laptop. El firmware imprime cada segundo
// "SEALJSON {...}" (la misma lectura que manda a la nube). Web Serial: Chrome o Edge en computadora (no celulares).
//
// Robustez: Web Serial corta el flujo ante errores "no fatales" (p. ej. BufferOverrunError cuando la pestaña queda
// en segundo plano y no lee a tiempo). Hay que volver a tomar `port.readable` y seguir: eso hace el bucle de abajo.
// Si el cable se desconecta de verdad, `port.readable` queda en null y se avisa con onClosed.
import type { Reading } from "./types";

export const serialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

/** Una línea del cable → lectura, o null si es otro mensaje (p. ej. "BME280 NO encontrado"). */
export function parseLine(line: string, now = Date.now()): Reading | null {
  const i = line.indexOf("SEALJSON {");   // puede venir pegada a un mensaje de la caja ("Red: ...SEALJSON {...}")
  if (i < 0) return null;
  try {
    const o = JSON.parse(line.slice(i + 9));
    if (!o || typeof o !== "object" || !o.bme || !o.uv || !o.gps) return null;
    return { ...o, received: now, ts: now };
  } catch { return null; }
}

/** Corta el texto en líneas completas; devuelve las líneas y lo que sobra (línea a medias). */
export function splitLines(buf: string): { lines: string[]; rest: string } {
  const parts = buf.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.replace(/\r$/, "").trim()).filter(Boolean), rest: rest.length > 20000 ? "" : rest };
}

export interface SerialPortLike {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>; close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}
type SerialNav = Navigator & { serial: { requestPort(): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]>; addEventListener(e: "connect", cb: (ev: Event) => void): void; removeEventListener(e: "connect", cb: (ev: Event) => void): void } };
const nav = () => navigator as SerialNav;

/** Puertos que este navegador ya autorizó antes (para reconectar sin preguntar al recargar la página). */
export async function grantedPorts(): Promise<SerialPortLike[]> {
  if (!serialSupported()) return [];
  try { return await nav().serial.getPorts(); } catch { return []; }
}
/** Avisa cuando se enchufa un puerto ya autorizado (el cable se volvió a conectar). */
export function onPortConnect(cb: (p: SerialPortLike) => void): () => void {
  if (!serialSupported()) return () => {};
  const h = (ev: Event) => cb((ev as Event & { target: SerialPortLike }).target);
  nav().serial.addEventListener("connect", h);
  return () => nav().serial.removeEventListener("connect", h);
}

/** Abre el puerto (o pide elegirlo) a 115200 baudios y entrega lecturas y mensajes. */
export async function openSerial(onReading: (r: Reading) => void, onText: (line: string) => void,
  o: { port?: SerialPortLike; onClosed?: () => void; onBytes?: (n: number) => void } = {}): Promise<() => Promise<void>> {
  const port = o.port ?? await nav().serial.requestPort();
  await port.open({ baudRate: 115200, bufferSize: 1 << 16 });   // búfer grande: aguanta la pestaña en segundo plano
  let stop = false, n = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const done = (async () => {
    for (;;) {
      const rs = stop ? null : port.readable;
      if (!rs) break;
      reader = rs.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { value, done: end } = await reader.read();
          if (end) break;
          o.onBytes?.(value.length);
          const s = splitLines(buf + dec.decode(value, { stream: true }));
          buf = s.rest;
          for (const line of s.lines) {
            const r = parseLine(line);
            // número propio por lectura: sin internet la caja puede repetir "seq" (solo lo sube al enviar a la nube)
            if (r) onReading({ ...r, seq: ++n }); else onText(line);
          }
        }
      } catch (e) {
        if (!stop) onText(`(cable: ${(e as Error)?.name ?? e} — sigo leyendo)`);
      } finally { try { reader.releaseLock(); } catch { /* ya liberado */ } }
      if (!stop) await new Promise((r) => setTimeout(r, 300));
    }
    if (!stop) { onText("(cable desconectado)"); await port.close().catch(() => {}); o.onClosed?.(); }
  })();
  return async () => { stop = true; await reader?.cancel().catch(() => {}); await done; await port.close().catch(() => {}); };
}
