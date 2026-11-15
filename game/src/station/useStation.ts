// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Estado compartido de la estación: modo (Firebase / simulador), caja, código de sesión. Guardado en el navegador.
import { useEffect, useState } from "react";
import { connectFirebase, connectSim, getConfig, type FbConfig } from "./cloud";
import type { SimScenario } from "./sim";
import type { Cloud } from "./types";

const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

export function newCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I ni O (se confunden con 1 y 0)
  let s = "";
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return `${s}${Math.floor(10 + Math.random() * 90)}`;
}

export type Mode = "firebase" | "sim";
export function useCloud(mode: Mode, scenario: SimScenario, cfg: FbConfig | null) {
  const [cloud, setCloud] = useState<Cloud | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setCloud(null); setErr(null);
    if (mode === "sim") {
      const c = connectSim(scenario);
      setCloud(c);
      return () => (c as Cloud & { stop?: () => void }).stop?.();
    }
    if (!cfg) return;
    let alive = true;
    connectFirebase(cfg).then((c) => alive && setCloud(c)).catch((e) => alive && setErr(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [mode, scenario, cfg?.apiKey, cfg?.databaseURL]); // eslint-disable-line react-hooks/exhaustive-deps
  return { cloud, err };
}

export function usePersisted(key: string, init: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => read(key, init));
  return [v, (x: string) => { setV(x); write(key, x); }];
}

export { getConfig };
