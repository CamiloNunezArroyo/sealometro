// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Constructor del lugar jugable: perímetro caminado (GPS), cancha de OpenStreetMap, escaneo 3D (archivo) o medidas a mano
// → arena → juego. Las fotos y videos SÍ cambian el mapa: análisis propio de cada imagen (station/sceneFromPhotos.ts)
// para el piso, las paredes (panorámica), el techo y los muebles; al aire libre, el GPS trae el alrededor real de
// OpenStreetMap y el relieve de Open-Meteo (station/osm.ts). Todo se muestra en el panel "Lo que entendimos".
import { useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";
import { useSettings } from "../settings";
import { cellOf, fromBox, fromLocal, fromPolygon, idx, placeProps, polygonArea, posOf, simplify, sizeCheck, toLocal, type ArenaSpec, type Poi } from "../game/core/arena";
import type { ArenaRuntime, Gravity } from "../game/engine";
import type { Mode } from "../game/core/world";
import type { Floor, Media, Place, ScanMeta, TrackPt } from "../station/types";
import type { Summary } from "../station/field";
import { FLOORS } from "./PhonePage";
import { combineScenes, FLOOR_OF, panoramaPlan, propCount, type FloorGuess, type PhotoScene, type RGB } from "../station/sceneFromPhotos";
import { ELEV_ATTRIBUTION, OSM_ATTRIBUTION, parseOsm, pitchAt, surfaceFloor, type ElevRing, type OsmJson, type OsmScene } from "../station/osm";

export interface PlayRequest { runtime: ArenaRuntime; preview: string; mode: Mode; gravity: Gravity; center: { lat: number; lon: number } | null; name: string }

/** Dibuja la arena vista desde arriba (también sirve de fondo del minimapa). */
export function drawArena(spec: ArenaSpec, ground: [number, number, number] | undefined, px = 512): string {
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(px, px);
  const g = ground ?? [160, 156, 148];
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const i = Math.round((x / (px - 1)) * (spec.n - 1)), j = Math.round((y / (px - 1)) * (spec.n - 1));
    const b = spec.blocked[idx(spec, i, j)], k = (y * px + x) * 4;
    const col = b ? [28, 32, 40] : g;
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // muebles de juego (si hay) en marrón, para que se vean en el plano
  for (const p of spec.props ?? []) {
    const s = px / spec.size, w = (p.rot ? p.l : p.w) * s, l = (p.rot ? p.w : p.l) * s;
    ctx.fillStyle = "#8a6a48";
    ctx.fillRect((p.x + spec.size / 2) * s - w / 2, (p.z + spec.size / 2) * s - l / 2, w, l);
  }
  return c.toDataURL("image/png");
}

const FLOOR_NAME: Record<FloorGuess, { es: string; en: string }> = {
  baldosa: { es: "baldosa", en: "tiles" }, cemento: { es: "cemento", en: "concrete" }, pasto: { es: "pasto", en: "grass" },
  tierra: { es: "tierra", en: "dirt" }, arena: { es: "arena", en: "sand" },
};
const rgbCss = (c: RGB) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;
type Geo = { lat: number; lon: number; from: "track" | "caja" | "fotos" };
type OsmState = { key: string; status: "loading" | "ok" | "error"; raw?: OsmJson; elev?: ElevRing | null; err?: string };
type Built = { s: ArenaSpec; object?: THREE.Object3D; center: { lat: number; lon: number } | null; origin: { lat: number; lon: number } | null;
  walls?: ArenaRuntime["walls"]; floorImage?: string; contour: "track" | "osm" | "medidas" | "escaneo" };

export function ArenaBuilder({ place, track, media, summary, boxGps, onPlay, scans = [], fetchScan }: {
  place: Place | null; track: TrackPt[]; media: [string, Media][]; summary: Summary | null; boxGps: { lat: number; lon: number } | null;
  onPlay: (r: PlayRequest) => void;
  scans?: [string, ScanMeta][]; fetchScan?: (id: string) => Promise<File>;
}) {
  const { lang } = useSettings();
  const L = (es: string, en: string) => (lang === "es" ? es : en);
  const outdoor = place ? !place.indoor : true;
  const [source, setSource] = useState<"perimetro" | "cancha" | "escaneo" | "medidas">(track.length >= 3 && outdoor ? "perimetro" : "medidas");
  const [floor, setFloor] = useState<Floor>(place?.floor ?? (outdoor ? "cemento" : "interior"));
  const floorTouched = useRef(!!place?.floor);
  const [dims, setDims] = useState({ w: place?.width_m ?? 30, l: place?.length_m ?? 20, h: place?.height_m ?? 6 });
  const [scan, setScan] = useState<{ obj: THREE.Object3D; name: string } | null>(null);
  const [zUp, setZUp] = useState(false);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [spec, setSpec] = useState<Built | null>(null);
  const [mode, setMode] = useState<Mode>("mission");
  const [gravity, setGravity] = useState<Gravity>("mars");
  const [useWalls, setUseWalls] = useState(true);
  const [useFloorPhoto, setUseFloorPhoto] = useState(true);
  const [useProps, setUseProps] = useState(true);
  const cv = useRef<HTMLImageElement>(null);
  const photos = useMemo(() => media.filter(([, m]) => m.kind === "photo" || m.idx === 0), [media]);

  // ---------------------------------------------------------------- análisis de cada foto y fotograma
  const [scenes, setScenes] = useState<Map<string, PhotoScene>>(new Map());
  const [analyzing, setAnalyzing] = useState(false);
  const pending = useRef(new Set<string>()), failed = useRef(new Set<string>());
  const toAnalyze = useMemo(() => media.slice(-24), [media]);
  useEffect(() => {
    const todo = toAnalyze.filter(([id]) => !scenes.has(id) && !pending.current.has(id) && !failed.current.has(id));
    if (!todo.length) return;
    todo.forEach(([id]) => pending.current.add(id));
    setAnalyzing(true);
    (async () => {
      const { analyzeImage } = await import("../station/sceneFromPhotos");
      for (const [id, m] of todo) {
        let sc: PhotoScene | null = null;
        try { sc = await analyzeImage(m.data); } catch { failed.current.add(id); /* imagen ilegible */ }
        pending.current.delete(id);
        if (sc) setScenes((prev) => new Map(prev).set(id, sc!));
      }
      if (!pending.current.size) setAnalyzing(false);
    })();
  }, [toAnalyze]); // eslint-disable-line react-hooks/exhaustive-deps
  const analyzed = useMemo(() => toAnalyze.filter(([id]) => scenes.has(id)).map(([id, m]) => ({ id, m, sc: scenes.get(id)! })), [toAnalyze, scenes]);
  const total = useMemo(() => combineScenes(analyzed.map((a) => a.sc)), [analyzed]);
  const pano = useMemo(() => panoramaPlan(analyzed.map(({ id, m }) => ({ id, data: m.data, t: m.t, video: m.video, idx: m.idx, kind: m.kind }))), [analyzed]);
  const groundCol = total?.palette.floor;
  // piso sugerido por las fotos: se aplica solo si nadie eligió el piso a mano
  useEffect(() => {
    if (total && !floorTouched.current && total.floor.conf >= 0.4) setFloor(FLOOR_OF[total.floor.kind]);
  }, [total]);
  const pickFloor = (f: Floor) => { floorTouched.current = true; setFloor(f); };
  const indoorGuess = place?.indoor ?? total?.indoor.value ?? true;

  // ---------------------------------------------------------------- GPS → OpenStreetMap + relieve
  const geo: Geo | null = useMemo(() => {
    if (track.length >= 3) return { lat: track.reduce((a, p) => a + p.lat, 0) / track.length, lon: track.reduce((a, p) => a + p.lon, 0) / track.length, from: "track" };
    if (boxGps) return { ...boxGps, from: "caja" };
    const g = media.filter(([, m]) => m.lat !== undefined && m.lon !== undefined);
    if (g.length) return { lat: g.reduce((a, [, m]) => a + m.lat!, 0) / g.length, lon: g.reduce((a, [, m]) => a + m.lon!, 0) / g.length, from: "fotos" };
    return null;
  }, [track, boxGps, media]);
  const geoKey = geo ? `${geo.lat.toFixed(4)},${geo.lon.toFixed(4)}` : "";
  const wantOsm = !!geo && place?.indoor !== true;
  const [osm, setOsm] = useState<OsmState | null>(null);
  const loadOsm = (force = false) => {
    if (!geo || (!force && osm?.key === geoKey && osm.status !== "error")) return;
    const key = geoKey;
    setOsm({ key, status: "loading" });
    (async () => {
      const { fetchOsm, fetchElevation } = await import("../station/osm");
      const mine = (o: OsmState | null) => !!o && o.key === key;
      fetchElevation(geo.lat, geo.lon).then((elev) => setOsm((o) => (mine(o) ? { ...o!, elev } : o)));
      try {
        const raw = await fetchOsm(geo.lat, geo.lon, 220);
        setOsm((o) => (mine(o) ? { ...o!, status: "ok", raw } : o));
      } catch (e) { setOsm((o) => (mine(o) ? { ...o!, status: "error", err: String(e) } : o)); }
    })();
  };
  useEffect(() => { if (wantOsm) loadOsm(); }, [geoKey, wantOsm]); // eslint-disable-line react-hooks/exhaustive-deps
  const around: OsmScene | null = useMemo(() => (osm?.raw && geo ? parseOsm(osm.raw, geo.lat, geo.lon) : null), [osm, geo]);
  const pitch = useMemo(() => (around ? pitchAt(around, 0, 0) : null), [around]);
  useEffect(() => { // cancha detectada y sin perímetro caminado: se ofrece (y se elige) su contorno
    if (pitch && track.length < 3 && source === "medidas" && outdoor) setSource("cancha");
    if (pitch && !floorTouched.current && surfaceFloor(pitch.surface) && !total) setFloor(surfaceFloor(pitch.surface)!);
  }, [pitch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- armar el mapa
  const build = async () => {
    setBusy(L("Armando el mapa…", "Building the map…"));
    await new Promise((r) => setTimeout(r, 30));
    try {
      const elev0 = summary?.gps.alt_m ?? 0;
      const name = place?.name || (lang === "es" ? "Nuestro lugar" : "Our place");
      let out: Built | null = null;
      if (source === "perimetro") {
        const lat0 = track[0].lat, lon0 = track[0].lon;
        let pts = simplify(track.map((p) => toLocal(lat0, lon0, p.lat, p.lon)), 2);
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        pts = pts.map(([x, z]) => [x - cx, z - cz]);
        // fromPolygon centra por la caja que lo encierra: se hace aquí mismo para que fotos, caja y OSM queden en el mismo sistema
        const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
        const bx = (Math.min(...xs) + Math.max(...xs)) / 2, bz = (Math.min(...zs) + Math.max(...zs)) / 2;
        pts = pts.map(([x, z]) => [x - bx, z - bz]);
        const s = fromPolygon(pts, { name, indoor: false, floor, source: "polygon", elev0 });
        // fotos con GPS → puntos de interés donde se tomaron; la caja → estación
        const local = (lat: number, lon: number) => { const [x, z] = toLocal(lat0, lon0, lat, lon); return { x: x - cx - bx, z: z - cz - bz }; };
        s.pois = photos.filter(([, m]) => m.lat !== undefined).slice(0, 6).map(([, m], k) => ({ ...local(m.lat!, m.lon!), label: `📷 ${k + 1}`, photo: m.data }));
        if (boxGps) s.station = local(boxGps.lat, boxGps.lon);
        const [olat, olon] = fromLocal(lat0, lon0, cx + bx, cz + bz);
        out = { s, center: { lat: lat0, lon: lon0 }, origin: { lat: olat, lon: olon }, contour: "track" };
      } else if (source === "cancha" && pitch && geo) {
        const xs = pitch.poly.map((p) => p[0]), zs = pitch.poly.map((p) => p[1]);
        const bx = (Math.min(...xs) + Math.max(...xs)) / 2, bz = (Math.min(...zs) + Math.max(...zs)) / 2;
        const s = fromPolygon(pitch.poly.map(([x, z]) => [x - bx, z - bz]), { name: pitch.name || name, indoor: false, floor, source: "polygon", elev0 });
        const local = (lat: number, lon: number) => { const [x, z] = toLocal(geo.lat, geo.lon, lat, lon); return { x: x - bx, z: z - bz }; };
        s.pois = photos.filter(([, m]) => m.lat !== undefined).slice(0, 6).map(([, m], k) => ({ ...local(m.lat!, m.lon!), label: `📷 ${k + 1}`, photo: m.data }));
        if (boxGps) s.station = local(boxGps.lat, boxGps.lon);
        const [olat, olon] = fromLocal(geo.lat, geo.lon, bx, bz);
        out = { s, center: { lat: geo.lat, lon: geo.lon }, origin: { lat: olat, lon: olon }, contour: "osm" };
      } else if (source === "medidas") {
        const s = fromBox(dims.w, dims.l, { name, indoor: place?.indoor ?? indoorGuess, floor, wallH: dims.h, elev0 });
        s.pois = ringPois(s, photos.map(([, m]) => m.data));
        out = { s, center: boxGps, origin: geo, contour: "medidas" };
      } else if (scan) {
        const { scanToArena } = await import("../station/scan");
        const { spec: s, object } = scanToArena(scan.obj, zUp, scale, { name, indoor: place?.indoor ?? indoorGuess, floor, elev0 });
        s.pois = ringPois(s, photos.map(([, m]) => m.data));
        out = { s, object, center: boxGps, origin: geo, contour: "escaneo" };
      }
      if (out) {
        const s = out.s, { cropBand, floorPatch } = await import("../station/sceneFromPhotos");
        // muebles de juego: cuántos según los bordes de las fotos (bajo techo y sin escaneo, que ya trae los suyos)
        if (s.indoor && s.source !== "scan" && useProps && total) placeProps(s, propCount(total.clutter, sizeCheck(s).area), 7);
        // paredes = franja media de cada foto/fotograma en su dirección
        if (s.indoor && s.source !== "scan" && useWalls && pano.parts.length) {
          out.walls = await Promise.all(pano.parts.map(async (p) => ({ image: await cropBand(p.data, 0.06, 0.7), a0: p.a0, a1: p.a1 })));
        }
        // piso: recorte real de la foto que más "parece" el piso elegido (y con buena luz)
        const kind = (Object.keys(FLOOR_OF) as FloorGuess[]).find((k) => FLOOR_OF[k] === floor);
        if (useFloorPhoto && kind && s.source !== "scan" && floor !== "interior") { // baldosas: mejor la cuadrícula dibujada con el color medido (un recorte en perspectiva las deforma)
          const best = analyzed.filter((a) => a.sc.light.value > 60 && a.sc.bottom.edges < 0.65).sort((p, q) => q.sc.floor.scores[kind] - p.sc.floor.scores[kind])[0];
          if (best && best.sc.floor.scores[kind] > 0.25) out.floorImage = await floorPatch(best.m.data);
        }
        setSpec(out);
      }
    } catch (e) { alert(String(e)); }
    setBusy(null);
  };
  const check = spec ? sizeCheck(spec.s) : null;
  const preview = useMemo(() => (spec ? drawArena(spec.s, groundCol) : ""), [spec, groundCol]);
  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(L("Leyendo el escaneo…", "Reading the scan…"));
    try { const { loadScan } = await import("../station/scan"); setScan({ obj: await loadScan(f), name: f.name }); setSpec(null); }
    catch (e) { alert(String(e)); }
    setBusy(null);
  };
  const trackArea = track.length >= 3 ? polygonArea(simplify(track.map((p) => toLocal(track[0].lat, track[0].lon, p.lat, p.lon)), 2)) : 0;

  /** Arma lo que necesita el juego, con el texto honesto de dónde sale cada cosa. */
  const runtime = (b: Built): ArenaRuntime => {
    const s = b.s, osmHere = !s.indoor && osm?.raw && b.origin ? parseOsm(osm.raw, b.origin.lat, b.origin.lon) : undefined;
    const elev = !s.indoor && osm?.elev ? osm.elev : undefined;
    const contour = { track: L("contorno: GPS caminado", "outline: walked GPS"), osm: L("contorno: cancha de OpenStreetMap", "outline: OpenStreetMap pitch"),
      medidas: L("forma: medidas del equipo", "shape: team measurements"), escaneo: L("forma: escaneo 3D del equipo", "shape: team 3D scan") }[b.contour];
    const parts = [contour];
    if (b.walls?.length) parts.push(L("paredes: tus fotos", "walls: your photos"));
    parts.push(b.floorImage ? L("piso: recorte de tu foto", "floor: crop of your photo") : groundCol ? L("piso: color de tus fotos", "floor: color from your photos") : L("piso: de juego", "floor: game texture"));
    if (s.props?.length) parts.push(L(`${s.props.length} muebles: cantidad según tus fotos`, `${s.props.length} props: count from your photos`));
    if (osmHere && osmHere.counts.buildings + osmHere.counts.trees + osmHere.counts.pitches + osmHere.counts.roads >= 3) parts.push(L("alrededor: © OpenStreetMap", "surroundings: © OpenStreetMap"));
    else if (!s.indoor) parts.push(L("alrededor: de juego", "surroundings: game"));
    if (elev) parts.push(L("relieve: Open-Meteo", "relief: Open-Meteo"));
    parts.push(L("resto y misión: de juego", "rest and mission: game"));
    return { spec: s, scan: b.object, wallPhotos: photos.map(([, m]) => m.data), ground: groundCol, walls: b.walls, floorImage: b.floorImage,
      palette: total ? { wall: total.palette.wall, ceiling: total.palette.ceiling } : undefined, osm: osmHere, elev: elev ?? undefined, note: parts.join(" · ") };
  };

  const rt = useMemo(() => (spec ? runtime(spec) : null), [spec, osm, total, groundCol, photos, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="arena-builder">
      <div className="seg" role="group">
        <button aria-pressed={source === "perimetro"} disabled={track.length < 3} onClick={() => setSource("perimetro")}>🚶 {L("Perímetro GPS", "GPS perimeter")}</button>
        {pitch && outdoor && <button aria-pressed={source === "cancha"} onClick={() => setSource("cancha")}>🏟️ {L("Cancha de OSM", "OSM pitch")}</button>}
        <button aria-pressed={source === "escaneo"} onClick={() => setSource("escaneo")}>🧊 {L("Escaneo 3D", "3D scan")}</button>
        <button aria-pressed={source === "medidas"} onClick={() => setSource("medidas")}>📏 {L("Medidas", "Measurements")}</button>
      </div>
      {source === "perimetro" && <p className="small-print muted">{track.length} {L("puntos caminados con el celular", "points walked with the phone")} · ≈ {Math.round(trackArea)} m². {L("Al aire libre, con precisión GPS de ±5-10 m: sirve para lugares de 30 m o más.", "Outdoors, with ±5-10 m GPS accuracy: good for places of 30 m or more.")}</p>}
      {source === "cancha" && pitch && <p className="small-print muted">{L("Contorno de la cancha dibujada en OpenStreetMap donde está el GPS", "Outline of the OpenStreetMap pitch where the GPS is")}: {pitch.name ?? pitch.sport ?? pitch.kind} · ≈ {Math.round(pitch.area)} m²{pitch.surface ? ` · ${L("superficie", "surface")}: ${pitch.surface}` : ""}. {L("Es el dibujo de voluntarios de OSM, no una medición nuestra.", "It is drawn by OSM volunteers, not measured by us.")}</p>}
      {source === "medidas" && (
        <div className="row dims">
          <label>{L("Largo", "Length")} <input type="number" min={2} value={dims.w} onChange={(e) => setDims({ ...dims, w: +e.target.value })} /> m</label>
          <label>{L("Ancho", "Width")} <input type="number" min={2} value={dims.l} onChange={(e) => setDims({ ...dims, l: +e.target.value })} /> m</label>
          <label>{L("Alto", "Height")} <input type="number" min={2} value={dims.h} onChange={(e) => setDims({ ...dims, h: +e.target.value })} /> m</label>
        </div>
      )}
      {source === "escaneo" && (
        <div>
          <p className="small-print muted">{L("La página no puede usar el LiDAR directamente (Safari no lo permite). Escanea con la app gratis Scaniverse (iPhone o Android), exporta en GLB u OBJ y súbelo aquí.",
            "The page cannot use LiDAR directly (Safari does not allow it). Scan with the free Scaniverse app (iPhone or Android), export as GLB or OBJ and upload it here.")}</p>
          {scans.length > 0 && (
            <div className="scan-list">
              <b className="small-print">📱 {L("Escaneos subidos desde el celular:", "Scans uploaded from the phone:")}</b>
              {scans.map(([id, s]) => (
                <div key={id} className="row small-print">
                  <span>{s.name} · {(s.bytes / 1048576).toFixed(1)} MB · {s.done ? "✓" : `⏳ ${Math.round(((s.sent ?? 0) / s.chunks) * 100)} %`}</span>
                  <button className="btn small" disabled={!s.done || !fetchScan || !!busy}
                    onClick={async () => { setBusy(L("Bajando el escaneo…", "Downloading the scan…")); try { await loadFile(await fetchScan!(id)); } catch (e) { alert(String(e)); setBusy(null); } }}>
                    {L("Usar", "Use")}</button>
                </div>
              ))}
            </div>
          )}
          <label className="btn">📂 {L("Elegir archivo (.glb .gltf .obj .ply)", "Choose file (.glb .gltf .obj .ply)")}<input hidden type="file" accept=".glb,.gltf,.obj,.ply" onChange={(e) => loadFile(e.target.files?.[0])} /></label>
          {scan && <span className="small-print"> ✓ {scan.name}</span>}
          <div className="row dims">
            <label><input type="checkbox" checked={zUp} onChange={(e) => setZUp(e.target.checked)} /> {L("El modelo viene con Z hacia arriba", "Model has Z up")}</label>
            <label>{L("Escala", "Scale")} <input type="number" step={0.1} min={0.01} value={scale} onChange={(e) => setScale(+e.target.value)} /> × ({L("1 = metros", "1 = meters")})</label>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ lo que entendimos de las fotos y del GPS */}
      <details className="scene-panel" open>
        <summary>🔎 {L("Lo que entendimos de tus fotos y del GPS", "What we understood from your photos and GPS")}</summary>
        <p className="small-print muted">{L("Análisis automático simple, sin IA: cada foto se parte en 3 franjas (arriba = techo o cielo, medio = paredes, abajo = piso) y se miden colores, brillo, bordes, verde, cielo y líneas repetidas (baldosas). Puede equivocarse con sombras, gente o luz rara: corrige el piso con los botones de abajo.",
          "Simple automatic analysis, no AI: each photo is split in 3 bands (top = ceiling or sky, middle = walls, bottom = floor) and we measure colors, brightness, edges, green, sky and repeated lines (tiles). It can be wrong with shadows, people or odd light: fix the floor with the buttons below.")}</p>
        {!media.length && <p className="small-print">📷 {L("Todavía no hay fotos ni videos. Desde el celular: fotos del piso y las paredes, y un video girando despacio en el centro del lugar (≈ 10 s).", "No photos or videos yet. From the phone: photos of the floor and walls, and a video turning slowly in the middle of the place (≈ 10 s).")}</p>}
        {analyzing && <p className="small-print">⏳ {L("Analizando fotos…", "Analyzing photos…")}</p>}
        {analyzed.length > 0 && (
          <div className="scene-grid">
            {analyzed.map(({ id, m, sc }) => (
              <figure key={id}>
                <div className="scene-thumb"><img src={m.data} alt="" /><i style={{ top: "30%" }} /><i style={{ top: "62%" }} /></div>
                <figcaption>
                  {m.kind === "frame" ? `🎥 ${(m.idx ?? 0) + 1}/${m.of ?? "?"}` : "📷"} <b>{FLOOR_NAME[sc.floor.kind][lang]}</b> {Math.round(sc.floor.conf * 100)} %
                  <span className="swatch" style={{ background: rgbCss(sc.bottom.dom) }} title={L("piso", "floor")} />
                  <span className="swatch" style={{ background: rgbCss(sc.mid.dom) }} title={L("pared", "wall")} />
                  <span className="swatch" style={{ background: rgbCss(sc.top.dom) }} title={L("techo/cielo", "ceiling/sky")} />
                  <br />{sc.indoor.value ? `🏠 ${L("interior", "indoor")}` : `🌤️ ${L("exterior", "outdoor")}`} · 💡 {{ oscuro: L("oscuro", "dark"), medio: L("luz media", "medium light"), brillante: L("brillante", "bright") }[sc.light.level]}
                  <br />🪑 {{ pocos: L("pocos objetos", "few objects"), algunos: L("algunos objetos", "some objects"), muchos: L("muchos objetos", "many objects") }[sc.clutter.level]}
                  <span className="muted"> · {L("verde", "green")} {Math.round(sc.bottom.green * 100)} % · {L("líneas", "lines")} {sc.tile.toFixed(2)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {total && (
          <div className="scene-sum small-print">
            <p>🧮 <b>{L("En total", "Overall")}</b> ({total.n} {L("imágenes", "images")}): {L("piso", "floor")} <b>{FLOOR_NAME[total.floor.kind][lang]}</b> ({Math.round(total.floor.conf * 100)} %) ·
              {total.indoor.value ? ` 🏠 ${L("parece interior", "looks indoor")}` : ` 🌤️ ${L("parece exterior", "looks outdoor")}`} ({Math.round(total.indoor.conf * 100)} %) ·
              💡 {Math.round(total.light)}/255 · 🪑 {L("objetos", "objects")} {Math.round(total.clutter * 100)} %
              {FLOOR_OF[total.floor.kind] !== floor && <button className="btn small" style={{ marginLeft: 8 }} onClick={() => pickFloor(FLOOR_OF[total.floor.kind])}>{L("Usar piso sugerido", "Use suggested floor")}</button>}</p>
            {place && place.indoor !== total.indoor.value && total.indoor.conf > 0.65 && <p className="warn">⚠️ {total.indoor.value ? L("Las fotos parecen de un lugar cerrado, pero el lugar está marcado al aire libre.", "The photos look indoor, but the place is marked outdoor.") : L("Las fotos parecen de afuera, pero el lugar está marcado como cerrado.", "The photos look outdoor, but the place is marked indoor.")}</p>}
            {indoorGuess && (
              <p>🧱 {pano.source === "video" ? L(`Panorámica: video de ${pano.parts.length} fotogramas → ${pano.parts.length} tramos de pared de ${Math.round(360 / pano.parts.length)}° cada uno (el 1.º mira al norte del mapa; no hay brújula, es una suposición).`,
                `Panorama: video with ${pano.parts.length} frames → ${pano.parts.length} wall sections of ${Math.round(360 / pano.parts.length)}° each (the 1st faces map north; no compass, it is an assumption).`)
                : pano.source === "photos" ? L(`Sin video girando: las ${photos.length} fotos se reparten por las paredes en orden de toma${photos.length < 4 ? " (repetidas para cubrir las 4 paredes)" : ""}.`, `No turning video: the ${photos.length} photos are spread over the walls in shooting order${photos.length < 4 ? " (repeated to cover the 4 walls)" : ""}.`)
                : L("Sin fotos para las paredes.", "No photos for the walls.")}</p>
            )}
            <div className="row dims">
              {indoorGuess && <label><input type="checkbox" checked={useWalls} onChange={(e) => setUseWalls(e.target.checked)} /> {L("Paredes con mis fotos", "Walls from my photos")}</label>}
              <label><input type="checkbox" checked={useFloorPhoto} onChange={(e) => setUseFloorPhoto(e.target.checked)} /> {L("Textura real del piso (el pedazo más parejo de una foto; en baldosas se dibuja la cuadrícula con su color)", "Real floor texture (the most even patch of a photo; tiles are drawn as a grid with their color)")}</label>
              {indoorGuess && <label><input type="checkbox" checked={useProps} onChange={(e) => setUseProps(e.target.checked)} /> {L("Muebles según las fotos (cantidad; posición de juego)", "Props from the photos (count; game positions)")}</label>}
            </div>
          </div>
        )}
        {/* GPS + OpenStreetMap */}
        {place?.indoor === true ? <p className="small-print muted">🏠 {L("Lugar cerrado: el mapa sale de las fotos (el GPS no ve las paredes).", "Indoor place: the map comes from the photos (GPS cannot see walls).")}</p>
          : !geo ? <p className="small-print muted">📍 {L("Sin GPS todavía (caja, celular o fotos con ubicación): el alrededor será de juego.", "No GPS yet (box, phone or geotagged photos): the surroundings will be game elements.")}</p>
          : (
            <div className="osm-box small-print">
              <p>📍 GPS {geo.lat.toFixed(5)}, {geo.lon.toFixed(5)} ({{ track: L("perímetro caminado", "walked perimeter"), caja: L("caja o celular", "box or phone"), fotos: L("fotos", "photos") }[geo.from]}) ·
                {osm?.status === "loading" && ` ⏳ ${L("consultando OpenStreetMap (puede tardar hasta 1 min)…", "querying OpenStreetMap (may take up to 1 min)…")}`}
                {osm?.status === "error" && <> ⚠️ {L("OpenStreetMap (Overpass) no respondió: sin internet o servidores saturados. El alrededor será de juego; prueba «Reintentar» en un rato.", "OpenStreetMap (Overpass) did not answer: no internet or busy servers. Surroundings will be game elements; try “Retry” later.")} <button className="btn small" onClick={() => loadOsm(true)}>{L("Reintentar", "Retry")}</button></>}
                {around && <> 🗺️ <b>{around.counts.buildings}</b> {L("edificios", "buildings")} ({around.counts.withHeight} {L("con altura en OSM", "with height in OSM")}), <b>{around.counts.trees}</b> {L("árboles", "trees")}, {around.counts.green} {L("zonas verdes", "green areas")}, {around.counts.pitches} {L("canchas", "pitches")}, {around.counts.roads} {L("calles/caminos", "streets/paths")}{around.counts.water ? `, ${around.counts.water} ${L("agua", "water")}` : ""}</>}</p>
              {around && pitch && <p className="ok">🏟️ {L("El GPS cae dentro de una cancha de OSM", "The GPS is inside an OSM pitch")}: {pitch.name ?? pitch.sport ?? pitch.kind} (≈ {Math.round(pitch.area)} m²{pitch.surface ? `, ${pitch.surface}` : ""}). {track.length < 3 ? L("Puedes usar su contorno (botón «Cancha de OSM»).", "You can use its outline (“OSM pitch” button).") : ""}</p>}
              {osm?.elev && <p>⛰️ {L("Relieve alrededor (hasta 800 m)", "Relief around (up to 800 m)")}: {Math.round(osm.elev.center)} m · {L("desnivel", "range")} {Math.round(Math.min(...osm.elev.rel))} / +{Math.round(Math.max(...osm.elev.rel))} m</p>}
              {around && <OsmMini s={around} pitch={pitch?.poly ?? null} />}
              {around && <p className="muted">{L("Edificios, árboles, canchas y calles en su lugar real; alturas: las de OSM o pisos × 3 m, y si no hay dato, una típica (de juego). Colores: de juego.", "Buildings, trees, pitches and streets in their real place; heights: OSM's or floors × 3 m, or a typical one if missing (game). Colors: game.")}</p>}
              <p className="muted">{OSM_ATTRIBUTION} · {L("Elevación", "Elevation")}: {ELEV_ATTRIBUTION}</p>
            </div>
          )}
      </details>

      <div className="chips">{FLOORS.map((f) => <button key={f.id} className={`chip ${floor === f.id ? "on" : ""}`} onClick={() => pickFloor(f.id)}>{f[lang]}</button>)}</div>
      <button className="btn primary" disabled={!!busy || (source === "escaneo" && !scan)} onClick={build}>🛠️ {L("Armar el mapa", "Build the map")}</button>
      {busy && <p className="note">⏳ {busy}</p>}
      {spec && check && (
        <div className="arena-result">
          <img ref={cv} src={preview} alt={L("Vista de arriba del lugar", "Top view of the place")} className="arena-preview" />
          <div>
            <p><b>{Math.round(check.area)} m²</b> {L("libres", "free")} · {check.w.toFixed(0)} × {check.l.toFixed(0)} m · {L("celda", "cell")} {cellOf(spec.s).toFixed(2)} m</p>
            {check.ok ? <p className="ok">✅ {L("Alcanza para manejar el rover.", "Big enough to drive the rover.")} {spec.s.indoor ? L("Es cerrado: el rover no puede salir.", "It is enclosed: the rover cannot leave.") : L("El borde es una reja: no se puede salir.", "The edge is a fence: no way out.")}</p>
              : <p className="bad">❌ {L(`Muy pequeño: hace falta al menos 150 m² libres y 10 m de lado (el rover de juego mide 1,2 m y necesita espacio para la misión). Un cuarto sirve para medir, no para manejar.`,
                `Too small: needs at least 150 m² free and 10 m per side (the game rover is 1.2 m long and needs room for the mission). A room is fine for measuring, not for driving.`)}</p>}
            <p className="small-print muted">{spec.s.pois.length} {L("puntos de interés (fotos)", "points of interest (photos)")} · {spec.s.station ? L("estación = donde estuvo la caja", "station = where the box was") : L("estación en la esquina opuesta a la salida", "station at the corner opposite the start")}
              {spec.walls?.length ? ` · 🧱 ${spec.walls.length} ${L("tramos de pared con tus fotos", "wall sections from your photos")}` : ""}
              {spec.floorImage ? ` · ${L("piso: recorte real", "floor: real crop")}` : ""}
              {spec.s.props?.length ? ` · 🪑 ${spec.s.props.length} ${L("muebles de juego", "game props")}` : ""}</p>
            {spec.floorImage && <img src={spec.floorImage} alt="" className="floor-crop" title={L("recorte del piso usado como textura", "floor crop used as texture")} />}
            {check.ok && rt && (
              <>
                <div className="seg">
                  <button aria-pressed={mode === "mission"} onClick={() => setMode("mission")}>🛰️ {L("Misión: estación + escáner + perímetro", "Mission: station + scanner + perimeter")}</button>
                  <button aria-pressed={mode === "free"} onClick={() => setMode("free")}>🏁 {L("Carrera por los puntos", "Race through the points")}</button>
                </div>
                <div className="seg">{(["earth", "mars", "moon"] as Gravity[]).map((g) => <button key={g} aria-pressed={gravity === g} onClick={() => setGravity(g)}>{g === "earth" ? "🌍" : g === "mars" ? "🔴" : "🌕"} {g === "earth" ? L("Tierra", "Earth") : g === "mars" ? L("Marte", "Mars") : L("Luna", "Moon")}</button>)}</div>
                <p className="small-print muted">{rt.note}</p>
                <button className="btn primary big-start" onClick={() => onPlay({ runtime: rt, preview, mode, gravity, center: spec.center, name: spec.s.name })}>
                  ▶ {L("Manejar en nuestro lugar", "Drive in our place")}</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Plano chico de lo que OSM tiene alrededor (norte arriba), con el GPS en el centro. */
function OsmMini({ s, pitch }: { s: OsmScene; pitch: [number, number][] | null }) {
  const R = 220, pts = (p: [number, number][]) => p.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(" ");
  return (
    <svg className="osm-mini" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} role="img" aria-label="OpenStreetMap">
      <rect x={-R} y={-R} width={2 * R} height={2 * R} fill="#1d2430" />
      {s.green.map((g, k) => <polygon key={`g${k}`} points={pts(g.poly)} fill="#3e5f34" />)}
      {s.water.map((w, k) => <polygon key={`w${k}`} points={pts(w)} fill="#3f6f99" />)}
      {s.pitches.map((p, k) => <polygon key={`p${k}`} points={pts(p.poly)} fill={p.kind === "stadium" ? "none" : "#4f9a48"} stroke="#9fd18f" strokeWidth={p.kind === "stadium" ? 2 : 1} />)}
      {s.roads.map((r, k) => <polyline key={`r${k}`} points={pts(r.line)} fill="none" stroke={r.kind === "waterway" ? "#3f6f99" : "#77706a"} strokeWidth={Math.max(1, r.width * 0.8)} strokeLinecap="round" />)}
      {s.buildings.map((b, k) => <polygon key={`b${k}`} points={pts(b.poly)} fill={b.hFrom === "default" ? "#b7aea0" : "#e8e1d4"} stroke="#0006" strokeWidth={0.6} />)}
      {s.trees.map(([x, z], k) => <circle key={`t${k}`} cx={x} cy={z} r={2.6} fill="#5fae4e" />)}
      {pitch && <polygon points={pts(pitch)} fill="none" stroke="#ffd27a" strokeWidth={3} />}
      <circle cx={0} cy={0} r={6} fill="#ff5a3c" stroke="#fff" strokeWidth={2} />
      <text x={-R + 8} y={-R + 20} fill="#cfd6e4" fontSize={16}>N ↑ · {R} m</text>
    </svg>
  );
}

/** Puntos de interés repartidos en anillo (bajo techo no hay GPS para ubicar cada foto). */
function ringPois(s: ArenaSpec, photos: string[]): Poi[] {
  const ch = sizeCheck(s), r = Math.min(ch.w, ch.l) * 0.3, n = Math.max(3, Math.min(5, photos.length || 4));
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, label: `P${k + 1}`, photo: photos[k] };
  });
}
export { posOf };
