// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Análisis de calidad de la caja (puro, testeable). Pensado para sensores BARATOS y caseros: no se exige precisión de
// laboratorio; se revisa que los datos sean posibles, que no estén trabados, que coincidan con referencias
// independientes y se explica para qué sirve cada uno. Umbrales: decisiones de diseño basadas en las hojas de datos
// (BME280: ±1 hPa, ±1 °C, ±3 % HR; GPS: HDOP; MQ: precalentamiento) — se dicen en pantalla.
import type { PhoneGps, Reading } from "./types";
import { isaPressure, type Meteo } from "./reference";

export type Verdict = "bueno" | "aceptable" | "dudoso" | "malo" | "sin_dato";
export interface L { es: string; en: string }
export interface SensorReport { id: string; name: L; verdict: Verdict; value: string; reasons: L[]; tips: L[]; use: L }
export interface Ctx { indoor: boolean | null; meteo: Meteo | null; demElev: number | null; phone: PhoneGps | null; now: number;
  /** Gravedad medida con la caja PLANA ("Calibrar nivel"): la inclinación se mide respecto a esa posición. */
  mpuRef?: [number, number, number] | null }
/** Ángulo (grados) entre la gravedad medida y la referencia de nivel (o el eje Z del sensor si no hay calibración). */
export function tiltDeg(a: { ax?: number; ay?: number; az?: number }, ref?: [number, number, number] | null): number {
  const v = [a.ax ?? 0, a.ay ?? 0, a.az ?? 0], n = Math.hypot(v[0], v[1], v[2]);
  if (n < 1e-6) return 0;
  if (!ref) return (Math.acos(Math.min(1, Math.abs(v[2]) / n)) * 180) / Math.PI;
  const m = Math.hypot(ref[0], ref[1], ref[2]) || 1;
  const c = (v[0] * ref[0] + v[1] * ref[1] + v[2] * ref[2]) / (n * m);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

const l = (es: string, en: string): L => ({ es, en });
export interface Stat { n: number; mean: number; sd: number; min: number; max: number; first: number; last: number }
export function stat(xs: (number | undefined | null)[]): Stat | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { n: v.length, mean, sd, min: Math.min(...v), max: Math.max(...v), first: v[0], last: v[v.length - 1] };
}
/** Pendiente (unidades por minuto) por mínimos cuadrados. */
export function trendPerMin(xs: number[]): number {
  const n = xs.length;
  if (n < 10) return 0;
  const mx = (n - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  xs.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return (num / den) * 60; // 1 lectura por segundo
}
export function distM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const f1 = (x: number, d = 1) => x.toFixed(d);

export function analyze(rs: Reading[], ctx: Ctx): { link: SensorReport; sensors: SensorReport[] } {
  const last = rs[rs.length - 1];
  const win = rs.slice(-120);
  const out: SensorReport[] = [];

  // ---------- enlace
  const link: SensorReport = { id: "link", name: l("Conexión de la caja", "Box connection"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
    use: l("Sin datos que lleguen, no hay análisis.", "Without incoming data there is no analysis.") };
  if (!last) {
    link.reasons.push(l("Todavía no llegó ninguna lectura.", "No reading has arrived yet."));
    link.tips.push(l("Revisa que la caja tenga Wi-Fi (LCD, pantalla 'Nube') y el mismo nombre de caja.", "Check the box has Wi-Fi (LCD 'Cloud' page) and the same box name."));
  } else {
    const age = (ctx.now - (last.received ?? ctx.now)) / 1000;
    const seqs = win.map((r) => r.seq).filter((s) => Number.isFinite(s));
    const span = seqs.length > 1 ? Math.max(...seqs) - Math.min(...seqs) + 1 : seqs.length;
    const loss = span > 0 ? 1 - Math.min(1, seqs.length / span) : 0;
    const lag = last.lat_ms !== undefined ? last.lat_ms / 1000 : null;   // retraso medido: caja → nube → esta página
    link.value = (lag !== null && age <= 5 ? `${l("retraso", "delay")} ${f1(lag, 1)} s` : `${f1(age, 0)} s`) + ` · ${Math.round((1 - loss) * 100)} %` + (last.wifi_rssi ? ` · ${last.wifi_rssi} dBm` : "");
    link.verdict = age > 15 ? "malo" : loss > 0.25 || age > 5 ? "dudoso" : loss > 0.05 ? "aceptable" : "bueno";
    if (age > 5) link.reasons.push(l(`La última lectura llegó hace ${f1(age, 0)} s.`, `The last reading arrived ${f1(age, 0)} s ago.`));
    if (loss > 0.05) link.reasons.push(l(`Se perdió el ${Math.round(loss * 100)} % de las lecturas.`, `${Math.round(loss * 100)}% of the readings were lost.`));
    if ((last.wifi_rssi ?? 0) < -80) link.tips.push(l(`Wi-Fi débil (${last.wifi_rssi} dBm): acerca el celular que hace de hotspot.`, `Weak Wi-Fi (${last.wifi_rssi} dBm): bring the hotspot phone closer.`));
    if (lag !== null) link.reasons.push(l(`Retraso total ≈ ${f1(lag, 1)} s: ${f1((last.age_ms ?? 0) / 1000, 1)} s esperando en la caja + envío a la nube (~${f1((last.send_ms ?? 0) / 2000, 1)} s) + nube → página. Medido con el reloj del servidor de Firebase.`,
      `Total delay ≈ ${f1(lag, 1)} s: ${f1((last.age_ms ?? 0) / 1000, 1)} s waiting in the box + upload (~${f1((last.send_ms ?? 0) / 2000, 1)} s) + cloud → page. Measured with Firebase's server clock.`));
    if (link.verdict === "bueno") link.reasons.push(l("Llegan las lecturas en vivo, sin pérdidas.", "Readings arrive live, no losses."));
  }
  if (!last) return { link, sensors: out };

  const outdoor = ctx.indoor === false, indoor = ctx.indoor === true;
  const m = ctx.meteo;

  // ---------- temperatura (BME280)
  {
    const r: SensorReport = { id: "t", name: l("Temperatura del aire (BME280)", "Air temperature (BME280)"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("Contexto: una lectura de un momento NO reemplaza a la temperatura media anual del satélite.", "Context: a one-moment reading does NOT replace the satellite's annual mean.") };
    const s = stat(win.map((x) => (x.bme.ok ? x.bme.t_c : undefined)));
    if (!last.bme.ok) { r.verdict = "malo"; r.reasons.push(l("El BME280 no responde.", "The BME280 does not respond.")); r.tips.push(l("Revisa SDA 21 / SCL 22 y la dirección 0x76/0x77.", "Check SDA 21 / SCL 22 and address 0x76/0x77.")); }
    else if (s) {
      r.value = `${f1(s.mean)} °C`;
      const trend = trendPerMin(win.map((x) => x.bme.t_c ?? NaN).filter(Number.isFinite));
      if (s.min < -40 || s.max > 60) { r.verdict = "malo"; r.reasons.push(l("Valor fuera de lo posible.", "Value out of range.")); }
      else if (s.n > 20 && s.sd === 0) { r.verdict = "dudoso"; r.reasons.push(l("El valor no cambia nada: ¿sensor trabado?", "The value never changes: stuck sensor?")); }
      else {
        r.verdict = "bueno";
        if (trend > 0.4) {
          r.verdict = "dudoso";
          r.reasons.push(l(`Sube ${f1(trend)} °C por minuto: la caja se está calentando.`, `Rising ${f1(trend)} °C per minute: the box is heating up.`));
          r.tips.push(l("Pon el BME280 a la sombra, en un tubo ventilado y lejos del ESP32.", "Put the BME280 in shade, in a vented tube, away from the ESP32."));
        }
        if (outdoor && m) {
          const d = s.mean - m.t_c;
          r.reasons.push(l(`Modelo meteorológico ahora: ${f1(m.t_c)} °C (diferencia ${d > 0 ? "+" : ""}${f1(d)} °C).`, `Weather model now: ${f1(m.t_c)} °C (difference ${d > 0 ? "+" : ""}${f1(d)} °C).`));
          if (Math.abs(d) > 6) r.verdict = "dudoso";
          else if (Math.abs(d) > 3 && r.verdict === "bueno") r.verdict = "aceptable";
          if (d > 3) r.tips.push(l("Más caliente que el modelo: típico de una caja al sol (el sensor mide su propio calor).", "Warmer than the model: typical of a box in the sun (the sensor measures its own heat)."));
        } else if (indoor) r.reasons.push(l("Bajo techo no se compara con el clima de afuera.", "Indoors it is not compared with outdoor weather."));
        if (last.mpu.ok && last.mpu.t_c !== undefined && last.mpu.t_c - s.mean > 4)
          r.reasons.push(l("El MPU-6050 está más caliente: mide la temperatura de su chip, no la del aire.", "The MPU-6050 is warmer: it measures its own chip, not the air."));
      }
    }
    out.push(r);
  }

  // ---------- humedad (BME280)
  {
    const r: SensorReport = { id: "rh", name: l("Humedad relativa (BME280)", "Relative humidity (BME280)"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("Entra al motor (dimensión 'humedad'), pero es de UN momento: el satélite da el promedio del año.", "Goes into the engine ('humidity'), but it is ONE moment: the satellite gives the yearly mean.") };
    const s = stat(win.map((x) => (x.bme.ok ? x.bme.rh_pct : undefined)));
    if (last.bme.ok && s) {
      r.value = `${f1(s.mean)} %`;
      if (s.max === 0) {
        r.verdict = "malo";
        r.reasons.push(l("Siempre marca 0 %.", "It always reads 0%."));
        r.tips.push(l("Muchos módulos vendidos como 'BME280' son BMP280, que NO mide humedad. Mira el chip o el texto del módulo.", "Many modules sold as 'BME280' are BMP280s, which do NOT measure humidity. Check the chip or module label."));
      } else if (s.min < 0 || s.max > 100) { r.verdict = "malo"; r.reasons.push(l("Valor imposible.", "Impossible value.")); }
      else if (s.min >= 99.5) { r.verdict = "dudoso"; r.reasons.push(l("Pegado en 100 %: ¿condensación sobre el sensor?", "Stuck at 100%: condensation on the sensor?")); }
      else {
        r.verdict = "bueno";
        if (outdoor && m) {
          const d = s.mean - m.rh;
          r.reasons.push(l(`Modelo ahora: ${Math.round(m.rh)} % (diferencia ${Math.round(d)} puntos; la humedad cambia mucho de un lugar a otro).`, `Model now: ${Math.round(m.rh)}% (difference ${Math.round(d)} points; humidity varies a lot locally).`));
          if (Math.abs(d) > 30) r.verdict = "dudoso"; else if (Math.abs(d) > 15) r.verdict = "aceptable";
        }
      }
    }
    out.push(r);
  }

  // ---------- presión (BME280): la medición más confiable de la caja
  {
    const r: SensorReport = { id: "p", name: l("Presión del aire (BME280)", "Air pressure (BME280)"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("La mejor medición de la caja (±1 hPa): REEMPLAZA a la del satélite en el motor y muestra la brecha con Marte (~0,6 kPa).", "The box's best measurement (±1 hPa): it REPLACES the satellite's in the engine and shows the gap with Mars (~0.6 kPa).") };
    const s = stat(win.map((x) => (x.bme.ok ? x.bme.p_hpa : undefined)));
    if (last.bme.ok && s) {
      r.value = `${f1(s.mean)} hPa (${f1(s.mean / 10, 2)} kPa)`;
      if (s.min < 300 || s.max > 1100) { r.verdict = "malo"; r.reasons.push(l("Fuera de lo posible en la Tierra.", "Outside what is possible on Earth.")); }
      else if (s.n > 20 && s.sd === 0) { r.verdict = "dudoso"; r.reasons.push(l("No cambia nada: ¿sensor trabado?", "No change at all: stuck sensor?")); }
      else if (m) {
        const d = s.mean - m.p_hpa;
        r.verdict = Math.abs(d) <= 3 ? "bueno" : Math.abs(d) <= 8 ? "aceptable" : "dudoso";
        r.reasons.push(l(`Modelo meteorológico en este punto: ${f1(m.p_hpa)} hPa (diferencia ${d > 0 ? "+" : ""}${f1(d)} hPa).`, `Weather model at this point: ${f1(m.p_hpa)} hPa (difference ${d > 0 ? "+" : ""}${f1(d)} hPa).`));
        if (Math.abs(d) > 8) r.tips.push(l("¿Las coordenadas son de este lugar? Una diferencia grande suele ser otra altura.", "Are the coordinates right? A large difference usually means a different altitude."));
      } else if (ctx.demElev !== null) {
        const e = isaPressure(ctx.demElev), d = s.mean - e;
        r.verdict = Math.abs(d) <= 15 ? "aceptable" : "dudoso";
        r.reasons.push(l(`Atmósfera estándar a ${Math.round(ctx.demElev)} m: ${f1(e)} hPa (el tiempo la mueve ±10 hPa).`, `Standard atmosphere at ${Math.round(ctx.demElev)} m: ${f1(e)} hPa (weather moves it ±10 hPa).`));
      } else { r.verdict = "aceptable"; r.reasons.push(l("Sin referencia todavía (falta posición).", "No reference yet (position missing).")); }
    }
    out.push(r);
  }

  // ---------- UV (GUVA-S12SD)
  {
    const r: SensorReport = { id: "uv", name: l("Índice UV (GUVA-S12SD)", "UV index (GUVA-S12SD)"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("Orientativo: índice ≈ mV/100 es una aproximación SIN calibrar (el motor lo marca 'estimated').", "Indicative: index ≈ mV/100 is an UNCALIBRATED approximation (marked 'estimated' in the engine).") };
    const s = stat(win.map((x) => x.uv.mv));
    if (s) {
      r.value = `≈ ${f1(s.mean / 100)} (${Math.round(s.mean)} mV)`;
      r.verdict = "aceptable";
      if (win.some((x) => x.uv.saturated)) { r.verdict = "dudoso"; r.reasons.push(l("Saturado: llegó al máximo del ADC.", "Saturated: it hit the ADC maximum.")); }
      if (indoor && s.mean / 100 > 1) { r.verdict = "dudoso"; r.reasons.push(l("Bajo techo debería dar casi 0.", "Indoors it should read almost 0.")); r.tips.push(l("¿Le da el sol por una ventana abierta o una lámpara UV?", "Is it in sunlight through an open window or under a UV lamp?")); }
      if (outdoor && m) {
        const d = s.mean / 100 - m.uvi;
        r.reasons.push(l(`Modelo (cielo ${Math.round(m.cloud)} % nublado): índice ${f1(m.uvi)}.`, `Model (sky ${Math.round(m.cloud)}% cloudy): index ${f1(m.uvi)}.`));
        if (!m.is_day && s.mean > 80) { r.verdict = "dudoso"; r.reasons.push(l("Es de noche y marca UV: ruido o desfase del sensor.", "It is night and reads UV: sensor noise or offset.")); }
        else if (Math.abs(d) > 3) { r.verdict = "dudoso"; r.tips.push(l("Ventana sin vidrio ni plástico (bloquean el UV) y mirando al cielo.", "Window without glass or plastic (they block UV), facing the sky.")); }
      }
      r.reasons.push(l("Fórmula sin calibrar: ±1 índice en el mejor caso.", "Uncalibrated formula: ±1 index at best."));
    }
    out.push(r);
  }

  // ---------- luz
  {
    const r: SensorReport = { id: "light", name: l("Luz (analógico)", "Light (analog)"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("Solo contexto (relativo, sin lux): no se compara con Marte.", "Context only (relative, no lux): not compared with Mars.") };
    const s = stat(win.map((x) => x.light.pct));
    if (s) {
      r.value = `${Math.round(s.mean)} %`;
      r.verdict = "aceptable";
      const sat = win.filter((x) => x.light.pct >= 99).length / win.length;
      if (sat > 0.5) { r.verdict = "dudoso"; r.reasons.push(l("Saturado (100 %): al sol el módulo llega al tope.", "Saturated (100%): in the sun the module tops out.")); }
      if (s.max === 0 && s.n > 10) {
        // 0 constante = oscuridad (el módulo sí responde al iluminarlo) o cable suelto: solo es "malo" si de día al aire libre sigue en 0
        if (outdoor && m?.is_day) { r.verdict = "malo"; r.reasons.push(l("De día al aire libre marca 0: ¿desconectado?", "Daytime outdoors it reads 0: disconnected?")); }
        else { r.reasons.push(l("0 % = oscuridad (lugar sin luz).", "0% = darkness (no light here).")); r.tips.push(l("Para probarlo: ilumínalo con la linterna del celular; si sigue en 0, revisa el cable.", "To test it: shine a phone flashlight on it; if it stays at 0, check the wire.")); }
      }
      if (outdoor && m?.is_day && s.mean < 15) { r.verdict = "dudoso"; r.tips.push(l("De día al aire libre marca muy poco: ¿está invertido? (INVERTIR_LUZ en el firmware)", "Daytime outdoors it reads very low: inverted? (INVERTIR_LUZ in the firmware)")); }
      r.reasons.push(l("Sin calibrar en lux: es una escala relativa 0-100 %.", "Not calibrated in lux: a relative 0-100% scale."));
    }
    out.push(r);
  }

  // ---------- gas / humo (MQ)
  {
    const r: SensorReport = { id: "gas", name: l("Gas / humo (MQ)", "Gas / smoke (MQ)"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("Seguridad y contexto. NO mide ppm de un gas: NUNCA se compara con el metano de Marte (que se mide en ppb).", "Safety and context. It does NOT measure ppm of a gas: NEVER compared with Mars methane (measured in ppb).") };
    const g = last.gas;
    r.value = `${g.raw} (${g.delta >= 0 ? "+" : ""}${g.delta})`;
    if (g.clipped) {
      r.verdict = "malo";
      r.reasons.push(l("Pegado al máximo (4095).", "Stuck at the maximum (4095)."));
      r.tips.push(l("La salida del MQ puede llegar a 5 V y el ESP32 aguanta 3,3 V: pon un divisor de voltaje (p. ej. 10 kΩ / 20 kΩ) o puedes dañar el pin.", "The MQ output can reach 5 V and the ESP32 tolerates 3.3 V: add a voltage divider (e.g. 10 kΩ / 20 kΩ) or the pin may be damaged."));
    } else if (g.raw < 30) { r.verdict = "malo"; r.reasons.push(l("Casi 0: ¿desconectado o sin 5 V en el calentador?", "Almost 0: disconnected or no 5 V on the heater?")); }
    else if (g.warmup_s < 120) { r.verdict = "dudoso"; r.reasons.push(l(`Recién encendido (${g.warmup_s} s): todavía se calienta.`, `Just turned on (${g.warmup_s} s): still warming up.`)); }
    else if (g.warmup_s < 1200) { r.verdict = "aceptable"; r.reasons.push(l(`Encendido hace ${Math.round(g.warmup_s / 60)} min: lo ideal son 20 min o más.`, `On for ${Math.round(g.warmup_s / 60)} min: ideally 20 min or more.`)); }
    else r.verdict = "aceptable";
    if (g.alert) r.reasons.push(l("¡Alerta! Subió mucho respecto del aire limpio (relativo, no en ppm).", "Alert! It rose a lot vs clean air (relative, not ppm)."));
    out.push(r);
  }

  // ---------- MPU-6050
  {
    const r: SensorReport = { id: "mpu", name: l("Inclinación y vibración (MPU-6050)", "Tilt and vibration (MPU-6050)"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("Control de la caja: UV y luz miden bien solo si la caja está nivelada y quieta.", "Box check: UV and light read well only if the box is level and still.") };
    if (!last.mpu.ok) { r.verdict = "malo"; r.reasons.push(l("El MPU-6050 no responde.", "The MPU-6050 does not respond.")); }
    else {
      const mags = win.filter((x) => x.mpu.ok).map((x) => Math.hypot(x.mpu.ax ?? 0, x.mpu.ay ?? 0, x.mpu.az ?? 0));
      const sm = stat(mags);
      const tilt = tiltDeg(last.mpu, ctx.mpuRef);
      r.value = `${f1(tilt, 0)}° · |a| ${sm ? f1(sm.mean, 2) : "?"} g`;
      if (sm && (sm.mean < 0.85 || sm.mean > 1.15)) { r.verdict = "dudoso"; r.reasons.push(l("Quieto debería marcar ~1 g.", "At rest it should read ~1 g.")); }
      else if (sm && sm.sd > 0.08) { r.verdict = "aceptable"; r.reasons.push(l("Se está moviendo o vibra.", "It is moving or vibrating.")); }
      else r.verdict = "bueno";
      if (!ctx.mpuRef) r.tips.push(l("Si el sensor va torcido dentro de la caja, pon la caja plana y toca “📐 Calibrar nivel”.", "If the sensor sits crooked in the box, set the box flat and tap “📐 Calibrate level”."));
      else r.reasons.push(l("Inclinación medida respecto a la calibración de nivel.", "Tilt measured against the level calibration."));
      if (tilt > 10) { r.tips.push(l(`La caja está inclinada ${f1(tilt, 0)}°: nivélala para medir UV y luz.`, `The box is tilted ${f1(tilt, 0)}°: level it to measure UV and light.`)); if (r.verdict === "bueno") r.verdict = "aceptable"; }
    }
    out.push(r);
  }

  // ---------- GPS de la caja
  {
    const r: SensorReport = { id: "gps", name: l("GPS de la caja", "Box GPS"), verdict: "sin_dato", value: "—", reasons: [], tips: [],
      use: l("Ubica el punto: con él el motor baja el clima y el relieve reales y crea el lugar jugable.", "Locates the point: the engine uses it to fetch real climate and relief and build the playable place.") };
    const g = last.gps;
    if (!g.fix) {
      r.verdict = indoor ? "sin_dato" : "dudoso";
      r.value = `${g.sats} sat.`;
      r.reasons.push(indoor ? l("Bajo techo el GPS normalmente no fija: se usa el GPS del celular o el lugar a mano.", "Indoors the GPS usually has no fix: the phone GPS or a manual place is used.")
        : l("Sin posición todavía.", "No position yet."));
      if (!indoor) r.tips.push(l("Cielo abierto y 1-5 min (el primer arranque tarda más).", "Open sky and 1-5 min (first start takes longer)."));
    } else {
      r.value = `${g.lat!.toFixed(5)}, ${g.lon!.toFixed(5)} · ${g.sats} sat. · HDOP ${f1(g.hdop)}`;
      r.verdict = g.sats >= 7 && g.hdop <= 1.5 ? "bueno" : g.sats >= 4 && g.hdop <= 3 ? "aceptable" : "dudoso";
      if (ctx.phone) {
        const d = distM({ lat: g.lat!, lon: g.lon! }, ctx.phone);
        r.reasons.push(l(`A ${Math.round(d)} m del GPS del celular (±${Math.round(ctx.phone.acc)} m).`, `${Math.round(d)} m from the phone GPS (±${Math.round(ctx.phone.acc)} m).`));
        if (d > Math.max(40, 3 * ctx.phone.acc)) { r.verdict = "dudoso"; r.tips.push(l("La caja y el celular no coinciden: ¿están en el mismo lugar?", "Box and phone disagree: are they at the same place?")); }
      }
      if (ctx.demElev !== null && g.alt_m !== undefined) {
        const d = g.alt_m - ctx.demElev;
        r.reasons.push(l(`Altura GPS ${Math.round(g.alt_m)} m vs relieve (DEM) ${Math.round(ctx.demElev)} m.`, `GPS height ${Math.round(g.alt_m)} m vs relief (DEM) ${Math.round(ctx.demElev)} m.`));
        if (Math.abs(d) > 40 && r.verdict === "bueno") r.verdict = "aceptable";
      }
    }
    out.push(r);
  }
  // la caja sin módulo GPS avisa gps.present = false: no se muestra (la posición viene del celular)
  return { link, sensors: last.gps.present === false ? out.filter((r) => r.id !== "gps") : out };
}

/** ¿Sirve la medición para el motor? Resumen honesto. */
export function usable(reps: SensorReport[]): { ok: string[]; weak: string[]; no: string[] } {
  const ok: string[] = [], weak: string[] = [], no: string[] = [];
  for (const r of reps) (r.verdict === "bueno" ? ok : r.verdict === "aceptable" ? weak : no).push(r.id);
  return { ok, weak, no };
}
