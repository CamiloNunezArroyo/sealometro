// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Motor del juego: une terreno real, física, señal, batería, misiones y la escena 3D.
import * as THREE from "three";
import { Grid, Heightfield } from "./core/terrain";
import { G, initialState, makeParams, step, type Env, type GameEvent, type Input, type Params, type State } from "./core/physics";
import { connected, lineOfSight, roverSignal, type Node } from "./core/signal";
import { buildWorld, type Mode, type Spot, type World } from "./core/world";
import { buildCave, CAVE_RELAY_MARGIN, CAVE_RELAY_RANGE, relaysNeeded, type CaveData, type CaveHazard } from "./core/cave";
import { boulderSpawn, devilCount, devilPush, geyserPhase, pickWeather, solarStormTime, spawnDevil, updateBoulder, updateDevil,
  type Boulder, type Devil, type WeatherChoice, type WeatherKind } from "./core/hazards";
import { hashSeed, rng } from "./core/terrain";
import { ARENA_SCALE, buildArenaWorld, camClamp, clearanceAt, clearanceMap, freeBounds, scannerLevel, type ArenaSpec, type ArenaWorld } from "./core/arena";
import { buildArenaScenery, buildBeacon, floorRgb, outsideRgb } from "./render/arenaScene";
import type { ElevRing, OsmScene } from "../station/osm";
import { buildBase, buildGate, buildRelay, buildRover, buildSample, buildStation, buildVent, type RoverModel } from "./render/models";
import { buildCaveMesh, buildPebbles, buildPuddle, buildRocks, buildSky, buildTerrain, buildWater, PALETTES } from "./render/scenery";
import type { GameSite } from "../data";
import { dataUrl } from "../data";
import type { Level } from "../i18n";

export type Gravity = "earth" | "mars" | "moon";
export type FailReason = "crash" | "tip" | "stuck" | "signal" | "battery" | "water" | "damage" | "fall" | "hit" | "radiation";
export type Weather = WeatherChoice;
export interface ImageryRef { file: string; credit: string; date: string }
/** El lugar REAL del equipo (escaneo, perímetro o medidas) como mapa jugable. */
export interface ArenaRuntime {
  spec: ArenaSpec;
  scan?: THREE.Object3D;                    // malla del escaneo ya centrada (piso en y = 0)
  wallPhotos?: string[];                    // fotos reales para colgar en las paredes (decorativo)
  ground?: [number, number, number];        // color del suelo medido en las fotos (0-255)
  walls?: { image: string; a0: number; a1: number }[];   // franja media de cada foto/fotograma = pared en esa dirección (rad, 0 = norte)
  floorImage?: string;                      // recorte real del piso de una foto (textura repetida)
  palette?: { wall?: [number, number, number]; ceiling?: [number, number, number] };   // colores medidos en las fotos
  osm?: OsmScene;                           // alrededor real (OpenStreetMap), en metros del mapa
  elev?: ElevRing;                          // relieve alrededor (Open-Meteo), relativo al lugar
  note?: string;                            // de dónde sale cada cosa (texto honesto para el HUD y la carga)
}
export interface GameConfig { site: GameSite; mode: Mode; gravity: Gravity; level: Level; mineralLabel: string; weather: Weather; imagery: ImageryRef | null; arena?: ArenaRuntime }
/** Lo que el rover midió en el punto de una muestra (para el panel de análisis). */
export interface SampleRecord { n: number; x: number; z: number; elev: number; slope: number; soil: string; wet: boolean; cave: boolean; time: number }
export interface Stats { distance: number; maxSpeed: number; devils: number; boulders: number; storms: number; geysers: number; rockfalls: number; photos: number; relays: number }
export interface Objective { key: string; vars?: Record<string, string | number>; done: boolean; progress?: string }
export interface EndResult { win: boolean; reason?: FailReason; stars: number; time: number; damage: number; score: number; samples: number;
  objectives: Objective[]; records: SampleRecord[]; stats: Stats; weather: WeatherKind }
export interface HudSnapshot {
  speedKmh: number; battery: number; signal: number; lostTime: number; lostLimit: number; damage: number;
  pitchDeg: number; rollDeg: number; time: number; objectives: Objective[]; hint: string | null;
  warn: { key: string; kind: "warn" | "bad" } | null; toast: { key: string; vars?: Record<string, string | number> } | null;
  relaysLeft: number; g: number; delay: number; action: number; lights: boolean; cam: number;
  targetBearing: number | null; targetDist: number | null; stationCard: boolean; paused: boolean; airborne: boolean;
  /** arena (de juego): señal del escáner de muestras 0–1 (null = no hay muestras escondidas) y simulacro de tormenta */
  scanner: number | null; drill: { left: number; late: boolean } | null;
  map: { x: number; z: number; yaw: number; size: number; view?: { cx: number; cz: number; size: number; north: boolean }; beacons?: Spot[]; base: Spot | null; targets: Spot[]; relays: Spot[]; cave: { x: number; z: number }[] | null;
    puddles: { x: number; z: number; r: number; deep: number }[]; sand: { x: number; z: number; r: number }[]; devils: Spot[]; vents: Spot[];
    hazards: { x: number; z: number; kind: string }[] };
  analysis: SampleRecord | null; weather: { kind: WeatherKind; on: boolean; prob: number }; storm: number; photo: boolean;
}

/** Punto suave y redondo para polvo y vapor (en vez de cuadrados). */
let dotTex: THREE.Texture | null = null;
function softDot(): THREE.Texture | null {
  if (dotTex || typeof document === "undefined") return dotTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

const LOST_LIMIT: Record<Level, number> = { explorador: 16, cadete: 10, cientifico: 7 };
const DRAIN: Record<Level, number> = { explorador: 0.6, cadete: 1, cientifico: 1.2 };
const DELAY: Record<Gravity, number> = { earth: 0, moon: 1.3, mars: 1.5 }; // solo nivel Científico (ver lección)

export class GameEngine {
  cfg: GameConfig;
  onEnd: (r: EndResult) => void;
  private container: HTMLElement;
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  private raf = 0;
  private last = 0;
  private mobile = false;
  private hf!: Heightfield;
  private grid: Grid | null = null;
  private world: World | null = null;
  private cave: CaveData | null = null;
  private env!: Env;
  private p!: Params;
  private s!: State;
  private rover!: RoverModel;
  private input: Input = { throttle: 0, steer: 0, brake: false };
  private queue: { t: number; inp: Input }[] = [];
  private actionHeld = false;
  private actionTime = 0;
  private time = 0;
  private battery = 100;
  private signal = 1;
  private lostTime = 0;
  private sigTimer = 0;
  private nodes: Node[] = [];
  private nodeOk: boolean[] = [];
  private relayMeshes: THREE.Object3D[] = [];
  private relaysLeft = 2;
  private objectives: Objective[] = [];
  private gateIdx = 0;
  private gateMeshes: THREE.Group[] = [];
  private sampleMeshes: THREE.Group[] = [];
  private samplesDone: boolean[] = [];
  private stationDone = false;
  private stationMesh: THREE.Group | null = null;
  private reachedEnd = false;
  private lights = false;
  private camMode = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private warn: HudSnapshot["warn"] = null;
  private warnUntil = 0;
  private toast: HudSnapshot["toast"] = null;
  private toastUntil = 0;
  private stationCard = false;
  paused = false;
  private ended = false;
  private safe = { x: 0, z: 0 };
  private dust!: THREE.Points;
  private dustData: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number }[] = [];
  private steam: THREE.Points | null = null;
  private resizeObs?: ResizeObserver;
  private shake = 0;
  private disposed = false;
  // ---- peligros, clima, muestras, foto (ver core/hazards.ts)
  private seed = (Math.random() * 2 ** 31) | 0;     // cada partida distinta: clima y peligros cambian
  private R = rng(this.seed);
  private sat: THREE.Texture | null = null;
  private satPx: { data: Uint8ClampedArray; w: number; h: number } | null = null;
  private envTex: THREE.Texture | null = null;
  private skyMesh: THREE.Mesh | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private devils: Devil[] = [];
  private devilMeshes: THREE.Points[] = [];
  private devilQuota = 0;
  private devilTimer = 25;
  private devilHit = false;
  private boulders: Boulder[] = [];
  private boulderMeshes: THREE.Mesh[] = [];
  private boulderTimer = 18;
  private geysers: { x: number; z: number; seed: number; steam: THREE.Mesh; phase: string }[] = [];
  private weather: { kind: WeatherKind; prob: number; start: number; intensity: number } = { kind: "clear", prob: 0, start: 0, intensity: 0 };
  private wet = 0;
  private rainObj: THREE.LineSegments | THREE.Points | null = null;
  private rainPuddles = 0;
  private puddleMeshes = new Map<object, THREE.Mesh>();
  private stormAt: number | null = null;
  private storm = 0;
  private panelDust = 0;
  private analysis: SampleRecord | null = null;
  private records: SampleRecord[] = [];
  private stats: Stats = { distance: 0, maxSpeed: 0, devils: 0, boulders: 0, storms: 0, geysers: 0, rockfalls: 0, photos: 0, relays: 0 };
  private rockfallsDone = new Set<CaveHazard>();
  private falling: { x: number; z: number; y: number; vy: number; floor: number; mesh: THREE.Mesh; hit: boolean }[] = [];
  private pendingFalls: { x: number; z: number; t: number }[] = [];
  private photo = false;
  private orbit = { yaw: 0.6, pitch: 0.32, dist: 13 };
  private sunHour = 11;
  private sunDir = new THREE.Vector3(300, 420, 160);
  private visY = NaN;
  // ---- arena (lugar chico): escala, cámara dentro del lugar y misión adaptada (ver core/arena.ts)
  private K = 1;                                   // escala del rover y de los marcadores (1 = sitios normales)
  private arenaW: ArenaWorld | null = null;
  private arenaClr: Float32Array | null = null;    // despeje a paredes (para la cámara)
  private ceilH: number | null = null;             // techo (lugar cerrado): la cámara queda debajo
  private hidden: boolean[] = [];                  // muestras todavía escondidas (se encuentran con el escáner)
  private periDone: boolean[] = [];
  private periMeshes: THREE.Group[] = [];
  private scanRange = 10;
  private drill: { left: number; late: boolean } | null = null;
  private get rStation() { return 8 * this.K; }
  private get rSample() { return 6 * this.K; }
  private get rGate() { return 7.5 * this.K; }

  constructor(container: HTMLElement, cfg: GameConfig, onEnd: (r: EndResult) => void) {
    this.container = container;
    this.cfg = cfg;
    this.onEnd = onEnd;
  }

  get delay() { return this.cfg.level === "cientifico" ? DELAY[this.cfg.gravity] : 0; }
  get g() { return G[this.cfg.gravity]; }

  async init() {
    const { site, mode } = this.cfg;
    this.mobile = matchMedia("(pointer: coarse)").matches || innerWidth < 800;
    if (this.cfg.arena) {
      const a = this.cfg.arena.spec;
      this.hf = new Heightfield(a.n, a.size, a.heights, 1, 0);   // piso del lugar real: sin detalle inventado
    } else {
      const buf = await fetch(dataUrl(site.file)).then((r) => { if (!r.ok) throw new Error(`terreno: HTTP ${r.status}`); return r.arrayBuffer(); });
      if (this.disposed) return; // React (modo estricto) puede desmontar antes de que termine la descarga
      const detail = site.biome === "salar" ? 0.12 : site.biome === "lago" ? 0.3 : 0.6;
      this.hf = Heightfield.fromUint16(site.n, site.size_m, new Uint16Array(buf), site.h_min, site.h_max, site.id.length * 7919, detail);
    }
    this.p = makeParams(this.g, this.cfg.level);
    if (this.cfg.arena) {
      // lugar chico: rover a escala de un rover de prueba (~1,2 m), más lento (decisión de diseño; la física es la misma)
      const K = (this.K = ARENA_SCALE), p = this.p;
      p.length *= K; p.width *= K; p.radius *= K; p.clearance *= K; p.travel *= K; p.smallRock *= K;
      p.maxSpeed = 2.8; p.revSpeed = 1.3; p.engineAccel = 2.2; p.crashSpeed *= 0.62;
    }
    if (this.cfg.imagery && mode !== "cave" && !this.cfg.arena) {
      try {
        const img = await new Promise<HTMLImageElement>((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = dataUrl(this.cfg.imagery!.file); });
        if (this.disposed) return;
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        this.satPx = { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
        const t = new THREE.Texture(img);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.needsUpdate = true;
        this.sat = t;
      } catch { this.sat = null; } // sin imagen: se usa la paleta del bioma
    }
    const precip = typeof site.climate?.precip?.value === "number" ? site.climate.precip.value : null;
    const tmean = typeof site.climate?.t_mean?.value === "number" ? site.climate.t_mean.value : null;
    this.weather = mode === "cave" || this.cfg.arena ? { kind: "clear", prob: 0, start: 0, intensity: 0 } : pickWeather(this.cfg.weather, precip, tmean, this.seed);
    this.devilQuota = mode === "cave" || this.cfg.arena ? 0 : devilCount(precip, this.cfg.gravity);
    this.stormAt = this.cfg.arena && mode === "mission" ? null : solarStormTime(this.cfg.gravity, this.seed); // misión en arena: la tormenta es el simulacro final

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.mobile, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.mobile ? 1.5 : 2));
    this.renderer.shadowMap.enabled = !this.mobile && mode !== "cave";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.container);
    this.resize();

    this.rover = buildRover();
    this.rover.group.scale.setScalar(this.K);
    this.scene.add(this.rover.group);

    if (mode === "cave") this.setupCave();
    else this.setupSurface();

    this.setupDust();
    this.s = initialState(this.safe.x, this.safe.z, this.s0yaw, this.env, this.p);
    this.camPos.set(this.s.x - Math.sin(this.s0yaw) * 10 * this.K, this.s.y + 5 * this.K, this.s.z - Math.cos(this.s0yaw) * 10 * this.K);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private s0yaw = 0;

  private setupSurface() {
    const { site, mode } = this.cfg;
    const M = this.mobile ? 256 : 384;
    this.grid = new Grid(this.hf, M, site.size_m);
    const arena = this.cfg.arena;
    if (arena) { this.arenaW = buildArenaWorld(arena.spec, mode, this.seed); this.arenaClr = clearanceMap(arena.spec); }
    this.world = arena ? this.arenaW! : buildWorld(this.hf, {
      id: site.id, biome: site.biome, water_level: site.water_level, h_min: site.h_min, cave: site.cave,
      roughness: site.terrain_stats?.roughness_100m?.value ?? null,
    }, mode);
    const w = this.world, grid = this.grid;
    // con lluvia o nieve el suelo agarra menos (decisión de diseño: hasta −22 %)
    this.env = { height: (x, z) => grid.heightAt(x, z), soil: (x, z) => { const so = w.soilAt(x, z); return this.wet > 0.05 ? { ...so, mu: so.mu * (1 - 0.22 * this.wet) } : so; },
      rocksNear: w.rocksNear, half: site.size_m / 2 };
    this.s0yaw = mode === "free" ? Math.atan2(w.gates[0].x - w.spawn.x, w.gates[0].z - w.spawn.z) : w.spawn.yaw;
    // el rover arranca 13 m adelante de la base (zona sin rocas de 32 m): así la cámara no queda dentro de la base
    const ahead = { x: w.spawn.x + Math.sin(this.s0yaw) * (arena ? 2.2 : 13), z: w.spawn.z + Math.cos(this.s0yaw) * (arena ? 2.2 : 13) };
    const okAhead = arena ? w.rocksNear(ahead.x, ahead.z, 4).every((r) => Math.hypot(r.x - ahead.x, r.z - ahead.z) > r.r + 1.2) : !w.inWater(ahead.x, ahead.z);
    this.safe = okAhead ? ahead : { x: w.spawn.x, z: w.spawn.z };

    const sky = arena?.spec.indoor ? [0x2a2f38, 0x5a606b] : this.cfg.site.biome === "frio" ? [0x5d7aa6, 0xd5dde6] : [0x1d4f9e, 0xc4d8ec];
    this.skyMesh = buildSky(sky[0], sky[1]);
    this.scene.add(this.skyMesh);
    const inside = !!arena?.spec.indoor;
    this.scene.fog = inside ? new THREE.Fog(0x8f887d, 40, 260) : new THREE.Fog(sky[1], arena ? 80 : 400, arena ? 900 : 2200);
    if (inside) this.scene.background = new THREE.Color(0x14161a);
    this.hemi = inside ? new THREE.HemisphereLight(0xfff1dc, 0x8c8272, 1.0) : new THREE.HemisphereLight(0xbfd6ff, 0x5a4636, 0.9);
    this.scene.add(this.hemi);
    // mapa de entorno (solo el cielo) para que los charcos lo reflejen
    const pm = new THREE.PMREMGenerator(this.renderer);
    const skyScene = new THREE.Scene();
    skyScene.add(buildSky(sky[0], sky[1]));
    this.envTex = pm.fromScene(skyScene, 0.02).texture;
    pm.dispose();
    this.sun.position.set(300, 420, 160);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    const sh = arena ? 16 : 60;   // arena: sombra más fina alrededor del rover chico
    sc.left = -sh; sc.right = sh; sc.top = sh; sc.bottom = -sh; sc.near = arena ? 1 : 10; sc.far = arena ? 220 : 1200;
    if (arena) { this.sun.shadow.radius = 4; this.sun.shadow.bias = -0.0004; }
    this.scene.add(this.sun, this.sun.target);

    if (arena) { // color del suelo: el medido en las fotos reales, o uno típico del tipo de piso; al aire libre sin escaneo, el del entorno
      const rgb = arena.scan || arena.spec.indoor ? floorRgb(arena.spec.floor, arena.ground) : outsideRgb(arena.spec.floor, arena.ground);
      const [r, g, b] = rgb.map((v) => v / 255);
      const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
      PALETTES.arena_foto = { base: c.getHex(), dark: c.clone().multiplyScalar(0.7).getHex(), light: c.clone().lerp(new THREE.Color(1, 1, 1), 0.25).getHex(),
        soft: c.clone().lerp(new THREE.Color(1, 1, 1), 0.15).getHex(), rock: c.clone().multiplyScalar(0.5).getHex() };
    }
    const biomeKey = arena ? "arena_foto" : site.biome;
    if (!arena || arena.scan) {   // arena sin escaneo: el piso (plano) lo dibuja buildArenaScenery con su textura
      const terrain = buildTerrain(grid, this.hf, w, biomeKey, this.mobile, this.sat);
      if (arena?.scan) terrain.position.y = -0.04; // el escaneo se dibuja encima; el terreno queda de respaldo
      this.scene.add(terrain);
    }
    const water = buildWater(w, site.size_m, site.id);
    if (water) this.scene.add(water);
    const rockC = PALETTES[site.biome]?.rock ?? 0x6f5340;
    if (arena) {
      const sc3 = buildArenaScenery(arena, this.mobile);
      this.scene.add(sc3.group);
      this.ceilH = sc3.ceilH;
      if (inside) this.scene.add(new THREE.AmbientLight(0xfff4e6, 0.3));
    } else {
      this.scene.add(buildRocks(w.rocks, (x, z) => grid.heightAt(x, z), rockC, this.mobile, (x, z) => this.satColor(x, z)));
      this.scene.add(buildPebbles(w, (x, z) => grid.heightAt(x, z), rockC, site.biome, this.mobile, w.spawn.x, w.spawn.z));
    }
    for (const pd of w.puddles) this.addPuddleMesh(pd);
    const at = (o: THREE.Object3D, p: Spot, dy = 0) => { o.position.set(p.x, grid.heightAt(p.x, p.z) + dy, p.z); this.scene.add(o); return o; };

    const base = buildBase();
    let basePos = { x: w.spawn.x + 7, z: w.spawn.z - 6 };
    if (arena) {   // base chica, a un costado de la salida (no entre la cámara y el rover) y sin columna de luz bajo techo
      base.scale.setScalar(0.26);
      if (inside) base.children[base.children.length - 1].visible = false;
      const side = [1, -1].map((k) => ({ x: w.spawn.x + Math.cos(this.s0yaw) * 1.5 * k, z: w.spawn.z - Math.sin(this.s0yaw) * 1.5 * k }))
        .sort((p, q) => clearanceAt(arena.spec, this.arenaClr!, q.x, q.z) - clearanceAt(arena.spec, this.arenaClr!, p.x, p.z))[0];
      basePos = clearanceAt(arena.spec, this.arenaClr!, side.x, side.z) >= 0.9 ? side : { x: w.spawn.x, z: w.spawn.z };
    }
    at(base, basePos);
    for (const v of w.vents) at(buildVent(), v);
    if (w.vents.length) this.setupSteam(w.vents);
    // géiseres: columna de vapor que crece al hacer erupción (ciclo en core/hazards.ts)
    w.vents.forEach((v, i) => {
      const steam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 2.6, 1, 14, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      steam.position.set(v.x, grid.heightAt(v.x, v.z), v.z);
      this.scene.add(steam);
      this.geysers.push({ x: v.x, z: v.z, seed: hashSeed(site.id) + i * 7, steam, phase: "calm" });
    });
    if (this.weather.kind !== "clear") this.setupRain(this.weather.kind);

    this.nodes = [{ x: w.spawn.x + 7, z: w.spawn.z - 6, y: grid.heightAt(w.spawn.x + 7, w.spawn.z - 6) + 5.6, range: arena ? 1e6 : 1400 }];
    this.relaysLeft = 2;
    if (mode === "free") {
      w.gates.forEach((gp, i) => {
        const g = buildGate();
        g.scale.setScalar(this.K);
        const nx = w.gates[(i + 1) % w.gates.length];
        g.rotation.y = Math.atan2(nx.x - gp.x, nx.z - gp.z) + Math.PI / 2;
        at(g, gp);
        this.gateMeshes.push(g);
      });
      this.objectives = [{ key: "g.obj.gates", vars: { n: w.gates.length }, done: false, progress: `0/${w.gates.length}` }];
    } else {
      this.stationMesh = at(buildStation(false), w.station) as THREE.Group;
      this.stationMesh.scale.setScalar(this.K);
      w.samples.forEach((sp) => { const m = at(buildSample(), sp) as THREE.Group; m.scale.setScalar(this.K); this.sampleMeshes.push(m); this.samplesDone.push(false); });
      if (this.arenaW) {
        // misión para lugares chicos (de juego): estación lejos, muestras ESCONDIDAS que se buscan con el escáner,
        // vuelta al perímetro pasando por balizas y, al final, simulacro de tormenta solar contra reloj
        const aw = this.arenaW, fb = freeBounds(arena!.spec);
        this.scanRange = Math.max(8, Math.hypot(fb.w, fb.l) * 0.6);
        this.hidden = w.samples.map(() => true);
        this.sampleMeshes.forEach((m) => { m.visible = false; m.children[2].visible = !inside; });
        if (inside) this.stationMesh.children[1].visible = false; // sin columna de luz bajo techo
        aw.perimeter.forEach((p) => { const m = at(buildBeacon(), p) as THREE.Group; this.periMeshes.push(m); this.periDone.push(false); });
        this.objectives = [
          { key: "g.obj.station", done: false },
          { key: "arena.obj.samples", vars: { n: w.samples.length }, done: false, progress: `0/${w.samples.length}` },
          { key: "arena.obj.perimeter", vars: { n: aw.perimeter.length }, done: false, progress: `0/${aw.perimeter.length}` },
          { key: "arena.obj.drill", done: false },
        ];
      } else this.objectives = [
        { key: "g.obj.station", done: false },
        { key: "g.obj.samples", vars: { n: w.samples.length, mineral: this.cfg.mineralLabel }, done: false, progress: `0/${w.samples.length}` },
        { key: "g.obj.return", done: false },
      ];
    }
    const t = this.cfg.site.climate?.t_mean?.value;
    if (typeof t === "number" && t < 273) this.say("g.cold", { t: Math.round(t - 273.15) }); // frío real: el calefactor gasta batería
  }

  private setupCave() {
    const cave = buildCave(this.cfg.site.id);
    this.cave = cave;
    const firm = cave.kind === "ice" ? { mu: 0.5, crr: 0.04, soft: false, kind: "hielo" } : { mu: 0.8, crr: 0.06, soft: false, kind: "roca" };
    const ice = { mu: 0.2, crr: 0.02, soft: false, kind: "hielo" };
    this.env = { height: cave.heightAt, soil: (x, z) => (cave.hazardAt(x, z)?.kind === "ice" ? ice : firm), rocksNear: () => cave.rocks, half: 1e6 };
    const p0 = cave.pts[2];
    this.safe = { x: p0.x, z: p0.z };
    this.s0yaw = Math.atan2(cave.pts[4].x - cave.pts[1].x, cave.pts[4].z - cave.pts[1].z);
    this.scene.background = new THREE.Color(0x020203);
    this.scene.fog = new THREE.Fog(0x020203, 22, 95);
    this.scene.add(new THREE.AmbientLight(cave.kind === "ice" ? 0x7fb8ff : 0x8a8fa8, cave.kind === "ice" ? 0.5 : 0.42));
    // lámpara de área del rover (además de los faros): ilumina el piso y las paredes cercanas
    const lamp = new THREE.PointLight(0xffe7c4, 40, 38, 1.1);
    lamp.position.set(0, 3.2, 0.5);
    this.rover.group.add(lamp);
    // luz del día en la entrada
    const shaft = new THREE.PointLight(0xfff0d0, 60, 45, 1.5);
    shaft.position.set(cave.pts[0].x, cave.pts[0].floor + 6, cave.pts[0].z);
    this.scene.add(shaft);
    this.scene.add(buildCaveMesh(cave));
    this.scene.add(buildRocks(cave.rocks, cave.heightAt, 0x3d322c, true));
    for (const sp of cave.samples) {
      const m = buildSample();
      m.position.set(sp.x, cave.heightAt(sp.x, sp.z), sp.z);
      m.children[2].visible = false; // sin columna de luz bajo techo
      this.scene.add(m);
      this.sampleMeshes.push(m);
      this.samplesDone.push(false);
    }
    const endMark = new THREE.Mesh(new THREE.TorusGeometry(3, 0.15, 6, 30), new THREE.MeshBasicMaterial({ color: 0x5ad1ff }));
    endMark.rotation.x = Math.PI / 2;
    endMark.position.set(cave.end.x, cave.heightAt(cave.end.x, cave.end.z) + 0.3, cave.end.z);
    this.scene.add(endMark);
    this.nodes = [{ x: cave.pts[0].x, z: cave.pts[0].z, y: cave.pts[0].floor + 2, range: CAVE_RELAY_RANGE }];
    this.relaysLeft = relaysNeeded(cave).relays + CAVE_RELAY_MARGIN[this.cfg.level];
    this.lights = true;
    this.objectives = [
      { key: "g.obj.cave.samples", vars: { n: cave.samples.length }, done: false, progress: `0/${cave.samples.length}` },
      { key: "g.obj.cave.reach", done: false },
      { key: "g.obj.cave.exit", done: false },
    ];
    this.flash("g.cave.dark", "warn");
  }

  private setupDust() {
    const N = 420;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const color = this.cave ? 0x6b5a4c : (PALETTES[this.cfg.arena ? "arena_foto" : this.cfg.site.biome]?.light ?? 0xd9b78c);
    const hard = this.cfg.arena && (this.cfg.arena.spec.floor === "cemento" || this.cfg.arena.spec.floor === "interior"); // piso duro: casi sin polvo
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.6 * Math.max(0.5, this.K), map: softDot(), transparent: true, opacity: hard ? 0.15 : 0.55, depthWrite: false }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
    for (let i = 0; i < N; i++) this.dustData.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
  }

  private setupSteam(vents: Spot[]) {
    const N = vents.length * 30;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(N * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    this.steam = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, map: softDot(), transparent: true, opacity: 0.4, depthWrite: false }));
    this.steam.userData = { vents, phase: Array.from({ length: N }, (_, i) => (i * 0.37) % 1) };
    this.steam.frustumCulled = false;
    this.scene.add(this.steam);
  }


  // ------------------------------------------------------------------ peligros, clima, muestras
  /** Color del suelo REAL (imagen satelital) en (x, z); null si no hay imagen. */
  satColor(x: number, z: number): THREE.Color | null {
    if (!this.satPx) return null;
    const size = this.cfg.site.size_m, { w, h, data } = this.satPx;
    const i = Math.max(0, Math.min(w - 1, Math.floor(((x + size / 2) / size) * w)));
    const j = Math.max(0, Math.min(h - 1, Math.floor(((z + size / 2) / size) * h)));
    const k = (j * w + i) * 4;
    return new THREE.Color().setRGB(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, THREE.SRGBColorSpace);
  }

  private addPuddleMesh(p: { x: number; z: number; r: number; deep: number }) {
    const g = this.grid!;
    let y = g.heightAt(p.x, p.z);
    for (let k = 0; k < 8; k++) y = Math.min(y, g.heightAt(p.x + p.r * 0.5 * Math.cos(k * 0.785), p.z + p.r * 0.5 * Math.sin(k * 0.785)));
    const m = buildPuddle(p, y, this.envTex);
    this.scene.add(m);
    this.puddleMeshes.set(p, m);
  }

  private setupRain(kind: WeatherKind) {
    const N = this.mobile ? 900 : 2200;
    if (kind === "rain") {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
      this.rainObj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xbfd3ea, transparent: true, opacity: 0 }));
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      this.rainObj = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18, map: softDot(), transparent: true, opacity: 0, depthWrite: false }));
    }
    this.rainObj.frustumCulled = false;
    this.rainObj.userData.seed = Array.from({ length: N }, () => [Math.random(), Math.random(), Math.random()]);
    this.scene.add(this.rainObj);
  }

  private updateHazards(dt: number) {
    const w = this.world!, s = this.s;
    // --- clima
    const on = this.weather.kind !== "clear" && this.time > this.weather.start;
    if (on && this.wet === 0) this.flash(this.weather.kind === "rain" ? "g.haz.rain" : "g.haz.snow", "warn");
    this.wet = on ? Math.min(1, this.wet + dt / 40) : Math.max(0, this.wet - dt / 120);
    if (this.weather.kind === "rain" && on && this.rainPuddles < Math.min(w.lowSpots.length, Math.floor(this.wet * 10))) {
      const ls = w.lowSpots[this.rainPuddles++];
      const pd = { x: ls.x, z: ls.z, r: 3, deep: 0, rain: true };
      w.puddles.push(pd);
      this.addPuddleMesh(pd);
    }
    for (const pd of w.puddles) if (pd.rain && pd.r < 9) { // los charcos de lluvia crecen
      pd.r = Math.min(9, pd.r + dt * 0.12 * this.wet);
      this.puddleMeshes.get(pd)?.scale.set(pd.r, 1, pd.r);
    }
    if (this.cfg.arena) { this.updateStorm(dt); return; }
    // --- remolinos de polvo
    this.devilTimer -= dt;
    if (this.devils.length < this.devilQuota && this.devilTimer <= 0 && !on) {
      this.devilTimer = 30 + this.R() * 40;
      const d = spawnDevil(this.R, s.x, s.z, this.cfg.site.size_m / 2);
      this.devils.push(d);
      const pts = new Float32Array(260 * 3);
      for (let i = 0; i < 260; i++) {
        const t = i / 260, hgt = t * 26, rad = 0.6 + t * d.r * 0.55, a = i * 2.4;
        pts.set([Math.cos(a) * rad, hgt, Math.sin(a) * rad], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
      const col = PALETTES[this.cfg.site.biome]?.light ?? 0xd9b78c;
      const m = new THREE.Points(geo, new THREE.PointsMaterial({ color: col, size: 1.6, map: softDot(), transparent: true, opacity: 0.45, depthWrite: false }));
      this.scene.add(m);
      this.devilMeshes.push(m);
    }
    let inDevil = false;
    for (let i = this.devils.length - 1; i >= 0; i--) {
      const d = this.devils[i];
      updateDevil(d, dt, this.R, s.x, s.z, this.cfg.site.size_m / 2);
      const push = devilPush(d, s.x, s.z);
      if (push.k > 0 && !s.airborne) {
        inDevil = true;
        s.x += push.ax * dt * 0.5; s.z += push.az * dt * 0.5;
        this.panelDust = Math.min(1, this.panelDust + dt * 0.08 * push.k);
        s.damage += dt * 1.2 * push.k * this.p.damageMul;
        this.flash("g.haz.devil", "warn");
        this.shake = Math.max(this.shake, 0.4 * push.k);
      }
      const m = this.devilMeshes[i];
      m.position.set(d.x, this.env.height(d.x, d.z), d.z);
      m.rotation.y = d.spin;
      if (d.life <= 0) { this.scene.remove(m); m.geometry.dispose(); this.devils.splice(i, 1); this.devilMeshes.splice(i, 1); }
    }
    if (inDevil && !this.devilHit) this.stats.devils++;
    this.devilHit = inDevil;
    // --- rocas que ruedan (solo cerca de laderas empinadas reales del DEM)
    this.boulderTimer -= dt;
    if (this.boulderTimer <= 0) {
      this.boulderTimer = 14 + this.R() * 16;
      const sp = boulderSpawn(this.R, s.x, s.z, (x, z) => this.hf.slopeDeg(x, z, 8), this.env.height);
      if (sp) {
        const r = 0.7 + this.R() * 0.9;
        this.boulders.push({ ...sp, y: this.env.height(sp.x, sp.z) + r, vx: 0, vz: 0, r, alive: true, t: 0 });
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0),
          new THREE.MeshStandardMaterial({ color: PALETTES[this.cfg.site.biome]?.rock ?? 0x6f5340, flatShading: true }));
        m.castShadow = !this.mobile;
        this.scene.add(m);
        this.boulderMeshes.push(m);
        this.flash("g.haz.boulder", "bad");
      }
    }
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i], m = this.boulderMeshes[i];
      updateBoulder(b, dt, this.g, this.env.height);
      m.position.set(b.x, b.y, b.z);
      m.rotation.x += (Math.hypot(b.vx, b.vz) * dt) / b.r;
      const d = Math.hypot(b.x - s.x, b.z - s.z);
      if (d < b.r + this.p.radius && Math.hypot(b.vx, b.vz) > 1) {
        const rel = Math.hypot(b.vx - Math.sin(s.yaw) * s.v, b.vz - Math.cos(s.yaw) * s.v);
        s.damage += rel * 5 * this.p.damageMul;
        this.shake = 1;
        b.vx *= -0.3; b.vz *= -0.3;
        if (rel > 7) return this.fail("hit");
      }
      if (!b.alive) {
        if (d > 15) this.stats.boulders++; // esquivada
        this.scene.remove(m); m.geometry.dispose(); this.boulders.splice(i, 1); this.boulderMeshes.splice(i, 1);
      }
    }
    // --- géiseres
    for (const gz of this.geysers) {
      const ph = geyserPhase(this.time, gz.seed);
      const near = Math.hypot(gz.x - s.x, gz.z - s.z);
      if (ph !== gz.phase) {
        if (ph === "warn" && near < 40) this.flash("g.haz.geyser", "warn");
        if (ph === "calm" && gz.phase === "erupt" && near < 25) this.stats.geysers++;
        gz.phase = ph;
      }
      if (ph === "erupt" && near < 8) { s.damage += dt * 22 * this.p.damageMul; this.flash("g.warn.vent", "bad"); }
    }
    this.updateStorm(dt);
  }

  private updateStorm(dt: number) {
    const w = this.world!, s = this.s;
    // --- tormenta solar (solo Marte/Luna): refugio = detenido junto a una roca grande o en la base
    if (this.stormAt !== null && this.time > this.stormAt && this.storm === 0) { this.storm = 30; this.stormAt = null; this.stats.storms++; this.flash("g.haz.storm", "bad"); }
    if (this.storm > 0) {
      this.storm = Math.max(0, this.storm - dt);
      const still = Math.abs(s.v) < 0.4;
      const shelter = still && (this.near(w.spawn, 16 * this.K) || w.rocksNear(s.x, s.z, 6).some((r) => r.h > 1 && Math.hypot(r.x - s.x, r.z - s.z) < r.r + 3.5 * this.K));
      if (!shelter) { s.damage += dt * 1.6 * this.p.damageMul; if (this.storm > 2) this.flash("g.haz.storm", "bad"); }
      if (s.damage >= 100) return this.fail("radiation");
      if (this.storm === 0) this.say("g.haz.storm.end");
    }
  }

  private updateCaveHazards() {
    const c = this.cave!, s = this.s;
    const h = c.hazardAt(s.x, s.z);
    if (h?.kind === "crevice" && !s.airborne) return this.fail("fall");
    if (h?.kind === "pool") {
      if (this.cfg.level === "explorador") { s.x = this.safe.x; s.z = this.safe.z; s.v = 0; s.damage += 6; this.flash("g.warn.water", "bad"); }
      else return this.fail("water");
    } else if (this.time % 0.5 < 0.02) this.safe = { x: s.x, z: s.z };
    if (h?.kind === "ice") this.flash("g.haz.ice", "warn");
    const i = c.nearest(s.x, s.z).i;
    for (const hz of c.hazards) {
      if (hz.kind !== "rockfall" || this.rockfallsDone.has(hz) || Math.abs(i - hz.i0) > 1) continue;
      this.rockfallsDone.add(hz);
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), ahead = Math.max(2, s.v * 1.3);
      this.pendingFalls.push({ x: s.x + fx * ahead, z: s.z + fz * ahead, t: this.time + 1.3 });
      this.flash("g.haz.rockfall", "bad");
      this.shake = 0.6;
    }
  }

  private updateFalls(dt: number) {
    for (let i = this.pendingFalls.length - 1; i >= 0; i--) {
      const f = this.pendingFalls[i];
      if (this.time < f.t) continue;
      this.pendingFalls.splice(i, 1);
      const q = this.cave!.nearest(f.x, f.z);
      for (let k = 0; k < 4; k++) {
        const r = 0.4 + this.R() * 0.6;
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), new THREE.MeshStandardMaterial({ color: 0x4a3f38, flatShading: true }));
        const x = f.x + (this.R() - 0.5) * 3, z = f.z + (this.R() - 0.5) * 3;
        this.scene.add(m);
        this.falling.push({ x, z, y: q.floor + 4 + q.w * 0.45, vy: 0, floor: this.cave!.heightAt(x, z) + r * 0.7, mesh: m, hit: false });
      }
    }
    let dodged = 0;
    for (const f of this.falling) {
      if (f.y > f.floor) {
        f.vy -= (this.g + 3) * dt;
        f.y = Math.max(f.floor, f.y + f.vy * dt);
        if (f.y === f.floor && !f.hit) {
          f.hit = true;
          this.shake = Math.max(this.shake, 0.8);
          if (Math.hypot(f.x - this.s.x, f.z - this.s.z) < 2.6) { this.s.damage += 14 * this.p.damageMul; this.flash("g.haz.rockfall.hit", "bad"); }
          else dodged++;
        }
      }
      f.mesh.position.set(f.x, f.y, f.z);
    }
    if (dodged >= 3) this.stats.rockfalls++;
  }

  private updateRain(dt: number) {
    const o = this.rainObj;
    if (!o) return;
    const on = this.time > this.weather.start;
    const mat = o.material as THREE.Material & { opacity: number };
    mat.opacity += ((on ? (this.weather.kind === "rain" ? 0.5 : 0.85) * this.weather.intensity : 0) - mat.opacity) * Math.min(1, dt);
    const seeds = o.userData.seed as number[][];
    const arr = (o.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const c = this.camera.position, A = 60, H = 40;
    const fall = this.weather.kind === "rain" ? 22 : 2.2;
    for (let i = 0; i < seeds.length; i++) {
      const sd = seeds[i];
      sd[1] = (sd[1] - (dt * fall) / H + 1) % 1;
      const x = c.x + (sd[0] - 0.5) * A + (this.weather.kind === "snow" ? Math.sin(this.time + i) * 0.6 : 0);
      const z = c.z + (sd[2] - 0.5) * A, y = c.y - 12 + sd[1] * H;
      if (this.weather.kind === "rain") arr.set([x, y, z, x + 0.05, y - 0.9, z], i * 6); else arr.set([x, y, z], i * 3);
    }
    o.geometry.attributes.position.needsUpdate = true;
    const k = this.wet; // cielo y niebla más cerrados mientras llueve
    if (this.skyMesh) (this.skyMesh.material as THREE.MeshBasicMaterial).color.setScalar(1 - 0.45 * k);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.far = 2200 - 1500 * k;
  }

  // ------------------------------------------------------------------ análisis de muestras y foto
  closeAnalysis() { this.analysis = null; this.paused = this.stationCard || this.photo; }
  setPhotoMode(on: boolean) {
    this.photo = on;
    this.paused = on || this.stationCard || !!this.analysis;
    if (on) { this.orbit.yaw = this.s.yaw + Math.PI + 0.6; this.orbit.dist = 13 * this.K; }
    else this.sunHour = 11;
  }
  orbitBy(dyaw: number, dpitch: number, zoom = 1) {
    this.orbit.yaw += dyaw;
    this.orbit.pitch = Math.max(0.03, Math.min(1.35, this.orbit.pitch + dpitch));
    this.orbit.dist = Math.max(4 * this.K, Math.min(80 * this.K, this.orbit.dist * zoom));
  }
  /** Hora del día solo para fotos (mueve el sol): 6 = amanecer, 12 = mediodía, 18 = atardecer. */
  setSunHour(h: number) { this.sunHour = h; }
  /** Renderiza y devuelve la foto como PNG (data URL) con un pie de foto opcional. */
  takePhoto(caption: string | null): string | null {
    this.render(0);
    const src = this.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    if (caption) {
      const fs = Math.max(13, Math.round(out.height / 46)), pad = fs * 0.6;
      ctx.font = fs + "px sans-serif";
      const w = Math.min(out.width, ctx.measureText(caption).width + pad * 2);
      ctx.fillStyle = "rgba(7,11,22,0.7)";
      ctx.fillRect(0, out.height - fs - pad * 2, w, fs + pad * 2);
      ctx.fillStyle = "#eef2fb";
      ctx.textBaseline = "middle";
      ctx.fillText(caption, pad, out.height - (fs + pad * 2) / 2);
    }
    this.stats.photos++;
    return out.toDataURL("image/png");
  }

  // ------------------------------------------------------------------ entrada
  setInput(inp: Partial<Input>) { this.input = { ...this.input, ...inp }; }
  setAction(down: boolean) { this.actionHeld = down; }
  toggleLights() { this.lights = !this.lights; }
  cycleCamera() { this.camMode = (this.camMode + 1) % 3; }
  dropRelay() {
    if (this.relaysLeft <= 0 || this.s.airborne || this.ended) return;
    this.relaysLeft--;
    this.stats.relays++;
    const y = this.env.height(this.s.x, this.s.z);
    this.nodes.push({ x: this.s.x, z: this.s.z, y: y + 2.2, range: this.cave ? CAVE_RELAY_RANGE : 650 });
    const m = buildRelay();
    m.scale.setScalar(Math.max(0.5, this.K));
    m.position.set(this.s.x, y, this.s.z);
    this.scene.add(m);
    this.relayMeshes.push(m);
    this.sigTimer = 1;
  }
  setPaused(p: boolean) { if (!this.ended) this.paused = p; }
  closeStationCard() { this.stationCard = false; this.paused = !!this.analysis || this.photo; }

  private flash(key: string, kind: "warn" | "bad") { this.warn = { key, kind }; this.warnUntil = this.time + 2.5; }
  private say(key: string, vars?: Record<string, string | number>) { this.toast = { key, vars }; this.toastUntil = this.time + 3; }

  // ------------------------------------------------------------------ ciclo
  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); // nunca negativo (relojes que retroceden)
    this.last = now;
    if (!this.paused && !this.ended) this.update(dt);
    this.render(dt);
  }

  private delayedInput(): Input {
    if (!this.delay) return this.input;
    this.queue.push({ t: this.time, inp: { ...this.input } });
    while (this.queue.length > 1 && this.queue[1].t <= this.time - this.delay) this.queue.shift();
    return this.queue[0].t <= this.time - this.delay ? this.queue[0].inp : { throttle: 0, steer: 0, brake: true };
  }

  private update(dt: number) {
    this.time += dt;
    const inp = { ...this.delayedInput() };
    if (this.battery < 20) inp.throttle *= 0.6;
    const n = Math.ceil(dt / (1 / 120));
    const events: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      events.push(...step(this.s, inp, this.env, this.p, dt / n));
      if (this.cave) this.caveWalls(events);
    }
    for (const e of events) {
      if (e.type === "crash") return this.fail("crash");
      if (e.type === "tip") return this.fail("tip");
      if (e.type === "stuck") return this.fail("stuck");
      if (e.type === "sandWarn") this.flash("g.warn.sand", "warn");
      if (e.type === "slopeWarn" || e.type === "slide") this.flash("g.warn.slope", "warn");
      if (e.type === "bump") this.shake = Math.min(1, this.shake + e.speed * 0.1);
      if (e.type === "land" && e.speed > 3) this.shake = 1;
    }
    this.stats.distance += Math.abs(this.s.v) * dt;
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, Math.abs(this.s.v) * 3.6);
    if (this.world) { this.updateHazards(dt); if (this.ended) return; }
    if (this.cave) { this.updateCaveHazards(); if (this.ended) return; this.updateFalls(dt); }
    const w = this.world;
    if (w) {
      if (w.inWater(this.s.x, this.s.z)) {
        if (this.cfg.level === "explorador") {
          this.s.x = this.safe.x; this.s.z = this.safe.z; this.s.v = 0;
          this.s.damage += 5;
          this.flash("g.warn.water", "bad");
        } else return this.fail("water");
      } else if (!this.s.airborne && this.time % 0.5 < dt) this.safe = { x: this.s.x, z: this.s.z };
      const vent = w.ventNear(this.s.x, this.s.z);
      if (vent > 0.5) { this.s.damage += 3 * vent * dt * this.p.damageMul; this.flash("g.warn.vent", "warn"); } // suelo caliente
    }
    if (this.s.damage >= 100) return this.fail("damage");

    // batería: motor + base + luces + calefactor si el lugar es frío (temperatura media real < 0 °C)
    const cold = (this.cfg.site.climate?.t_mean?.value ?? 290) < 273 ? 0.05 : 0;
    const drain = (0.05 + 0.27 * Math.abs(inp.throttle) + (this.lights ? 0.03 : 0) + cold) * DRAIN[this.cfg.level];
    const charging = !this.cave && Math.abs(this.s.v) < 0.2 && Math.abs(inp.throttle) < 0.05;
    // el panel carga menos con polvo encima (remolinos), con lluvia/nieve o con tormenta solar en curso
    const sunK = (1 - 0.6 * this.panelDust) * (1 - 0.65 * this.wet);
    this.battery = Math.max(0, Math.min(100, this.battery - drain * dt + (charging ? 0.4 * sunK * dt : 0)));
    if (this.battery < 20 && this.battery > 0) this.flash("g.warn.battery", "warn");
    if (this.battery <= 0) return this.fail("battery");

    this.sigTimer -= dt;
    if (this.sigTimer <= 0) { this.sigTimer = 0.2; this.updateSignal(); }
    if (this.signal < 0.08) {
      this.lostTime += dt;
      this.flash("g.warn.signal", "bad");
      if (this.lostTime > LOST_LIMIT[this.cfg.level]) return this.fail("signal");
    } else this.lostTime = Math.max(0, this.lostTime - dt * 2);

    this.updateObjectives(dt);
    this.updateDust(dt);
  }

  private caveWalls(events: GameEvent[]) {
    const c = this.cave!;
    const q = c.nearest(this.s.x, this.s.z);
    const lim = q.w - this.p.radius * 0.8;
    if (q.d <= lim) return;
    const a = c.pts[q.i], b = c.pts[q.i + 1];
    const cx = a.x + (b.x - a.x) * q.t, cz = a.z + (b.z - a.z) * q.t;
    const nx = (this.s.x - cx) / q.d, nz = (this.s.z - cz) / q.d;
    const fx = Math.sin(this.s.yaw), fz = Math.cos(this.s.yaw);
    const vn = (fx * nx + fz * nz) * this.s.v;
    if (vn > this.p.crashSpeed) events.push({ type: "crash", speed: vn });
    if (vn > 0.5) { this.s.damage += (vn - 0.5) * 7 * this.p.damageMul; events.push({ type: "bump", speed: vn }); }
    this.s.x = cx + nx * lim; this.s.z = cz + nz * lim;
    if (vn > 0) this.s.v *= 0.3;
  }

  private updateSignal() {
    const ry = this.s.y + 1.7;
    if (this.cave) {
      const c = this.cave;
      const los = (a: Node, b: { x: number; z: number }) => c.losInside(a.x, a.z, b.x, b.z);
      this.nodeOk = connected(this.nodes, (a, b) => los(a, b));
      this.signal = roverSignal(this.nodes, this.nodeOk, this.s.x, ry, this.s.z, (a, x, _y, z) => los(a, { x, z }));
      return;
    }
    const grid = this.grid!;
    const blocked = (x: number, z: number, y: number) => grid.heightAt(x, z) > y;
    this.nodeOk = connected(this.nodes, (a, b) => lineOfSight(a.x, a.y, a.z, b.x, b.y, b.z, blocked));
    this.signal = roverSignal(this.nodes, this.nodeOk, this.s.x, ry, this.s.z,
      (a, x, y, z) => lineOfSight(a.x, a.y, a.z, x, y, z, blocked));
  }

  private near(p: Spot, r: number) { return Math.hypot(this.s.x - p.x, this.s.z - p.z) < r; }

  private updateObjectives(dt: number) {
    const still = Math.abs(this.s.v) < 0.5 && !this.s.airborne;
    let holding = false;
    if (this.cfg.mode === "free") {
      const w = this.world!;
      const g = w.gates[this.gateIdx];
      if (g && this.near(g, this.rGate)) {
        const m = this.gateMeshes[this.gateIdx];
        ((m.getObjectByName("ring") as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(0x2fbf71);
        ((m.getObjectByName("ring") as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.set(0x1f8f51);
        this.gateIdx++;
        this.objectives[0].progress = `${this.gateIdx}/${w.gates.length}`;
        this.say("g.ok.gate");
        if (this.gateIdx >= w.gates.length) { this.objectives[0].done = true; return this.win(); }
      }
    } else if (this.cfg.mode === "mission") {
      const w = this.world!;
      if (!this.stationDone && this.near(w.station, this.rStation)) {
        holding = this.actionHeld && still;
        if (holding && this.actionTime > 2) {
          this.stationDone = true;
          this.objectives[0].done = true;
          this.scene.remove(this.stationMesh!);
          const st = buildStation(true);
          st.scale.setScalar(Math.max(0.55, this.K));
          st.position.set(w.station.x, this.env.height(w.station.x, w.station.z), w.station.z);
          this.scene.add(st);
          // la estación también funciona como repetidor (si ve a la base o a un repetidor conectado)
          this.nodes.push({ x: w.station.x, z: w.station.z, y: this.env.height(w.station.x, w.station.z) + 2.2, range: 650 });
          this.sigTimer = 0;
          this.stationCard = true;
          this.paused = true;
          this.actionTime = 0;
        }
      }
      if (this.arenaW) this.revealSamples();
      this.handleSamples(w.samples, this.rSample, still, (h) => (holding = holding || h));
      const allSamples = this.samplesDone.every(Boolean);
      if (this.arenaW) { this.updateArenaTasks(dt, allSamples); if (this.ended) return; }
      else if (this.stationDone && allSamples && this.near(w.spawn, 14)) { this.objectives[2].done = true; return this.win(); }
    } else {
      const c = this.cave!;
      this.handleSamples(c.samples, 5, still, (h) => (holding = holding || h));
      if (!this.reachedEnd && this.near(c.end, 8)) { this.reachedEnd = true; this.objectives[1].done = true; this.say("g.obj.cave.exit"); }
      if (this.reachedEnd && this.samplesDone.every(Boolean) && this.near(c.pts[1], 9)) { this.objectives[2].done = true; return this.win(); }
    }
    this.actionTime = holding ? this.actionTime + dt : 0;
  }

  /** Arena: las muestras están escondidas; aparecen cuando el rover (con el escáner) llega cerca. */
  private revealSamples() {
    this.world!.samples.forEach((sp, i) => {
      if (!this.hidden[i] || !this.near(sp, Math.max(2.6, this.rSample))) return;
      this.hidden[i] = false;
      this.sampleMeshes[i].visible = true;
      this.say("arena.ok.found");
    });
  }
  /** Arena: balizas del perímetro y simulacro de tormenta solar (vuelta a la base contra reloj). Todo de juego. */
  private updateArenaTasks(dt: number, allSamples: boolean) {
    const w = this.arenaW!, obj = this.objectives[2];
    w.perimeter.forEach((p, i) => {
      if (this.periDone[i] || !this.near(p, 1.7)) return;
      this.periDone[i] = true;
      for (const name of ["cone", "ring"]) {
        const mat = (this.periMeshes[i].getObjectByName(name) as THREE.Mesh).material as THREE.MeshStandardMaterial;
        mat.color.set(0x2fbf71); mat.emissive?.set(0x1f8f51);
      }
      const k = this.periDone.filter(Boolean).length;
      obj.progress = `${k}/${w.perimeter.length}`;
      obj.done = k === w.perimeter.length;
      this.say("arena.ok.beacon", { k, n: w.perimeter.length });
    });
    if (!this.drill && this.stationDone && allSamples && obj.done) {
      // tiempo: distancia a la base a ~55 % de la velocidad máxima + margen según el nivel (decisión de diseño)
      const d = Math.hypot(this.s.x - w.spawn.x, this.s.z - w.spawn.z);
      const T = Math.max(15, d / (this.p.maxSpeed * 0.55) + 8) * { explorador: 1.5, cadete: 1.2, cientifico: 1 }[this.cfg.level];
      this.drill = { left: T, late: false };
      this.stats.storms++;
      this.flash("arena.drill.start", "bad");
    }
    if (this.drill) {
      if (this.near(w.spawn, 2.6)) { this.objectives[3].done = !this.drill.late; return this.win(); }
      this.drill.left -= dt;
      if (this.drill.left <= 0) { this.drill.late = true; this.s.damage += dt * 3 * this.p.damageMul; this.flash("arena.drill.late", "bad"); }
    }
  }

  private handleSamples(spots: Spot[], r: number, still: boolean, setHold: (h: boolean) => void) {
    spots.forEach((sp, i) => {
      if (this.samplesDone[i] || this.hidden[i] || !this.near(sp, r)) return;
      const h = this.actionHeld && still;
      setHold(h);
      if (h && this.actionTime > 2.5) {
        this.samplesDone[i] = true;
        this.sampleMeshes[i].visible = false;
        const rel = this.env.height(sp.x, sp.z);
        const rec: SampleRecord = {
          n: this.records.length + 1, x: sp.x, z: sp.z, time: this.time, cave: !!this.cave,
          elev: this.cave ? NaN : this.cfg.site.h_min + (this.hf.demAt(sp.x, sp.z)),  // arena: h_min = altura medida del lugar
          slope: this.cave ? NaN : this.hf.slopeDeg(sp.x, sp.z, 15),
          soil: this.env.soil(sp.x, sp.z).kind, wet: this.wet > 0.2 || !!this.world?.puddleAt(sp.x, sp.z),
        };
        void rel;
        this.records.push(rec);
        this.analysis = rec;
        this.paused = true;
        const n = this.samplesDone.filter(Boolean).length;
        const obj = this.objectives.find((o) => o.key.includes("samples"))!;
        obj.progress = `${n}/${spots.length}`;
        obj.done = n === spots.length;
        this.say("g.ok.sample");
        this.actionTime = 0;
      }
    });
  }

  private currentTarget(): Spot | null {
    if (this.cfg.mode === "free") return this.world!.gates[this.gateIdx] ?? null;
    if (this.cfg.mode === "mission") {
      const w = this.world!;
      if (!this.stationDone) return w.station;
      if (this.arenaW) {   // arena: la flecha lleva a una muestra ya encontrada, si no a la baliza más cercana; las escondidas se buscan con el escáner
        const byDist = (a: Spot, b: Spot) => Math.hypot(a.x - this.s.x, a.z - this.s.z) - Math.hypot(b.x - this.s.x, b.z - this.s.z);
        const seen = w.samples.filter((_, i) => !this.samplesDone[i] && !this.hidden[i]).sort(byDist)[0];
        if (seen) return seen;
        const bc = this.arenaW.perimeter.filter((_, i) => !this.periDone[i]).sort(byDist)[0];
        if (bc) return bc;
        return this.drill ? w.spawn : null;
      }
      const k = this.samplesDone.findIndex((d) => !d);
      if (k >= 0) return w.samples[k];
      return w.spawn;
    }
    const c = this.cave!;
    const k = this.samplesDone.findIndex((d) => !d);
    if (k >= 0) return c.samples[k];
    if (!this.reachedEnd) return c.end;
    return c.pts[1];
  }

  private stars(): number {
    const d = this.s.damage;
    let st = d < 20 ? 3 : d < 50 ? 2 : 1;
    if (this.cfg.mode === "free") {
      const w = this.world!;
      let L = Math.hypot(w.gates[0].x - w.spawn.x, w.gates[0].z - w.spawn.z);
      for (let i = 1; i < w.gates.length; i++) L += Math.hypot(w.gates[i].x - w.gates[i - 1].x, w.gates[i].z - w.gates[i - 1].z);
      const par = L / (this.arenaW ? this.p.maxSpeed * 0.6 : 4.5);
      st = Math.min(st, this.time <= par ? 3 : this.time <= par * 1.5 ? 2 : 1);
    }
    return st;
  }
  private win() {
    this.ended = true;
    const samples = this.samplesDone.filter(Boolean).length;
    let st = this.stars();
    if (this.drill?.late) st = Math.min(st, 2);   // llegó tarde al simulacro
    this.onEnd({ win: true, stars: st, time: this.time, damage: this.s.damage, samples,
      score: Math.max(0, Math.round(3000 - this.time * 3 - this.s.damage * 15 + samples * 250 + st * 300)), ...this.progress() });
  }
  private progress() {
    return { objectives: this.objectives.map((o) => ({ ...o })), records: [...this.records], stats: { ...this.stats }, weather: this.weather.kind };
  }
  private fail(reason: FailReason) {
    if (this.ended) return;
    this.ended = true;
    this.onEnd({ win: false, reason, stars: 0, time: this.time, damage: this.s.damage, samples: this.samplesDone.filter(Boolean).length, score: 0, ...this.progress() });
  }

  // ------------------------------------------------------------------ visual
  private updateDust(dt: number) {
    const drag = this.cfg.gravity === "earth" ? 1.6 : this.cfg.gravity === "mars" ? 0.5 : 0; // sin aire en la Luna
    const speed = Math.abs(this.s.v);
    const emit = !this.s.airborne && speed > 1.2 ? Math.min(6, speed * 0.8) : 0;
    let toEmit = Math.floor(emit + Math.random());
    const fx = Math.sin(this.s.yaw), fz = Math.cos(this.s.yaw);
    for (const d of this.dustData) {
      if (d.life > 0) {
        d.vy -= this.g * dt;
        const k = Math.max(0, 1 - drag * dt);
        d.vx *= k; d.vz *= k; if (drag) d.vy = d.vy * k;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.life -= dt;
        if (d.y < this.env.height(d.x, d.z)) d.life = 0;
      } else if (toEmit > 0) {
        toEmit--;
        const side = Math.random() < 0.5 ? -1 : 1;
        d.x = this.s.x - fx * 1.3 * this.K + Math.cos(this.s.yaw) * side * 1.3 * this.K;
        d.z = this.s.z - fz * 1.3 * this.K - Math.sin(this.s.yaw) * side * 1.3 * this.K;
        d.y = this.env.height(d.x, d.z) + 0.2 * this.K;
        d.vx = -fx * speed * 0.3 + (Math.random() - 0.5) * 1.5;
        d.vz = -fz * speed * 0.3 + (Math.random() - 0.5) * 1.5;
        d.vy = 1 + Math.random() * 2.2;
        d.life = 3;
      }
    }
  }

  private render(dt: number) {
    if (!this.s) return;
    const s = this.s, r = this.rover;
    const bodyY = s.airborne ? s.y : Math.min(s.y, s.ground + 0.06); // suspensión estirada: ruedas en el suelo
    this.visY = Number.isFinite(this.visY) ? this.visY + (bodyY - this.visY) * Math.min(1, dt * 25 || 1) : bodyY;
    r.group.position.set(s.x, this.visY - this.p.clearance + (this.s.sink / this.p.stuckTime) * -0.25, s.z);
    r.group.rotation.set(0, 0, 0);
    r.group.rotateY(s.yaw);
    r.group.rotateX(-s.pitch);
    r.group.rotateZ(-s.roll);
    for (const w of r.wheels) w.rotation.x = s.wheelAngle / this.K;
    for (const fw of r.frontWheels) fw.rotation.y = (fw.position.z > 0 ? -1 : 1) * this.input.steer * 0.45;
    (r.beacon.material as THREE.MeshBasicMaterial).color.set(this.signal > 0.3 ? 0x5cff8a : this.signal > 0.08 ? 0xffc23d : 0xff4d4d);
    for (const l of r.lights) l.intensity = this.lights ? (this.cave ? 90 : 40) : 0;

    // marcadores animados
    const tt = this.time;
    for (const m of this.sampleMeshes) { const c = m.getObjectByName("crystal"); if (c) { c.rotation.y = tt; c.position.y = 1.4 + Math.sin(tt * 2) * 0.2; } }
    this.periMeshes.forEach((m, i) => { const c = m.getObjectByName("cone"); if (c) c.position.y = 0.25 + (this.periDone[i] ? 0 : Math.abs(Math.sin(tt * 3 + i)) * 0.12); });
    this.gateMeshes.forEach((g, i) => { (g.getObjectByName("ring") as THREE.Mesh).scale.setScalar(i === this.gateIdx ? 1 + Math.sin(tt * 4) * 0.05 : 1); });
    for (const m of this.relayMeshes) { const led = m.getObjectByName("led"); if (led) led.visible = Math.sin(tt * 6) > 0; }

    // polvo y vapor
    const arr = (this.dust.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    this.dustData.forEach((d, i) => { arr[i * 3] = d.x; arr[i * 3 + 1] = d.life > 0 ? d.y : -9999; arr[i * 3 + 2] = d.z; });
    this.dust.geometry.attributes.position.needsUpdate = true;
    if (this.steam) {
      const vents = this.steam.userData.vents as Spot[], ph = this.steam.userData.phase as number[];
      const a2 = (this.steam.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < ph.length; i++) {
        const v = vents[i % vents.length];
        ph[i] = (ph[i] + dt * 0.25) % 1;
        const base = this.env.height(v.x, v.z);
        a2[i * 3] = v.x + Math.sin(i * 3.1 + tt) * ph[i] * 2;
        a2[i * 3 + 1] = base + 1 + ph[i] * 14;
        a2[i * 3 + 2] = v.z + Math.cos(i * 1.7 + tt) * ph[i] * 2;
      }
      this.steam.geometry.attributes.position.needsUpdate = true;
    }

    for (const gz of this.geysers) { // columna de vapor
      const ph = geyserPhase(this.time, gz.seed), m = gz.steam, mat = m.material as THREE.MeshBasicMaterial;
      const want = ph === "erupt" ? 22 : ph === "warn" ? 5 : 0.5;
      m.scale.y += (want - m.scale.y) * Math.min(1, dt * 3);
      m.position.y = this.env.height(gz.x, gz.z) + m.scale.y / 2;
      mat.opacity = ph === "erupt" ? 0.5 : ph === "warn" ? 0.3 : 0.08;
    }
    if (!this.photo) this.updateRain(dt);
    // sol: en modo foto se puede elegir la hora
    if (!this.cave) {
      const h = this.photo ? this.sunHour : 11;
      const el = Math.sin(((h - 6) / 12) * Math.PI), az = ((h - 12) / 12) * Math.PI;
      this.sun.intensity = 0.4 + 2.2 * Math.max(0.05, el) * (1 - 0.5 * this.wet);
      this.sun.color.setHSL(0.08, 0.9, 0.5 + 0.45 * Math.min(1, el * 1.6));
      if (this.hemi) this.hemi.intensity = 0.35 + 0.6 * Math.max(0.1, el);
      this.sunDir.set(Math.sin(az) * 300, 40 + 400 * Math.max(0.03, el), 160 + Math.cos(az) * 80);
      if (this.ceilH !== null) {   // lugar cerrado: luz cálida de las luminarias del techo (casi vertical), no el sol
        this.sun.intensity = 1.5; this.sun.color.set(0xffe9c8);
        if (this.hemi) this.hemi.intensity = 1.0;
        this.sunDir.set(190, 420, 120);
      }
    }

    // cámara
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const cfgs = [[-10, 4.6, 3], [-26, 15, 4], [1.6, 1.9, 22]] as const;
    const K = this.K, kc = K < 1 ? K * 1.12 : 1;   // arena: cámara más baja y cercana, a la escala del rover
    const [back, up, ahead] = cfgs[this.camMode].map((v) => v * kc);
    const want = new THREE.Vector3(s.x + fx * back, s.y + up, s.z + fz * back);
    if (this.photo) { // cámara libre alrededor del rover
      const o = this.orbit;
      want.set(s.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, s.y + 1 + Math.sin(o.pitch) * o.dist, s.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    }
    const minY = this.env.height(want.x, want.z) + 1.2 * K;
    if (want.y < minY) want.y = minY;
    this.keepCamInside(want, !this.photo && this.camMode !== 2);
    if (this.cave) { const q = this.cave.nearest(want.x, want.z); if (q.d > q.w - 0.5) { want.x = s.x - fx * 4; want.z = s.z - fz * 4; want.y = s.y + 2.5; } }
    const look = this.photo ? new THREE.Vector3(s.x, s.y + 1 * K, s.z) : new THREE.Vector3(s.x + fx * ahead, s.y + 1.2 * K, s.z + fz * ahead);
    const k = this.camMode === 2 || this.photo ? 1 : 1 - Math.exp(-dt * 5);
    this.camPos.lerp(want, k);
    this.keepCamInside(this.camPos);
    this.camLook.lerp(look, this.camMode === 2 || this.photo ? 1 : 1 - Math.exp(-dt * 8));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3 * K;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3 * K;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.lookAt(this.camLook);
    if (!this.cave) {
      if (this.cfg.arena) this.sunDir.setLength(90);   // luz cerca: sombra precisa para el rover chico
      this.sun.position.set(s.x + this.sunDir.x, s.y + this.sunDir.y, s.z + this.sunDir.z);
      this.sun.target.position.set(s.x, s.y, s.z);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Arena: la cámara nunca sale de las paredes (o de la reja) ni pasa el techo; si choca, se acerca al rover. */
  private camSide = 1;
  private keepCamInside(c: THREE.Vector3, swing = false) {
    const a = this.cfg.arena;
    if (!a || !this.arenaClr) return;
    const s = this.s;
    let t = camClamp(a.spec, this.arenaClr, s.x, s.z, c.x, c.z);
    if (t < 0.7 && swing) {
      // de espaldas a una pared: antes de pegarse al rover, la cámara gira hacia un costado donde sí hay lugar
      const dx = c.x - s.x, dz = c.z - s.z;
      for (const ang of [0.8, -0.8, 1.3, -1.3, 1.8, -1.8].map((v) => v * this.camSide)) {
        const x = s.x + dx * Math.cos(ang) + dz * Math.sin(ang), z = s.z - dx * Math.sin(ang) + dz * Math.cos(ang);
        const t2 = camClamp(a.spec, this.arenaClr, s.x, s.z, x, z);
        if (t2 >= 0.85) { c.x = x; c.z = z; t = t2; this.camSide = Math.sign(ang); break; }
      }
    }
    if (t < 1) {
      c.x = s.x + (c.x - s.x) * t; c.z = s.z + (c.z - s.z) * t;
      c.y += (1 - t) * 3 * this.K;            // al acercarse sube para seguir viendo al rover y el lugar
    }
    if (this.ceilH === null) return;         // al aire libre no hay techo
    const top = this.env.height(c.x, c.z) + this.ceilH - 0.5;
    if (c.y > top) c.y = top;
  }

  private resize() {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  hud(): HudSnapshot | null {
    if (!this.s) return null;
    const tgt = this.currentTarget();
    let bearing: number | null = null, dist: number | null = null;
    if (tgt) {
      // en la cueva la flecha sigue el túnel (un punto unos metros más adelante en el camino), no la línea recta
      let gx = tgt.x, gz = tgt.z;
      dist = Math.hypot(tgt.x - this.s.x, tgt.z - this.s.z);
      if (this.cave) {
        const c = this.cave, nr = c.nearest(this.s.x, this.s.z), nt = c.nearest(tgt.x, tgt.z);
        if (Math.abs(nt.i - nr.i) > 2) { const k = Math.max(0, Math.min(c.pts.length - 1, nr.i + Math.sign(nt.i - nr.i) * 3)); gx = c.pts[k].x; gz = c.pts[k].z; }
        dist = Math.max(dist, Math.abs(nt.s - nr.s)); // distancia por el túnel
      }
      const ang = Math.atan2(gx - this.s.x, gz - this.s.z);
      bearing = Math.atan2(Math.sin(ang - this.s.yaw), Math.cos(ang - this.s.yaw));
    }
    let hint: string | null = null;
    if (this.cfg.mode === "mission" && !this.stationDone && this.world && this.near(this.world.station, this.rStation)) hint = "g.hint.deploy";
    const spots = this.cave ? this.cave.samples : this.cfg.mode === "mission" ? this.world!.samples : [];
    if (spots.some((sp, i) => !this.samplesDone[i] && !this.hidden[i] && this.near(sp, this.cave ? 5 : this.rSample))) hint = "g.hint.drill";
    if (!hint && this.signal < 0.25 && this.relaysLeft > 0) hint = "g.hint.relay";
    const targets: Spot[] = this.cfg.mode === "free" ? this.world!.gates.slice(this.gateIdx)
      : this.cfg.mode === "mission" ? [...(this.stationDone ? [] : [this.world!.station]), ...this.world!.samples.filter((_, i) => !this.samplesDone[i] && !this.hidden[i])]
        : [...this.cave!.samples.filter((_, i) => !this.samplesDone[i]), this.cave!.end];
    let scanner: number | null = null, view: HudSnapshot["map"]["view"];
    if (this.arenaW && this.cfg.arena) {
      const left = this.world!.samples.filter((_, i) => this.hidden[i]);
      if (left.length) scanner = scannerLevel(Math.min(...left.map((p) => Math.hypot(p.x - this.s.x, p.z - this.s.z))), this.scanRange);
      const fb = freeBounds(this.cfg.arena.spec);
      view = { cx: fb.cx, cz: fb.cz, size: Math.max(fb.w, fb.l) + 3, north: this.cfg.arena.spec.source === "polygon" };
    }
    return {
      scanner, drill: this.drill ? { left: Math.max(0, this.drill.left), late: this.drill.late } : null,
      speedKmh: Math.abs(this.s.v) * 3.6, battery: this.battery, signal: this.signal, lostTime: this.lostTime, lostLimit: LOST_LIMIT[this.cfg.level],
      damage: Math.min(100, this.s.damage), pitchDeg: (this.s.pitch * 180) / Math.PI, rollDeg: (this.s.roll * 180) / Math.PI, time: this.time,
      objectives: this.objectives.map((o) => ({ ...o })), hint,
      warn: this.time < this.warnUntil ? this.warn : null, toast: this.time < this.toastUntil ? this.toast : null,
      relaysLeft: this.relaysLeft, g: this.g, delay: this.delay, action: Math.min(1, this.actionTime / (hint === "g.hint.deploy" ? 2 : 2.5)),
      lights: this.lights, cam: this.camMode, targetBearing: bearing, targetDist: dist, stationCard: this.stationCard, paused: this.paused,
      airborne: this.s.airborne,
      map: { x: this.s.x, z: this.s.z, yaw: this.s.yaw, size: this.cave ? 0 : this.cfg.site.size_m, view,
        beacons: this.arenaW && this.cfg.mode === "mission" ? this.arenaW.perimeter.filter((_, i) => !this.periDone[i]) : undefined,
        base: this.world ? this.world.spawn : this.cave ? { x: this.cave.pts[1].x, z: this.cave.pts[1].z } : null,
        targets, relays: this.nodes.slice(1).map((n) => ({ x: n.x, z: n.z })), cave: this.cave ? this.cave.pts : null,
        puddles: this.world ? this.world.puddles.map((p) => ({ x: p.x, z: p.z, r: p.r, deep: p.deep })) : [],
        sand: this.world ? this.world.sand : [], devils: this.devils.map((d) => ({ x: d.x, z: d.z })),
        vents: this.world ? this.world.vents : [],
        hazards: this.cave ? this.cave.hazards.map((h) => ({ x: h.x, z: h.z, kind: h.kind })) : [] },
      analysis: this.analysis, weather: { kind: this.weather.kind, on: this.weather.kind !== "clear" && this.time > this.weather.start, prob: this.weather.prob },
      storm: this.storm, photo: this.photo,
    };
  }

  /** Imagen de sombreado del relieve para el minimapa (una sola vez). */
  hillshade(px = 160): ImageData | null {
    if (!this.hf || this.cave) return null;
    const img = new ImageData(px, px);
    const size = this.cfg.site.size_m;
    for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
      const x = -size / 2 + ((i + 0.5) / px) * size, z = -size / 2 + ((j + 0.5) / px) * size;
      const [nx, ny, nz] = this.hf.normalAt(x, z, 15);
      const light = Math.max(0, nx * -0.5 + ny * 0.7 + nz * -0.5);
      const water = this.world?.inWater(x, z);
      const k = (j * px + i) * 4;
      const v = 40 + light * 170;
      img.data[k] = water ? 40 : v; img.data[k + 1] = water ? 110 : v * 0.92; img.data[k + 2] = water ? 140 : v * 0.85; img.data[k + 3] = 255;
    }
    return img;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

