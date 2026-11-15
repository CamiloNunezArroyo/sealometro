// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composition, MINERALS, MINERAL_BY_ID, parseFormula, prettyFormula } from "./minerals";
import { pickSamples, samplePool } from "./samples";

const pct = (f: string, el: string) => composition(f).find((c) => c.el === el)?.pct ?? 0;

describe("composición calculada de la fórmula", () => {
  it("halita NaCl: 39,3 % Na y 60,7 % Cl", () => {
    expect(pct("NaCl", "Na")).toBeCloseTo(39.34, 1);
    expect(pct("NaCl", "Cl")).toBeCloseTo(60.66, 1);
  });
  it("calcita CaCO3: 40,0 % Ca, 12,0 % C, 48,0 % O", () => {
    expect(pct("CaCO3", "Ca")).toBeCloseTo(40.04, 1);
    expect(pct("CaCO3", "C")).toBeCloseTo(12.0, 1);
    expect(pct("CaCO3", "O")).toBeCloseTo(47.96, 1);
  });
  it("yeso CaSO4·2H2O: el agua pesa 20,9 % (se libera en el horno)", () => {
    const at = parseFormula("CaSO4·2H2O");
    expect(at).toEqual({ Ca: 1, S: 1, O: 6, H: 4 });
    expect(pct("CaSO4·2H2O", "H")).toBeCloseTo(2.34, 1);
  });
  it("paréntesis y decimales: jarosita y olivino", () => {
    expect(parseFormula("KFe3(SO4)2(OH)6")).toEqual({ K: 1, Fe: 3, S: 2, O: 14, H: 6 });
    expect(parseFormula("Mg1.6Fe0.4SiO4")).toEqual({ Mg: 1.6, Fe: 0.4, Si: 1, O: 4 });
  });
  it("muestra subíndices sin tocar el coeficiente del hidrato", () => {
    expect(prettyFormula("Mg(ClO4)2·6H2O")).toBe("Mg(ClO₄)₂·6H₂O");
    expect(prettyFormula("(Mg0.8Fe0.2)2SiO4")).toBe("(Mg₀.₈Fe₀.₂)₂SiO₄");
  });
  it("todas las fórmulas del catálogo se leen y suman 100 %", () => {
    for (const m of MINERALS) {
      const s = composition(m.formula).reduce((a, c) => a + c.pct, 0);
      expect(s).toBeCloseTo(100, 6);
    }
  });
  it("hay al menos 25 minerales distintos, con ids únicos y conexión espacial", () => {
    expect(MINERALS.length).toBeGreaterThanOrEqual(25);
    expect(new Set(MINERALS.map((m) => m.id)).size).toBe(MINERALS.length);
    for (const m of MINERALS) expect(m.space.es.length).toBeGreaterThan(20);
  });
  it("pruebas coherentes: los carbonatos burbujean con ácido y sueltan CO2; la magnetita se pega al imán", () => {
    for (const m of MINERALS.filter((x) => x.formula.includes("CO3"))) { expect(m.acid).not.toBe("none"); expect(m.heat).toContain("CO2"); }
    for (const m of MINERALS.filter((x) => x.acid !== "none")) expect(m.formula).toContain("CO3");
    expect(MINERAL_BY_ID.get("magnetita")!.magnet).toBe("strong");
    for (const m of MINERALS.filter((x) => x.formula.includes("H2O") && x.id !== "hielo")) expect(m.heat).toContain("H2O");
  });
});

describe("qué mineral sale en cada lugar", () => {
  it("Atacama prioriza lo documentado y lo propio del lugar (salitre, perclorato)", () => {
    const pool = samplePool({ id: "atacama_yungay", biome: "desierto", minerals: { classes: ["sulfato", "cloruro", "carbonato"] } }, false);
    expect(pool.map((p) => p.id)).toContain("nitratina");
    expect(pool.find((p) => p.id === "yeso")?.why).toBe("site");
  });
  it("cada muestra de una partida es distinta y todos los ids existen", () => {
    const s = pickSamples({ id: "uyuni_incahuasi", biome: "salar", minerals: { classes: ["cloruro", "sulfato"] } }, 3, false, 42);
    expect(new Set(s.map((x) => x.id)).size).toBe(3);
    for (const x of s) expect(MINERAL_BY_ID.has(x.id)).toBe(true);
  });
  it("en los 41 lugares reales y sus cuevas, todos los minerales posibles existen en el catálogo", () => {
    const META = join(process.cwd(), "public", "data", "terrain", "game_sites.json");
    if (!existsSync(META)) return;
    const sites = JSON.parse(readFileSync(META, "utf8")).sites;
    const seen = new Set<string>();
    for (const s of sites) for (const cave of [false, s.cave]) for (const p of samplePool(s, cave)) { expect(MINERAL_BY_ID.has(p.id)).toBe(true); seen.add(p.id); }
    expect(seen.size).toBeGreaterThanOrEqual(25); // la mayor parte del catálogo aparece en algún lugar
  });
});
