// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Idioma y nivel de lectura (edad), recordados en el navegador. Si el almacenamiento falla, la app sigue igual.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, type Lang, type Level } from "./i18n";

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* sin almacenamiento: no pasa nada */ }
}

interface Settings {
  lang: Lang; level: Level;
  setLang: (l: Lang) => void; setLevel: (l: Level) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}
const Ctx = createContext<Settings | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const browserLang: Lang = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
  // ?lang=en / ?lang=es en el enlace manda (para el jurado global: https://seal-box.web.app/?lang=en)
  const urlLang = typeof location !== "undefined" ? new URLSearchParams(location.search).get("lang") : null;
  const [lang, setLangState] = useState<Lang>(() => (urlLang === "en" || urlLang === "es" ? urlLang : load("seal.lang", ["es", "en"] as const, browserLang)));
  const [level, setLevelState] = useState<Level>(() => load("seal.level", ["explorador", "cadete", "cientifico"] as const, "cadete"));
  const setLang = useCallback((l: Lang) => { setLangState(l); save("seal.lang", l); }, []);
  const setLevel = useCallback((l: Level) => { setLevelState(l); save("seal.level", l); }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.level = level;
  }, [lang, level]);
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, level, setLang, setLevel, t }), [lang, level, setLang, setLevel, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): Settings {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings fuera de SettingsProvider");
  return v;
}

// ------------------------------------------------------------------ enrutador por hash (#/mapa?target=...)
export interface Route { path: string[]; query: URLSearchParams }
function parse(): Route {
  const h = (typeof location !== "undefined" ? location.hash : "").replace(/^#\/?/, "");
  const [p, q = ""] = h.split("?");
  return { path: p.split("/").filter(Boolean), query: new URLSearchParams(q) };
}
export function useRoute(): Route {
  const [r, setR] = useState<Route>(parse);
  useEffect(() => {
    const on = () => { setR(parse()); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}
export function go(path: string, query?: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  location.hash = `#/${path}${s ? "?" + s : ""}`;
}
