/**
 * Tipos de datos del proyecto.
 *
 * REGLA CENTRAL: cada valor numérico viaja dentro de una `Metric` que dice de dónde
 * viene (`status` + `source`). La interfaz muestra esa etiqueta junto al dato, así
 * nunca se presenta como real algo estimado o inventado para jugabilidad.
 */

export type Status =
  | "measured" // medición directa (estación, rover, láser)
  | "modeled" // producto satelital / reanálisis / modelo (NASA POWER, SoilGrids)
  | "literature" // tomado de un paper o ficha oficial, con referencia
  | "derived" // calculado por nosotros a partir de datos reales (pendiente desde el DEM)
  | "estimated" // estimación o simplificación documentada
  | "gameplay" // inventado para jugabilidad (posiciones de muestras, batería...)
  | "pending"; // aún no cargado: value es null y NO se usa en el puntaje

export interface Metric {
  value: number | null;
  unit: string;
  /** Rango [mín, máx] cuando aplica (p. ej. rango diurno de temperatura). */
  range?: [number, number];
  status: Status;
  source: string;
  retrieved?: string; // fecha ISO de descarga
  ref?: string; // DOI o URL
  note?: string; // limitaciones
}

export type Biome = "desert" | "salt_flat" | "volcanic" | "polar" | "jungle" | "rocky";
export type TargetId = "mars" | "moon";

export interface MineralEntry {
  name: string;
  status: Status;
  ref: string;
}

export interface TerrainMeta {
  /** Ruta del heightmap binario (Float32 little-endian, filas de norte a sur). */
  file: string;
  width: number;
  height: number;
  metersPerPixel: number;
  minElevationM: number;
  maxElevationM: number;
  status: Status;
  source: string;
  note?: string;
  /** Pendiente media del terreno cargado. Solo es "derived" si el DEM es real. */
  slopeMean: Metric;
}

export interface MonthlyClimate {
  /** 12 valores (enero..diciembre). null = sin dato. */
  tMaxC: (number | null)[];
  tMinC: (number | null)[];
  status: Status;
  source: string;
  note?: string;
}

export interface SamplePointDef {
  id: string;
  /** Posición en metros desde el centro del terreno (x este, z sur). */
  x: number;
  z: number;
}

export interface Site {
  id: string;
  name: string;
  country: string;
  region: string;
  coords: { lat: number; lon: number };
  biome: Biome;
  analogFor: TargetId[];
  analogRationale: { text: string; refs: string[] };
  terrain: TerrainMeta;
  /** Interior subterráneo (cueva): sin Sol, con linterna. Lo fija el juego al construir un nivel de cueva. */
  underground?: boolean;
  elevation: Metric;
  climate: {
    meanTemp: Metric;
    dailyRange: Metric; // rango diurno típico: range = [mín, máx] en K (igual que el objetivo); value = amplitud en K
    pressure: Metric;
    humidity: Metric;
    wind: Metric;
    albedo: Metric;
    monthly: MonthlyClimate;
  };
  radiation: { solarSurface: Metric; uvIndex: Metric };
  soil: { claySandSilt: Metric; ph: Metric; minerals: MineralEntry[] };
  water: {
    precipitation: Metric;
    /** Cota (m) de la superficie de un lago dentro del recorte, derivada de una meseta plana del DEM. Opcional. */
    surface?: Metric;
    /** Todos los lagos detectados (el primero es `surface`). Opcional. */
    surfaces?: Metric[];
    note: string;
  };
  gameplay: {
    sampleSeed: number;
    sampleCount: number;
    missionSamplesRequired: number;
    sampleStatus: Status; // siempre "gameplay"
  };
}

/** Un criterio puntuable dentro de una categoría. */
export interface ScoringCriterion {
  id: string;
  label: string;
  /** Cómo se calcula la similitud. */
  kind: "log" | "linear";
  /** Valor del cuerpo objetivo (misma unidad que la métrica del sitio). null = pendiente. */
  target: Metric;
  /** Para "log": décadas de diferencia que llevan la similitud a 0. Para "linear": diferencia que la lleva a 0. */
  tolerance: number;
  /** Ruta de la métrica del sitio, p. ej. "climate.meanTemp". Se lee su `value`. */
  sitePath: string;
}

export interface ScoringCategory {
  id: string;
  label: string;
  weight: number;
  criteria: ScoringCriterion[];
  note?: string;
}

export interface Target {
  id: TargetId;
  name: string;
  /** Gravedad superficial media en m/s². */
  gravity: Metric;
  categories: ScoringCategory[];
}

/**
 * Índice de Viabilidad Operativa (IVO): ¿qué tan viable es operar un rover / asentamiento en este sitio?
 * A diferencia del IFA, NO compara con un cuerpo objetivo: cada criterio tiene una banda ideal [min, max]
 * (los umbrales son decisiones de diseño del proyecto salvo que digan lo contrario en `threshold`).
 */
export interface IvoCriterion {
  id: string;
  label: string;
  /** Ruta de la métrica del sitio, p. ej. "climate.meanTemp". */
  sitePath: string;
  unit: string;
  /** Banda ideal: similitud 1 dentro de [min, max]. null = sin cota por ese lado. */
  min: number | null;
  max: number | null;
  /** Distancia fuera de la banda (en la unidad del criterio) a la que la viabilidad llega a 0. */
  tolerance: number;
  /** De dónde sale la banda: status + source (+ ref si es literature). */
  threshold: { status: Status; source: string; ref?: string; note?: string };
}

export interface IvoCategory {
  id: string;
  label: string;
  weight: number;
  criteria: IvoCriterion[];
  note?: string;
}

export interface IvoModel {
  id: string;
  name: string;
  description: string;
  categories: IvoCategory[];
}
