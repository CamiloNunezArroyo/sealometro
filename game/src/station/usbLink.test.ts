// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it, vi } from "vitest";

const line = (seq: number) => `SEALJSON ${JSON.stringify({ device: "t", fw: "1", seq, boot: 7, uptime_s: seq, bme: { ok: true }, mpu: { ok: false }, uv: { mv: 1 }, light: { pct: 0 }, gas: { raw: 1 }, gps: { fix: false, sats: 0, hdop: 99 } })}\r\n`;
const enc = new TextEncoder();

/** Puerto falso: 1.er flujo manda una lectura y falla (como BufferOverrunError); el 2.º manda dos más y se queda abierto. */
function fakePort() {
  let k = 0;
  return {
    open: vi.fn(async () => {}), close: vi.fn(async () => {}),
    get readable() {
      k++;
      if (k === 1) return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(line(1) + "BME280 OK\r\n")); setTimeout(() => c.error(Object.assign(new Error("x"), { name: "BufferOverrunError" })), 5); } });
      if (k === 2) return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(line(2) + line(3).slice(0, 20))); setTimeout(() => c.enqueue(enc.encode(line(3).slice(20))), 5); } });
      return null;
    },
  };
}

describe("cable USB que sobrevive a errores y a cambiar de sección", () => {
  it("sigue leyendo tras un error no fatal y guarda las lecturas", async () => {
    vi.stubGlobal("navigator", { serial: { requestPort: async () => fakePort(), getPorts: async () => [], addEventListener() {}, removeEventListener() {} } });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
    const u = await import("./usbLink");
    const relayed: number[] = [];
    u.setUsbRelay((r) => relayed.push(r.seq));
    await u.connectUsb();
    await new Promise((r) => setTimeout(r, 400));
    const s = u.usbState();
    expect(s.on).toBe(true);
    expect(s.readings).toBe(3);
    expect(u.usbBuffer().map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(relayed).toEqual([1, 2, 3]);
    expect(s.log.some((l) => l.includes("BufferOverrunError"))).toBe(true);
    expect(u.usbHealth(s)?.level).toBe("ok");
    vi.unstubAllGlobals();
  });
  it("diagnóstico: caja muda, esperando, y lecturas viejas", async () => {
    const { usbHealth } = await import("./usbLink");
    const base = { on: true, opened: 0, bytes: 0, lastByte: 0, lastReading: 0, readings: 0, log: [] };
    expect(usbHealth({ ...base }, 10_000)?.level).toBe("warn");
    expect(usbHealth({ ...base }, 60_000)?.es).toMatch(/no manda NADA/);
    expect(usbHealth({ ...base, bytes: 900, lastByte: 50_000, readings: 4, lastReading: 50_000 }, 90_000)?.es).toMatch(/hace 40 s/);
    expect(usbHealth({ ...base, on: false })).toBeNull();
  });
});
