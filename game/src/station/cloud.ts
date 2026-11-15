// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Conexión: Firebase Realtime Database (plan gratis "Spark") o simulador local.
// Por qué NO Firebase Storage: desde oct. 2024 los proyectos nuevos necesitan el plan Blaze (tarjeta) para Storage.
// Las fotos van comprimidas (~150 KB) a la base de datos; de los videos se suben fotogramas.
//
// Estructura en la base de datos:
//   stations/{device}/latest          ← la caja escribe 1 vez por segundo
//   stations/{device}/history/{clave} ← historia (clave = hora UTC en segundos)
//   sessions/{code}                   ← lugar, GPS del celular (sin fotos: liviano)
//   tracks/{code}/{id}                ← puntos del perímetro caminado
//   media/{code}/{id}                 ← fotos y fotogramas
//   scanmeta/{code}/{id}              ← escaneo 3D: nombre, tamaño, pedazos (liviano, se escucha)
//   scandata/{code}/{id}/{i}          ← escaneo 3D: pedazos en base64 (se descargan solo al usarlo)
import { SCAN_CHUNK, SCAN_MAX_BYTES, type Cloud, type Media, type Reading, type ScanMeta, type SessionDoc, type TrackPt } from "./types";
import { simReading, type SimScenario } from "./sim";

/** Pedazo de archivo → base64 (sin el prefijo "data:...;base64,"). */
async function chunkB64(f: Blob): Promise<string> {
  return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => bad(r.error); r.readAsDataURL(f); });
}
export function b64ToBytes(s: string): Uint8Array { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
/** Revisa un archivo de escaneo antes de subirlo: formato que sabemos leer y tamaño. Devuelve el error o null. */
export function scanFileProblem(f: { name: string; size: number }, es = true): string | null {
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (!["glb", "gltf", "obj", "ply"].includes(ext)) return es ? `Formato .${ext} no soportado: exporta en GLB desde Scaniverse.` : `.${ext} not supported: export as GLB from Scaniverse.`;
  if (ext === "gltf" || ext === "obj") return es ? `.${ext} suele venir en varios archivos (texturas aparte): exporta en GLB, que es uno solo.` : `.${ext} usually comes as several files: export as GLB (single file).`;
  if (f.size > SCAN_MAX_BYTES) return es ? `Pesa ${(f.size / 1048576).toFixed(0)} MB (máx. 30 MB): en Scaniverse exporta con menos detalle o recorta el modelo.` : `${(f.size / 1048576).toFixed(0)} MB (max 30 MB): export with less detail or crop the model.`;
  if (f.size < 1000) return es ? "El archivo está vacío." : "The file is empty.";
  return null;
}
const assemble = (name: string, parts: string[]) => new File(parts.map((p) => b64ToBytes(p) as BlobPart), name);

export interface FbConfig { apiKey: string; authDomain?: string; databaseURL: string; projectId?: string; appId?: string }
const LS_KEY = "seal.firebase.config";

/** Configuración: primero la del build (.env.local), si no, la pegada en la página (guardada en el navegador). */
export function getConfig(): FbConfig | null {
  const e = import.meta.env;
  if (e.VITE_FIREBASE_API_KEY && e.VITE_FIREBASE_DATABASE_URL) {
    return { apiKey: e.VITE_FIREBASE_API_KEY, authDomain: e.VITE_FIREBASE_AUTH_DOMAIN, databaseURL: e.VITE_FIREBASE_DATABASE_URL,
      projectId: e.VITE_FIREBASE_PROJECT_ID, appId: e.VITE_FIREBASE_APP_ID };
  }
  try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function saveConfig(c: FbConfig | null) {
  try { if (c) localStorage.setItem(LS_KEY, JSON.stringify(c)); else localStorage.removeItem(LS_KEY); } catch { /* sin almacenamiento */ }
}
/** Acepta el objeto "firebaseConfig" copiado de la consola (con o sin "const firebaseConfig ="). */
export function parseConfig(text: string): FbConfig | null {
  const body = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!body) return null;
  try {
    const json = body.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, "}");
    const o = JSON.parse(json);
    return o.apiKey && o.databaseURL ? o : null;
  } catch { return null; }
}
/** Para el QR: la configuración web de Firebase es pública por diseño (la protegen las reglas + inicio de sesión). */
export const encodeCfg = (c: FbConfig) => btoa(JSON.stringify({ apiKey: c.apiKey, databaseURL: c.databaseURL, projectId: c.projectId, appId: c.appId }));
export function decodeCfg(s: string): FbConfig | null { try { const o = JSON.parse(atob(s)); return o.apiKey && o.databaseURL ? o : null; } catch { return null; } }

const num = (o: Record<string, unknown>) => o as unknown as Reading;

// ------------------------------------------------------------------ Firebase
let fbPromise: Promise<Cloud> | null = null;
export function connectFirebase(cfg: FbConfig): Promise<Cloud> {
  fbPromise ??= (async () => {
    const [{ initializeApp }, auth, db] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/database")]);
    const app = initializeApp(cfg);
    await auth.signInAnonymously(auth.getAuth(app));      // las reglas piden auth != null
    const d = db.getDatabase(app);
    const R = (p: string) => db.ref(d, p);
    const cloud: Cloud = {
      kind: "firebase",
      onStation: (dev, cb) => {
        // reloj del servidor: Date.now() + offset ≈ hora de Firebase → retraso real sin depender de la hora de esta compu
        let offset = 0;
        const u1 = db.onValue(R(".info/serverTimeOffset"), (s) => { offset = Number(s.val()) || 0; });
        const u2 = db.onValue(R(`stations/${dev}/latest`), (s) => {
          if (!s.exists()) { cb(null); return; }
          const r = num(s.val()), now = Date.now();
          const lat = r.ts ? Math.max(0, now + offset - r.ts) + (r.age_ms ?? 0) + (r.send_ms ?? 0) / 2 : undefined;
          cb({ ...r, received: now, lat_ms: r.age_ms !== undefined ? lat : undefined });
        });
        return () => { u1(); u2(); };
      },
      putStation: async (dev, r) => {
        const clean = JSON.parse(JSON.stringify({ ...r, received: undefined, via: "usb" }));   // la base no acepta "undefined"
        const lat = { ...clean, ts: db.serverTimestamp() };
        await db.update(R(`stations/${dev}`), { latest: lat, [`history/u${r.boot}_${String(r.uptime_s).padStart(7, "0")}`]: lat });
      },
      stationHistory: async (dev, n) => {
        const s = await db.get(db.query(R(`stations/${dev}/history`), db.orderByKey(), db.limitToLast(n)));
        const out: Reading[] = [];
        s.forEach((c) => { out.push(num(c.val())); });
        return out;
      },
      onSession: (code, cb) => db.onValue(R(`sessions/${code}`), (s) => cb(s.exists() ? (s.val() as SessionDoc) : null)),
      updateSession: (code, patch) => db.update(R(`sessions/${code}`), patch),
      pushTrack: async (code, p) => { await db.push(R(`tracks/${code}`), p); },
      clearTrack: (code) => db.remove(R(`tracks/${code}`)),
      onTrack: (code, cb) => db.onValue(R(`tracks/${code}`), (s) => { const pts: TrackPt[] = []; s.forEach((c) => { pts.push(c.val()); }); cb(pts); }),
      pushMedia: async (code, m) => (await db.push(R(`media/${code}`), m)).key ?? "",
      onMedia: (code, cb) => db.onChildAdded(R(`media/${code}`), (s) => cb(s.key ?? "", s.val() as Media)),
      pushScan: async (code, f, onProgress) => {
        const chunks = Math.ceil(f.size / SCAN_CHUNK);
        const id = db.push(R(`scanmeta/${code}`)).key!;
        await db.set(R(`scanmeta/${code}/${id}`), { name: f.name.slice(0, 80), bytes: f.size, chunks, t: Date.now(), done: false, sent: 0 });
        for (let i = 0; i < chunks; i++) {
          await db.set(R(`scandata/${code}/${id}/${i}`), await chunkB64(f.slice(i * SCAN_CHUNK, (i + 1) * SCAN_CHUNK)));
          await db.update(R(`scanmeta/${code}/${id}`), { sent: i + 1 });
          onProgress(i + 1, chunks);
        }
        await db.update(R(`scanmeta/${code}/${id}`), { done: true });
        return id;
      },
      onScans: (code, cb) => db.onValue(R(`scanmeta/${code}`), (s) => { const a: [string, ScanMeta][] = []; s.forEach((c) => { a.push([c.key ?? "", c.val() as ScanMeta]); }); cb(a); }),
      getScan: async (code, id) => {
        const [m, d] = await Promise.all([db.get(R(`scanmeta/${code}/${id}`)), db.get(R(`scandata/${code}/${id}`))]);
        const meta = m.val() as ScanMeta, parts: string[] = [];
        for (let i = 0; i < meta.chunks; i++) { const p = d.child(String(i)).val(); if (typeof p !== "string") throw new Error(`Falta el pedazo ${i + 1} de ${meta.chunks}`); parts.push(p); }
        return assemble(meta.name, parts);
      },
    };
    return cloud;
  })();
  fbPromise.catch(() => { fbPromise = null; });
  return fbPromise;
}

// ------------------------------------------------------------------ Simulador (sin internet, una sola compu)
// Sincroniza pestañas del MISMO navegador con BroadcastChannel (p. ej. /estacion y /movil abiertas en la laptop).
export function connectSim(scenario: SimScenario): Cloud {
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("seal-sim") : null;
  const sessions = new Map<string, SessionDoc>(), tracks = new Map<string, TrackPt[]>(), media = new Map<string, [string, Media][]>();
  const subs = { st: new Set<(r: Reading | null) => void>(), se: new Map<string, Set<(s: SessionDoc | null) => void>>(),
    tr: new Map<string, Set<(p: TrackPt[]) => void>>(), me: new Map<string, Set<(id: string, m: Media) => void>>(),
    sc: new Map<string, Set<(l: [string, ScanMeta][]) => void>>() };
  const scans = new Map<string, Map<string, { meta: ScanMeta; parts: string[] }>>();
  const history: Reading[] = [];
  let t = 0;
  const timer = setInterval(() => {
    const r = { ...simReading(scenario, t++), received: Date.now(), ts: Date.now() };
    history.push(r);
    if (history.length > 600) history.shift();
    subs.st.forEach((cb) => cb(r));
  }, 1000);
  const emit = (msg: { k: string; code: string; v: unknown; id?: string }, local = true) => {
    if (msg.k === "se") { sessions.set(msg.code, { ...(sessions.get(msg.code) ?? {}), ...(msg.v as object) }); subs.se.get(msg.code)?.forEach((cb) => cb(sessions.get(msg.code)!)); }
    if (msg.k === "tr") { const a = msg.v === null ? [] : [...(tracks.get(msg.code) ?? []), msg.v as TrackPt]; tracks.set(msg.code, a); subs.tr.get(msg.code)?.forEach((cb) => cb(a)); }
    if (msg.k === "me") { const a = media.get(msg.code) ?? []; a.push([msg.id!, msg.v as Media]); media.set(msg.code, a); subs.me.get(msg.code)?.forEach((cb) => cb(msg.id!, msg.v as Media)); }
    if (msg.k === "sc") {
      const m = scans.get(msg.code) ?? scans.set(msg.code, new Map()).get(msg.code)!;
      m.set(msg.id!, msg.v as { meta: ScanMeta; parts: string[] });
      const list = [...m.entries()].map(([id, s]) => [id, s.meta] as [string, ScanMeta]);
      subs.sc.get(msg.code)?.forEach((cb) => cb(list));
    }
    if (local) bc?.postMessage(msg);
  };
  if (bc) bc.onmessage = (e) => emit(e.data, false);
  const add = <T>(m: Map<string, Set<T>>, code: string, cb: T) => { (m.get(code) ?? m.set(code, new Set()).get(code)!).add(cb); return () => { m.get(code)?.delete(cb); }; };
  // parches anidados tipo "place/kind" → objeto
  const nest = (patch: Record<string, unknown>) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      const parts = k.split("/");
      let cur = o;
      parts.slice(0, -1).forEach((p) => { cur = (cur[p] ??= {}) as Record<string, unknown>; });
      cur[parts[parts.length - 1]] = v;
    }
    return o;
  };
  const cloud: Cloud & { stop: () => void } = {
    kind: "sim",
    onStation: (_d, cb) => { subs.st.add(cb); return () => { subs.st.delete(cb); }; },
    putStation: async () => { /* en el simulador no hace falta reenviar */ },
    stationHistory: async (_d, n) => history.slice(-n),
    onSession: (code, cb) => { const u = add(subs.se, code, cb); cb(sessions.get(code) ?? null); return u; },
    updateSession: async (code, patch) => {
      const cur = sessions.get(code) ?? {};
      const n = nest(patch) as SessionDoc;
      emit({ k: "se", code, v: { ...cur, ...n, phone: { ...(cur.phone ?? {}), ...(n.phone ?? {}) }, place: n.place ? { ...(cur.place ?? {}), ...n.place } : cur.place } });
    },
    pushTrack: async (code, p) => emit({ k: "tr", code, v: p }),
    clearTrack: async (code) => emit({ k: "tr", code, v: null }),
    onTrack: (code, cb) => { const u = add(subs.tr, code, cb); cb(tracks.get(code) ?? []); return u; },
    pushMedia: async (code, m) => { const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; emit({ k: "me", code, v: m, id }); return id; },
    onMedia: (code, cb) => { const u = add(subs.me, code, cb); (media.get(code) ?? []).forEach(([id, m]) => cb(id, m)); return u; },
    pushScan: async (code, f, onProgress) => {
      const chunks = Math.ceil(f.size / SCAN_CHUNK), id = `s${Date.now().toString(36)}`, parts: string[] = [];
      for (let i = 0; i < chunks; i++) { parts.push(await chunkB64(f.slice(i * SCAN_CHUNK, (i + 1) * SCAN_CHUNK))); onProgress(i + 1, chunks); }
      emit({ k: "sc", code, id, v: { meta: { name: f.name, bytes: f.size, chunks, t: Date.now(), done: true, sent: chunks }, parts } });
      return id;
    },
    onScans: (code, cb) => { const u = add(subs.sc, code, cb); cb([...(scans.get(code) ?? new Map()).entries()].map(([id, s]) => [id, s.meta])); return u; },
    getScan: async (code, id) => { const s = scans.get(code)?.get(id); if (!s) throw new Error("No existe ese escaneo"); return assemble(s.meta.name, s.parts); },
    stop: () => { clearInterval(timer); bc?.close(); },
  };
  return cloud;
}
