// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Escaneo 3D del lugar → mapa jugable. La página NO puede usar el LiDAR del iPhone (Safari no tiene WebXR): el
// escaneo se hace con una app gratis (p. ej. Scaniverse, iPhone y Android) que exporta GLB/OBJ/PLY en metros.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { fromScan, type ArenaSpec, type Floor } from "../game/core/arena";

export async function loadScan(file: File): Promise<THREE.Object3D> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".glb") || name.endsWith(".gltf")) {
    const g = await new GLTFLoader().parseAsync(buf, "");
    return g.scene;
  }
  if (name.endsWith(".obj")) return new OBJLoader().parse(new TextDecoder().decode(buf));
  if (name.endsWith(".ply")) {
    const geo = new PLYLoader().parse(buf);
    const hasFaces = !!geo.index && geo.index.count > 0;
    if (hasFaces) { geo.computeVertexNormals(); return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: !!geo.attributes.color })); }
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.04, vertexColors: !!geo.attributes.color }));
  }
  throw new Error("Formato no soportado: usa .glb, .gltf, .obj o .ply");
}

/** Muestras (x, y, z, ny) de la superficie en metros, con "arriba" = +y. `zUp` gira modelos que vienen con Z arriba. */
export function samplePoints(obj: THREE.Object3D, zUp: boolean, scale = 1, max = 400000): Float32Array {
  const root = new THREE.Group();
  root.add(obj);
  if (zUp) obj.rotation.x = -Math.PI / 2;
  obj.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [], clouds: THREE.Points[] = [];
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); else if ((o as THREE.Points).isPoints) clouds.push(o as THREE.Points); });
  const out: number[] = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  // área total para repartir las muestras
  const areas = meshes.map((m) => { const g = m.geometry; const pos = g.attributes.position; let a = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), cnt = g.index ? g.index.count : pos.count;
    for (let i = 0; i < cnt; i += 3) {
      const ia = g.index ? g.index.getX(i) : i, ib = g.index ? g.index.getX(i + 1) : i + 1, ic = g.index ? g.index.getX(i + 2) : i + 2;
      A.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld); B.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld); C.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      a += B.sub(A).cross(C.sub(A)).length() / 2;
    }
    return a; });
  const totA = areas.reduce((a, b) => a + b, 0) || 1;
  meshes.forEach((m, k) => {
    // sin normales: se calculan por CARA (sin índice). Con vértices compartidos entre caras opuestas (mallas de dos
    // lados) el promedio daría normales nulas y el piso no se detectaría.
    if (!m.geometry.attributes.normal) { if (m.geometry.index) m.geometry = m.geometry.toNonIndexed(); m.geometry.computeVertexNormals(); }
    const sampler = new MeshSurfaceSampler(m).build();
    const cnt = Math.min(max, Math.max(500, Math.round((areas[k] / totA) * max)));
    nm.getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < cnt; i++) {
      sampler.sample(p, n);
      p.applyMatrix4(m.matrixWorld);
      n.applyMatrix3(nm).normalize();
      out.push(p.x, p.y, p.z, n.y);
    }
  });
  for (const c of clouds) {  // nube de puntos (sin caras): se toma cada punto, "arriba" = se decide por altura
    const pos = c.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / max));
    for (let i = 0; i < pos.count; i += step) { p.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld); out.push(p.x, p.y, p.z, 1); }
  }
  root.remove(obj);
  return new Float32Array(out);
}

/** Convierte el escaneo en arena y deja la malla centrada (mismo corrimiento que la rejilla) para dibujarla. */
export function scanToArena(obj: THREE.Object3D, zUp: boolean, scale: number, o: { name: string; indoor: boolean; floor: Floor; elev0?: number }): { spec: ArenaSpec; object: THREE.Object3D } {
  const pts = samplePoints(obj, zUp, scale);
  const spec = fromScan(pts, o);
  const holder = new THREE.Group();
  holder.add(obj);
  holder.position.set(-(spec.offset?.cx ?? 0), -(spec.offset?.base ?? 0), -(spec.offset?.cz ?? 0));
  return { spec, object: holder };
}
