// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// "Lo que entendimos de tus fotos": análisis de imagen PROPIO, simple y explicable (sin IA ni servicios externos).
// Cada foto se divide en 3 franjas: arriba (techo o cielo), medio (paredes / horizonte) y abajo (piso).
// Por franja se mide: color dominante (histograma), brillo, saturación, tono, textura (gradiente medio),
// densidad de bordes, fracción de verde y fracción de cielo. En el piso además se busca un patrón de BALDOSAS
// (líneas rectas repetidas = autocorrelación del perfil de bordes). Con reglas fijas (decisión de diseño, `design`)
// se sugiere: tipo de piso con confianza, interior/exterior, nivel de luz y cuántos objetos hay.
// Puede equivocarse (sombras, gente, luz rara): la página lo dice y deja corregir el piso.
// Las funciones puras (analyzePixels, combineScenes, panoramaPlan) no usan DOM y tienen pruebas con píxeles sintéticos.

export type RGB = [number, number, number];
export type FloorGuess = "baldosa" | "cemento" | "pasto" | "tierra" | "arena";
export const FLOOR_GUESSES: FloorGuess[] = ["baldosa", "cemento", "pasto", "tierra", "arena"];
/** Tipo de piso del juego que corresponde a cada sugerencia. */
export const FLOOR_OF: Record<FloorGuess, "interior" | "cemento" | "pasto" | "tierra" | "arena"> = {
  baldosa: "interior", cemento: "cemento", pasto: "pasto", tierra: "tierra", arena: "arena",
};

export interface BandStats {
  mean: RGB; dom: RGB;          // color medio y dominante
  bright: number;               // 0–255
  sat: number; hue: number;     // saturación media 0–1 y tono del color medio (0–360°)
  texture: number;              // gradiente medio de luminancia (0 = liso)
  edges: number;                // fracción de píxeles con borde fuerte (0–1)
  green: number;                // fracción de píxeles verdes (pasto / árboles)
  greenTex: number;             // fracción de píxeles verdes CON textura (hojas, pasto); una pared pintada de verde es lisa
  sky: number;                  // fracción de píxeles de cielo azul claro
  white: number;                // fracción de píxeles blancos muy brillantes (cielo nublado… o un techo muy iluminado)
}
export interface PhotoScene {
  top: BandStats; mid: BandStats; bottom: BandStats;
  tile: number;                                  // 0–1: qué tan fuerte es el patrón de líneas repetidas del piso
  floor: { kind: FloorGuess; conf: number; scores: Record<FloorGuess, number> };
  indoor: { value: boolean; conf: number; outdoorScore: number };
  light: { value: number; level: "oscuro" | "medio" | "brillante" };
  clutter: { value: number; level: "pocos" | "algunos" | "muchos" };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Pertenencia trapezoidal: 0 fuera de [a, d], 1 en [b, c], rampa entre medio. */
export function trap(x: number, a: number, b: number, c: number, d: number) {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  return x < b ? (x - a) / (b - a) : (d - x) / (d - c);
}
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx / 255];
}

function bandStats(px: Uint8ClampedArray, lum: Float32Array, w: number, h: number, y0: number, y1: number): BandStats {
  let r = 0, g = 0, b = 0, sat = 0, tex = 0, edges = 0, green = 0, greenTex = 0, sky = 0, white = 0, n = 0, ng = 0;
  const bins = new Map<number, [number, number, number, number]>();
  for (let y = y0; y < y1; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, R = px[4 * i], G = px[4 * i + 1], B = px[4 * i + 2];
    r += R; g += G; b += B; n++;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), s = mx ? (mx - mn) / mx : 0, Y = lum[i];
    sat += s;
    const isGreen = G > R + 6 && G > B + 2 && s > 0.12 && Y > 25;
    if (isGreen) green++;
    if (B > R + 12 && B >= G - 6 && Y > 110) sky++;
    else if (Y > 215 && s < 0.1) white++;
    const key = ((R >> 5) << 6) | ((G >> 5) << 3) | (B >> 5), e = bins.get(key) ?? [0, 0, 0, 0];
    e[0] += R; e[1] += G; e[2] += B; e[3]++; bins.set(key, e);
    if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
      const gm = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
      tex += gm; ng++;
      if (gm > 40) edges++;
      if (isGreen && gm > 24) greenTex++;
    }
  }
  n = Math.max(1, n);
  const top = [...bins.values()].sort((p, q) => q[3] - p[3])[0] ?? [0, 0, 0, 1];
  const mean: RGB = [r / n, g / n, b / n];
  return {
    mean, dom: [top[0] / top[3], top[1] / top[3], top[2] / top[3]],
    bright: 0.299 * mean[0] + 0.587 * mean[1] + 0.114 * mean[2],
    sat: sat / n, hue: rgbToHsv(mean[0], mean[1], mean[2])[0],
    texture: ng ? tex / ng : 0, edges: ng ? edges / ng : 0, green: green / n, greenTex: greenTex / n, sky: sky / n, white: white / n,
  };
}

/** Autocorrelación normalizada máxima de un perfil (sin tendencia) para desfases entre minLag y len/2. */
export function periodicity(p: Float32Array, minLag = 4): number {
  const L = p.length;
  if (L < minLag * 3) return 0;
  const q = new Float32Array(L), win = 7;
  for (let i = 0; i < L; i++) {          // quita la tendencia lenta (luz que cambia) con un promedio móvil
    let s = 0, k = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(L - 1, i + win); j++) { s += p[j]; k++; }
    q[i] = p[i] - s / k;
  }
  let e0 = 0;
  for (let i = 0; i < L; i++) e0 += q[i] * q[i];
  if (e0 < 1e-6) return 0;
  let best = 0;
  for (let lag = minLag; lag <= Math.floor(L / 2); lag++) {
    let s = 0;
    for (let i = 0; i + lag < L; i++) s += q[i] * q[i + lag];
    best = Math.max(best, s / e0 * (L / (L - lag)));
  }
  return clamp01(best);
}

/** Líneas marcadas en un perfil de bordes: picos (máximos locales > 2 × la mediana). Devuelve 0–1. */
export function lineScore(p: Float32Array): number {
  const v = [...p].sort((a, b) => a - b), med = v[Math.floor(v.length / 2)] + 1e-3, p95 = v[Math.floor(v.length * 0.95)];
  let peaks = 0, last = -9;
  for (let i = 1; i + 1 < p.length; i++) if (p[i] > 2 * med && p[i] >= p[i - 1] && p[i] >= p[i + 1] && i - last >= 3) { peaks++; last = i; } // (una línea fina da 2 picos pegados: cuentan 1)
  // una o dos líneas (rayas de una cancha, una sombra) no son baldosas: hacen falta ≥ 3
  return clamp01((peaks - 2) / 4) * clamp01((p95 / med - 1.4) / 1.6);
}

/** Patrón de baldosas en una franja: líneas horizontales y verticales que se repiten. 0–1. */
function tileScore(lum: Float32Array, w: number, y0: number, y1: number): number {
  const H = y1 - y0;
  if (H < 12 || w < 12) return 0;
  const rows = new Float32Array(H - 2), cols = new Float32Array(w - 2), yc = y1 - Math.round(H * 0.4);
  for (let y = y0 + 2; y < y1 - 1; y++) for (let x = 1; x < w - 1; x++) {   // (y0 + 2: el borde con la franja de arriba no cuenta)
    const i = y * w + x;
    rows[y - y0 - 1] += Math.abs(lum[i + w] - lum[i - w]) / w;
    if (y >= yc) cols[x - 1] += Math.abs(lum[i + 1] - lum[i - 1]); // columnas: solo la parte de abajo (la perspectiva junta las líneas arriba)
  }
  const pr = periodicity(rows), pc = periodicity(cols);
  // 1) líneas que se repiten a distancia fija (vista desde arriba); hacen falta en las dos direcciones
  const periodic = clamp01((Math.min(pr, pc) - 0.3) / 0.35);
  // 2) varias juntas marcadas (en perspectiva la distancia cambia, pero siguen siendo líneas rectas)
  const lines = 0.6 * Math.max(lineScore(rows), lineScore(cols)) + 0.4 * Math.min(lineScore(rows), lineScore(cols));
  return Math.max(periodic, lines);
}

/** Análisis de una imagen (píxeles RGBA, idealmente reducida a ~160 px de lado). Puro. */
export function analyzePixels(px: Uint8ClampedArray, w: number, h: number): PhotoScene {
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2];
  const a = Math.round(h * 0.3), c = Math.round(h * 0.62);
  const top = bandStats(px, lum, w, h, 0, a), mid = bandStats(px, lum, w, h, a, c), bottom = bandStats(px, lum, w, h, c, h);
  const tile = tileScore(lum, w, c, h);
  const B = bottom, warm = trap(B.hue, 12, 22, 48, 62);
  // reglas (decisión de diseño): cada tipo de piso recibe un puntaje 0–1 según color, textura y patrón
  const scores: Record<FloorGuess, number> = {
    pasto: clamp01((B.green - 0.12) / 0.33),
    arena: warm * trap(B.sat, 0.1, 0.18, 0.45, 0.6) * trap(B.bright, 120, 155, 240, 256) * (1 - clamp01(B.green * 3)) * (1 - tile * 0.8),
    tierra: trap(B.hue, 5, 15, 42, 55) * trap(B.sat, 0.15, 0.25, 0.7, 0.85) * trap(B.bright, 30, 55, 145, 175) * (1 - clamp01(B.green * 3)) * (1 - tile * 0.8),
    cemento: trap(B.sat, -1, 0, 0.12, 0.22) * trap(B.bright, 50, 80, 200, 235) * (1 - tile) * (0.6 + 0.4 * trap(B.texture, 2, 5, 30, 50)),
    baldosa: Math.max(tile, trap(B.sat, -1, 0, 0.2, 0.32) * trap(B.texture, -1, 0, 3, 6) * trap(B.bright, 100, 140, 256, 257) * 0.7),
  };
  let kind: FloorGuess = "cemento", best = -1, sum = 0;
  for (const k of FLOOR_GUESSES) { sum += scores[k]; if (scores[k] > best) { best = scores[k]; kind = k; } }
  const conf = sum > 0.05 ? best / sum : 0.2;
  // interior vs exterior: cielo azul arriba y verde en el medio → afuera. El blanco brillante solo cuenta como cielo
  // nublado si arriba es MUCHO más claro que el piso (afuera el cielo suele salir ≥ 1,5–2 veces más claro; un techo, no)
  const ratio = top.bright / Math.max(1, bottom.bright);
  const outdoorScore = clamp01(top.sky * 1.8 + top.white * trap(ratio, 1.45, 1.9, 1e3, 1e4) + mid.greenTex * 1.4 + bottom.green * 0.6);
  const indoor = outdoorScore < 0.35;
  const light = 0.299 * (top.mean[0] + mid.mean[0] + bottom.mean[0]) / 3 + 0.587 * (top.mean[1] + mid.mean[1] + bottom.mean[1]) / 3 + 0.114 * (top.mean[2] + mid.mean[2] + bottom.mean[2]) / 3;
  return {
    top, mid, bottom, tile,
    floor: { kind, conf: Math.max(0.2, Math.min(0.95, conf)), scores },
    indoor: { value: indoor, conf: Math.max(0.5, Math.min(0.95, 0.5 + Math.abs(outdoorScore - 0.35))), outdoorScore },
    light: { value: light, level: light < 70 ? "oscuro" : light > 170 ? "brillante" : "medio" },
    clutter: { value: mid.edges, level: mid.edges < 0.06 ? "pocos" : mid.edges < 0.14 ? "algunos" : "muchos" },
  };
}

export interface SceneSummary {
  n: number;
  floor: { kind: FloorGuess; conf: number; votes: Record<FloorGuess, number> };
  indoor: { value: boolean; conf: number };
  palette: { floor: RGB; wall: RGB; ceiling: RGB };
  light: number;
  clutter: number;              // 0–1 (densidad de bordes de la franja del medio, normalizada)
}
const avg = (cs: RGB[]): RGB => [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / Math.max(1, cs.length)) as RGB;
/** Junta el análisis de varias fotos: vota el piso (ponderado por confianza) y promedia la paleta. */
export function combineScenes(list: PhotoScene[]): SceneSummary | null {
  const ok = list.filter((s) => s.light.value > 25);   // fotos casi negras no votan
  if (!ok.length) return null;
  const votes = Object.fromEntries(FLOOR_GUESSES.map((k) => [k, 0])) as Record<FloorGuess, number>;
  for (const s of ok) for (const k of FLOOR_GUESSES) votes[k] += s.floor.scores[k];
  let kind: FloorGuess = "cemento", best = -1, sum = 0;
  for (const k of FLOOR_GUESSES) { sum += votes[k]; if (votes[k] > best) { best = votes[k]; kind = k; } }
  const out = ok.reduce((s, x) => s + x.indoor.outdoorScore, 0) / ok.length;
  return {
    n: ok.length,
    floor: { kind, conf: sum > 0.05 ? Math.max(0.2, Math.min(0.95, best / sum)) : 0.2, votes },
    indoor: { value: out < 0.35, conf: Math.max(0.5, Math.min(0.95, 0.5 + Math.abs(out - 0.35))) },
    palette: { floor: avg(ok.map((s) => s.bottom.dom)), wall: avg(ok.map((s) => s.mid.dom)), ceiling: avg(ok.map((s) => s.top.dom)) },
    light: ok.reduce((s, x) => s + x.light.value, 0) / ok.length,
    clutter: clamp01((ok.reduce((s, x) => s + x.clutter.value, 0) / ok.length - 0.04) / 0.18),
  };
}
/** Cuántos muebles/objetos poner (de juego) según la densidad de bordes y el área libre. */
export const propCount = (clutter: number, area: number) => Math.round(clutter * Math.max(0, Math.min(14, area / 35)));

export interface PanoItem { id: string; data: string; t: number; video?: string; idx?: number; kind: "photo" | "frame" }
/**
 * Panorámica: el video se graba GIRANDO despacio en el lugar, así que el fotograma i de N mira hacia i/N·360°.
 * Se usa el video con más fotogramas (≥ 3); si no hay, las fotos sueltas en orden de toma.
 * Devuelve cada imagen con su rango de ángulo [a0, a1) en radianes (0 = primera dirección).
 */
export function panoramaPlan(items: PanoItem[]): { source: "video" | "photos" | "none"; parts: { id: string; data: string; a0: number; a1: number }[] } {
  const vids = new Map<string, PanoItem[]>();
  for (const m of items) if (m.kind === "frame" && m.video) (vids.get(m.video) ?? vids.set(m.video, []).get(m.video)!).push(m);
  const best = [...vids.values()].sort((a, b) => b.length - a.length)[0];
  let list: PanoItem[], source: "video" | "photos" | "none";
  if (best && best.length >= 3) { list = [...best].sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0)); source = "video"; }
  else {
    list = items.filter((m) => m.kind === "photo").sort((a, b) => a.t - b.t).slice(0, 8);
    source = list.length ? "photos" : "none";
    if (list.length && list.length < 4) list = Array.from({ length: 4 }, (_, k) => list[k % list.length]); // pocas fotos: se repiten
  }
  const N = list.length, D = (2 * Math.PI) / Math.max(1, N);
  return { source, parts: list.map((m, k) => ({ id: m.id, data: m.data, a0: k * D, a1: (k + 1) * D })) };
}

// ------------------------------------------------------------------ navegador (canvas): no se usan en las pruebas
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
}
/** Analiza una foto (data URL) reduciéndola a ≤ 160 px. */
export async function analyzeImage(dataUrl: string, maxPx = 160): Promise<PhotoScene> {
  const im = await loadImg(dataUrl);
  const k = Math.min(1, maxPx / Math.max(im.width, im.height));
  const w = Math.max(16, Math.round(im.width * k)), h = Math.max(16, Math.round(im.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(im, 0, 0, w, h);
  return analyzePixels(ctx.getImageData(0, 0, w, h).data, w, h);
}
/** Recorta una franja horizontal (proporciones 0–1 de alto) y la devuelve como JPEG ≤ outW px. */
export async function cropBand(dataUrl: string, y0: number, y1: number, outW = 512, outH = 256): Promise<string> {
  const im = await loadImg(dataUrl);
  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  c.getContext("2d")!.drawImage(im, 0, im.height * y0, im.width, im.height * (y1 - y0), 0, 0, outW, outH);
  return c.toDataURL("image/jpeg", 0.8);
}
/** Recorte real del piso para usarlo como textura repetida: entre varios cuadrados de la parte de abajo de la foto
 *  (donde la perspectiva deforma menos) se elige el MÁS PAREJO (menos bordes), para no repetir rayas, pies o sombras. */
export async function floorPatch(dataUrl: string, px = 256): Promise<string> {
  const im = await loadImg(dataUrl);
  const W = 96, H = Math.max(16, Math.round((96 * im.height) / im.width));
  const c0 = document.createElement("canvas");
  c0.width = W; c0.height = H;
  const x0 = c0.getContext("2d", { willReadFrequently: true })!;
  x0.drawImage(im, 0, 0, W, H);
  const d = x0.getImageData(0, 0, W, H).data, lum = (x: number, y: number) => { const i = 4 * (y * W + x); return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
  const side = Math.max(8, Math.min(Math.round(H * 0.16), Math.round(W * 0.25)));
  let best = { x: Math.round(W * 0.35), y: H - side - 1, e: Infinity };
  for (const fy of [0.98, 0.9, 0.82]) for (const fx of [0.05, 0.2, 0.35, 0.5, 0.65]) {
    const sx = Math.round(W * fx), sy = Math.round(H * fy) - side;
    if (sy < H * 0.62 || sx + side >= W) continue;
    let e = 0;
    for (let y = sy + 1; y < sy + side - 1; y++) for (let x = sx + 1; x < sx + side - 1; x++) e += Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
    if (e < best.e) best = { x: sx, y: sy, e };
  }
  const k = im.width / W, c = document.createElement("canvas");
  c.width = c.height = px;
  c.getContext("2d")!.drawImage(im, best.x * k, best.y * k, side * k, side * k, 0, 0, px, px);
  return c.toDataURL("image/jpeg", 0.8);
}
