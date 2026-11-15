// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Fotos y videos del celular: comprimir antes de subir, sacar fotogramas de un video y revisar cada imagen
// (exposición y nitidez). No se reconoce nada "inteligente" en la foto: solo medidas simples y explicables.

/** Comprime una foto (respeta la orientación de la cámara) a JPEG de ≤ maxPx de lado. */
export async function compressImage(file: Blob, maxPx = 1280, q = 0.75): Promise<{ data: string; w: number; h: number; bytes: number }> {
  let bmp: ImageBitmap | HTMLImageElement;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bmp = await new Promise<HTMLImageElement>((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = URL.createObjectURL(file); }); }
  const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const data = c.toDataURL("image/jpeg", q);
  return { data, w, h, bytes: Math.round((data.length * 3) / 4) };
}

type Frame = { data: string; w: number; h: number; bytes: number };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Espera a que el video tenga un fotograma NUEVO pintado (requestVideoFrameCallback si existe; si no, un rato). */
function nextFrame(v: HTMLVideoElement, ms = 1200): Promise<void> {
  const vv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  if (!vv.requestVideoFrameCallback) return sleep(250);
  return new Promise((ok) => { const t = setTimeout(ok, ms); vv.requestVideoFrameCallback!(() => { clearTimeout(t); ok(); }); });
}
/** true si la imagen es prácticamente negra (Safari a veces entrega fotogramas vacíos). */
export function isBlackFrame(px: Uint8ClampedArray): boolean {
  let max = 0;
  for (let i = 0; i < px.length; i += 16) { const y = px[i] + px[i + 1] + px[i + 2]; if (y > max) max = y; if (max > 30) return false; }
  return true;
}

/** Saca n fotogramas repartidos en el video (Chrome de Android y Safari de iPhone).
 *  En iPhone, dibujar un video "buscado" sin reproducir suele dar fotogramas negros: por eso el video se pone en la
 *  página (invisible), se REPRODUCE en silencio y se captura cada fotograma cuando ya está pintado. Los negros se
 *  descartan; si todos salen negros se avisa (causa típica: Video HDR / Dolby Vision del iPhone). */
export async function videoFrames(file: Blob, n = 6, maxPx = 960): Promise<{ frames: Frame[]; duration: number; black: number }> {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = "auto";
  v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
  Object.assign(v.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0.01", pointerEvents: "none", zIndex: "-1" });
  document.body.appendChild(v);
  v.src = url;
  const frames: Frame[] = [];
  let black = 0;
  try {
    await new Promise<void>((ok, bad) => {
      const t = setTimeout(() => bad(new Error("el video no carga")), 15000);
      v.onloadeddata = () => { clearTimeout(t); ok(); };
      v.onerror = () => { clearTimeout(t); bad(new Error("video ilegible (formato no soportado por este navegador)")); };
      v.load();
    });
    // algunos videos (grabados en el navegador) no traen su duración: saltar "al infinito" obliga a calcularla
    if (!Number.isFinite(v.duration) || v.duration < 0.1) {
      await new Promise<void>((ok) => { const t = setTimeout(ok, 4000); v.ondurationchange = () => { if (Number.isFinite(v.duration) && v.duration > 0.1) { clearTimeout(t); ok(); } }; v.currentTime = 1e101; });
      v.ondurationchange = null;
    }
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const k = Math.min(1, maxPx / Math.max(v.videoWidth || 1, v.videoHeight || 1));
    const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k);
    if (!w || !h) throw new Error("el video no tiene imagen");
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    const grab = () => {
      ctx.drawImage(v, 0, 0, w, h);
      if (isBlackFrame(ctx.getImageData(0, 0, w, h).data)) { black++; return; }
      const data = c.toDataURL("image/jpeg", 0.72);
      frames.push({ data, w, h, bytes: Math.round((data.length * 3) / 4) });
    };
    for (let i = 0; i < n; i++) {
      const t = dur * ((i + 0.5) / n);
      await new Promise<void>((ok) => { const done = () => { v.removeEventListener("seeked", done); ok(); }; v.addEventListener("seeked", done); v.currentTime = t; setTimeout(done, 3000); });
      // reproducir un instante obliga a decodificar y pintar ese punto (clave en iPhone)
      try { await v.play(); await nextFrame(v); await nextFrame(v, 400); } catch { await sleep(300); }
      v.pause();
      grab();
    }
    return { frames, duration: dur, black };
  } finally {
    v.pause(); v.removeAttribute("src"); v.load(); v.remove();
    URL.revokeObjectURL(url);
  }
}

export interface PhotoCheck { brightness: number; sharpness: number; dark: boolean; burnt: boolean; blurry: boolean; ground: [number, number, number]; colors: [number, number, number][] }
/** Brillo medio, nitidez (varianza del laplaciano en una copia chica), color del suelo (tercio de abajo) y colores dominantes. */
export function checkPixels(px: Uint8ClampedArray, w: number, h: number): PhotoCheck {
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) { const y = 0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]; g[i] = y; sum += y; }
  const brightness = sum / (w * h);
  let lsum = 0, lsq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, lap = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
    lsum += lap; lsq += lap * lap; n++;
  }
  const sharpness = n ? lsq / n - (lsum / n) ** 2 : 0;
  // suelo: promedio del tercio inferior
  let r = 0, gg = 0, b = 0, k = 0;
  for (let y = Math.floor((2 * h) / 3); y < h; y++) for (let x = 0; x < w; x++) { const i = 4 * (y * w + x); r += px[i]; gg += px[i + 1]; b += px[i + 2]; k++; }
  // colores dominantes: cubos de 4×4×4
  const bins = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < w * h; i += 3) {
    const R = px[4 * i], G = px[4 * i + 1], B = px[4 * i + 2], key = ((R >> 6) << 4) | ((G >> 6) << 2) | (B >> 6);
    const e = bins.get(key) ?? [0, 0, 0, 0];
    e[0] += R; e[1] += G; e[2] += B; e[3]++;
    bins.set(key, e);
  }
  const colors = [...bins.values()].sort((a, c) => c[3] - a[3]).slice(0, 4).map((e) => [e[0] / e[3], e[1] / e[3], e[2] / e[3]] as [number, number, number]);
  return { brightness, sharpness, dark: brightness < 45, burnt: brightness > 225, blurry: sharpness < 60, ground: [r / k, gg / k, b / k], colors };
}

export async function checkImage(dataUrl: string): Promise<PhotoCheck> {
  const im = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = dataUrl; });
  const k = Math.min(1, 256 / Math.max(im.width, im.height));
  const w = Math.max(8, Math.round(im.width * k)), h = Math.max(8, Math.round(im.height * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(im, 0, 0, w, h);
  return checkPixels(ctx.getImageData(0, 0, w, h).data, w, h);
}
