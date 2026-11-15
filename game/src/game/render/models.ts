// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Modelos 3D hechos con geometría simple (sin archivos externos ni logos): rover de 6 ruedas, base, estación,
// muestras, puertas, repetidor y fumarolas.
import * as THREE from "three";

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.15, ...extra });

export interface RoverModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  head: THREE.Object3D;
  lights: THREE.SpotLight[];
  beacon: THREE.Mesh;
}

export function buildRover(): RoverModel {
  const g = new THREE.Group();
  const white = mat(0xe8ebef, { roughness: 0.5 });
  const dark = mat(0x2b2f36, { roughness: 0.9 });
  const gold = mat(0xc9a35a, { metalness: 0.6, roughness: 0.35 });
  const blue = mat(0x1f3b6f, { metalness: 0.3, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 2.6), white);
  body.position.y = 0.55;
  body.castShadow = true;
  g.add(body);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 1.2), blue); // panel solar
  deck.position.set(0, 0.87, -0.55);
  deck.castShadow = true;
  g.add(deck);
  const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 12), gold);
  rtg.rotation.x = Math.PI / 2.6;
  rtg.position.set(0, 0.8, -1.45);
  g.add(rtg);
  // mástil con cabeza de cámaras
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 8), white);
  mast.position.set(0.55, 1.5, 0.95);
  g.add(mast);
  const head = new THREE.Group();
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.3), white);
  head.add(headBox);
  const eyeL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10), dark);
  eyeL.rotation.x = Math.PI / 2;
  eyeL.position.set(-0.12, 0, 0.17);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.12;
  head.add(eyeL, eyeR);
  head.position.set(0.55, 2.25, 0.95);
  g.add(head);
  // antena de alta ganancia
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.1, 0.08, 16), white);
  dish.rotation.x = -Math.PI / 3;
  dish.position.set(-0.6, 1.1, 0.35);
  g.add(dish);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0x5cff8a }));
  beacon.position.set(-0.6, 1.25, -0.5);
  g.add(beacon);

  // 6 ruedas con balancines (rocker-bogie simplificado)
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.32, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const treadGeo = new THREE.TorusGeometry(0.35, 0.03, 4, 18);
  treadGeo.rotateY(Math.PI / 2);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2.8), dark);
    arm.position.set(side * 1.15, 0.55, 0);
    g.add(arm);
    for (const zz of [1.15, 0, -1.15]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.3, 0.35, zz);
      const spin = new THREE.Group();
      const w = new THREE.Mesh(wheelGeo, dark);
      w.castShadow = true;
      const tread = new THREE.Mesh(treadGeo, white);
      spin.add(w, tread);
      pivot.add(spin);
      g.add(pivot);
      wheels.push(spin);
      if (zz !== 0) frontWheels.push(pivot);
    }
  }
  // faros (se usan en la cueva)
  const lights: THREE.SpotLight[] = [];
  for (const side of [-0.45, 0.45]) {
    const l = new THREE.SpotLight(0xfff2d6, 0, 70, 0.55, 0.45, 1.2);
    l.position.set(side, 1.0, 1.35);
    const tgt = new THREE.Object3D();
    tgt.position.set(side * 0.6, 0, 12);
    g.add(tgt);
    l.target = tgt;
    g.add(l);
    lights.push(l);
  }
  return { group: g, wheels, frontWheels, head, lights, beacon };
}

export function buildBase(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(0xd9dde3);
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 1.0, 8), m);
  plat.position.y = 1.4;
  plat.castShadow = true;
  g.add(plat);
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 6), mat(0x9aa3b0));
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    leg.position.set(Math.cos(a) * 3, 0.9, Math.sin(a) * 3);
    leg.rotation.z = Math.cos(a) * 0.35;
    leg.rotation.x = -Math.sin(a) * 0.35;
    g.add(leg);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 4, 6), mat(0xbfc6d1));
  mast.position.y = 3.8;
  g.add(mast);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.2, 0.2, 18), mat(0xffffff));
  dish.position.y = 5.6;
  dish.rotation.x = -0.6;
  g.add(dish);
  g.add(beam(0x7fb2ff, 160, 0.6));
  return g;
}

/** Columna de luz para ver objetivos desde lejos. */
export function beam(color: number, h = 120, r = 0.8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  m.position.y = h / 2;
  return m;
}

export function buildStation(deployed: boolean): THREE.Group {
  const g = new THREE.Group();
  if (!deployed) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.18, 6, 40), new THREE.MeshBasicMaterial({ color: 0x5ad1ff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.3;
    g.add(ring, beam(0x5ad1ff, 90, 0.7));
    return g;
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), mat(0xcfd6e0));
  pole.position.y = 1.1;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 0.3), mat(0xffffff));
  box.position.y = 1.6;
  const vane = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), mat(0xe8743b));
  vane.position.y = 2.25;
  g.add(pole, box, vane);
  return g;
}

export function buildSample(): THREE.Group {
  const g = new THREE.Group();
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0),
    new THREE.MeshStandardMaterial({ color: 0xffa04d, emissive: 0xff6a1a, emissiveIntensity: 0.6, roughness: 0.3 }));
  crystal.position.y = 1.4;
  crystal.name = "crystal";
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.12, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffa04d }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  g.add(crystal, ring, beam(0xffa04d, 70, 0.5));
  return g;
}

export function buildGate(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.35, 8, 40),
    new THREE.MeshStandardMaterial({ color: 0xe8743b, emissive: 0xe8743b, emissiveIntensity: 0.5 }));
  ring.position.y = 5.5;
  ring.name = "ring";
  g.add(ring);
  return g;
}

export function buildRelay(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), mat(0x9aa3b0));
    const a = (i / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 0.3, 0.6, Math.sin(a) * 0.3);
    leg.rotation.z = Math.cos(a) * 0.3;
    leg.rotation.x = -Math.sin(a) * 0.3;
    g.add(leg);
  }
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 5), mat(0xffffff));
  ant.position.y = 1.7;
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), new THREE.MeshBasicMaterial({ color: 0x5cff8a }));
  led.position.y = 2.25;
  led.name = "led";
  const glow = new THREE.PointLight(0x5cff8a, 3, 18);
  glow.position.y = 2.2;
  g.add(ant, led, glow);
  return g;
}

export function buildVent(): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.1, 10, 1, true), mat(0x8d6a4a, { roughness: 1 }));
  cone.position.y = 0.3;
  const hot = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), new THREE.MeshBasicMaterial({ color: 0xffb36b }));
  hot.rotation.x = -Math.PI / 2;
  hot.position.y = 0.86;
  g.add(cone, hot);
  return g;
}
