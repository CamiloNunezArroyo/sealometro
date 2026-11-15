// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Escena del "lugar jugable" (arena): piso con textura según el tipo de suelo (teñida con el color medido en las
// fotos), paredes con zócalo y columnas, techo con vigas y luces si es cerrado, reja + entorno si es al aire libre,
// fotos reales del lugar como cuadros y la malla del escaneo 3D con sus texturas originales.
// HONESTIDAD: la FORMA y el TAMAÑO vienen de lo que midió el equipo; texturas, techo, columnas, árboles y edificios
// de alrededor son decoración de juego (texturas generadas en el navegador, sin archivos externos).
// Con el análisis de fotos (station/sceneFromPhotos.ts): las PAREDES son la franja media real de cada foto/fotograma en
// su dirección (panorámica), el piso puede ser un recorte real de la foto y el techo toma el color medido; la cantidad
// de muebles sale de los bordes de las fotos. Al aire libre con GPS: edificios, árboles, canchas y calles REALES de
// OpenStreetMap y relieve de Open-Meteo (station/osm.ts). Si no hay nada de eso, queda el entorno de juego de siempre.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { freeBounds, insidePolygon, type ArenaSpec, type Floor, type Prop } from "../core/arena";
import { rng } from "../core/terrain";
import { elevAt, type ElevRing, type OsmScene } from "../../station/osm";

type RGB = [number, number, number];
const FLOOR_RGB: Record<Floor, RGB> = {
  cemento: [160, 156, 148], interior: [207, 198, 180], pasto: [93, 138, 60], tierra: [138, 106, 72], arena: [209, 184, 137],
};
/** Color base del piso: el medido en las fotos (si hay) o uno típico del tipo de suelo. */
export function floorRgb(floor: Floor, tint?: RGB): RGB {
  if (!tint) return FLOOR_RGB[floor];
  const lum = (tint[0] * 0.3 + tint[1] * 0.59 + tint[2] * 0.11) / 255, k = lum < 0.18 ? 0.18 / Math.max(0.02, lum) : lum > 0.9 ? 0.9 / lum : 1;
  return tint.map((v) => Math.max(0, Math.min(255, v * k))) as RGB;
}
/** Color del terreno de alrededor (de juego) para lugares al aire libre. */
export function outsideRgb(floor: Floor, tint?: RGB): RGB {
  if (floor === "pasto") return floorRgb(floor, tint).map((v) => v * 0.85) as RGB;
  if (floor === "tierra" || floor === "arena") return floorRgb(floor, tint).map((v) => v * 0.92) as RGB;
  return [118, 128, 84]; // cancha de cemento: alrededor, pasto seco
}
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const hex = (c: RGB) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

function canvasTex(px: number, draw: (ctx: CanvasRenderingContext2D, px: number, R: () => number) => void, seed = 7): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  draw(ctx, px, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function speckle(ctx: CanvasRenderingContext2D, px: number, R: () => number, n: number, a: number) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = R() < 0.5 ? `rgba(0,0,0,${a * R()})` : `rgba(255,255,255,${a * R()})`;
    ctx.fillRect(R() * px, R() * px, 1 + R() * 1.6, 1 + R() * 1.6);
  }
}
/** Manchas suaves que se repiten bien en los bordes (se dibujan también corridas una baldosa). */
function blotches(ctx: CanvasRenderingContext2D, px: number, R: () => number, n: number, a: number) {
  for (let i = 0; i < n; i++) {
    const x = R() * px, y = R() * px, r = px * (0.06 + R() * 0.16), dark = R() < 0.6;
    for (const dx of [-px, 0, px]) for (const dy of [-px, 0, px]) {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, dark ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    }
  }
}

/** Textura del piso (CanvasTexture) y cuántos metros cubre una repetición. */
export function floorTexture(floor: Floor, tint: RGB | undefined, mobile: boolean): { map: THREE.CanvasTexture | null; tileM: number; roughness: number } {
  const base = floorRgb(floor, tint), px = mobile ? 256 : 512;
  const tileM = floor === "cemento" ? 6 : floor === "interior" ? 2 : 4;
  const map = canvasTex(px, (ctx, P, R) => {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, P, P);
    if (floor === "cemento") {          // losas de 3 m con juntas, manchas y alguna grieta
      blotches(ctx, P, R, 14, 0.07);
      speckle(ctx, P, R, P * 14, 0.16);
      for (const q of [0, P / 2]) {
        ctx.fillStyle = "rgba(0,0,0,0.38)"; ctx.fillRect(q - 1.5, 0, 3, P); ctx.fillRect(0, q - 1.5, P, 3);
        ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(q + 1.5, 0, 1.5, P); ctx.fillRect(0, q + 1.5, P, 1.5);
      }
      ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        let x = R() * P, y = R() * P;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let i = 0; i < 9; i++) { x += (R() - 0.5) * P * 0.08; y += (R() - 0.2) * P * 0.05; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    } else if (floor === "interior") {  // baldosas de 50 cm con junta y brillo suave
      const n = 4, t = P / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        ctx.fillStyle = R() < 0.5 ? `rgba(0,0,0,${R() * 0.07})` : `rgba(255,255,255,${R() * 0.08})`;
        ctx.fillRect(i * t, j * t, t, t);
        const g = ctx.createLinearGradient(i * t, j * t, (i + 1) * t, (j + 1) * t);
        g.addColorStop(0, "rgba(255,255,255,0.07)"); g.addColorStop(1, "rgba(0,0,0,0.05)");
        ctx.fillStyle = g; ctx.fillRect(i * t, j * t, t, t);
      }
      speckle(ctx, P, R, P * 5, 0.07);
      ctx.fillStyle = "rgba(40,36,30,0.55)";
      for (let i = 0; i < n; i++) { ctx.fillRect(i * t - 1, 0, 2.5, P); ctx.fillRect(0, i * t - 1, P, 2.5); }
    } else if (floor === "pasto") {     // hojitas de varios verdes
      blotches(ctx, P, R, 22, 0.1);
      for (let i = 0; i < P * 26; i++) {
        const x = R() * P, y = R() * P, l = 3 + R() * 6, a = -Math.PI / 2 + (R() - 0.5) * 1.6;
        ctx.strokeStyle = R() < 0.55 ? `rgba(18,52,10,${0.15 + R() * 0.25})` : `rgba(196,224,120,${0.1 + R() * 0.22})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
    } else if (floor === "tierra") {    // tierra con piedritas
      blotches(ctx, P, R, 20, 0.09);
      speckle(ctx, P, R, P * 22, 0.2);
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = R() < 0.5 ? `rgba(60,44,30,${0.3 + R() * 0.3})` : `rgba(210,196,170,${0.25 + R() * 0.3})`;
        ctx.beginPath(); ctx.ellipse(R() * P, R() * P, 1.5 + R() * 3.5, 1 + R() * 2.5, R() * 3, 0, 7); ctx.fill();
      }
    } else {                            // arena con ondas
      blotches(ctx, P, R, 12, 0.06);
      for (let y = 0; y < P; y += P / 32) {
        const ph = R() * 6;
        for (const [dy, col] of [[0, "rgba(0,0,0,0.09)"], [2, "rgba(255,255,255,0.1)"]] as const) {
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath();
          for (let x = 0; x <= P; x += 8) { const yy = y + dy + Math.sin((x / P) * Math.PI * 4 + ph) * 3; if (x) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); }
          ctx.stroke();
        }
      }
      speckle(ctx, P, R, P * 12, 0.12);
    }
  }, 11 + floor.length);
  if (map) map.repeat.set(1 / tileM, 1 / tileM);
  return { map, tileM, roughness: floor === "interior" ? 0.42 : floor === "cemento" ? 0.85 : 0.97 };
}

function plasterTexture(mobile: boolean) {      // pared pintada: grano fino, manchas leves y juntas verticales tenues
  const t = canvasTex(mobile ? 128 : 256, (ctx, P, R) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, P, P);
    blotches(ctx, P, R, 10, 0.05);
    speckle(ctx, P, R, P * 10, 0.08);
    ctx.fillStyle = "rgba(0,0,0,0.07)"; ctx.fillRect(0, 0, 1.5, P); ctx.fillRect(P / 2, 0, 1.5, P);
  }, 23);
  if (t) t.repeat.set(1 / 3, 1 / 3);
  return t;
}
function ceilingTexture(mobile: boolean) {      // cielo raso de placas de 1,2 m
  const t = canvasTex(mobile ? 128 : 256, (ctx, P, R) => {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, P, P);
    speckle(ctx, P, R, P * 8, 0.06);
    ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(0, 0, P, 2); ctx.fillRect(0, 0, 2, P);
  }, 29);
  if (t) t.repeat.set(1 / 1.2, 1 / 1.2);
  return t;
}
function fenceTexture() {                       // malla olímpica (rombos) con transparencia
  const t = canvasTex(64, (ctx, P) => {
    ctx.clearRect(0, 0, P, P);
    ctx.strokeStyle = "rgba(190,198,206,1)"; ctx.lineWidth = 3;
    ctx.beginPath();
    for (const o of [-P, 0, P]) { ctx.moveTo(o, 0); ctx.lineTo(o + P, P); ctx.moveTo(o + P, 0); ctx.lineTo(o, P); }
    ctx.stroke();
  }, 31);
  if (t) t.repeat.set(1 / 0.25, 1 / 0.25);
  return t;
}

/** Normal 2D hacia ADENTRO del contorno para el lado a→b. */
function inward(P: [number, number][], a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  const n: [number, number] = [dz / L, -dx / L], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  return insidePolygon(P, mx + n[0] * 0.2, mz + n[1] * 0.2) ? n : [-n[0], -n[1]];
}
/** Franja vertical que sigue el contorno (pared, zócalo, reja). UV en metros. */
function wallStrip(P: [number, number][], y0: number, y1: number, inset: number, mat: THREE.Material): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], index: number[] = [];
  let run = 0;
  P.forEach((a, i) => {
    const b = P[(i + 1) % P.length], n = inward(P, a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = pos.length / 3;
    const ax = a[0] + n[0] * inset, az = a[1] + n[1] * inset, bx = b[0] + n[0] * inset, bz = b[1] + n[1] * inset;
    pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    uv.push(run, y0, run + L, y0, run + L, y1, run, y1);
    for (let q = 0; q < 4; q++) nor.push(n[0], 0, n[1]);
    index.push(k, k + 1, k + 2, k, k + 2, k + 3);
    run += L;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(index);
  mat.side = THREE.DoubleSide;
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}
/** Superficie horizontal con la forma del contorno (piso o techo). UV en metros. */
function flatShape(P: [number, number][], y: number, mat: THREE.Material): THREE.Mesh {
  const sh = new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  return m;
}
/** Cajas instanciadas (columnas, vigas, luces, postes): [x, y, z, sx, sy, sz, rotY]. */
function boxes(items: number[][], mat: THREE.Material, shadow = false): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, items.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  items.forEach(([x, y, z, sx, sy, sz, r], k) => { m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, r ?? 0), new THREE.Vector3(sx, sy, sz)); inst.setMatrixAt(k, m4); });
  inst.count = items.length;
  inst.castShadow = shadow;
  inst.receiveShadow = true;
  return inst;
}

/** Fotos reales del lugar como cuadros en las paredes (o lonas en la reja), con la proporción de cada foto. */
function photoFrames(P: [number, number][], photos: string[], wallH: number, indoor: boolean): THREE.Group {
  const g = new THREE.Group();
  const edges = P.map((a, i) => { const b = P[(i + 1) % P.length]; return { a, b, L: Math.hypot(b[0] - a[0], b[1] - a[1]), n: inward(P, a, b) }; });
  const total = edges.reduce((s, e) => s + e.L, 0);
  const ph = indoor ? Math.max(0.9, Math.min(2.0, wallH * 0.38)) : Math.min(1.0, wallH * 0.75);
  const yc = indoor ? Math.min(wallH - ph / 2 - 0.3, 1.25 + ph / 2) : wallH * 0.5 + 0.05;
  const loader = new THREE.TextureLoader();
  photos.slice(0, 8).forEach((src, k) => {
    let d = ((k + 0.5) / Math.min(8, photos.length)) * total, e = edges[0];
    for (const ed of edges) { e = ed; if (d <= ed.L) break; d -= ed.L; }
    // centrada en el tramo entre dos pilastras (cada ~5 m), para que ninguna columna la tape
    const nBay = Math.max(1, Math.round(e.L / 5)), bay = e.L / nBay, t = ((Math.min(nBay - 1, Math.floor(d / bay)) + 0.5) * bay) / e.L;
    const x = e.a[0] + (e.b[0] - e.a[0]) * t, z = e.a[1] + (e.b[1] - e.a[1]) * t;
    const frame = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05), new THREE.MeshStandardMaterial({ color: 0x33291f, roughness: 0.7 }));
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x777777 }));
    pic.position.z = 0.03;
    const size = (aspect: number) => { const w = Math.min(ph * aspect, bay - 0.8, 3.4), h = w / aspect; pic.scale.set(w, h, 1); back.scale.set(w + 0.14, h + 0.14, 1); };
    size(4 / 3);
    loader.load(src, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = pic.material as THREE.MeshBasicMaterial;
      mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
      const im = tex.image as { width?: number; height?: number };
      if (im?.width && im?.height) size(im.width / im.height);
    });
    frame.add(back, pic);
    frame.position.set(x + e.n[0] * 0.07, yc, z + e.n[1] * 0.07);
    frame.rotation.y = Math.atan2(e.n[0], e.n[1]);
    g.add(frame);
  });
  return g;
}

/** Entorno de juego para lugares al aire libre: suelo hasta el horizonte, árboles, edificios lejanos y cerros. */
function outdoorSurround(s: ArenaSpec, ground: RGB, mobile: boolean): THREE.Group {
  const g = new THREE.Group(), b = freeBounds(s), R = rng(4242), rIn = Math.hypot(b.w, b.l) / 2 + 3;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshStandardMaterial({ color: hex(ground), roughness: 1 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(b.cx, -0.09, b.cz);
  disc.receiveShadow = true;
  g.add(disc);
  const nT = mobile ? 36 : 80;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), nT);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), nT);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let k = 0; k < nT; k++) {
    const a = R() * Math.PI * 2, r = rIn + 2 + R() * R() * 90, x = b.cx + Math.cos(a) * r, z = b.cz + Math.sin(a) * r, h = 2 + R() * 2.5, w = 1.2 + R() * 1.3;
    m4.makeScale(1, h, 1).setPosition(x, h / 2, z); trunk.setMatrixAt(k, m4);
    m4.makeScale(w, w * (0.9 + R() * 0.5), w).setPosition(x, h + w * 0.55, z); crown.setMatrixAt(k, m4);
    crown.setColorAt(k, col.setHSL(0.25 + R() * 0.1, 0.35 + R() * 0.25, 0.22 + R() * 0.14));
  }
  crown.castShadow = trunk.castShadow = !mobile;
  g.add(trunk, crown);
  const bl: number[][] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + R() * 0.4, r = rIn + 28 + R() * 80, w = 8 + R() * 14, h = 3.5 + R() * 9;
    bl.push([b.cx + Math.cos(a) * r, h / 2, b.cz + Math.sin(a) * r, w, h, 6 + R() * 10, R() * Math.PI]);
  }
  const build = boxes(bl, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
  bl.forEach((_, k) => build.setColorAt(k, col.setHSL(0.07 + R() * 0.06, 0.12 + R() * 0.2, 0.55 + R() * 0.25)));
  g.add(build);
  const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshStandardMaterial({ color: 0x5e6f58, roughness: 1 }));
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + R(), r = 520 + R() * 160, m = hill.clone();
    m.scale.set(170 + R() * 150, 45 + R() * 60, 170 + R() * 150);
    m.position.set(b.cx + Math.cos(a) * r, -6, b.cz + Math.sin(a) * r);
    g.add(m);
  }
  return g;
}

/** Paredes hechas con las fotos: cada imagen cubre el tramo de pared que se ve desde el centro en su rango de ángulo
 *  (0 = norte del mapa, girando a la derecha, como gira la persona al grabar). UV: u = ángulo dentro del tramo, v = alto. */
export function photoWallPieces(P: [number, number][], walls: { a0: number; a1: number }[], center: [number, number], step = 0.4) {
  const TAU = 2 * Math.PI, A0 = -Math.PI / 2;
  const ang = (q: [number, number]) => (((Math.atan2(q[1] - center[1], q[0] - center[0]) - A0) % TAU) + TAU) % TAU;
  const out = walls.map(() => [] as { a: [number, number]; b: [number, number]; u0: number; u1: number; n: [number, number] }[]);
  P.forEach((a, i) => {
    const b = P[(i + 1) % P.length], n = inward(P, a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < steps; k++) {
      const p0: [number, number] = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
      const p1: [number, number] = [a[0] + ((b[0] - a[0]) * (k + 1)) / steps, a[1] + ((b[1] - a[1]) * (k + 1)) / steps];
      const m = ang([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]);
      let w = walls.findIndex((x) => m >= x.a0 && m < x.a1);
      if (w < 0) w = walls.length - 1;
      const un = (q: [number, number]) => { let u = ang(q); if (u - m > Math.PI) u -= TAU; if (m - u > Math.PI) u += TAU; return (u - walls[w].a0) / (walls[w].a1 - walls[w].a0); };
      out[w].push({ a: p0, b: p1, u0: un(p0), u1: un(p1), n });
    }
  });
  return out;
}
function photoWalls(P: [number, number][], walls: { image: string; a0: number; a1: number }[], h: number, center: [number, number]): THREE.Group {
  const g = new THREE.Group(), loader = new THREE.TextureLoader();
  photoWallPieces(P, walls, center).forEach((pieces, w) => {
    if (!pieces.length) return;
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], index: number[] = [];
    for (const p of pieces) {
      const k = pos.length / 3, ins = 0.02;
      const ax = p.a[0] + p.n[0] * ins, az = p.a[1] + p.n[1] * ins, bx = p.b[0] + p.n[0] * ins, bz = p.b[1] + p.n[1] * ins;
      pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
      uv.push(p.u0, 0, p.u1, 0, p.u1, 1, p.u0, 1);
      for (let q = 0; q < 4; q++) nor.push(p.n[0], 0, p.n[1]);
      index.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(index);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95, side: THREE.DoubleSide });
    loader.load(walls[w].image, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      mat.map = tex; mat.emissiveMap = tex; mat.emissive.set(0xffffff); mat.emissiveIntensity = 0.35; mat.color.set(0xffffff); mat.needsUpdate = true;
    });
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    g.add(m);
  });
  return g;
}

/** Muebles de juego (mesas, sillas, cajas, estantes) hechos de cajas instanciadas. */
function propMeshes(props: Prop[]): THREE.Group {
  const g = new THREE.Group(), wood: number[][] = [], metal: number[][] = [], card: number[][] = [];
  for (const p of props) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const put = (list: number[][], ox: number, y: number, oz: number, sx: number, sy: number, sz: number) =>
      list.push([p.x + ox * c + oz * s, y, p.z - ox * s + oz * c, sx, sy, sz, p.rot]);
    const legs = (y: number) => { for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) put(metal, a * (p.w / 2 - 0.05), y / 2, b * (p.l / 2 - 0.05), 0.05, y, 0.05); };
    if (p.kind === "mesa") { put(wood, 0, p.h - 0.025, 0, p.w, 0.05, p.l); legs(p.h - 0.05); }
    else if (p.kind === "silla") { put(wood, 0, 0.45, 0, p.w, 0.05, p.l); put(wood, 0, 0.7, -p.l / 2 + 0.03, p.w, 0.45, 0.04); legs(0.43); }
    else if (p.kind === "caja") put(card, 0, p.h / 2, 0, p.w, p.h, p.l);
    else { put(wood, -p.w / 2 + 0.03, p.h / 2, 0, 0.05, p.h, p.l); put(wood, p.w / 2 - 0.03, p.h / 2, 0, 0.05, p.h, p.l); for (let k = 0; k < 4; k++) put(wood, 0, 0.15 + (k * (p.h - 0.2)) / 3, 0, p.w, 0.04, p.l); }
  }
  if (wood.length) g.add(boxes(wood, new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 }), true));
  if (metal.length) g.add(boxes(metal, new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.5, metalness: 0.5 }), true));
  if (card.length) g.add(boxes(card, new THREE.MeshStandardMaterial({ color: 0xb38b5d, roughness: 0.95 }), true));
  return g;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function meshOf(pos: number[], index: number[], mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}
/** Alrededor REAL (OpenStreetMap + relieve Open-Meteo). Lo que OSM no dice (colores, alturas sin dato) es de juego. */
function osmSurround(s: ArenaSpec, osm: OsmScene, elev: ElevRing | undefined, ground: RGB, mobile: boolean): THREE.Group {
  const g = new THREE.Group(), b = freeBounds(s), rIn = Math.hypot(b.w, b.l) / 2 + 3, P = s.polygon ?? [];
  const hAt = (x: number, z: number) => (elev ? elevAt(elev, x, z) * smooth(rIn + 8, rIn + 60, Math.hypot(x - b.cx, z - b.cz)) : 0);
  const nearArena = (x: number, z: number) => Math.hypot(x - b.cx, z - b.cz) < rIn || (P.length >= 3 && insidePolygon(P, x, z));
  // suelo: disco polar con la altura real (si hay); adentro, plano y apenas debajo del piso del lugar
  {
    const radii = [0, rIn + 8, rIn + 30, rIn + 60, 120, 180, 250, 350, 450, 600, 800, 1000].filter((r, i, a) => i === 0 || r > a[i - 1]), nA = 48;
    const pos: number[] = [], index: number[] = [];
    for (let k = 0; k < radii.length; k++) for (let a = 0; a < nA; a++) {
      const t = (a / nA) * 2 * Math.PI, x = b.cx + Math.cos(t) * radii[k], z = b.cz + Math.sin(t) * radii[k];
      pos.push(x, hAt(x, z) - 0.09, z);
    }
    for (let k = 0; k + 1 < radii.length; k++) for (let a = 0; a < nA; a++) {
      const p0 = k * nA + a, p1 = k * nA + ((a + 1) % nA);
      index.push(p0, p1 + nA, p0 + nA, p0, p1, p1 + nA);
    }
    g.add(meshOf(pos, index, new THREE.MeshStandardMaterial({ color: hex(ground), roughness: 1, side: THREE.DoubleSide })));
  }
  // superficies planas (verde, agua, canchas) pegadas al relieve
  const addFlat = (polys: [number, number][][], color: number, off: number) => {
    const geos: THREE.BufferGeometry[] = [];
    for (const poly of polys) {
      try {
        const geo = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z))));
        geo.rotateX(-Math.PI / 2);
        geo.deleteAttribute("uv");
        const p = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)) - 0.05);
        geos.push(geo.index ? geo.toNonIndexed() : geo);
      } catch { /* contorno roto en OSM */ }
    }
    if (!geos.length) return;
    const geo = mergeGeometries(geos);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off }));
    m.receiveShadow = true;
    g.add(m);
  };
  addFlat(osm.green.map((x) => x.poly), 0x5d7f45, -1);
  addFlat(osm.water, 0x4f86b5, -2);
  const otherPitches = osm.pitches.filter((p) => p.kind !== "stadium" && !(P.length >= 3 && insidePolygon(p.poly, b.cx, b.cz)) && !insidePolygon(p.poly, b.cx, b.cz));
  const grassy = (p: { surface?: string }) => /grass|turf/.test(p.surface ?? "grass");
  addFlat(otherPitches.filter(grassy).map((p) => p.poly), 0x4f9a48, -3);
  addFlat(otherPitches.filter((p) => !grassy(p)).map((p) => p.poly), 0xb08a64, -3);
  // cintas: calles (planas, siguen el relieve) y muros/rejas (verticales)
  const outside = (line: [number, number][]) => line.some(([x, z]) => !nearArena(x, z));
  const ribbons = (lines: { line: [number, number][]; width: number }[], color: number, off: number) => {
    const pos: number[] = [], index: number[] = [];
    for (const r of lines) for (let i = 0; i + 1 < r.line.length; i++) {
      const [ax, az] = r.line[i], [bx, bz] = r.line[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const nx = ((-(bz - az) / L) * r.width) / 2, nz = (((bx - ax) / L) * r.width) / 2, n = Math.max(1, Math.ceil(L / 12));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1, q = pos.length / 3;
        for (const [x, z] of [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz]]) pos.push(x, hAt(x, z) - 0.04, z);
        index.push(q, q + 1, q + 2, q, q + 2, q + 3);
      }
    }
    if (pos.length) g.add(meshOf(pos, index, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off })));
  };
  const isFoot = (k: string) => /footway|path|steps|pedestrian|cycleway/.test(k);
  ribbons(osm.roads.filter((r) => r.kind === "waterway" && outside(r.line)), 0x4f86b5, -4);
  ribbons(osm.roads.filter((r) => isFoot(r.kind) && outside(r.line)), 0xb9b0a2, -5);
  ribbons(osm.roads.filter((r) => r.kind !== "waterway" && !isFoot(r.kind) && outside(r.line)), 0x4a4a4c, -6);
  {
    const pos: number[] = [], index: number[] = [];
    for (const r of osm.barriers) for (let i = 0; i + 1 < r.line.length; i++) {
      const [ax, az] = r.line[i], [bx, bz] = r.line[i + 1];
      if (nearArena(ax, az) && nearArena(bx, bz)) continue;
      const q = pos.length / 3, ya = hAt(ax, az), yb = hAt(bx, bz);
      pos.push(ax, ya - 0.3, az, bx, yb - 0.3, bz, bx, yb + r.h, bz, ax, ya + r.h, az);
      index.push(q, q + 1, q + 2, q, q + 2, q + 3);
    }
    if (pos.length) g.add(meshOf(pos, index, new THREE.MeshStandardMaterial({ color: 0xcfc6b6, roughness: 0.95, side: THREE.DoubleSide })));
  }
  // edificios: el contorno real de OSM extruido a su altura (OSM, pisos × 3 m o típica de juego)
  const R = rng(99), col = new THREE.Color(), geos: THREE.BufferGeometry[] = [];
  for (const bd of osm.buildings.slice(0, mobile ? 220 : 500)) {
    if (bd.poly.some(([x, z]) => nearArena(x, z))) continue;
    try {
      const hs = bd.poly.map(([x, z]) => hAt(x, z)), base = Math.min(...hs) - 1, top = Math.max(...hs) + bd.h;
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(bd.poly.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: top - base, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, base, 0);
      geo.deleteAttribute("uv");
      const flatGeo = geo.index ? geo.toNonIndexed() : geo, n = flatGeo.attributes.position.count, c = new Float32Array(n * 3);
      col.setHSL(0.08 + R() * 0.05, 0.08 + R() * 0.18, bd.hFrom === "default" ? 0.7 + R() * 0.14 : 0.8 + R() * 0.1, THREE.SRGBColorSpace);
      for (let i = 0; i < n; i++) { c[3 * i] = col.r; c[3 * i + 1] = col.g; c[3 * i + 2] = col.b; }
      flatGeo.setAttribute("color", new THREE.BufferAttribute(c, 3));
      geos.push(flatGeo);
    } catch { /* contorno roto en OSM: se salta */ }
  }
  if (geos.length) {
    const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
    m.castShadow = !mobile; m.receiveShadow = true;
    g.add(m);
  }
  // árboles: cada árbol que OSM tiene marcado (forma y tamaño de juego)
  const trees = osm.trees.filter(([x, z]) => !nearArena(x, z)).slice(0, mobile ? 150 : 400);
  if (trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), trees.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), trees.length);
    const m4 = new THREE.Matrix4();
    trees.forEach(([x, z], k) => {
      const y = hAt(x, z), h = 2.5 + R() * 2.5, w = 1.6 + R() * 1.4;
      m4.makeScale(1, h, 1).setPosition(x, y + h / 2, z); trunk.setMatrixAt(k, m4);
      m4.makeScale(w, w * (0.9 + R() * 0.5), w).setPosition(x, y + h + w * 0.55, z); crown.setMatrixAt(k, m4);
      crown.setColorAt(k, col.setHSL(0.25 + R() * 0.1, 0.35 + R() * 0.25, 0.22 + R() * 0.14));
    });
    crown.castShadow = trunk.castShadow = !mobile;
    g.add(trunk, crown);
  }
  return g;
}
/** ¿Hay suficiente en OSM para reemplazar el entorno genérico? */
export const osmUsable = (o?: OsmScene) => !!o && o.counts.buildings + o.counts.trees + o.counts.pitches + o.counts.roads >= 3;

/** Deja la malla del escaneo con sus materiales/texturas originales, visible de los dos lados y sin verse negra. */
function prepareScan(scan: THREE.Object3D, base: RGB) {
  scan.traverse((o) => {
    o.castShadow = false; o.receiveShadow = true;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const hasColor = !!geo.attributes.color;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((x) => {
      x.side = THREE.DoubleSide; // los escaneos traen caras de un solo lado
      const st = x as THREE.MeshStandardMaterial;
      if (st.isMeshStandardMaterial) {
        st.metalness = 0; st.roughness = Math.max(0.85, st.roughness); // sin esto un GLB "metálico" se ve negro (no hay reflejos)
        if (st.map) { st.emissive = new THREE.Color(0xffffff); st.emissiveMap = st.map; st.emissiveIntensity = 0.3; } // la textura real nunca queda a oscuras
        else if (!hasColor) { if (st.color.getHex() === 0xffffff) st.color.copy(hex(base)); st.flatShading = true; } // sin textura: caras planas para que se lea la forma
      }
      x.needsUpdate = true;
    });
  });
}

export interface ArenaSceneOut { group: THREE.Group; ceilH: number | null }
/**
 * Arma todo lo visual del lugar. `ceilH` = altura bajo la que debe quedarse la cámara (lugares cerrados).
 */
export interface ArenaSceneInput {
  spec: ArenaSpec; scan?: THREE.Object3D; wallPhotos?: string[]; ground?: RGB;
  walls?: { image: string; a0: number; a1: number }[]; floorImage?: string; palette?: { wall?: RGB; ceiling?: RGB };
  osm?: OsmScene; elev?: ElevRing;
}
/** Entorno de afuera: el real de OSM si alcanza; si no, el de juego. */
function surround(a: ArenaSceneInput, mobile: boolean) {
  const s = a.spec, ground = outsideRgb(s.floor, a.ground);
  return osmUsable(a.osm) ? osmSurround(s, a.osm!, a.elev, ground, mobile) : outdoorSurround(s, ground, mobile);
}
/** Piso con el recorte real de la foto (repetido en espejo para que no se noten las uniones). */
function photoFloorMaterial(src: string, roughness: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness, metalness: 0 });
  new THREE.TextureLoader().load(src, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.repeat.set(1 / 1.6, 1 / 1.6);
    tex.anisotropy = 4;
    mat.map = tex; mat.color.set(0xffffff); mat.needsUpdate = true;
  });
  return mat;
}
export function buildArenaScenery(a: ArenaSceneInput, mobile: boolean): ArenaSceneOut {
  const s = a.spec, g = new THREE.Group(), base = floorRgb(s.floor, a.ground);
  let ceilH: number | null = null;
  if (a.scan) {
    prepareScan(a.scan, base);
    g.add(a.scan);
    if (s.indoor) {   // cáscara neutra alrededor: por los huecos del escaneo se ve una pared oscura, no el vacío
      const box = new THREE.Box3().setFromObject(a.scan), sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const top = Math.max(2.4, box.max.y);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(sz.x + 1.2, top + 0.5, sz.z + 1.2), new THREE.MeshStandardMaterial({ color: 0x4d4944, roughness: 1, side: THREE.BackSide }));
      shell.position.set(c.x, (top + 0.5) / 2 - 0.3, c.z);
      g.add(shell);
      ceilH = top;
    } else g.add(surround(a, mobile));
    return { group: g, ceilH };
  }
  const P = s.polygon ?? [];
  if (P.length < 3) return { group: g, ceilH };
  const h = s.wallH, b = freeBounds(s);
  // --- piso
  const ft = floorTexture(s.floor, a.ground, mobile);
  const floor = flatShape(P, 0, a.floorImage ? photoFloorMaterial(a.floorImage, ft.roughness)
    : new THREE.MeshStandardMaterial({ map: ft.map, color: ft.map ? 0xffffff : hex(base), roughness: ft.roughness, metalness: 0 }));
  floor.receiveShadow = true;
  g.add(floor);
  const edges = P.map((p, i) => { const q = P[(i + 1) % P.length]; return { a: p, b: q, L: Math.hypot(q[0] - p[0], q[1] - p[1]), n: inward(P, p, q) }; });
  const fromPhotos = s.indoor && !!a.walls?.length;
  if (s.indoor) {
    if (fromPhotos) {
      // --- paredes = las fotos del lugar, cada una en su dirección (panorámica del video o fotos en orden)
      g.add(photoWalls(P, a.walls!, h, [b.cx, b.cz]));
    } else {
      // --- paredes de piso a techo: zócalo oscuro, franja baja y pared clara con textura (teñida con el color medido)
      const plaster = plasterTexture(mobile), wc = a.palette?.wall ? hex(floorRgb("interior", a.palette.wall)) : new THREE.Color(0xe9e3d6);
      g.add(wallStrip(P, 0, 0.14, 0.03, new THREE.MeshStandardMaterial({ color: 0x57514a, roughness: 0.8 })));
      g.add(wallStrip(P, 0, Math.min(1.1, h * 0.3), 0.012, new THREE.MeshStandardMaterial({ color: wc.clone().multiplyScalar(0.8), map: plaster, roughness: 0.9 })));
      g.add(wallStrip(P, 0, h, 0, new THREE.MeshStandardMaterial({ color: wc, map: plaster, roughness: 0.95 })));
      // --- columnas en las esquinas y pilastras cada ~5 m
      const cols: number[][] = [];
      for (const e of edges) {
        const ang = Math.atan2(e.n[0], e.n[1]), nP = Math.max(1, Math.round(e.L / 5));
        cols.push([e.a[0], h / 2, e.a[1], 0.5, h, 0.5, ang]);
        for (let k = 1; k < nP; k++) { const t = k / nP; cols.push([e.a[0] + (e.b[0] - e.a[0]) * t + e.n[0] * 0.08, h / 2, e.a[1] + (e.b[1] - e.a[1]) * t + e.n[1] * 0.08, 0.34, h, 0.18, ang]); }
      }
      g.add(boxes(cols, new THREE.MeshStandardMaterial({ color: 0xd3ccbd, roughness: 0.9 })));
    }
    // --- techo (color medido en la franja de arriba de las fotos, si hay), vigas y luminarias (de juego)
    const cc = a.palette?.ceiling ? hex(floorRgb("interior", a.palette.ceiling)) : new THREE.Color(0xe4dfd4);
    const ceil = flatShape(P, h, new THREE.MeshStandardMaterial({ color: cc, map: ceilingTexture(mobile), roughness: 1, side: THREE.DoubleSide, emissive: 0x2a2824 }));
    g.add(ceil);
    const alongX = b.w >= b.l, span = (alongX ? b.l : b.w) + 0.4, long = alongX ? b.w : b.l, nB = Math.max(2, Math.round(long / 4));
    const beams: number[][] = [], lamps: number[][] = [];
    for (let k = 0; k < nB; k++) {
      const u = -long / 2 + ((k + 0.5) / nB) * long;
      beams.push(alongX ? [b.cx + u, h - 0.2, b.cz, 0.22, 0.4, span] : [b.cx, h - 0.2, b.cz + u, span, 0.4, 0.22]);
      const nL = Math.max(1, Math.round((span - 0.4) / 5));
      for (let q = 0; q < nL; q++) {
        const v = -span / 2 + ((q + 0.5) / nL) * span, x = alongX ? b.cx + u : b.cx + v, z = alongX ? b.cz + v : b.cz + u;
        if (insidePolygon(P, x, z)) lamps.push(alongX ? [x, h - 0.45, z, 0.26, 0.06, 1.3] : [x, h - 0.45, z, 1.3, 0.06, 0.26]);
      }
    }
    g.add(boxes(beams, new THREE.MeshStandardMaterial({ color: 0x73777c, roughness: 0.6, metalness: 0.3 })));
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, toneMapped: false, fog: false });
    g.add(boxes(lamps, lampMat));
    ceilH = h;
  } else {
    // --- reja con postes y cordón; alrededor, entorno de juego (no un vacío)
    g.add(wallStrip(P, 0, 0.14, 0, new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.9 })));
    const ftex = fenceTexture();
    g.add(wallStrip(P, 0.14, h, 0, ftex ? new THREE.MeshStandardMaterial({ map: ftex, alphaTest: 0.35, roughness: 0.6, metalness: 0.1 })
      : new THREE.MeshStandardMaterial({ color: 0x9aa7b4, transparent: true, opacity: 0.5 })));
    g.add(wallStrip(P, h - 0.05, h, 0, new THREE.MeshStandardMaterial({ color: 0x7c858e, roughness: 0.5, metalness: 0.5 })));
    const posts: number[][] = [];
    for (const e of edges) { const nP = Math.max(1, Math.round(e.L / 2.5)); for (let k = 0; k < nP; k++) { const t = k / nP; posts.push([e.a[0] + (e.b[0] - e.a[0]) * t, h / 2, e.a[1] + (e.b[1] - e.a[1]) * t, 0.07, h, 0.07, 0]); } }
    g.add(boxes(posts, new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.5, metalness: 0.6 }), !mobile));
    g.add(surround(a, mobile));
  }
  if (s.props?.length) g.add(propMeshes(s.props));
  const photos = fromPhotos ? [] : a.wallPhotos ?? [];   // con paredes de fotos, las fotos YA son la pared
  if (photos.length) g.add(photoFrames(P, photos, h, s.indoor));
  return { group: g, ceilH };
}

/** Baliza del perímetro (de juego): cono con luz que se pone verde al pasar. */
export function buildBeacon(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x35c8ff, emissive: 0x1486c8, emissiveIntensity: 0.9, roughness: 0.4 });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 10), mat);
  cone.position.y = 0.25;
  cone.name = "cone";
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 6, 28), new THREE.MeshBasicMaterial({ color: 0x35c8ff }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  ring.name = "ring";
  g.add(cone, ring);
  return g;
}
