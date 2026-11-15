/**
 * Motor de puntaje de similitud analógica (IFA).
 *
 * Principios:
 *  - Transparente: cada criterio devuelve su similitud 0..1 y el motivo si no se pudo calcular.
 *  - Honesto con los datos faltantes: un criterio con dato pendiente NO cuenta como 0, se excluye;
 *    los pesos de lo que sí tiene datos se renormalizan y se informa la "cobertura".
 *  - Funciones puras (sin DOM ni Three.js), fáciles de probar.
 */
import type { Metric, ScoringCategory, ScoringCriterion, Site, Target } from "../data/types";

/** Similitud para magnitudes que abarcan órdenes de magnitud (p. ej. presión). */
export function similarityLog(siteValue: number, targetValue: number, toleranceDecades: number): number | null {
  if (!(siteValue > 0) || !(targetValue > 0) || !(toleranceDecades > 0)) return null;
  const decades = Math.abs(Math.log10(siteValue / targetValue));
  return clamp01(1 - decades / toleranceDecades);
}

/** Similitud lineal: 1 si coinciden, 0 si difieren en `tolerance` o más. */
export function similarityLinear(siteValue: number, targetValue: number, tolerance: number): number | null {
  if (!Number.isFinite(siteValue) || !Number.isFinite(targetValue) || !(tolerance > 0)) return null;
  return clamp01(1 - Math.abs(siteValue - targetValue) / tolerance);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function usable(metric: Metric | null | undefined): metric is Metric & { value: number } {
  return !!metric && metric.status !== "pending" && typeof metric.value === "number" && Number.isFinite(metric.value);
}

/** Lee "climate.meanTemp" dentro del sitio. Devuelve null si el camino no existe. */
export function metricAt(site: Site, path: string): Metric | null {
  let cur: unknown = site;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (cur && typeof cur === "object" && "value" in cur && "unit" in cur) return cur as Metric;
  return null;
}

export type SkipReason = "site_pending" | "target_pending" | "invalid" | "unit_mismatch";

export interface CriterionResult {
  id: string;
  label: string;
  siteMetric: Metric | null;
  target: Metric;
  similarity: number | null;
  skipped?: SkipReason;
}

export interface CategoryResult {
  id: string;
  label: string;
  /** Peso efectivo usado (puede venir de un override del jugador). */
  weight: number;
  note?: string;
  criteria: CriterionResult[];
  /** Media de las similitudes de sus criterios calculables; null si ninguno. */
  similarity: number | null;
}

export interface ScoreResult {
  /** 0..100 sobre las categorías con datos; null si no hay ninguna calculable. */
  total: number | null;
  /** Fracción del peso total que tiene datos (0..1). */
  coverage: number;
  categories: CategoryResult[];
}

function scoreCriterion(site: Site, c: ScoringCriterion): CriterionResult {
  const siteMetric = metricAt(site, c.sitePath);
  const base = { id: c.id, label: c.label, siteMetric, target: c.target };
  if (!usable(c.target)) return { ...base, similarity: null, skipped: "target_pending" };
  if (!usable(siteMetric)) return { ...base, similarity: null, skipped: "site_pending" };
  if (siteMetric.unit !== c.target.unit) return { ...base, similarity: null, skipped: "unit_mismatch" };
  const s =
    c.kind === "log"
      ? similarityLog(siteMetric.value, c.target.value, c.tolerance)
      : similarityLinear(siteMetric.value, c.target.value, c.tolerance);
  if (s === null) return { ...base, similarity: null, skipped: "invalid" };
  return { ...base, similarity: s };
}

function scoreCategory(site: Site, cat: ScoringCategory, weight: number): CategoryResult {
  const criteria = cat.criteria.map((c) => scoreCriterion(site, c));
  const ok = criteria.filter((c) => c.similarity !== null) as (CriterionResult & { similarity: number })[];
  const similarity = ok.length ? ok.reduce((a, c) => a + c.similarity, 0) / ok.length : null;
  return { id: cat.id, label: cat.label, weight, note: cat.note, criteria, similarity };
}

/**
 * Calcula el IFA de un sitio contra un cuerpo objetivo.
 * @param weightOverrides pesos alternativos por id de categoría (el jugador puede cambiarlos).
 */
export function scoreSite(site: Site, target: Target, weightOverrides: Record<string, number> = {}): ScoreResult {
  const categories = target.categories.map((cat) => {
    const w = weightOverrides[cat.id];
    const weight = typeof w === "number" && w >= 0 ? w : cat.weight;
    return scoreCategory(site, cat, weight);
  });
  const totalWeight = categories.reduce((a, c) => a + c.weight, 0);
  const covered = categories.filter((c) => c.similarity !== null);
  const coveredWeight = covered.reduce((a, c) => a + c.weight, 0);
  const total =
    coveredWeight > 0 ? (covered.reduce((a, c) => a + c.weight * (c.similarity as number), 0) / coveredWeight) * 100 : null;
  return { total, coverage: totalWeight > 0 ? coveredWeight / totalWeight : 0, categories };
}

export const SKIP_TEXT: Record<SkipReason, string> = {
  site_pending: "falta el dato del sitio",
  target_pending: "falta el valor del cuerpo objetivo",
  invalid: "valores no comparables",
  unit_mismatch: "unidades distintas",
};
