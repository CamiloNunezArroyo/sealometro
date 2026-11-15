// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Pruebas de la conversión OpenStreetMap → objetos en metros locales, del relieve en anillos y de los muebles de juego.
import { describe, expect, it } from "vitest";
import { buildArenaWorld, fromBox, fromLocal, sizeCheck, toLocal } from "../game/core/arena";
import { buildingHeight, elevAt, elevRingFrom, elevSamples, ELEV_ANGLES, ELEV_RADII, overpassQuery, parseOsm, pitchAt, surfaceFloor, type OsmJson } from "./osm";
import { placeProps } from "../game/core/arena";

const lat0 = -19.0407, lon0 = -65.2601;
/** Cuadrado de lado `m` metros con centro en (dx este, dz sur) m del origen, como geometría OSM. */
const sq = (dx: number, dz: number, m: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => {
  const [lat, lon] = fromLocal(lat0, lon0, dx + (a * m) / 2, dz + (b * m) / 2); return { lat, lon };
});

describe("OpenStreetMap → alrededor real del lugar", () => {
  const j: OsmJson = { elements: [
    { type: "way", id: 1, tags: { building: "office", "building:levels": "5", name: "Oficina" }, geometry: sq(60, 0, 20) },
    { type: "way", id: 2, tags: { building: "yes", height: "12.5" }, geometry: sq(-50, 30, 10) },
    { type: "way", id: 3, tags: { building: "house" }, geometry: sq(0, -80, 8) },
    { type: "way", id: 4, tags: { leisure: "pitch", sport: "soccer", surface: "grass" }, geometry: sq(0, 0, 40) },
    { type: "way", id: 5, tags: { leisure: "stadium", barrier: "wall" }, geometry: sq(0, 0, 120) },
    { type: "node", id: 6, tags: { natural: "tree" }, ...(() => { const [lat, lon] = fromLocal(lat0, lon0, 10, 30); return { lat, lon }; })() },
    { type: "way", id: 7, tags: { highway: "primary" }, geometry: [fromLocal(lat0, lon0, -200, 70), fromLocal(lat0, lon0, 200, 70), fromLocal(lat0, lon0, 5000, 70)].map(([lat, lon]) => ({ lat, lon })) },
    { type: "way", id: 8, tags: { building: "yes" }, geometry: sq(3000, 0, 10) },   // muy lejos: se descarta
    { type: "way", id: 9, tags: { leisure: "park" }, geometry: sq(-90, -90, 30) },
  ] };
  it("convierte edificios (con altura de OSM o de juego), cancha, árbol, calle y parque a metros locales", () => {
    const s = parseOsm(j, lat0, lon0);
    expect(s.counts.buildings).toBe(3);
    expect(s.counts.withHeight).toBe(2);
    const office = s.buildings.find((b) => b.name === "Oficina")!;
    expect(office.h).toBe(16);                 // 5 pisos × 3 m + 1
    expect(office.hFrom).toBe("levels");
    const cx = office.poly.reduce((a, p) => a + p[0], 0) / office.poly.length;
    expect(cx).toBeCloseTo(60, 0);              // al este
    expect(office.poly.length).toBe(4);         // el punto repetido de cierre se quita
    expect(s.buildings.find((b) => b.hFrom === "height")!.h).toBe(12.5);
    expect(s.trees[0][0]).toBeCloseTo(10, 0);
    expect(s.trees[0][1]).toBeCloseTo(30, 0);
    expect(s.roads[0].line.length).toBe(2);     // el punto a 5 km se recorta
    expect(s.green.length).toBe(1);
    expect(s.barriers.length).toBe(1);          // muro del estadio
  });
  it("el GPS dentro de la cancha la encuentra (antes que el estadio) y sugiere el piso por su superficie", () => {
    const s = parseOsm(j, lat0, lon0);
    const p = pitchAt(s, 0, 0)!;
    expect(p.kind).toBe("pitch");
    expect(p.area).toBeGreaterThan(1500);
    expect(p.area).toBeLessThan(1700);
    expect(surfaceFloor(p.surface)).toBe("pasto");
    expect(surfaceFloor("asphalt")).toBe("cemento");
    expect(surfaceFloor(undefined)).toBeNull();
    expect(pitchAt(s, 500, 500)).toBeNull();
  });
  it("el desplazamiento `off` mueve todo al centro del mapa del juego", () => {
    const s = parseOsm(j, lat0, lon0, [10, -5]);
    const t = s.trees[0];
    expect(t[0]).toBeCloseTo(0, 0);
    expect(t[1]).toBeCloseTo(35, 0);
  });
  it("altura de edificio y consulta Overpass", () => {
    expect(buildingHeight({ building: "yes", height: "9 m" })).toEqual({ h: 9, hFrom: "height" });
    expect(buildingHeight({ building: "apartments" }).hFrom).toBe("default");
    const q = overpassQuery(lat0, lon0, 200);
    expect(q).toContain("around:200,-19.040700,-65.260100");
    expect(q).toContain("[out:json]");
  });
  it("fromLocal es el inverso de toLocal", () => {
    const [lat, lon] = fromLocal(lat0, lon0, 120, -45);
    const [x, z] = toLocal(lat0, lon0, lat, lon);
    expect(x).toBeCloseTo(120, 3);
    expect(z).toBeCloseTo(-45, 3);
  });
  it("relieve: anillos interpolados (0 en el centro, sube hacia donde sube el terreno)", () => {
    const pts = elevSamples();
    expect(pts.length).toBe(1 + ELEV_RADII.length * ELEV_ANGLES);
    // terreno que sube 0,05 m por metro hacia el este
    const ring = elevRingFrom(pts.map(([x]) => 2800 + x * 0.05))!;
    expect(ring.center).toBe(2800);
    expect(elevAt(ring, 0, 0)).toBeCloseTo(0, 6);
    expect(elevAt(ring, 250, 0)).toBeCloseTo(12.5, 3);
    expect(elevAt(ring, -450, 0)).toBeCloseTo(-22.5, 3);
    expect(elevAt(ring, 2000, 0)).toBeCloseTo(40, 3);   // más allá del último anillo: se queda en el último
    expect(elevRingFrom([1, 2, 3])).toBeNull();
  });
});

describe("muebles de juego según las fotos", () => {
  it("pone muebles junto a las paredes, bloquea sus celdas y el lugar sigue sirviendo", () => {
    const s = fromBox(30, 20, { name: "salón", indoor: true, floor: "interior" });
    const area0 = sizeCheck(s).area;
    const props = placeProps(s, 8, 3);
    expect(props.length).toBe(8);
    expect(s.props).toBe(props);
    const area1 = sizeCheck(s).area;
    expect(area1).toBeLessThan(area0);
    expect(area1).toBeGreaterThan(area0 * 0.88);
    for (const p of props) expect(Math.max(Math.abs(p.x) - 15, Math.abs(p.z) - 10)).toBeGreaterThan(-3.5); // cerca de una pared
    const w = buildArenaWorld(s, "mission", 1);
    expect(w.rocksNear(props[0].x, props[0].z, 1).length).toBeGreaterThan(0); // el rover choca con el mueble
    expect(placeProps(fromBox(30, 20, { name: "x", indoor: true, floor: "interior" }), 0)).toEqual([]);
  });
});
