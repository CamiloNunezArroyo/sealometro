// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Contrato de datos entre la caja (ESP32), el celular y la página. Lo escribe firmware/seal_box/seal_box.ino.

/** Una lectura de la caja ("SEAL-BOX live v1"), 1 por segundo. */
export interface Reading {
  device: string; fw: string; seq: number; boot: number; uptime_s: number;
  t_dev?: number;         // hora real del ESP32 (NTP), segundos
  ts?: number;            // hora del servidor de Firebase (ms)
  received?: number;      // hora en que llegó a ESTA página (ms)
  bme: { ok: boolean; t_c?: number; rh_pct?: number; p_hpa?: number; alt_baro_m?: number };
  mpu: { ok: boolean; ax?: number; ay?: number; az?: number; gx?: number; gy?: number; gz?: number; t_c?: number };
  uv: { model: string; mv: number; uvi_est: number; saturated: boolean; calibrated: boolean };
  light: { raw: number; pct: number; inverted: boolean };
  gas: { model: string; raw: number; baseline: number; delta: number; alert: boolean; warmup_s: number; clipped: boolean };
  gps: { present?: boolean; fix: boolean; sats: number; hdop: number; lat?: number; lon?: number; alt_m?: number; kmh?: number; age_ms?: number };
  wifi_rssi?: number;
  age_ms?: number;        // cuánto esperó la lectura en la caja antes de enviarse (firmware ≥ 1.5)
  send_ms?: number;       // cuánto tardó el envío anterior a la nube
  lat_ms?: number;        // retraso total estimado caja → nube → página (lo calcula la página)
}

export interface PhoneGps { lat: number; lon: number; acc: number; alt?: number | null; altAcc?: number | null; t: number }
export interface TrackPt { lat: number; lon: number; acc: number; t: number }
export type PlaceKind = "cuarto" | "salon" | "coliseo" | "cancha" | "plaza" | "campo";
export type Floor = "cemento" | "interior" | "pasto" | "tierra" | "arena";
export interface Place { kind: PlaceKind; indoor: boolean; name?: string; floor?: Floor; length_m?: number; width_m?: number; height_m?: number }
export interface Media {
  kind: "photo" | "frame"; t: number; w: number; h: number; data: string; bytes: number;
  lat?: number; lon?: number; acc?: number; video?: string; idx?: number; of?: number; duration?: number; note?: string;
}
export interface SessionDoc { created?: number; device?: string; place?: Place; phone?: { gps?: PhoneGps; seen?: number; ua?: string } }

/** Escaneo 3D subido desde el celular (Scaniverse → GLB), en pedazos de 512 KB. */
export interface ScanMeta { name: string; bytes: number; chunks: number; t: number; done: boolean; sent?: number }
export const SCAN_MAX_BYTES = 30 * 1024 * 1024;
export const SCAN_CHUNK = 512 * 1024;

export type Unsub = () => void;
/** Punto de encuentro en la nube (Firebase) o el simulador local: misma interfaz. */
export interface Cloud {
  kind: "firebase" | "sim";
  onStation(device: string, cb: (r: Reading | null) => void): Unsub;
  /** Escribe una lectura como si la mandara la caja (lo usa el plan B por cable: la laptop la reenvía a la nube). */
  putStation(device: string, r: Reading): Promise<void>;
  stationHistory(device: string, n: number): Promise<Reading[]>;
  onSession(code: string, cb: (s: SessionDoc | null) => void): Unsub;
  updateSession(code: string, patch: Record<string, unknown>): Promise<void>;
  pushTrack(code: string, p: TrackPt): Promise<void>;
  clearTrack(code: string): Promise<void>;
  onTrack(code: string, cb: (pts: TrackPt[]) => void): Unsub;
  pushMedia(code: string, m: Media): Promise<string>;
  onMedia(code: string, cb: (id: string, m: Media) => void): Unsub;
  pushScan(code: string, f: File, onProgress: (sent: number, total: number) => void): Promise<string>;
  onScans(code: string, cb: (list: [string, ScanMeta][]) => void): Unsub;
  getScan(code: string, id: string): Promise<File>;
}
