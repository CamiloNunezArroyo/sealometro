// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Terreno: alturas REALES del DEM (Copernicus GLO-30) + detalle chico procedural (de juego, declarado).
// Coordenadas del mundo en metros: x = este, z = sur, centro de la ventana en (0, 0). Fila 0 del DEM = norte.

/** Generador pseudoaleatorio con semilla (mulberry32): mismo sitio → mismo mundo. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Ruido de valor 2D suave (para el detalle chico del suelo). */
export function valueNoise(seed: number) {
  const perm = new Uint16Array(512);
  const r = rng(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (ix: number, iz: number) => perm[(perm[ix & 255] + iz) & 511] / 255;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = grad(ix, iz), b = grad(ix + 1, iz), c = grad(ix, iz + 1), d = grad(ix + 1, iz + 1);
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };
}

export class Heightfield {
  readonly n: number;
  readonly size: number;
  readonly h: Float32Array;
  readonly minH: number;
  readonly maxH: number;
  private detail: (x: number, z: number) => number;
  private detailAmp: number;

  /** h: n×n alturas (fila 0 = norte) en metros, ya relativas (se resta el mínimo). */
  constructor(n: number, size: number, h: Float32Array, seed = 1, detailAmp = 0.6) {
    this.n = n;
    this.size = size;
    this.h = h;
    let lo = Infinity, hi = -Infinity;
    for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
    this.minH = lo;
    this.maxH = hi;
    this.detail = valueNoise(seed);
    this.detailAmp = detailAmp;
  }

  /** Desde el .bin del motor: uint16 cuantizado entre hMin y hMax. */
  static fromUint16(n: number, size: number, q: Uint16Array, hMin: number, hMax: number, seed: number, detailAmp = 0.6) {
    const h = new Float32Array(n * n);
    const span = hMax - hMin;
    for (let i = 0; i < n * n; i++) h[i] = (q[i] / 65535) * span; // relativo al mínimo del sitio
    return new Heightfield(n, size, h, seed, detailAmp);
  }

  get half() { return this.size / 2; }
  inside(x: number, z: number, margin = 0) {
    return Math.abs(x) <= this.half - margin && Math.abs(z) <= this.half - margin;
  }

  /** Altura del DEM (bilineal), sin detalle. */
  demAt(x: number, z: number): number {
    const n = this.n;
    const gx = ((x + this.half) / this.size) * (n - 1);
    const gz = ((z + this.half) / this.size) * (n - 1);
    const cx = Math.max(0, Math.min(n - 1.0001, gx));
    const cz = Math.max(0, Math.min(n - 1.0001, gz));
    const i = Math.floor(cx), j = Math.floor(cz);
    const fx = cx - i, fz = cz - j;
    const a = this.h[j * n + i], b = this.h[j * n + i + 1], c = this.h[(j + 1) * n + i], d = this.h[(j + 1) * n + i + 1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  }

  /** Altura final: DEM real + ondulación chica (dos octavas, de juego). */
  heightAt(x: number, z: number): number {
    const d = this.detail(x / 40, z / 40) * 0.65 + this.detail(x / 16 + 37, z / 16 - 11) * 0.35;
    return this.demAt(x, z) + (d - 0.5) * 2 * this.detailAmp;
  }

  /** Normal de la superficie (diferencias centradas). */
  normalAt(x: number, z: number, e = 1.0): [number, number, number] {
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

  /** Pendiente del DEM en grados, a la escala de `e` metros. */
  slopeDeg(x: number, z: number, e = 15): number {
    const hx = (this.demAt(x + e, z) - this.demAt(x - e, z)) / (2 * e);
    const hz = (this.demAt(x, z + e) - this.demAt(x, z - e)) / (2 * e);
    return (Math.atan(Math.hypot(hx, hz)) * 180) / Math.PI;
  }
}

/** Rejilla regular muestreada del Heightfield: la MISMA que se dibuja; la física la usa para que el rover
 *  nunca flote ni se hunda respecto de lo que se ve. */
export class Grid {
  readonly m: number;
  readonly size: number;
  readonly data: Float32Array;
  constructor(src: { heightAt: (x: number, z: number) => number }, m: number, size: number) {
    this.m = m;
    this.size = size;
    this.data = new Float32Array((m + 1) * (m + 1));
    for (let j = 0; j <= m; j++) for (let i = 0; i <= m; i++) {
      this.data[j * (m + 1) + i] = src.heightAt(-size / 2 + (i / m) * size, -size / 2 + (j / m) * size);
    }
  }
  heightAt(x: number, z: number): number {
    const m = this.m, w = m + 1;
    const gx = Math.max(0, Math.min(m - 1e-4, ((x + this.size / 2) / this.size) * m));
    const gz = Math.max(0, Math.min(m - 1e-4, ((z + this.size / 2) / this.size) * m));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    // misma triangulación que PlaneGeometry (diagonal de (i,j+1) a (i+1,j))
    const a = this.data[j * w + i], b = this.data[j * w + i + 1], c = this.data[(j + 1) * w + i], d = this.data[(j + 1) * w + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Normal de la superficie (diferencias centradas). */
  normalAt(x: number, z: number, e = 1.0): [number, number, number] {
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    return [nx / l, ny / l, nz / l];
  }

}
