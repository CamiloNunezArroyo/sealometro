// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Globo terráqueo 3D para elegir el lugar. Adaptado del prototipo del equipo (rover-analogs, hecho antes de la
// hackathon): textura dibujada con Natural Earth 1:110m (dominio público, paquete world-atlas), halo de atmósfera,
// un pin por región que gira el globo hacia ella. Colores de diseño: NO es una imagen satelital.
import * as THREE from "three";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import type { Region } from "../regions";

const DEG = Math.PI / 180;
export function latLonToVector(lat: number, lon: number, r = 1): THREE.Vector3 {
  return new THREE.Vector3(r * Math.cos(lat * DEG) * Math.cos(lon * DEG), r * Math.sin(lat * DEG), -r * Math.cos(lat * DEG) * Math.sin(lon * DEG));
}
/** Rotación (x, y) del grupo que deja (lat, lon) mirando a una cámara en +z. */
export function rotationToFace(lat: number, lon: number): { x: number; y: number } {
  const v = latLonToVector(0, lon);
  return { x: lat * DEG, y: -Math.atan2(v.x, v.z) };
}
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

type Ring = number[][];
function strokeLine(ctx: CanvasRenderingContext2D, pts: Ring, W: number, H: number) {
  let prev = 0;
  pts.forEach(([lon, lat], i) => {
    const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
    if (i === 0 || Math.abs(lon - prev) > 180) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    prev = lon;
  });
}
function earthCanvas(W: number, H: number): HTMLCanvasElement {
  const topo = world as unknown as Topology;
  const countries = topo.objects.countries as GeometryCollection;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  const sea = ctx.createLinearGradient(0, 0, 0, H);
  sea.addColorStop(0, "#0c2740"); sea.addColorStop(0.5, "#0b3152"); sea.addColorStop(1, "#0c2740");
  ctx.fillStyle = sea; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) { const x = ((lon + 180) / 360) * W; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let lat = -60; lat <= 60; lat += 30) { const y = ((90 - lat) / 180) * H; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.fillStyle = "#3b5a4e"; ctx.strokeStyle = "rgba(230,245,235,0.55)"; ctx.lineWidth = 1.6;
  for (const f of feature(topo, countries).features) {
    const g = f.geometry;
    ctx.beginPath();
    const polys = g.type === "Polygon" ? [g.coordinates as Ring[]] : g.type === "MultiPolygon" ? (g.coordinates as Ring[][]) : [];
    for (const poly of polys) for (const ring of poly) { strokeLine(ctx, ring, W, H); ctx.closePath(); }
    ctx.fill("evenodd"); ctx.stroke();
  }
  const borders = mesh(topo, countries, (a, b) => a !== b);
  ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1.2; ctx.beginPath();
  for (const line of borders.coordinates as Ring[]) strokeLine(ctx, line, W, H);
  ctx.stroke();
  return c;
}

interface Pin { region: Region; dot: THREE.Mesh; ring: THREE.Mesh; hit: THREE.Mesh; label: HTMLElement; local: THREE.Vector3 }
const FAR = 3.4, NEAR = 2.25;

export class Globe {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private group = new THREE.Group();
  private earth: THREE.Mesh;
  private pins: Pin[] = [];
  private ray = new THREE.Raycaster();
  private focused: Region | null = null;
  private dist = FAR;
  private idle = 0;
  private dragging = false;
  private dragDist = 0;
  private last = { x: 0, y: 0 };
  private pinch: number | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private hovered: Pin | null = null;
  private time = 0;
  private raf = 0;
  private prevT = 0;
  private obs: ResizeObserver;
  private off: (() => void)[] = [];
  /** Desplaza el globo a la izquierda cuando hay un panel abierto a la derecha (fracción del ancho). */
  shift = 0;

  constructor(private box: HTMLElement, private labels: HTMLElement, regions: Region[], private onSelect: (r: Region) => void) {
    const mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 800;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x02040a);
    box.appendChild(this.renderer.domElement);
    const tex = new THREE.CanvasTexture(earthCanvas(mobile ? 2048 : 4096, mobile ? 1024 : 2048));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    this.group.add(this.earth);
    this.scene.add(this.group);
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(4, 2.5, 5);
    this.scene.add(sun, new THREE.AmbientLight(0x6f86a8, 0.9));
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.14, 64, 48), new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      vertexShader: "varying vec3 n; void main(){ n = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "varying vec3 n; void main(){ float i = pow(max(0.0, 0.66 - dot(n, vec3(0.0, 0.0, 1.0))), 3.0); gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * i; }",
    })));
    this.scene.add(stars());
    for (const r of regions) this.pins.push(this.pin(r));
    const bo = regions.find((r) => r.id === "bo_altiplano_sur") ?? regions[0];
    const f = bo ? rotationToFace(bo.lat, bo.lon) : { x: 0.25, y: 1.2 };
    this.group.rotation.set(f.x, f.y, 0); // empieza mirando a Bolivia
    this.camera.position.z = FAR;
    this.bind();
    this.obs = new ResizeObserver(() => this.resize());
    this.obs.observe(box);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private pin(region: Region): Pin {
    const local = latLonToVector(region.lat, region.lon, 1.004);
    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), local.clone().normalize());
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb454 }));
    dot.position.copy(local);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.036, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb454, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(local);
    ring.quaternion.copy(face);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.copy(local);
    this.group.add(dot, ring, hit);
    const label = document.createElement("button");
    label.className = "globe-label";
    label.type = "button";
    label.onclick = () => this.onSelect(region);
    this.labels.appendChild(label);
    return { region, dot, ring, hit, label, local };
  }

  /** Textos y colores de los pines (cambian con el idioma y con Marte/Luna). */
  setPins(text: (r: Region) => string, color: (r: Region) => string) {
    for (const p of this.pins) {
      p.label.textContent = text(p.region);
      delete p.label.dataset.w; // el ancho cambia con el idioma
      const c = new THREE.Color(color(p.region));
      (p.dot.material as THREE.MeshBasicMaterial).color.copy(c);
      (p.ring.material as THREE.MeshBasicMaterial).color.copy(c);
      p.label.style.setProperty("--pin", color(p.region));
    }
  }

  private bind() {
    const c = this.renderer.domElement;
    c.style.touchAction = "none";
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      c.addEventListener(t, fn as EventListener, o);
      this.off.push(() => c.removeEventListener(t, fn as EventListener));
    };
    on("pointerdown", (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      this.dragging = true; this.dragDist = 0; this.last = { x: e.clientX, y: e.clientY };
    });
    on("pointermove", (e) => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) { // pellizco para zoom
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.dist = THREE.MathUtils.clamp(this.dist * (this.pinch / d), 1.7, 5);
        this.pinch = d; this.focused = null; this.dragDist = 99;
        return;
      }
      if (this.dragging) {
        const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
        this.last = { x: e.clientX, y: e.clientY };
        this.dragDist += Math.abs(dx) + Math.abs(dy);
        const k = 0.0045 * (this.camera.position.z / FAR);
        this.group.rotation.y += dx * k;
        this.group.rotation.x = THREE.MathUtils.clamp(this.group.rotation.x + dy * k, -1.3, 1.3);
        this.idle = 0;
        if (this.dragDist > 8) this.focused = null;
      } else {
        this.hovered = this.pick(e);
        c.style.cursor = this.hovered ? "pointer" : "grab";
      }
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const click = this.dragging && this.dragDist < 6;
      this.dragging = false;
      if (click) { const p = this.pick(e); if (p) this.onSelect(p.region); }
    };
    on("pointerup", up);
    on("pointercancel", up);
    on("wheel", (e) => { e.preventDefault(); this.focused = null; this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.001), 1.7, 5); }, { passive: false });
    c.style.cursor = "grab";
  }

  private pick(e: PointerEvent): Pin | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects([this.earth, ...this.pins.map((p) => p.hit)], false)[0]?.object;
    return this.pins.find((p) => p.hit === hit) ?? null;
  }

  focus(r: Region | null) { this.focused = r; this.idle = 0; }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - (this.prevT || now)) / 1000);
    this.prevT = now;
    this.frame(dt);
  }

  frame(dt: number) {
    this.time += dt; this.idle += dt;
    const ease = 1 - Math.exp(-4 * dt);
    if (this.focused) {
      const t = rotationToFace(this.focused.lat, this.focused.lon);
      this.group.rotation.x += (t.x - this.group.rotation.x) * ease;
      this.group.rotation.y += shortestAngle(this.group.rotation.y, t.y) * ease;
    } else if (!this.dragging && this.idle > 4) this.group.rotation.y += dt * 0.06;
    const want = this.focused ? NEAR : this.dist;
    this.camera.position.z += (want - this.camera.position.z) * ease;
    // con el panel abierto el globo se corre a la izquierda (en celular el panel va abajo: se sube)
    const w = this.box.clientWidth, h = this.box.clientHeight;
    const side = w > h;
    this.group.position.x += ((side ? -this.shift * 1.6 : 0) - this.group.position.x) * ease;
    this.group.position.y += ((side ? 0 : this.shift * 1.2) - this.group.position.y) * ease;
    this.group.updateMatrixWorld();
    const phase = (this.time * 0.8) % 1;
    const v = new THREE.Vector3(), camDir = new THREE.Vector3();
    const place: { p: Pin; x: number; y: number; pri: number }[] = [];
    for (const p of this.pins) {
      const big = p === this.hovered || p.region === this.focused;
      p.dot.scale.setScalar(big ? 1.6 : 1);
      p.ring.scale.setScalar(1 + phase * 1.4);
      (p.ring.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.9;
      v.copy(p.local).applyMatrix4(this.group.matrixWorld);
      camDir.copy(this.camera.position).sub(v).normalize();
      const n = v.clone().sub(this.group.position).normalize();
      const facing = n.dot(camDir) > 0.15;
      v.project(this.camera);
      p.label.classList.toggle("active", big);
      if (!facing) { p.label.style.display = "none"; continue; }
      place.push({ p, x: ((v.x + 1) / 2) * w + 14, y: ((1 - v.y) / 2) * h - 12, pri: (big ? 100 : 0) + p.region.sites.length });
    }
    // etiquetas sin encimarse: primero las de mayor prioridad (la elegida, la señalada, las de más lugares)
    place.sort((a, b) => b.pri - a.pri);
    const boxes: [number, number, number, number][] = [];
    for (const q of place) {
      if (!q.p.label.dataset.w) { q.p.label.style.display = "block"; q.p.label.dataset.w = String(q.p.label.offsetWidth || 120); }
      const lw = Number(q.p.label.dataset.w);
      const bx: [number, number, number, number] = [q.x, q.y, q.x + lw, q.y + 22];
      const hit = boxes.some((b) => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1]);
      q.p.label.style.display = hit ? "none" : "block";
      q.p.label.style.transform = `translate(${q.x}px, ${q.y}px)`;
      if (!hit) boxes.push(bx);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = this.box.clientWidth || innerWidth, h = this.box.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // en pantallas angostas se aleja un poco la cámara para que entre el globo completo
    this.camera.fov = w < h ? 52 : 38;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.obs.disconnect();
    this.off.forEach((f) => f());
    this.pins.forEach((p) => p.label.remove());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => { (x as THREE.MeshStandardMaterial).map?.dispose(); x.dispose(); });
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function stars(): THREE.Points {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = new Float32Array(1200 * 3);
  for (let i = 0; i < 1200; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    p.set([Math.cos(a) * s * 40, u * 40, Math.sin(a) * s * 40], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, opacity: 0.8, transparent: true }));
}
