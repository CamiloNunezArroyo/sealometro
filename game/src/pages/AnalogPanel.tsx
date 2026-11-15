// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Panel "¿Qué tanto se parece y sirve este lugar?": (1) analogía con Marte/Luna con la matemática del motor,
// (2) qué tan diferente es la caja de los datos reales (referencias independientes), (3) aptitud para una prueba de
// rover (decisión de diseño). Todo con su fuente y su estado; lo que falta se dice.
import { useEffect, useMemo, useState } from "react";
import { useData } from "../data";
import { diffTable, fetchPowerClimate, missionFit, scoreTarget, siteValues, POWER_REF, type FieldTargets, type PowerClim } from "../station/analog";
import { tiltDeg } from "../station/quality";
import { polygonArea, simplify, toLocal } from "../game/core/arena";
import type { Summary } from "../station/field";
import type { Meteo } from "../station/reference";
import type { Place, Reading, TrackPt } from "../station/types";

const pct = (x: number) => `${Math.round(x)} %`;
let LANG: "es" | "en" = "es";
/** Número con coma decimal en español; la temperatura media (K) se muestra en °C. */
const fmt = (x: number, unit: string, id?: string) => {
  if (id === "t_mean" && unit === "K") { x -= 273.15; unit = "°C"; }
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return `${x.toLocaleString(LANG === "es" ? "es-BO" : "en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}${unit && unit !== "1" ? " " + unit : ""}`;
};

export function AnalogPanel({ L, lang, summary, readings, meteo, dem, pos, place, track, mpuRef }: {
  L: (es: string, en: string) => string; lang: "es" | "en"; summary: Summary | null; readings: Reading[]; meteo: Meteo | null; dem: number | null;
  pos: { lat: number; lon: number } | null; place: Place | null; track: TrackPt[]; mpuRef: [number, number, number] | null;
}) {
  LANG = lang;
  const ft = useData<FieldTargets>("engine/field_targets.json");
  const [power, setPower] = useState<PowerClim | null>(null);
  const [powerErr, setPowerErr] = useState<string | null>(null);
  const [body, setBody] = useState<"mars" | "moon">("mars");
  const key = pos ? `${pos.lat.toFixed(3)},${pos.lon.toFixed(3)}` : null;
  useEffect(() => {
    if (!pos) return;
    let alive = true;
    setPowerErr(null);
    fetchPowerClimate(pos.lat, pos.lon).then((c) => alive && setPower(c)).catch((e) => alive && setPowerErr(String(e)));
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const vals = useMemo(() => siteValues(power, dem, summary?.p_hpa ?? null), [power, dem, summary]);
  const scores = useMemo(() => (ft.data ? ft.data.targets.map((t) => scoreTarget(vals, t, ft.data!)).sort((a, b) => (b.ifaRaw ?? -1) - (a.ifaRaw ?? -1)) : []), [ft.data, vals]);
  const shown = scores.filter((s) => s.body === body);
  const best = shown[0];
  const diffs = useMemo(() => (summary ? diffTable({ t_c: summary.t_c, rh: summary.rh, p_hpa: summary.p_hpa, uvi: summary.uvi, alt_gps: summary.gps.alt_m ?? null }, meteo, dem, place ? place.indoor : null) : []), [summary, meteo, dem, place]);

  const fit = useMemo(() => {
    let area: number | null = null, minSide: number | null = null;
    if (place?.length_m && place?.width_m) { area = place.length_m * place.width_m; minSide = Math.min(place.length_m, place.width_m); }
    else if (track.length >= 3) { const pts = simplify(track.map((p) => toLocal(track[0].lat, track[0].lon, p.lat, p.lon)), 2); area = polygonArea(pts); }
    const win = readings.slice(-60).filter((r) => r.mpu?.ok);
    const tilts = win.map((r) => tiltDeg(r.mpu, mpuRef));
    const m = tilts.length ? tilts.reduce((a, b) => a + b, 0) / tilts.length : 0;
    const sd = tilts.length > 3 ? Math.sqrt(tilts.reduce((a, b) => a + (b - m) ** 2, 0) / tilts.length) : null;
    const last = readings[readings.length - 1];
    return missionFit({ area_m2: area, minSide_m: minSide, floor: place?.floor ?? null, indoor: place ? place.indoor : null, tiltStd_deg: sd,
      gasAlert: !!last?.gas?.alert, light_pct: summary?.light_pct ?? last?.light?.pct ?? null, gpsFix: !!summary?.gps.fix || !!pos, gpsAcc_m: summary?.gps.acc_m ?? null });
  }, [place, track, readings, mpuRef, summary, pos]);

  return (
    <section className="card analog-panel" style={{ marginTop: 16 }}>
      <h3>📊 {L("¿Qué tanto se parece y qué tanto sirve este lugar?", "How similar and how useful is this place?")}</h3>
      <p className="small-print muted">{L("Tres preguntas distintas, cada una con su fuente. Son referencias: no hay un lugar en la Tierra igual a Marte.", "Three different questions, each with its source. They are references: no place on Earth is Mars.")}</p>

      {/* 1 · analogía */}
      <h4>1 · {L("Parecido con", "Similarity to")} <span className="seg inline">
        <button aria-pressed={body === "mars"} onClick={() => setBody("mars")}>🔴 {L("Marte", "Mars")}</button>
        <button aria-pressed={body === "moon"} onClick={() => setBody("moon")}>🌕 {L("Luna", "Moon")}</button></span></h4>
      {!pos ? <p className="note">📍 {L("Falta la posición (GPS del celular) para bajar el clima del lugar de NASA POWER.", "Position missing (phone GPS) to get the place's climate from NASA POWER.")}</p>
        : powerErr ? <p className="note bad-note">⚠️ NASA POWER: {powerErr}</p>
        : !power || !ft.data ? <p className="muted">⏳ {L("Bajando la climatología de NASA POWER…", "Getting the NASA POWER climatology…")}</p>
        : best ? (
          <div>
            <div className="analog-big">
              <div><b className="big-num">{best.ifaRaw !== null ? pct(best.ifaRaw) : "—"}</b>
                <span className="small-print">{L("parecido climático con", "climate similarity to")} <b>{best.name}</b></span></div>
              <div className="small-print muted">{L("Cobertura", "Coverage")} {pct(best.coverage * 100)} · {best.ifa === null ? `⚠️ ${L("referencia, no puntaje oficial", "reference, not an official score")}: ${best.why}` : L("puntaje con cobertura suficiente", "score with enough coverage")}</div>
            </div>
            <table className="analog-table"><thead><tr><th>{L("Dimensión", "Dimension")}</th><th>{L("Este lugar", "This place")}</th><th>{body === "mars" ? L("Marte", "Mars") : L("Luna", "Moon")}</th><th>{L("Parecido", "Similarity")}</th></tr></thead>
              <tbody>
                {best.dims.map((d) => (
                  <tr key={d.id} title={`${d.xSource} · ${d.tSource}`}>
                    <td>{d.label}</td><td className="num">{fmt(d.x, d.unit, d.id)}<br /><span className="tag">{d.xStatus}</span></td>
                    <td className="num">{d.lo === d.hi ? fmt(d.lo, d.unit, d.id) : `${fmt(d.lo, d.unit, d.id)}–${fmt(d.hi, d.unit, d.id)}`}<br /><span className="tag">{d.tStatus}</span></td>
                    <td><div className="bar"><i style={{ width: `${Math.round(d.s * 100)}%` }} /></div>{pct(d.s * 100)}</td>
                  </tr>
                ))}
              </tbody></table>
            {best.gaps.map((g) => (
              <p key={g.id} className="note">🧭 <b>{g.label}</b>: {L("brecha que la Tierra no puede cerrar. Tu lugar recorrió", "a gap Earth cannot close. Your place went")} <b>{pct(g.po * 100)}</b> {L("del camino desde la Tierra típica hacia", "of the way from typical Earth toward")} {best.name} ({fmt(g.x, g.unit)} {L("vs", "vs")} {fmt(g.lo, g.unit)}–{fmt(g.hi, g.unit)}; {g.xSource}).</p>
            ))}
            <details className="small-print"><summary>{L("Otros objetivos y cómo se calcula", "Other targets and how it is computed")}</summary>
              <ul>{shown.map((s) => <li key={s.id}>{s.name}: {s.ifaRaw !== null ? pct(s.ifaRaw) : "—"} ({L("cobertura", "coverage")} {pct(s.coverage * 100)}){s.why ? ` · ${s.why}` : ""}</li>)}</ul>
              <p>{L("Misma matemática que nuestro motor: por dimensión s = exp(−½·(d/τ)²), d = distancia al rango del objetivo; se promedia con los pesos del motor. Clima del lugar: NASA POWER (climatología, corregida por elevación con 6,5 K/km); valores de Marte/Luna: papers y fichas oficiales citados en engine/seal/targets. Pesos y τ: decisiones nuestras (design). Sin pendiente, rugosidad, NDVI ni minerales la cobertura es baja: para el puntaje completo, usa “Calcular % de analogía con el motor”.",
                "Same math as our engine: per dimension s = exp(−½·(d/τ)²), d = distance to the target range; weighted with the engine's weights. Place climate: NASA POWER (climatology, elevation-corrected at 6.5 K/km); Mars/Moon values: papers and official fact sheets cited in engine/seal/targets. Weights and τ: our decisions (design). Without slope, roughness, NDVI or minerals coverage is low: for the full score use “Compute analogy % with the engine”.")}
                {" "}<a href={POWER_REF} target="_blank" rel="noreferrer">NASA POWER</a></p>
            </details>
          </div>
        ) : <p className="muted">{L("Sin objetivos con datos.", "No targets with data.")}</p>}

      {/* 2 · medido vs real */}
      <h4>2 · {L("¿Qué tan diferente es la caja de los datos reales?", "How different is the box from real data?")}</h4>
      {!summary ? <p className="muted small-print">{L("Mide 60 s (sección 4) para comparar.", "Measure 60 s (section 4) to compare.")}</p>
        : diffs.length === 0 ? <p className="muted small-print">{L("Faltan las referencias (necesita posición e internet).", "References missing (needs position and internet).")}</p>
        : (
          <table className="analog-table"><thead><tr><th>{L("Dato", "Data")}</th><th>{L("Caja", "Box")}</th><th>{L("Real (referencia)", "Real (reference)")}</th><th>{L("Diferencia", "Difference")}</th></tr></thead>
            <tbody>{diffs.map((d) => (
              <tr key={d.id} title={lang === "es" ? d.noteEs : d.noteEn}>
                <td>{lang === "es" ? d.es : d.en}</td><td className="num">{fmt(d.measured, d.unit)}</td>
                <td className="num">{fmt(d.ref, d.unit)}<br /><span className="tag">{d.refSrc}</span></td>
                <td className={d.ok ? "ok" : "warn"}>{d.diff > 0 ? "+" : ""}{fmt(d.diff, d.unit)} {d.ok ? `✓ ${L("dentro de", "within")} ±${d.tol}` : `⚠️ ${L("fuera de", "outside")} ±${d.tol}`}
                  <br /><span className="small-print muted">{lang === "es" ? d.noteEs : d.noteEn}</span></td>
              </tr>))}</tbody></table>
        )}
      {power && (
        <p className="small-print muted">{L("Clima promedio del lugar (NASA POWER, anual)", "Average climate here (NASA POWER, annual)")}: {power.t_mean_k !== null && fmt(power.t_mean_k, "K", "t_mean")} · RH {power.rh !== null ? fmt(power.rh, "%") : "—"} · {L("lluvia", "rain")} {power.precip_mm_y !== null ? fmt(power.precip_mm_y, "mm") : "—"}/{L("año", "yr")} · UV {power.uv !== null ? fmt(power.uv, "") : "—"}
          {summary?.t_c != null && power.t_mean_k !== null && ` · ${L("hoy la caja mide", "today the box reads")} ${(summary.t_c - (power.t_mean_k - 273.15) >= 0 ? "+" : "")}${(summary.t_c - (power.t_mean_k - 273.15)).toFixed(1)} °C ${L("respecto al promedio (un momento vs un año: no es error)", "vs the average (one moment vs a year: not an error)")}`}</p>
      )}

      {/* 3 · aptitud */}
      <h4>3 · {L("¿Qué tanto sirve para una prueba de rover?", "How useful is it for a rover test?")}</h4>
      <div className="analog-big">
        <div><b className="big-num">{fit.score !== null ? pct(fit.score) : "—"}</b><span className="small-print">{L("aptitud del lugar (con lo que se sabe:", "place suitability (with what is known:")} {pct(fit.coverage * 100)})</span></div>
        {fit.coverage < 0.7 && <div className="small-print warn">⚠️ {L("Incompleto: falta lo más importante (tamaño y suelo). Marca el lugar y el suelo, y camina el borde o da las medidas.", "Incomplete: the most important parts are missing (size and ground). Set the place and ground, and walk the edge or give measurements.")}</div>}
      </div>
      <ul className="fit-list">{fit.items.map((it) => (
        <li key={it.id}><span>{lang === "es" ? it.es : it.en}</span><div className="bar"><i style={{ width: `${Math.round((it.score ?? 0) * 100)}%`, opacity: it.score === null ? 0.2 : 1 }} /></div>
          <span className="small-print muted">{it.score === null ? "—" : pct(it.score * 100)} · {lang === "es" ? it.whyEs : it.whyEn}</span></li>))}</ul>
      <p className="small-print muted">{L("Pesos y umbrales de la aptitud: decisión nuestra (design) para elegir dónde probar el rover; no es un dato científico.", "Suitability weights and thresholds: our decision (design) to choose where to test the rover; not a scientific value.")}</p>
    </section>
  );
}
