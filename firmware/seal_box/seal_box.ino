// ============================================================
//  SEAL-BOX — estación de sensores (ESP32) → Firebase Realtime Database
//  Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
//
//  Basado en el código del equipo "estacion_sensores.ino" (mismos pines, sensores y pantallas LCD).
//  Agregado: Wi-Fi + envío a la nube cada 1 s (un solo JSON con todo), inicio de sesión anónimo en Firebase,
//  tarea de red separada (núcleo 0) para que el GPS no pierda datos, estado en la LCD, copia por cable USB.
//  v1.2: SIN reloj por internet (SNTP/configTime). En el núcleo esp32 3.x el cliente SNTP hacía reiniciar la placa
//  ("assert failed: udp_new_ip_type ... Required to lock TCPIP core functionality") al conectarse a Firebase.
//  La hora exacta de cada lectura la pone el servidor de Firebase ("ts").
//
//  Sensores: BME280 (T, HR, presión), MPU-6050 (acelerómetro/giroscopio), UV GUVA-S12SD (analógico),
//            humo MQ (analógico), luz (analógico), GPS (TinyGPSPlus), LCD 1602 I2C.
//
//  Librerías (Arduino IDE → Administrar bibliotecas):
//   - hd44780 (Bill Perry)            - Adafruit BME280 Library + Adafruit Unified Sensor
//   - TinyGPSPlus (Mikal Hart)        - ArduinoJson (Benoit Blanchon) v7
//  Placa: "ESP32 Dev Module" (paquete esp32 de Espressif).
//
//  ANTES DE COMPILAR: copia "secrets.example.h" como "secrets.h" y llena Wi-Fi y Firebase.
// ============================================================

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>
#include <TinyGPSPlus.h>
#include <time.h>
#include "secrets.h"

#define FW_VERSION "1.5.0"

// ================= PINES (los de la caja real del equipo) =================
#define SDA_PIN        21     // I2C: LCD, BME280, MPU-6050
#define SCL_PIN        22
#define GPS_RX_PIN     16     // recibe del TX del GPS
#define GPS_TX_PIN     17     // envía al RX del GPS
#define PIN_UV         34     // ADC1 (los pines ADC2 no funcionan con el Wi-Fi encendido)
#define PIN_HUMO       35     // ADC1
#define PIN_LUZ        32     // ADC1
#define PIN_LED        2      // LED integrado: alerta de humo

// ================= CONFIGURACIÓN =================
#define MPU_ADDR               0x68
#define MPU_INVERTIDO          true      // el MPU-6050 va boca abajo en la caja: invierte Y y Z (false = montaje normal)
#define PRESION_NIVEL_MAR      1013.25   // hPa, solo para la "altitud" calculada del BME280 (dato derivado)
#define GPS_BAUDIOS            9600
#define TIENE_GPS              false     // la caja NO lleva GPS: la posición la da el celular (true si se conecta un módulo)
#define INTERVALO_LECTURA_MS   500       // se lee y se envía apenas hay lectura nueva: ~0,5 s de retraso
#define INTERVALO_HISTORIA_MS  1000      // la historia guarda 1 lectura por segundo (la "latest" va cada 0,5 s)
#define INTERVALO_PAGINA_MS    3000
#define TOTAL_PAGINAS          9
#define MUESTRAS_ADC           16
#define PRECALENTAMIENTO_S     30        // humo; lo ideal son 20 min o más (y 24-48 h la primera vez)
#define UMBRAL_HUMO            200
#define INVERTIR_LUZ           false
#define UV_MV_MAX              1700      // con atenuación 6 dB el ADC llega a ~1750 mV: por encima = saturado
#define SALIDA_USB_JSON        true      // plan B: cada 1 s imprime "SEALJSON {...}" por el cable USB (página → "Cable USB")

// ================= OBJETOS =================
hd44780_I2Cexp lcd;
Adafruit_BME280 bme;
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
bool lcdOk = false;

struct DatosSensores {
  bool  bmeOk;
  float temperatura, humedad, presionHpa, altitudM;
  float uvMilivoltios, indiceUV;
  int   luzRaw, luzPorcentaje;
  int   humoValor, humoCambio;
  bool  humoAlerta;
  bool  mpuOk;
  float ax, ay, az, gx, gy, gz, tempMPU;
};
struct DatosGPS {
  bool   tienePosicion;
  double latitud, longitud, altitudM, velocidadKmh, hdop;
  int    satelites;
  unsigned long edadMs;
};

DatosSensores datos = {};
DatosGPS datosGPS = {};
portMUX_TYPE muxDatos = portMUX_INITIALIZER_UNLOCKED;   // protege la copia de datos entre núcleos

int humoBaseline = 0;
int paginaActual = 0;
unsigned long ultimaLectura = 0, ultimoCambioPagina = 0;
unsigned long inicioMs = 0;

// estado de la nube (lo escribe la tarea de red, lo lee la LCD)
volatile int    httpUltimo = 0;
volatile uint32_t enviosOk = 0, enviosError = 0;
volatile bool   autenticado = false;
volatile uint32_t lecturaMs = 0, envioMs = 0;   // cuándo se leyó lo último y cuánto tardó el último envío
TaskHandle_t tareaNubeHandle = nullptr;
uint32_t bootId = 0, secuencia = 0;
// si secrets.h todavía tiene el texto de ejemplo, no se intenta el Wi-Fi (la caja funciona solo por cable USB)
const bool wifiConfigurado = strncmp(WIFI_SSID, "ESCRIBE_AQUI", 12) != 0 && strncmp(WIFI_SSID, "NombreDeTuRed", 13) != 0;

// ================= GPS =================
void actualizarGPS() {
  if (!TIENE_GPS) return;
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
}
void actualizarDatosGPS() {
  DatosGPS d = {};
  d.tienePosicion = gps.location.isValid() && gps.location.age() < 3000;
  if (d.tienePosicion) { d.latitud = gps.location.lat(); d.longitud = gps.location.lng(); }
  d.altitudM     = gps.altitude.isValid()   ? gps.altitude.meters()   : 0;
  d.velocidadKmh = gps.speed.isValid()      ? gps.speed.kmph()        : 0;
  d.satelites    = gps.satellites.isValid() ? gps.satellites.value()  : 0;
  d.hdop         = gps.hdop.isValid()       ? gps.hdop.hdop()         : 99.9;
  d.edadMs       = gps.location.isValid()   ? gps.location.age()      : 0;
  portENTER_CRITICAL(&muxDatos);
  datosGPS = d;
  portEXIT_CRITICAL(&muxDatos);
}

// ================= SENSORES (igual que el código del equipo) =================
int leerPromedioADC(int pin, int n) {
  long suma = 0;
  for (int i = 0; i < n; i++) { suma += analogRead(pin); delayMicroseconds(300); }
  return suma / n;
}
int16_t leer16MPU() { int16_t a = Wire.read(); int16_t b = Wire.read(); return (a << 8) | b; }

void leerTodosLosSensores() {
  DatosSensores d;
  portENTER_CRITICAL(&muxDatos);
  d = datos;
  portEXIT_CRITICAL(&muxDatos);

  if (d.bmeOk) {
    d.temperatura = bme.readTemperature();
    d.humedad     = bme.readHumidity();
    d.presionHpa  = bme.readPressure() / 100.0F;
    d.altitudM    = bme.readAltitude(PRESION_NIVEL_MAR);
  }
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14);
  if (Wire.available() == 14) {
    int16_t ax = leer16MPU(), ay = leer16MPU(), az = leer16MPU(), t = leer16MPU();
    int16_t gx = leer16MPU(), gy = leer16MPU(), gz = leer16MPU();
    d.ax = ax / 16384.0; d.ay = ay / 16384.0; d.az = az / 16384.0;   // ±2 g
    d.gx = gx / 131.0;   d.gy = gy / 131.0;   d.gz = gz / 131.0;     // ±250 °/s
    if (MPU_INVERTIDO) {   // módulo montado boca abajo: giro de 180° sobre el eje X (Y y Z cambian de signo)
      d.ay = -d.ay; d.az = -d.az; d.gy = -d.gy; d.gz = -d.gz;
    }
    d.tempMPU = t / 340.0 + 36.53;
    d.mpuOk = true;
  } else d.mpuOk = false;

  uint32_t suma = 0;
  for (int i = 0; i < MUESTRAS_ADC; i++) { suma += analogReadMilliVolts(PIN_UV); delayMicroseconds(300); }
  d.uvMilivoltios = suma / (float)MUESTRAS_ADC;
  d.indiceUV = d.uvMilivoltios / 100.0;   // APROXIMACIÓN común (índice ≈ voltios / 0,1): SIN calibrar

  d.luzRaw = leerPromedioADC(PIN_LUZ, MUESTRAS_ADC);
  int pct = map(d.luzRaw, 0, 4095, 0, 100);
  if (INVERTIR_LUZ) pct = 100 - pct;
  d.luzPorcentaje = constrain(pct, 0, 100);

  d.humoValor  = leerPromedioADC(PIN_HUMO, MUESTRAS_ADC);
  d.humoCambio = d.humoValor - humoBaseline;
  d.humoAlerta = d.humoCambio > UMBRAL_HUMO;
  digitalWrite(PIN_LED, d.humoAlerta ? HIGH : LOW);

  portENTER_CRITICAL(&muxDatos);
  datos = d;
  portEXIT_CRITICAL(&muxDatos);
}

// ================= FIREBASE (REST) =================
// Inicio de sesión ANÓNIMO (hay que activarlo en Firebase → Authentication → Anónimo).
// Así la base de datos no queda abierta a cualquiera: las reglas piden "auth != null".
String idToken, refreshToken;
unsigned long tokenVenceMs = 0;

bool postJson(const String& url, const String& body, const char* tipo, String& respuesta) {
  WiFiClientSecure cli;
  cli.setInsecure();                      // sin certificados (suficiente para la hackathon; ver README)
  HTTPClient http;
  http.setTimeout(6000);
  if (!http.begin(cli, url)) return false;
  http.addHeader("Content-Type", tipo);
  int code = http.POST(body);
  respuesta = http.getString();
  if (code != 200) Serial.printf("HTTP %d (%s) libre=%u bloque=%u\n", code, code < 0 ? http.errorToString(code).c_str() : "respuesta del servidor",
                                 (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
  http.end();
  return code == 200;
}

bool leerToken(const String& resp, const char* kId, const char* kRef, const char* kExp) {
  JsonDocument r;
  if (deserializeJson(r, resp)) return false;
  if (!r[kId].is<const char*>()) return false;
  idToken = r[kId].as<String>();
  refreshToken = r[kRef].as<String>();
  long seg = String(r[kExp].as<const char*>()).toInt();
  if (seg <= 0) seg = 3600;
  tokenVenceMs = millis() + (unsigned long)(seg - 300) * 1000UL;   // renovar 5 min antes
  return true;
}

bool iniciarSesionFirebase() {
  String resp;
  bool ok;
  if (refreshToken.length()) {
    ok = postJson(String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY,
                  "grant_type=refresh_token&refresh_token=" + refreshToken, "application/x-www-form-urlencoded", resp)
         && leerToken(resp, "id_token", "refresh_token", "expires_in");
    if (ok) return true;
  }
  ok = postJson(String("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=") + FIREBASE_API_KEY,
                "{\"returnSecureToken\":true}", "application/json", resp)
       && leerToken(resp, "idToken", "refreshToken", "expiresIn");
  if (!ok) Serial.printf("Firebase: no se pudo iniciar sesion: %s\n", resp.substring(0, 160).c_str());
  else Serial.println("Firebase: sesion anonima OK");
  return ok;
}

// Diagnóstico de red (una vez, al tener Wi-Fi): imprime por el cable qué funciona y qué no.
// Si internet anda pero el DNS de la red no responde (devuelve 0.0.0.0), pasa a DNS públicos (8.8.8.8 y 1.1.1.1).
bool resuelve(const char* host) { IPAddress ip; return WiFi.hostByName(host, ip) && ip != IPAddress(0, 0, 0, 0); }
void diagnosticoRed() {
  Serial.printf("Red: IP %s  puerta %s  DNS %s  RSSI %d\n", WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(),
                WiFi.dnsIP().toString().c_str(), WiFi.RSSI());
  bool dns = resuelve("identitytoolkit.googleapis.com");
  WiFiClient plano;
  plano.setTimeout(5000);
  bool porIp = plano.connect(IPAddress(1, 1, 1, 1), 80);     // internet sin usar nombres
  plano.stop();
  Serial.printf("Red: DNS de la red %s · internet (por IP) %s\n", dns ? "OK" : "FALLA", porIp ? "OK" : "FALLA");
  if (!porIp) { Serial.println("Red: esta red NO tiene salida a internet (¿el hotspot sin datos?)"); return; }
  if (!dns) {
    WiFi.config(WiFi.localIP(), WiFi.gatewayIP(), WiFi.subnetMask(), IPAddress(8, 8, 8, 8), IPAddress(1, 1, 1, 1));
    delay(500);
    dns = resuelve("identitytoolkit.googleapis.com");
    Serial.printf("Red: con DNS publicos (8.8.8.8): %s\n", dns ? "OK" : "FALLA");
  }
  WiFiClientSecure seg;
  seg.setInsecure();
  seg.setTimeout(8000);
  bool tls = seg.connect("identitytoolkit.googleapis.com", 443);
  char err[120] = "";
  if (!tls) seg.lastError(err, sizeof(err));
  Serial.printf("Red: conexion segura (443): %s %s\n", tls ? "OK" : "FALLA", err);
  seg.stop();
}

// Arma el JSON con TODOS los sensores (formato "SEAL-BOX live v1", lo lee la página /estacion)
void armarLectura(JsonObject o, const DatosSensores& d, const DatosGPS& g, bool horaServidor = true) {
  o["device"] = DEVICE_ID;
  o["fw"] = FW_VERSION;
  o["seq"] = secuencia;
  o["boot"] = bootId;
  o["uptime_s"] = (millis() - inicioMs) / 1000;
  if (horaServidor) o["ts"][".sv"] = "timestamp";                   // hora del servidor de Firebase

  JsonObject b = o["bme"].to<JsonObject>();
  b["ok"] = d.bmeOk;
  if (d.bmeOk) {
    b["t_c"] = serialized(String(d.temperatura, 2));
    b["rh_pct"] = serialized(String(d.humedad, 1));
    b["p_hpa"] = serialized(String(d.presionHpa, 2));
    b["alt_baro_m"] = serialized(String(d.altitudM, 1));
  }
  JsonObject m = o["mpu"].to<JsonObject>();
  m["ok"] = d.mpuOk;
  if (d.mpuOk) {
    m["ax"] = serialized(String(d.ax, 3)); m["ay"] = serialized(String(d.ay, 3)); m["az"] = serialized(String(d.az, 3));
    m["gx"] = serialized(String(d.gx, 2)); m["gy"] = serialized(String(d.gy, 2)); m["gz"] = serialized(String(d.gz, 2));
    m["t_c"] = serialized(String(d.tempMPU, 1));
  }
  JsonObject u = o["uv"].to<JsonObject>();
  u["model"] = "GUVA-S12SD";
  u["mv"] = serialized(String(d.uvMilivoltios, 0));
  u["uvi_est"] = serialized(String(d.indiceUV, 2));
  u["saturated"] = d.uvMilivoltios >= UV_MV_MAX;
  u["calibrated"] = false;
  JsonObject l = o["light"].to<JsonObject>();
  l["raw"] = d.luzRaw;
  l["pct"] = d.luzPorcentaje;
  l["inverted"] = INVERTIR_LUZ;
  JsonObject s = o["gas"].to<JsonObject>();
  s["model"] = "MQ";
  s["raw"] = d.humoValor;
  s["baseline"] = humoBaseline;
  s["delta"] = d.humoCambio;
  s["alert"] = d.humoAlerta;
  s["warmup_s"] = (millis() - inicioMs) / 1000;
  s["clipped"] = d.humoValor >= 4090;          // pegado al máximo: ¿falta el divisor de voltaje?
  JsonObject p = o["gps"].to<JsonObject>();
  if (!TIENE_GPS) p["present"] = false;        // la página oculta el GPS de la caja y usa el del celular
  p["fix"] = g.tienePosicion;
  p["sats"] = g.satelites;
  p["hdop"] = serialized(String(g.hdop, 1));
  if (g.tienePosicion) {                        // sin fix NO se inventan coordenadas
    p["lat"] = serialized(String(g.latitud, 6));
    p["lon"] = serialized(String(g.longitud, 6));
    p["alt_m"] = serialized(String(g.altitudM, 1));
    p["kmh"] = serialized(String(g.velocidadKmh, 1));
    p["age_ms"] = g.edadMs;
  }
  if (WiFi.status() == WL_CONNECTED) o["wifi_rssi"] = WiFi.RSSI();
}

// Tarea de red (núcleo 0): cada 1 s manda la última lectura. Un solo PATCH escribe "latest" y la historia.
void tareaNube(void*) {
  // conexión segura que se REUTILIZA (keep-alive): abrir TLS en cada envío costaba ~1-2 s; reutilizada, ~0,2 s
  static WiFiClientSecure cli;
  static HTTPClient http;
  cli.setInsecure();
  http.setReuse(true);
  http.setTimeout(5000);
  static unsigned long ultimaHistoria = 0;
  for (;;) {
    // espera una lectura nueva (el loop avisa) y la envía enseguida; si no llega aviso en 2 s, envía igual
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(2000));
    if (WiFi.status() != WL_CONNECTED) {   // sin Wi-Fi: reintentar cada 10 s (no cada segundo)
      autenticado = false;
      static unsigned long ultimoIntento = 0;
      if (millis() - ultimoIntento > 10000) { ultimoIntento = millis(); WiFi.reconnect(); }
      continue;
    }
    static bool diagHecho = false;
    if (!diagHecho) { diagHecho = true; diagnosticoRed(); }
    if (!autenticado || millis() > tokenVenceMs) {
      autenticado = iniciarSesionFirebase();
      if (!autenticado) { enviosError++; vTaskDelay(pdMS_TO_TICKS(4000)); continue; }
    }
    DatosSensores d; DatosGPS g;
    portENTER_CRITICAL(&muxDatos);
    d = datos; g = datosGPS;
    portEXIT_CRITICAL(&muxDatos);
    secuencia++;

    JsonDocument doc;
    JsonObject lat = doc["latest"].to<JsonObject>();
    armarLectura(lat, d, g);
    lat["age_ms"] = millis() - lecturaMs;        // cuánto esperó la lectura antes de salir (la página suma el resto)
    lat["send_ms"] = envioMs;                    // cuánto tardó el envío anterior
    if (millis() - ultimaHistoria >= INTERVALO_HISTORIA_MS) {
      ultimaHistoria = millis();
      char clave[40];   // clave de la historia: arranque + número (ordenable); la hora la pone el servidor ("ts")
      snprintf(clave, sizeof(clave), "history/b%05lu_%07lu", (unsigned long)bootId, (unsigned long)secuencia);
      doc[clave] = doc["latest"];
    }
    String cuerpo;
    serializeJson(doc, cuerpo);

    String url = String(FIREBASE_DB_URL) + "/stations/" + DEVICE_ID + ".json?auth=" + idToken;
    int code = -1;
    unsigned long t0 = millis();
    if (http.begin(cli, url)) {
      http.addHeader("Content-Type", "application/json");
      code = http.sendRequest("PATCH", cuerpo);
      if (code > 0) http.getString();          // leer la respuesta completa: así la conexión se puede reutilizar
      http.end();
    }
    if (code < 0) cli.stop();                  // conexión rota: el próximo envío abre una nueva
    envioMs = millis() - t0;
    httpUltimo = code;
    if (code != 200) Serial.printf("Nube: envio fallo (http %d)\n", code);
    else if (enviosOk == 0) Serial.println("Nube: primer envio OK");
    if (code == 200) enviosOk++;
    else {
      enviosError++;
      if (code == 401 || code == 403) autenticado = false;   // token vencido o reglas: volver a iniciar sesión
    }
  }
}

// ================= LCD =================
const char* categoriaUV(float uv) {
  if (uv < 3) return "Bajo"; if (uv < 6) return "Moderado"; if (uv < 8) return "Alto"; if (uv < 11) return "Muy alto"; return "Extremo";
}
void lcdLinea(uint8_t fila, const char* texto) {
  if (!lcdOk) return;
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16s", texto);
  lcd.setCursor(0, fila);
  lcd.print(buf);
}
void mostrarPagina(int pagina) {
  char l1[40] = "", l2[40] = "";
  DatosSensores d;
  portENTER_CRITICAL(&muxDatos);
  d = datos;
  portEXIT_CRITICAL(&muxDatos);
  switch (pagina) {
    case 0: if (d.bmeOk) { snprintf(l1, 40, "Temp: %.1f C", d.temperatura); snprintf(l2, 40, "Humedad: %.1f %%", d.humedad); }
            else { snprintf(l1, 40, "BME280: ERROR"); snprintf(l2, 40, "Revisa conexion"); } break;
    case 1: if (d.bmeOk) { snprintf(l1, 40, "Pres: %.1f hPa", d.presionHpa); snprintf(l2, 40, "Altitud: %.0f m", d.altitudM); }
            else { snprintf(l1, 40, "BME280: ERROR"); snprintf(l2, 40, "Revisa conexion"); } break;
    case 2: snprintf(l1, 40, "UV indice: %.1f", d.indiceUV); snprintf(l2, 40, "%s %.0f mV", categoriaUV(d.indiceUV), d.uvMilivoltios); break;
    case 3: { snprintf(l1, 40, "Luz: %d %%", d.luzPorcentaje); int n = d.luzPorcentaje * 16 / 100;
              for (int i = 0; i < 16; i++) l2[i] = (i < n) ? '#' : ' '; l2[16] = '\0'; break; }
    case 4: snprintf(l1, 40, d.humoAlerta ? "Humo: ALERTA!" : "Humo: Normal"); snprintf(l2, 40, "R:%d D:%+d", d.humoValor, d.humoCambio); break;
    case 5: if (d.mpuOk) { snprintf(l1, 40, "Ax%+.2f Ay%+.2f", d.ax, d.ay); snprintf(l2, 40, "Az%+.2f g", d.az); }
            else { snprintf(l1, 40, "MPU6050: ERROR"); snprintf(l2, 40, "Revisa conexion"); } break;
    case 6: if (d.mpuOk) { snprintf(l1, 40, "Gx%+.0f Gy%+.0f", d.gx, d.gy); snprintf(l2, 40, "Gz%+.0f deg/s", d.gz); }
            else { snprintf(l1, 40, "MPU6050: ERROR"); snprintf(l2, 40, "Revisa conexion"); } break;
    case 7: { DatosGPS g; portENTER_CRITICAL(&muxDatos); g = datosGPS; portEXIT_CRITICAL(&muxDatos);
              if (g.tienePosicion) { snprintf(l1, 40, "GPS OK sat:%d", g.satelites); snprintf(l2, 40, "HDOP %.1f", g.hdop); }
              else { snprintf(l1, 40, "GPS sin senal"); snprintf(l2, 40, "sat:%d (afuera!)", g.satelites); } break; }
    case 8: if (!wifiConfigurado) { snprintf(l1, 40, "Sin WiFi config."); snprintf(l2, 40, "Modo cable USB"); }
            else if (WiFi.status() != WL_CONNECTED) { snprintf(l1, 40, "WiFi: buscando"); snprintf(l2, 40, "%.16s", WIFI_SSID); }
            else if (!autenticado) { snprintf(l1, 40, "WiFi OK %ddBm", WiFi.RSSI()); snprintf(l2, 40, "Nube: sin sesion"); }
            else { snprintf(l1, 40, "Nube OK %lu", (unsigned long)enviosOk); snprintf(l2, 40, "envio %lums e:%lu", (unsigned long)envioMs, (unsigned long)enviosError); } break;
  }
  lcdLinea(0, l1);
  lcdLinea(1, l2);
}

// ================= SETUP / LOOP =================
void setup() {
  Serial.begin(115200);
  delay(300);
  {  // por qué arrancó: sirve para saber si la caja se colgó (perro guardián) o se reinició por un error
    const char* r;
    switch (esp_reset_reason()) {
      case ESP_RST_POWERON: r = "encendido"; break;            case ESP_RST_EXT: r = "boton EN / cable"; break;
      case ESP_RST_SW: r = "reinicio por software"; break;     case ESP_RST_PANIC: r = "ERROR (panic)"; break;
      case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: r = "SE COLGO (perro guardian)"; break;
      case ESP_RST_BROWNOUT: r = "BAJO VOLTAJE (cable o fuente debil)"; break;  default: r = "otro"; break;
    }
    Serial.printf("SEAL-BOX %s arranco: %s\n", FW_VERSION, r);
  }
  inicioMs = millis();
  bootId = esp_random() % 100000;
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  Wire.begin(SDA_PIN, SCL_PIN);

  if (lcd.begin(16, 2) == 0) { lcdOk = true; lcdLinea(0, "SEAL-BOX " FW_VERSION); lcdLinea(1, "Iniciando..."); }

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_UV, ADC_6db);     // ~0-1,75 V
  analogSetPinAttenuation(PIN_HUMO, ADC_11db);  // ~0-3,3 V (¡la salida del MQ a 5 V necesita divisor!)
  analogSetPinAttenuation(PIN_LUZ, ADC_11db);

  datos.bmeOk = bme.begin(0x76, &Wire) || bme.begin(0x77, &Wire);
  Serial.println(datos.bmeOk ? "BME280 OK" : "BME280 NO encontrado");
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  datos.mpuOk = (Wire.endTransmission() == 0);

  if (TIENE_GPS) {
    gpsSerial.setRxBufferSize(1024);
    gpsSerial.begin(GPS_BAUDIOS, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  }

  // Wi-Fi en paralelo con el precalentamiento del humo
  if (wifiConfigurado) {
    WiFi.mode(WIFI_STA);
    // diagnóstico: qué redes ve la caja (el ESP32 solo ve 2,4 GHz). Así se sabe si el hotspot está en 5 GHz o es WPA3.
    int nRedes = WiFi.scanNetworks();
    bool vista = false;
    Serial.printf("Redes Wi-Fi que ve la caja (%d):\n", nRedes);
    for (int i = 0; i < nRedes && i < 15; i++) {
      const char* seg;
      switch (WiFi.encryptionType(i)) {
        case WIFI_AUTH_OPEN: seg = "abierta"; break;            case WIFI_AUTH_WPA_PSK: seg = "WPA"; break;
        case WIFI_AUTH_WPA2_PSK: seg = "WPA2"; break;           case WIFI_AUTH_WPA_WPA2_PSK: seg = "WPA/WPA2"; break;
        case WIFI_AUTH_WPA3_PSK: seg = "WPA3"; break;           case WIFI_AUTH_WPA2_WPA3_PSK: seg = "WPA2/WPA3"; break;
        default: seg = "otra"; break;
      }
      bool esta = WiFi.SSID(i) == String(WIFI_SSID);
      vista |= esta;
      Serial.printf("  %s \"%s\"  canal %d  %d dBm  %s\n", esta ? ">>" : "  ", WiFi.SSID(i).c_str(), WiFi.channel(i), WiFi.RSSI(i), seg);
    }
    if (!vista) Serial.printf("Red: NO veo \"%s\": ¿hotspot apagado, en 5 GHz, o el nombre no es exacto (mayusculas/espacios)?\n", WIFI_SSID);
    WiFi.scanDelete();
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  } else Serial.println("secrets.h sin Wi-Fi: solo cable USB");

  unsigned long t0 = millis();
  int ultimo = -1;
  while (millis() - t0 < PRECALENTAMIENTO_S * 1000UL) {
    actualizarGPS();
    int faltan = PRECALENTAMIENTO_S - (millis() - t0) / 1000;
    if (faltan != ultimo) {
      ultimo = faltan;
      char linea[20];
      snprintf(linea, sizeof(linea), "Faltan %d s", faltan);
      lcdLinea(0, WiFi.status() == WL_CONNECTED ? "Humo... WiFi OK" : "Calentando humo");
      lcdLinea(1, linea);
    }
  }
  humoBaseline = leerPromedioADC(PIN_HUMO, 100);
  Serial.printf("Referencia de humo: %d (de 4095)\n", humoBaseline);

  leerTodosLosSensores();
  actualizarDatosGPS();
  mostrarPagina(paginaActual);
  ultimaLectura = ultimoCambioPagina = millis();

  // red en el núcleo 0; sensores, GPS y LCD siguen en el loop (núcleo 1)
  if (wifiConfigurado) xTaskCreatePinnedToCore(tareaNube, "nube", 16384, nullptr, 1, &tareaNubeHandle, 0);
  // perro guardián del loop: si sensores/LCD/GPS se traban más de ~5 s, el ESP32 se reinicia solo
  enableLoopWDT();
}

void loop() {
  actualizarGPS();
  unsigned long ahora = millis();
  if (ahora - ultimaLectura >= INTERVALO_LECTURA_MS) {
    ultimaLectura = ahora;
    leerTodosLosSensores();
    actualizarDatosGPS();
    lecturaMs = millis();
    if (tareaNubeHandle) xTaskNotifyGive(tareaNubeHandle);   // ¡lectura nueva! la tarea de red la envía ya
    mostrarPagina(paginaActual);
    if (SALIDA_USB_JSON) {   // misma lectura, una línea por segundo, para la página por cable USB
      DatosSensores d; DatosGPS g;
      portENTER_CRITICAL(&muxDatos);
      d = datos; g = datosGPS;
      portEXIT_CRITICAL(&muxDatos);
      if (!wifiConfigurado) secuencia++;
      JsonDocument doc;
      armarLectura(doc.to<JsonObject>(), d, g, false);
      // una sola escritura por línea: así los mensajes de la tarea de red (otro núcleo) no la cortan por la mitad
      String json;
      serializeJson(doc, json);              // ArduinoJson 7 REEMPLAZA el contenido del String (no agrega)
      String linea = "SEALJSON ";
      linea.reserve(json.length() + 12);
      linea += json;
      linea += '\n';
      Serial.write((const uint8_t*)linea.c_str(), linea.length());
    }
  }
  if (ahora - ultimoCambioPagina >= INTERVALO_PAGINA_MS) {
    ultimoCambioPagina = ahora;
    do { paginaActual = (paginaActual + 1) % TOTAL_PAGINAS; } while (!TIENE_GPS && paginaActual == 7);   // sin GPS: se salta su página
    mostrarPagina(paginaActual);
  }
}
