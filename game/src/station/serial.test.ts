// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { describe, expect, it } from "vitest";
import { splitLines } from "./serial";
import { isBlackFrame } from "./media";

describe("cable USB: corte en líneas", () => {
  it("separa líneas completas y guarda la que llegó a medias", () => {
    const a = splitLines("SEALJSON {\"a\":1}\r\nBME280 OK\r\nSEALJSON {\"b\"");
    expect(a.lines).toEqual(["SEALJSON {\"a\":1}", "BME280 OK"]);
    expect(a.rest).toBe("SEALJSON {\"b\"");
    const b = splitLines(a.rest + ":2}\n");
    expect(b.lines).toEqual(["SEALJSON {\"b\":2}"]);
    expect(b.rest).toBe("");
  });
  it("descarta basura larga sin saltos (velocidad equivocada)", () => {
    expect(splitLines("x".repeat(30000)).rest).toBe("");
  });
});

describe("video: fotograma negro", () => {
  it("negro puro y casi negro → true; con imagen → false", () => {
    const px = new Uint8ClampedArray(4 * 100);
    expect(isBlackFrame(px)).toBe(true);
    px.fill(5); expect(isBlackFrame(px)).toBe(true);
    px[48] = 200; px[49] = 180; px[50] = 150;   // se revisa 1 de cada 4 píxeles
    expect(isBlackFrame(px)).toBe(false);
  });
});

describe("cable USB: lectura pegada a un mensaje", () => {
  it("encuentra SEALJSON aunque venga después de otro texto", async () => {
    const { parseLine } = await import("./serial");
    const r = parseLine('Red: sin internetSEALJSON {"seq":1,"bme":{"ok":true},"uv":{"mv":1},"gps":{"fix":false}}', 5);
    expect(r?.seq).toBe(1);
    expect(parseLine("HTTP -1 (connection refused)")).toBeNull();
  });
});
