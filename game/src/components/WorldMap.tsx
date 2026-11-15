// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Mapa mundial interactivo (SVG, sin internet): Equal Earth, zoom/arrastre/pellizco, marcadores accesibles.
import { useEffect, useMemo, useRef, useState } from "react";
import { geoEqualEarth, geoGraticule10, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import type { Discover, Result, SiteInfo } from "../data";
import { BOLIVIA, ramp, rampStops } from "../colors";
import { pct, num, COUNTRY_EN } from "../i18n";
import { useSettings } from "../settings";

const W = 960, H = 500;
const BOLIVIA_ID = "068";

type View = { k: number; x: number; y: number };

export interface MapProps {
  sites: SiteInfo[];
  results: Map<string, Result>;
  body: "mars" | "moon";
  selected: string | null;
  onSelect: (id: string) => void;
  heat: Discover | null;
  boliviaOnly: boolean;
  maxIfa: number;
}

export function WorldMap({ sites, results, body, selected, onSelect, heat, boliviaOnly, maxIfa }: MapProps) {
  const { t, lang } = useSettings();
  const projection = useMemo(() => geoEqualEarth().fitExtent([[8, 8], [W - 8, H - 8]], { type: "Sphere" } as any), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  const countries = useMemo(() => (feature(world as any, (world as any).objects.countries) as any).features as any[], []);
  const grat = useMemo(() => path(geoGraticule10()) ?? "", [path]);
  const sphere = useMemo(() => path({ type: "Sphere" } as any) ?? "", [path]);

  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ id: string; px: number; py: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; dist?: number; k?: number } | null>(null);

  const boliviaView = useMemo<View>(() => {
    const p = projection([-64.7, -16.8])!;
    const k = 7;
    return { k, x: W / 2 - p[0] * k, y: H / 2 - p[1] * k };
  }, [projection]);

  function toSvg(e: { clientX: number; clientY: number }) {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  function zoomAt(px: number, py: number, factor: number) {
    setView((v) => {
      const k = Math.max(1, Math.min(40, v.k * factor));
      const f = k / v.k;
      return clamp({ k, x: px - (px - v.x) * f, y: py - (py - v.y) * f });
    });
  }
  function clamp(v: View): View {
    const minX = W - W * v.k, minY = H - H * v.k;
    return { k: v.k, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
  }

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e);
      zoomAt(p.x, p.y, e.deltaY < 0 ? 1.25 : 0.8);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, toSvg(e));
    const pts = [...pointers.current.values()];
    if (pts.length === 1) drag.current = { x: pts[0].x, y: pts[0].y, vx: view.x, vy: view.y };
    if (pts.length === 2) drag.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, vx: view.x, vy: view.y,
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), k: view.k };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, toSvg(e));
    const d = drag.current;
    if (!d) return;
    const pts = [...pointers.current.values()];
    if (pts.length === 1) {
      setView((v) => clamp({ ...v, x: d.vx + pts[0].x - d.x, y: d.vy + pts[0].y - d.y }));
    } else if (pts.length === 2 && d.dist && d.k) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = Math.max(1, Math.min(40, d.k * (dist / d.dist)));
      const f = k / d.k;
      setView(clamp({ k, x: d.x - (d.x - d.vx) * f, y: d.y - (d.y - d.vy) * f }));
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    drag.current = null;
  }

  const shown = sites.filter((s) => s.processed && s.lat !== null && (!boliviaOnly || s.country === "Bolivia"));
  const r0 = 6 / Math.sqrt(view.k);
  const stroke = 1.4 / view.k;

  const heatCells = useMemo(() => {
    if (!heat) return [];
    const st = heat.step_deg / 2;
    const max = Math.max(1, ...heat.cells.map((c) => c.ifa ?? 0));
    return heat.cells.filter((c) => c.ifa !== null).map((c) => {
      const pts = [[c.lon - st, c.lat - st], [c.lon + st, c.lat - st], [c.lon + st, c.lat + st], [c.lon - st, c.lat + st]]
        .map((p) => projection(p as [number, number])!);
      return { d: `M${pts.map((p) => p.join(",")).join("L")}Z`, fill: ramp("mars", (c.ifa ?? 0) / max), c };
    });
  }, [heat, projection]);

  const hs = hover ? sites.find((s) => s.id === hover.id) : null;
  const hr = hover ? results.get(hover.id) : undefined;

  return (
    <div className="map-wrap">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("map.title")}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <defs>
          <radialGradient id="ocean" cx="50%" cy="45%" r="70%">
            <stop offset="0%" stopColor="#0d1c38" /><stop offset="100%" stopColor="#060c1a" />
          </radialGradient>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <path d={sphere} fill="url(#ocean)" stroke="#2a3658" strokeWidth={stroke} />
          <path d={grat} fill="none" stroke="#1b2747" strokeWidth={0.6 / view.k} />
          {countries.map((c) => (
            <path key={c.id ?? c.properties?.name} d={path(c) ?? ""} fill={c.id === BOLIVIA_ID ? "#2b3352" : "#1a2440"}
              stroke={c.id === BOLIVIA_ID ? BOLIVIA : "#33416a"} strokeWidth={(c.id === BOLIVIA_ID ? 1.6 : 0.5) / view.k} />
          ))}
          {heatCells.map((h, i) => (
            <path key={i} d={h.d} fill={h.fill} opacity={0.85} stroke="none">
              <title>{`${num(lang, h.c.lat, 2)}, ${num(lang, h.c.lon, 2)} · IFA ${num(lang, h.c.ifa, 0)}`}</title>
            </path>
          ))}
          {shown.map((s) => {
            const p = projection([s.lon!, s.lat!]);
            if (!p) return null;
            const r = results.get(s.id);
            const v = r?.ifa ?? null;
            const fill = v === null ? "transparent" : ramp(body, v / Math.max(1, maxIfa));
            const outline = s.country === "Bolivia" ? BOLIVIA : "#e8eefc";
            const sel = selected === s.id;
            const size = (sel ? 1.6 : 1) * r0;
            const common = {
              fill, stroke: v === null ? "#8e9bb8" : outline, strokeWidth: (sel ? 2.4 : 1.3) / view.k,
              strokeDasharray: v === null ? `${2 / view.k} ${1.5 / view.k}` : undefined,
            };
            const label = `${s.name}, ${lang === "en" ? COUNTRY_EN[s.country] ?? s.country : s.country}. ${t(`role.${s.role}`)}. IFA ${num(lang, v, 0)}`;
            return (
              <g key={s.id} transform={`translate(${p[0]},${p[1]})`} tabIndex={0} role="button" aria-label={label} aria-pressed={sel}
                style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); onSelect(s.id); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.id); } }}
                onPointerEnter={() => setHover({ id: s.id, px: p[0] * view.k + view.x, py: p[1] * view.k + view.y })}
                onPointerLeave={() => setHover(null)} onPointerDown={(e) => e.stopPropagation()}>
                {s.role === "control_pos" ? (
                  <path d={`M0,${-size * 1.25}L${size * 1.1},${size * 0.75}L${-size * 1.1},${size * 0.75}Z`} {...common} />
                ) : s.role === "control_neg" ? (
                  <rect x={-size * 0.9} y={-size * 0.9} width={size * 1.8} height={size * 1.8} {...common} />
                ) : (
                  <circle r={size} {...common} />
                )}
                {sel && <circle r={size * 2.2} fill="none" stroke="#ffd166" strokeWidth={1.5 / view.k} />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="map-tools">
        <button className="btn small" onClick={() => setView({ k: 1, x: 0, y: 0 })}>🌍 {t("map.zoom.world")}</button>
        <button className="btn small" onClick={() => setView(boliviaView)}>🇧🇴 {t("map.zoom.bolivia")}</button>
        <button className="btn small" aria-label={t("map.zoom.in")} onClick={() => zoomAt(W / 2, H / 2, 1.6)}>＋</button>
        <button className="btn small" aria-label={t("map.zoom.out")} onClick={() => zoomAt(W / 2, H / 2, 0.625)}>－</button>
      </div>
      {hs && hover && (
        <div className="tooltip" style={{ left: `${(hover.px / W) * 100}%`, top: `${(hover.py / H) * 100}%`, transform: "translate(12px, -110%)" }}>
          <strong>{hs.name}</strong><br />
          <span className="muted">{lang === "en" ? COUNTRY_EN[hs.country] ?? hs.country : hs.country} · {t(`role.${hs.role}`)}</span><br />
          IFA {num(lang, hr?.ifa ?? null, 0)} · {t("rank.col.cov")} {pct(lang, hr?.coverage)}
        </div>
      )}
      <div className="map-legend" aria-label="legend">
        <span>{t("map.legend.ifa")}</span>
        <span style={{ display: "inline-flex", height: 10, width: 120, borderRadius: 99, background: `linear-gradient(90deg, ${rampStops(body).join(",")})` }} />
        <span className="muted">0 → {num(lang, maxIfa, 0)}</span>
        <span>● {t("map.legend.candidate")}</span><span>▲ {t("map.legend.control_pos")}</span><span>■ {t("map.legend.control_neg")}</span>
        <span style={{ color: "#ffd59a" }}>◯ Bolivia</span>
        <span className="muted">◌ {t("map.legend.nodata")}</span>
      </div>
    </div>
  );
}
