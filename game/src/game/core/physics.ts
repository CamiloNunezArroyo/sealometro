// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Física del rover (pura, sin gráficos). Modelo simple pero físico:
// - tracción máxima = μ·g·cos(θ): con menos gravedad hay menos agarre → se acelera y frena peor;
// - componente de la gravedad a lo largo de la pendiente = g·sen(θ): si supera a la tracción, el rover resbala;
// - en el aire cae con la gravedad elegida → en la Luna los saltos duran más;
// - volcadura por inclinación, choque con rocas grandes, hundimiento en suelo blando.
// Velocidades y tiempos ACELERADOS respecto de un rover real (que va a centímetros por segundo): se declara en el juego.

export interface Soil { mu: number; crr: number; soft: boolean; kind: string }
export interface Rock { x: number; z: number; r: number; h: number }
export interface Env {
  height: (x: number, z: number) => number;
  soil: (x: number, z: number) => Soil;
  rocksNear: (x: number, z: number, radius: number) => Rock[];
  half: number; // medio lado del mundo (m)
}
export interface Params {
  g: number;
  maxSpeed: number; revSpeed: number; engineAccel: number;
  length: number; width: number; radius: number; clearance: number;
  maxSteer: number;
  tipRoll: number; tipPitch: number;   // radianes
  crashSpeed: number;                  // m/s hacia la roca
  stuckTime: number;                   // s patinando en suelo blando
  smallRock: number;                   // m: rocas más bajas se pueden pisar
  landDamageSpeed: number;             // m/s vertical sin daño
  damageMul: number;
  travel: number;                      // m: recorrido de la suspensión (rocker-bogie); más separación = en el aire
}
export interface Input { throttle: number; steer: number; brake: boolean }
export interface State {
  x: number; z: number; y: number; vy: number; yaw: number; v: number;
  pitch: number; roll: number; airborne: boolean; airTime: number;
  ground: number;   // altura del suelo bajo el rover (+ despeje): para dibujar las ruedas sobre el suelo
  sink: number; damage: number; sliding: boolean; wheelAngle: number;
}
export type GameEvent =
  | { type: "crash"; speed: number } | { type: "tip"; roll: number; pitch: number } | { type: "stuck" }
  | { type: "bump"; speed: number } | { type: "land"; speed: number } | { type: "slide" }
  | { type: "sandWarn" } | { type: "slopeWarn" } | { type: "edge" };

export const DEG = Math.PI / 180;
export const G = { earth: 9.82, mars: 3.73, moon: 1.62 } as const; // NASA NSSDC (Tierra: gravedad superficial media)

export function makeParams(g: number, level: "explorador" | "cadete" | "cientifico"): Params {
  const L = { explorador: { crash: 5.5, roll: 42, pitch: 48, stuck: 8, dmg: 0.6 },
    cadete: { crash: 4.2, roll: 38, pitch: 44, stuck: 5, dmg: 1 },
    cientifico: { crash: 3.4, roll: 35, pitch: 40, stuck: 3.5, dmg: 1.25 } }[level];
  return {
    g, maxSpeed: 7, revSpeed: 2.8, engineAccel: 3.2, length: 3.0, width: 2.6, radius: 1.5, clearance: 0.55,
    maxSteer: 32 * DEG, tipRoll: L.roll * DEG, tipPitch: L.pitch * DEG, crashSpeed: L.crash, stuckTime: L.stuck,
    smallRock: 0.42, landDamageSpeed: 4.5, damageMul: L.dmg, travel: 0.35,
  };
}

export function initialState(x: number, z: number, yaw: number, env: Env, p: Params): State {
  const y = env.height(x, z) + p.clearance;
  return { x, z, y, ground: y, vy: 0, yaw, v: 0, pitch: 0, roll: 0, airborne: false, airTime: 0,
    sink: 0, damage: 0, sliding: false, wheelAngle: 0 };
}

function groundPose(x: number, z: number, yaw: number, env: Env, p: Params) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const hl = p.length / 2, hw = p.width / 2;
  const hF = env.height(x + fx * hl, z + fz * hl), hB = env.height(x - fx * hl, z - fz * hl);
  const hR = env.height(x + rx * hw, z + rz * hw), hL = env.height(x - rx * hw, z - rz * hw);
  return { pitch: Math.atan2(hF - hB, p.length), roll: Math.atan2(hR - hL, p.width), ground: (hF + hB + hR + hL) / 4 };
}

export function step(s: State, inp: Input, env: Env, p: Params, dt: number): GameEvent[] {
  const ev: GameEvent[] = [];
  const soil = env.soil(s.x, s.z);
  const pose = groundPose(s.x, s.z, s.yaw, env, p);
  if (!s.airborne) {
    const k = Math.min(1, dt * 14);
    s.pitch += (pose.pitch - s.pitch) * k;
    s.roll += (pose.roll - s.roll) * k;
  }
  // la física usa la pendiente REAL bajo el rover (no la suavizada)
  const cosT = Math.cos(pose.pitch), sinT = Math.sin(pose.pitch);
  s.sliding = false;

  if (!s.airborne) {
    // agarre: suelo blando + hundimiento lo reducen
    const sinkFactor = soil.soft ? 1 - Math.min(0.6, (s.sink / p.stuckTime) * 0.6) : 1;
    const tractMax = soil.mu * sinkFactor * p.g * cosT;
    let drive = inp.throttle * p.engineAccel;
    drive = Math.max(-tractMax, Math.min(tractMax, drive));
    const grav = -p.g * sinT;                    // cuesta arriba frena, cuesta abajo empuja
    const rollRes = Math.abs(s.v) > 0.05 ? -Math.sign(s.v) * soil.crr * p.g * cosT : 0;
    let a = drive + grav + rollRes;
    if (inp.brake) {
      const b = tractMax;
      if (Math.abs(s.v) <= b * dt) { s.v = 0; a = Math.abs(grav) > tractMax ? grav : 0; }
      else a += -Math.sign(s.v) * b;
    }
    s.v += a * dt;
    // el rover se sostiene quieto en pendientes que su agarre aguanta
    if (Math.abs(inp.throttle) < 0.05 && Math.abs(s.v) < 0.06 && Math.abs(grav) < tractMax * 0.95) s.v = 0;
    if (Math.abs(grav) > tractMax * 0.98 && Math.abs(sinT) > 0.05) { s.sliding = true; ev.push({ type: "slide" }); }
    const vmax = p.maxSpeed * (s.sliding ? 1.4 : 1);
    s.v = Math.max(-p.revSpeed * (s.sliding ? 3 : 1), Math.min(vmax, s.v));
    if (Math.abs(pose.pitch) > p.tipPitch * 0.65 || Math.abs(pose.roll) > p.tipRoll * 0.65) ev.push({ type: "slopeWarn" });
  }

  // dirección: gira sobre sí mismo cuando está casi quieto (como los rovers reales)
  let yawRate: number;
  if (Math.abs(s.v) < 0.4 && Math.abs(inp.throttle) < 0.1) yawRate = -inp.steer * 0.9;
  else yawRate = -(s.v / p.length) * Math.tan(inp.steer * p.maxSteer);
  if (!s.airborne) s.yaw += yawRate * dt;
  s.wheelAngle += (s.v / 0.35) * dt;

  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
  let nx = s.x + fx * s.v * dt, nz = s.z + fz * s.v * dt;
  const lim = env.half - 25;
  if (Math.abs(nx) > lim || Math.abs(nz) > lim) {
    nx = Math.max(-lim, Math.min(lim, nx));
    nz = Math.max(-lim, Math.min(lim, nz));
    s.v *= -0.2;
    ev.push({ type: "edge" });
  }
  s.x = nx; s.z = nz;

  // rocas
  for (const r of env.rocksNear(s.x, s.z, p.radius + 4)) {
    const dx = s.x - r.x, dz = s.z - r.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    if (r.h < p.smallRock) {
      if (d < r.r + p.radius * 0.5 && Math.abs(s.v) > 3 && !s.airborne) {
        s.damage += 0.6 * p.damageMul;
        ev.push({ type: "bump", speed: Math.abs(s.v) });
      }
      continue;
    }
    const minD = r.r + p.radius;
    if (d < minD) {
      const n0 = dx / d, n1 = dz / d;
      const vn = -(fx * s.v * n0 + fz * s.v * n1); // velocidad hacia la roca
      if (vn > p.crashSpeed) ev.push({ type: "crash", speed: vn });
      if (vn > 0.4) {
        s.damage += (vn - 0.4) * 9 * p.damageMul;
        ev.push({ type: "bump", speed: vn });
      }
      s.x = r.x + n0 * minD;
      s.z = r.z + n1 * minD;
      if (vn > 0) s.v *= -0.25;
    }
  }

  // vertical: suelo, suspensión o vuelo.
  // El cuerpo no puede bajar más rápido que la gravedad. Si el suelo baja más rápido (cresta), las ruedas siguen
  // apoyadas mientras la suspensión se estira (hasta `travel`); recién si la separación es mayor, el rover vuela.
  // Así los baches chicos y las uniones de la malla NO lo hacen despegar; las crestas fuertes a velocidad sí
  // (y más en la Luna, con poca gravedad: v²/R > g).
  const after = groundPose(s.x, s.z, s.yaw, env, p);
  const groundY = after.ground + p.clearance;
  s.ground = groundY;
  if (s.airborne) {
    s.vy -= p.g * dt;
    s.y += s.vy * dt;
    s.airTime += dt;
    if (s.y <= groundY) {
      const impact = -s.vy;
      s.y = groundY;
      s.airborne = false;
      s.airTime = 0;
      if (impact > p.landDamageSpeed) s.damage += (impact - p.landDamageSpeed) * 10 * p.damageMul;
      ev.push({ type: "land", speed: impact });
      s.vy = 0;
    }
  } else {
    // velocidad vertical que impone el terreno, medida con la pendiente entre ruedas delanteras y traseras (3 m):
    // los baches más chicos que el rover los absorbe el balancín, no empujan al cuerpo
    const vyT = s.v * Math.sin(after.pitch);
    const fallVy = s.vy - p.g * dt;              // lo más rápido que puede bajar el cuerpo
    const gap = s.y - groundY;
    if (gap <= 0.001 && vyT >= fallVy) {         // apoyado: sigue al suelo
      s.vy = vyT;
      s.y = groundY;
    } else {                                     // la cresta "se cae" más rápido que la gravedad: suspensión estirada
      s.vy = Math.max(fallVy, gap <= 0.001 ? fallVy : -50);
      s.y += s.vy * dt;
      if (s.y <= groundY) { s.y = groundY; s.vy = vyT; }
      else if (s.y - groundY > p.travel) {
        if (Math.abs(s.v) > 2) { s.airborne = true; s.airTime = 0; }
        else s.y = groundY + p.travel;           // muy lento: no vuela, baja con el suelo
      }
    }
  }

  if (!s.airborne && (Math.abs(pose.roll) > p.tipRoll || Math.abs(pose.pitch) > p.tipPitch)) ev.push({ type: "tip", roll: pose.roll, pitch: pose.pitch });

  // suelo blando: si las ruedas giran pero el rover no avanza, se hunde
  if (soil.soft && !s.airborne) {
    if (Math.abs(s.v) < 0.6 && Math.abs(inp.throttle) > 0.3) s.sink += dt;
    else if (Math.abs(s.v) > 1) s.sink = Math.max(0, s.sink - dt * 0.7);
    if (s.sink > p.stuckTime * 0.35) ev.push({ type: "sandWarn" });
    if (s.sink > p.stuckTime) ev.push({ type: "stuck" });
  } else {
    s.sink = Math.max(0, s.sink - dt);
  }
  return ev;
}
