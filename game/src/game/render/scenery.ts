// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Terreno 3D, agua, cielo, rocas y cueva.
import * as THREE from "three";
import type { Grid, Heightfield } from "../core/terrain";
import type { World } from "../core/world";
import type { CaveData } from "../core/cave";
import type { Rock } from "../core/physics";

interface Palette { base: number; dark: number; light: number; soft: number; rock: number }
export const PALETTES: Record<string, Palette> = {
  desierto: { base: 0xb98b5e, dark: 0x7d5536, light: 0xd9b78c, soft: 0xe6cfa3, rock: 0x6f5340 },
  salar: { base: 0xf2efe8, dark: 0xc9c2b5, light: 0xffffff, soft: 0xfbf9f4, rock: 0x7c7064 },
  volcanico: { base: 0x4c3f3a, dark: 0x2b2321, light: 0x6f5e55, soft: 0x6a625e, rock: 0x322a28 },
  frio: { base: 0xb7c1ca, dark: 0x7f8a96, light: 0xeaf0f5, soft: 0xf7f9fb, rock: 0x5b5f66 },
  lago: { base: 0xb39a7c, dark: 0x7e6550, light: 0xd9c6a8, soft: 0x7a604a, rock: 0x5e4c3f },
  vegetado: { base: 0x6f7c46, dark: 0x4b5630, light: 0x97a462, soft: 0x6b5843, rock: 0x5c5a52 },
  cemento: { base: 0x9a9893, dark: 0x6f6d69, light: 0xb9b7b1, soft: 0xa8a6a0, rock: 0x5e5c58 },
  interior: { base: 0xb7aa96, dark: 0x8a7f6f, light: 0xd2c6b2, soft: 0xc0b4a0, rock: 0x6b6258 },
};
// agua de las lagunas: Laguna Colorada es rojiza (por algas, no por óxido) y Laguna Verde es verde (minerales)
const WATER: Record<string, number> = { laguna_colorada: 0xa8472f, laguna_verde_licancabur: 0x2f9a8d };

/** Detalle de cerca por bioma (procedural, sin archivos): color (multiplica, media ≈ 1) + relieve (bump).
 *  salar: polígonos de sal con bordes levantados (en Uyuni miden de ~1 a ~5 m; aquí ~3 m, decisión de diseño). */
export interface Detail { color: THREE.Texture; bump: THREE.Texture; tileM: number; strength: number }
const detailCache = new Map<string, Detail>();
export function detailFor(biome: string): Detail | null {
  if (typeof document === "undefined") return null;
  if (detailCache.has(biome)) return detailCache.get(biome)!;
  const N = 256;
  const col = new Uint8ClampedArray(N * N * 4), hgt = new Uint8ClampedArray(N * N * 4);
  let seed = 9001 + biome.length * 77;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // ruido de valor que se repite sin costura
  const G = 32, grid = Array.from({ length: G * G }, rnd);
  const vnoise = (x: number, y: number, f: number) => {
    const gx = (x / N) * f, gy = (y / N) * f, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const at = (i: number, j: number) => grid[(((j % f) + f) % f) * G + (((i % f) + f) % f)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
  };
  // Voronoi que se repite: un punto por celda de una rejilla C×C
  const voronoi = (C: number) => {
    const P = Array.from({ length: C * C }, () => [rnd(), rnd()]);
    return (x: number, y: number) => {
      const u = (x / N) * C, v = (y / N) * C, cx = Math.floor(u), cy = Math.floor(v);
      let d1 = 9, d2 = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j, p = P[(((gy % C) + C) % C) * C + (((gx % C) + C) % C)];
        const d = Math.hypot(gx + p[0] - u, gy + p[1] - v);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      return d2 - d1; // 0 en el borde entre celdas
    };
  };
  let tileM = 12, strength = 0.35;
  const vor = biome === "salar" ? voronoi(5) : biome === "lago" ? voronoi(7) : biome === "frio" ? voronoi(3) : null;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = (y * N + x) * 4;
    const n1 = vnoise(x, y, 8), n2 = vnoise(x, y, 32), fine = rnd();
    let c = 1, h = 0.5, tint = [1, 1, 1];
    if (biome === "salar") {        // polígonos: interior liso algo más gris, borde blanco levantado
      tileM = 16; strength = 0.55;
      const e = vor!(x, y), ridge = Math.max(0, 1 - e / 0.09);
      c = 0.9 + 0.08 * n2 + 0.22 * ridge + 0.04 * (fine - 0.5);
      h = 0.35 + 0.6 * ridge + 0.05 * n2;
    } else if (biome === "desierto") { // ondas de arena + piedritas
      tileM = 10; strength = 0.4;
      const rip = Math.sin((x / N) * 2 * Math.PI * 9 + n1 * 5) * 0.5 + 0.5;
      const peb = fine > 0.985 ? 1 : 0;
      c = 0.92 + 0.1 * rip + 0.08 * (n2 - 0.5) - 0.25 * peb;
      h = 0.3 + 0.35 * rip + 0.5 * peb;
    } else if (biome === "volcanico") { // escoria y ceniza
      tileM = 8; strength = 0.55;
      const blob = Math.max(0, n2 - 0.45) * 2;
      c = 0.8 + 0.35 * n1 - 0.3 * blob + 0.15 * (fine - 0.5);
      h = 0.3 + 0.6 * blob + 0.15 * fine;
    } else if (biome === "frio") {   // escarcha y polígonos de suelo helado
      tileM = 20; strength = 0.4;
      const e = vor!(x, y), crack = Math.max(0, 1 - e / 0.06);
      c = 0.95 + 0.12 * n2 - 0.18 * crack + 0.06 * (fine - 0.5);
      h = 0.55 - 0.4 * crack + 0.1 * n2;
    } else if (biome === "lago") {   // barro agrietado de orilla
      tileM = 9; strength = 0.5;
      const e = vor!(x, y), crack = Math.max(0, 1 - e / 0.05);
      c = 0.95 + 0.08 * n2 - 0.4 * crack;
      h = 0.6 - 0.5 * crack;
    } else if (biome === "cemento" || biome === "interior" || biome === "arena_foto") { // piso: grano fino neutro
      tileM = 3; strength = 0.25;
      c = 0.94 + 0.08 * (n2 - 0.5) + 0.1 * (fine - 0.5);
      h = 0.5 + 0.2 * (fine - 0.5);
    } else {                          // vegetado: matas de pasto
      tileM = 6; strength = 0.5;
      const tuft = Math.max(0, n2 - 0.55) * 2.2;
      c = 0.9 + 0.15 * n1 - 0.1 * tuft;
      tint = [1 - 0.15 * tuft, 1 + 0.08 * tuft, 1 - 0.2 * tuft];
      h = 0.4 + 0.5 * tuft + 0.1 * fine;
    }
    col[k] = 128 * c * tint[0]; col[k + 1] = 128 * c * tint[1]; col[k + 2] = 128 * c * tint[2]; col[k + 3] = 255;
    hgt[k] = hgt[k + 1] = hgt[k + 2] = 255 * Math.max(0, Math.min(1, h)); hgt[k + 3] = 255;
  }
  const mk = (data: Uint8ClampedArray) => {
    const c = document.createElement("canvas");
    c.width = c.height = N;
    c.getContext("2d")!.putImageData(new ImageData(data, N, N), 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  const d = { color: mk(col), bump: mk(hgt), tileM, strength };
  detailCache.set(biome, d);
  return d;
}

/** Terreno: el color de lejos es la IMAGEN SATELITAL REAL (Sentinel-2) de la misma ventana; de cerca se suma el
 *  detalle del bioma. Sin imagen, usa la paleta del bioma (respaldo). */
export function buildTerrain(grid: Grid, hf: Heightfield, world: World, biome: string, mobile: boolean, sat: THREE.Texture | null): THREE.Mesh {
  const m = grid.m;
  const geo = new THREE.PlaneGeometry(grid.size, grid.size, m, m);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const mask = new Float32Array(pos.count); // dónde se dibuja el detalle (la sal poligonal solo en lo plano)
  const P = PALETTES[biome] ?? PALETTES.desierto;
  const cBase = new THREE.Color(P.base), cDark = new THREE.Color(P.dark), cLight = new THREE.Color(P.light), cSoft = new THREE.Color(P.soft);
  const cVent = new THREE.Color(0xb86a3c), white = new THREE.Color(1, 1, 1);
  const tmp = new THREE.Color();
  const range = Math.max(1, hf.maxH - hf.minH);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k);
    const y = grid.data[k];
    pos.setY(k, y);
    if (sat) {
      tmp.copy(white);
      if (world.inSand(x, z)) tmp.lerp(cSoft, 0.35).multiplyScalar(1.05); // la arena blanda de juego se ve (más clara)
    } else {
      const slope = hf.slopeDeg(x, z, 8);
      const hNorm = (y - hf.minH) / range;
      const n = (Math.sin(x * 0.11) * Math.cos(z * 0.13) + Math.sin(x * 0.031 + z * 0.027)) * 0.5;
      tmp.copy(cBase).lerp(cLight, Math.max(0, 0.25 * hNorm + 0.12 * n));
      tmp.lerp(cDark, Math.min(0.85, Math.max(0, (slope - 6) / 30)));
      if (world.inSand(x, z)) tmp.lerp(cSoft, 0.75);
    }
    const v = world.ventNear(x, z);
    if (v > 0) tmp.lerp(cVent, v * 0.6);
    col[3 * k] = tmp.r; col[3 * k + 1] = tmp.g; col[3 * k + 2] = tmp.b;
    const sl = hf.slopeDeg(x, z, 6);
    mask[k] = biome === "salar" ? 1 - Math.min(1, Math.max(0, (sl - 2.5) / 3)) : 1 - 0.6 * Math.min(1, Math.max(0, (sl - 25) / 20));
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("detMask", new THREE.BufferAttribute(mask, 1));
  geo.computeVertexNormals();
  const det = detailFor(biome);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: sat, roughness: biome === "salar" ? 0.75 : 0.95, metalness: 0 });
  if (det) {
    const rep = grid.size / det.tileM;
    det.bump.repeat.set(rep, rep);
    mat.bumpMap = det.bump;
    mat.bumpScale = biome === "salar" ? 2.2 : 1.4;
    const uni = { detailMap: { value: det.color }, detailRepeat: { value: rep }, detailStrength: { value: det.strength } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vDetUv; attribute float detMask; varying float vDetMask;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvDetUv = uv; vDetMask = detMask;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D detailMap; uniform float detailRepeat; uniform float detailStrength; varying vec2 vDetUv; varying float vDetMask;")
        .replace("#include <normal_fragment_maps>", THREE.ShaderChunk.normal_fragment_maps.replace("dHdxy_fwd()", "(dHdxy_fwd() * vDetMask)"))
        .replace("#include <map_fragment>", [
          "#include <map_fragment>",
          // detalle de cerca; a lo lejos, una versión 8 veces más grande para no repetir el patrón
          "float camD = length(vViewPosition);",
          "float fade = 1.0 - smoothstep(60.0, 320.0, camD);",
          "vec3 detN = texture2D(detailMap, vDetUv * detailRepeat).rgb * 2.0;",
          "vec3 detF = texture2D(detailMap, vDetUv * detailRepeat * 0.13).rgb * 2.0;",
          "diffuseColor.rgb *= mix(vec3(1.0), mix(detF, detN, fade), detailStrength * vDetMask);",
        ].join("\n"));
    };
    mat.customProgramCacheKey = () => "terrain-detail-" + biome;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = !mobile;
  return mesh;
}

/** Piedritas decorativas (sin choque) para que el suelo no se vea vacío. Más en terrenos rocosos. */
export function buildPebbles(world: World, heightAt: (x: number, z: number) => number, color: number, biome: string, mobile: boolean, cx: number, cz: number): THREE.InstancedMesh {
  const base: Record<string, number> = { volcanico: 9000, desierto: 6500, frio: 7000, lago: 4000, vegetado: 2500, salar: 900 };
  const n = Math.round((base[biome] ?? 5000) * (mobile ? 0.4 : 1));
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), t = new THREE.Vector3();
  const c = new THREE.Color(color), tmp = new THREE.Color();
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let k = 0;
  for (let i = 0; i < n * 3 && k < n; i++) {
    const a = rnd() * 2 * Math.PI, d = Math.pow(rnd(), 0.75) * 700;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (world.inWater(x, z) || world.puddleAt(x, z)) continue;
    if (biome === "salar" && heightAt(x, z) - heightAt(cx, cz) < 2 && rnd() < 0.85) continue;
    const r = 0.05 + 0.22 * Math.pow(rnd(), 2.2);
    e.set(rnd() * 3, rnd() * 3, rnd() * 3);
    q.setFromEuler(e);
    sc.set(r, r * (0.5 + rnd() * 0.5), r * (0.7 + rnd() * 0.5));
    t.set(x, heightAt(x, z) + r * 0.25, z);
    m4.compose(t, q, sc);
    mesh.setMatrixAt(k, m4);
    tmp.copy(c).multiplyScalar(0.75 + rnd() * 0.5);
    mesh.setColorAt(k, tmp);
    k++;
  }
  mesh.count = k;
  return mesh;
}

/** Charcos (salar y lluvia): discos que reflejan el cielo, con borde irregular. */
export function buildPuddle(p: { x: number; z: number; r: number; deep: number }, y: number, env: THREE.Texture | null): THREE.Mesh {
  const g = new THREE.CircleGeometry(1, 40);
  const pa = g.attributes.position as THREE.BufferAttribute;
  for (let i = 1; i < pa.count; i++) {
    const a = Math.atan2(pa.getY(i), pa.getX(i)), k = 1 + 0.12 * Math.sin(a * 3 + p.x) + 0.08 * Math.sin(a * 7 + p.z);
    pa.setXY(i, pa.getX(i) * k, pa.getY(i) * k);
  }
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: p.deep > 0 ? 0x8fb4d4 : 0xb7cde0, roughness: 0.04, metalness: 0.35,
    envMap: env, envMapIntensity: 1.2, transparent: true, opacity: p.deep > 0 ? 0.92 : 0.8 }));
  m.scale.set(p.r, 1, p.r);
  m.position.set(p.x, y + 0.05, p.z);
  m.renderOrder = 1;
  return m;
}

export function buildWater(world: World, size: number, siteId: string): THREE.Mesh | null {
  if (world.waterRel === null) return null;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: WATER[siteId] ?? 0x3b7fa8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.86 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = world.waterRel + 0.05;
  return m;
}

export function buildRocks(rocks: Rock[], heightAt: (x: number, z: number) => number, color: number, mobile: boolean,
  colorAt?: (x: number, z: number) => THREE.Color | null): THREE.InstancedMesh {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { // deformar un poco para que no parezcan dados
    const s = 0.82 + 0.36 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * (0.8 + 0.2 * s), p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), Math.max(1, rocks.length));
  const base = new THREE.Color(color), tmpC = new THREE.Color();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), t = new THREE.Vector3();
  rocks.forEach((r, i) => {
    e.set((i * 0.37) % 0.5, (i * 1.7) % (Math.PI * 2), (i * 0.23) % 0.4);
    q.setFromEuler(e);
    s.set(r.r, r.h, r.r * (0.8 + ((i * 0.61) % 0.4)));
    t.set(r.x, heightAt(r.x, r.z) + r.h * 0.45, r.z);
    m4.compose(t, q, s);
    mesh.setMatrixAt(i, m4);
    // color: el del suelo real en ese punto (imagen satelital), más oscuro; si no hay imagen, el de la paleta
    const sc = colorAt?.(r.x, r.z);
    tmpC.copy(sc ? sc.clone().multiplyScalar(0.62).lerp(base, 0.35) : base).multiplyScalar(0.85 + ((i * 0.37) % 0.3));
    mesh.setColorAt(i, tmpC);
  });
  mesh.count = rocks.length;
  mesh.castShadow = !mobile;
  mesh.receiveShadow = !mobile;
  return mesh;
}

export function buildSky(top: number, horizon: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(4000, 24, 12);
  const c = new Float32Array(geo.attributes.position.count * 3);
  const a = new THREE.Color(top), b = new THREE.Color(horizon), tmp = new THREE.Color();
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i) / 4000;
    tmp.copy(b).lerp(a, Math.max(0, Math.min(1, y * 1.6)));
    c.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
}

/** Malla de la cueva: túnel (paredes y techo) + piso, siguiendo el camino. */
export function buildCaveMesh(cave: CaveData): THREE.Group {
  const g = new THREE.Group();
  const M = 18;
  const pts = cave.pts;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const PAL = { lava: [0x2c2725, 0x4a3e37, 0x3a322d], karst: [0x6f6252, 0x9a8a72, 0x7b6d5c], ice: [0x6f9fc4, 0xbfe3ff, 0x9cc7e6] }[cave.kind];
  const cA = new THREE.Color(PAL[0]), cB = new THREE.Color(PAL[1]), tmp = new THREE.Color();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let dx = q.x - o.x, dz = q.z - o.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    const nx = -dz, nz = dx;
    const height = 4.2 + p.w * 0.45;
    for (let k = 0; k <= M; k++) {
      const a = Math.PI * (k / M); // de un lado del piso, por el techo, al otro lado
      const r = p.w + 0.8;
      const off = Math.cos(a) * r;
      const jitter = Math.sin(i * 1.7 + k * 2.3) * 0.35 + Math.sin(i * 0.43 + k) * 0.25;
      const y = p.floor - 0.3 + Math.sin(a) * height + jitter;
      pos.push(p.x + nx * (off + jitter), y, p.z + nz * (off + jitter));
      tmp.copy(cA).lerp(cB, 0.5 + 0.5 * Math.sin(i * 0.9 + k * 1.3));
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < M; k++) {
    const a = i * (M + 1) + k, b = a + M + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: cave.kind === "ice" ? 0.25 : 1, metalness: 0,
    side: THREE.DoubleSide, flatShading: cave.kind !== "ice", emissive: cave.kind === "ice" ? 0x0d2a44 : 0x000000 })));

  // piso: tira que sigue la altura física
  const fpos: number[] = [], fidx: number[] = [];
  const S = 12;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let dx = q.x - o.x, dz = q.z - o.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    for (let k = 0; k <= S; k++) {
      const off = (k / S - 0.5) * 2 * (p.w + 0.6);
      const x = p.x - dz * off, z = p.z + dx * off;
      fpos.push(x, cave.heightAt(x, z), z);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < S; k++) {
    const a = i * (S + 1) + k, b = a + S + 1;
    fidx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute("position", new THREE.Float32BufferAttribute(fpos, 3));
  fgeo.setIndex(fidx);
  fgeo.computeVertexNormals();
  g.add(new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({ color: PAL[2], roughness: cave.kind === "ice" ? 0.3 : 1, side: THREE.DoubleSide })));
  g.add(buildCaveDecor(cave));
  return g;
}

/** Decoración y peligros visibles de la cueva: estalactitas (kárstica), carámbanos (hielo), grietas, pozas y hielo. */
function buildCaveDecor(cave: CaveData): THREE.Group {
  const g = new THREE.Group();
  const pts = cave.pts;
  let seed = 77 + pts.length;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // conos colgando del techo
  if (cave.kind !== "lava") {
    const n = cave.kind === "karst" ? 260 : 200;
    const cone = new THREE.ConeGeometry(1, 1, 6, 1);
    cone.rotateX(Math.PI); // punta hacia abajo
    const mat = new THREE.MeshStandardMaterial(cave.kind === "karst" ? { color: 0xb8a68a, roughness: 0.8 }
      : { color: 0xdff3ff, roughness: 0.1, transparent: true, opacity: 0.85, emissive: 0x16344d });
    const inst = new THREE.InstancedMesh(cone, mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const i = 2 + Math.floor(rnd() * (pts.length - 4)), p = pts[i], o = pts[i + 1];
      const dx = o.x - p.x, dz = o.z - p.z, L = Math.hypot(dx, dz) || 1;
      const off = (rnd() * 2 - 1) * p.w * 0.6, h = 4.2 + p.w * 0.45;
      const len = 0.4 + rnd() * (cave.kind === "karst" ? 2.2 : 1.4), r = len * (0.12 + rnd() * 0.08);
      t.set(p.x - (dz / L) * off, p.floor - 0.3 + h * Math.sqrt(Math.max(0, 1 - (off / (p.w + 0.8)) ** 2)) - len / 2 + 0.3, p.z + (dx / L) * off);
      s.set(r, len, r);
      m4.compose(t, q, s);
      inst.setMatrixAt(k, m4);
    }
    g.add(inst);
  }
  // peligros del piso
  for (const h of cave.hazards) {
    if (h.kind === "rockfall") { // grietas en el techo: marca visual de zona de derrumbe
      const p = pts[h.i0];
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.06, 4, 18), new THREE.MeshBasicMaterial({ color: 0x2a1a10 }));
      m.position.set(p.x, p.floor + 4 + p.w * 0.45, p.z);
      m.rotation.x = Math.PI / 2;
      g.add(m);
      continue;
    }
    const pos: number[] = [], idx: number[] = [];
    for (let i = h.i0; i <= h.i1 + 1 && i < pts.length; i++) {
      const p = pts[i], o = pts[Math.min(pts.length - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      let dx = o.x - b.x, dz = o.z - b.z;
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const a = h.kind === "ice" ? -p.w : h.from, e = h.kind === "ice" ? p.w : p.w + 0.6;
      // lateral +: izquierda del avance (−dz, dx)
      const lx = -dz * h.side, lz = dx * h.side;
      for (const off of [a, e]) pos.push(p.x + lx * off, p.floor + (h.kind === "crevice" ? 0.03 : 0.06), p.z + lz * off);
    }
    for (let k = 0; k < pos.length / 6 - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = h.kind === "crevice" ? new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide })
      : h.kind === "pool" ? new THREE.MeshStandardMaterial({ color: 0x2b5d78, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: 0xcfeaff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}
