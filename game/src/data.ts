// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Tipos y carga de los productos del motor (copiados a public/data por scripts/sync-data.mjs).
import { useEffect, useState } from "react";

export type Status = "measured" | "modeled" | "literature" | "derived" | "estimated" | "design" | "gameplay" | "pending";

export interface Val {
  value?: number | null;
  unit: string;
  status: Status;
  source?: string;
  ref?: string;
  range?: [number, number];
  classes?: string[];
  retrieved?: string;
}
export interface Dim {
  id: string;
  s: number | null;
  po: number | null;
  pct_earth: number | null;
  skipped: string | null;
  analogable: boolean;
  weight: number;
  site: Val | null;
  target: Val | null;
}
export interface Gap { id: string; earth: unknown; target: unknown; unit: string | null; ratio?: number; status?: string; ref?: string[] }
export interface Story { explorador: string; cadete: string; cientifico: string }
export interface Result {
  site_id: string;
  target_id: string;
  role: "candidate" | "control_pos" | "control_neg";
  ifa: number | null;
  ifa_min: number | null;
  insufficient?: string | null;
  coverage: number;
  profiles: Record<string, number | null>;
  limiting: string | null;
  robust: { median_rank: number | null; p90: [number, number] | null; p_top3: number; n: number } | null;
  dims: Dim[];
  gaps: Gap[];
  story: Story;
  story_en?: Story;
}
export interface TargetInfo { id: string; body: "mars" | "moon"; name: string; group: string; file: string; n: number; top3: string[] }
export interface Validation { auc: number | null; auc_ci90: [number, number] | null; n_pos: number | null; n_rand: number | null; note: string | null;
  by_target: Record<string, { auc: number | null; auc_ci90: [number, number] | null; n_pos: number | null; n_rand: number | null }> }
export interface RankingIndex { generated: string; engine_version: string; validation: Validation; targets: TargetInfo[] }
export interface TargetFile { target: TargetInfo; results: Result[] }
export interface SiteInfo { id: string; name: string; country: string; region: string; lat: number | null; lon: number | null;
  coord_status: Status; role: Result["role"]; analog_for: string[]; refs: string[]; processed: boolean }
export interface GameSite {
  id: string; name: string; country: string; lat: number; lon: number; role: Result["role"];
  file: string; n: number; size_m: number; m_per_px: number; h_min: number; h_max: number;
  water_level: number | null; biome: string; cave: boolean;
  minerals: { classes: string[]; status: Status; source: string } | null;
  climate: Record<string, Val | null>;
  terrain_stats: Record<string, Val | null>;
}
export interface DiscoverCell { lat: number; lon: number; ifa: number | null; coverage: number; limiting: string | null; values: Record<string, number> }
export interface Discover { step_deg: number; cells: DiscoverCell[]; top_bolivia: (DiscoverCell & { nearest_site: string; nearest_km: number })[]; note: string }

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

export function fetchJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(path, fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path) as Promise<T>;
}

export function dataUrl(path: string): string {
  return BASE + path;
}

export function useData<T>(path: string | null): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState({ data: null, error: null });
    fetchJSON<T>(path).then((d) => alive && setState({ data: d, error: null }))
      .catch((e) => alive && setState({ data: null, error: String(e) }));
    return () => { alive = false; };
  }, [path]);
  return state;
}

/** Valor para ordenar: el conservador (lo que falta cuenta como 0). */
export function rankValue(r: Result): number {
  return r.ifa_min ?? -1;
}
