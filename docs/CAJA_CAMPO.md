# Caja de campo SEAL-BOX — sensores, conexiones y contrato de datos

> **Actualización (15 nov):** la conexión real ahora es ESP32 → Firebase Realtime Database ← celular, con la página
> `/estacion` (ver [`CONEXION_ESTACION.md`](CONEXION_ESTACION.md)). Pines reales de la caja (código del equipo):
> UV = GPIO 34, humo = GPIO 35, luz = GPIO 32; además hay un MPU-6050 y una LCD 1602 por I²C.

## 1. Lo que mide la caja (versión definitiva) y qué aporta al motor
| Sensor | Conexión (ESP32 DevKit V1) | Dimensión del motor | Cuidado |
|---|---|---|---|
| **GPS** (NEO-6M / M8N) | UART2: RX 16, TX 17 | Coordenadas → el motor descarga POWER + relieve real (DEM) de ese punto; el juego crea el sitio | Bajo techo **no fija**; tarda minutos en el primer arranque → encenderlo afuera antes. Usar la altitud del GPS, no la del barómetro |
| **BME280** (T, humedad relativa, presión; la "altura" es calculada) | I²C 0x76/0x77 (SDA 21, SCL 22) | `pressure`, `rh`, `t_air` | La "altura" del BME280 sale de la presión con una fórmula (`derived`), no es una medición. Dentro de la caja se calienta → ponerlo en un **tubo ventilado, a la sombra y lejos del ESP32**. Control: ~730 hPa en Sucre (2800 m), ~640 hPa a 3650 m |
| **GUVA-S12SD** (UV, analógico; módulo de Ardunel, ref. SEN-27) | **ADC1**: GPIO 34, con `analogSetPinAttenuation(34, ADC_2_5db)` (rango ~0–1,25 V: más resolución para una salida de 0–1 V) | `uv_index` | Según la tienda: alimentación 2,7–5 V, salida 0–1 V, detecta ~240–370 nm, precisión ±1 índice UV; **no da fórmula de conversión**. Aproximación común de estos módulos: índice UV ≈ mV / 100 → **verificarla** y calibrar contra POWER/OMI (`calibrated: false` hasta hacerlo). Ojo: con esa fórmula, 1 V ≈ índice 10, y en el Altiplano el UV puede pasar de eso → si la lectura se pega cerca de 1000 mV, marcar `saturated: true`. Ventana sin vidrio ni acrílico (bloquean el UV) |
| **TEMT6000** (luz ambiental, analógico; módulo CJMCU de Ardunel, ref. NB114) | **ADC1**: GPIO 35 (atenuación 11 dB, rango ~0–3,3 V); alimentar a **3,3 V** para no pasarse del máximo del ESP32 | `lux` (contexto; el motor no la compara con Marte) | Fototransistor con pico en 570 nm, ±60°, filtra el infrarrojo (respuesta parecida al ojo humano). La tienda **no da rango de lux ni la resistencia** del módulo: revisen la resistencia de la placa (si dice "103" = 10 kΩ). Con 10 kΩ el módulo llega al tope con algunos cientos de lux (aprox., verificar con la hoja de datos): **al sol se satura por completo**. Opciones: cambiar la resistencia por una menor (p. ej. 220 Ω–1 kΩ) o poner un filtro/difusor, y marcar `saturated: true` cuando se pegue al máximo. Convertir a lux solo de forma aproximada (`lux_est`) |
| **MQ-2** (gas: GLP, butano, metano, humo, hidrógeno; analógico) | Salida AO → **divisor de voltaje** (p. ej. 10 kΩ arriba / 20 kΩ abajo) → ADC1 GPIO 32 | `gas_anomaly` (solo contexto y seguridad; **no entra al IFA**) | El calentador va a **5 V** y la salida AO puede llegar a 5 V: **el ESP32 aguanta solo 3,3 V en sus pines** → sin divisor se daña la entrada. Necesita minutos de precalentamiento (y mucho más para una lectura estable). **No es selectivo**: reacciona a varios gases a la vez, así que no puede decir "esto es metano". Mide en **ppm**; el metano de Marte que midió Curiosity está en **ppb** (mil veces menos) → **no se compara con Marte** y así se dice en el pitch. Sirve para detectar gases en zonas geotérmicas y para contar el misterio del metano marciano |
| **Cámara del celular** (fotos y video) | — | fotos → `rock_abundance` (rocas en la foto), color; video → panorama/escaneo para el juego | Poner una hoja blanca en la foto como referencia de color. No mostrar caras de menores |

El único sensor I²C es el BME280. Los analógicos (UV, luz, gas) van en pines **ADC1** distintos (34, 35, 32). **Nunca usar pines ADC2** (GPIO 0, 2, 4, 12–15, 25–27) para lo analógico:
dejan de funcionar con el Wi-Fi encendido.

Lo que **no** mide la caja (el motor lo toma del satélite): pendiente (DEM), temperatura de la superficie (MODIS),
humedad del suelo (SMAP), minerales (literatura/EMIT).

## 2. Conexión (evitar el error clásico)
Una página servida por **HTTPS** (GitHub Pages) **no puede** leer `http://` del ESP32: el navegador bloquea el
contenido mixto. Por eso:
1. **Demo (recomendado):** la laptop crea un hotspot. El ESP32 y el celular se conectan ahí. La laptop corre el juego
   (`npm run dev`) y un servidor pequeño del motor. El ESP32 hace `POST` del JSON a la laptop. Todo es `http` local,
   funciona en Android y en iPhone, y no depende del Wi-Fi del evento.
2. **Campo sin laptop:** el ESP32 en modo punto de acceso ("SEAL-BOX") sirve su propia página: muestra las lecturas,
   deja descargar el JSON y subir fotos con `<input type="file" accept="image/*" capture>` (funciona en http, en Android
   y en iPhone).

## 3. Contrato JSON (lo que manda la caja) → `data/shared/field/<id>.json`
```json
{
  "device": "seal-box-01", "fw": "0.1.0", "t_utc": "2026-11-14T19:30:00Z",
  "gps":   {"fix": true, "lat": -19.04, "lon": -65.26, "alt_m": 2810, "hdop": 1.1, "sats": 8},
  "air":   {"t_c": 21.4, "rh_pct": 38.0, "p_hpa": 735.2, "alt_baro_m": 2790},
  "uv":    {"model": "GUVA-S12SD", "mv": 820, "uvi_est": 8.2, "saturated": false, "calibrated": false},
  "light": {"model": "TEMT6000", "mv": 3290, "lux_est": null, "saturated": true},
  "gas":   {"model": "MQ-2", "mv": 640, "warmup_s": 600, "calibrated": false},
  "photos": ["foto_01.jpg"],
  "n_samples": 10,
  "notes": "tierra suelta, sol directo"
}
```
(Los valores son de ejemplo.) El motor convierte cada lectura en `Value(status="measured", source="SEAL-BOX <device>")`;
`alt_baro_m` como `derived`; `saturated` o `calibrated: false` bajan la confianza y se muestran, no se ocultan.
Si `gps.fix` es `false`, el motor pide las coordenadas a mano (o usa las de la última lectura con fix, avisando).

## 4. Del escaneo al juego ("escanear y jugar")
1. GPS de la caja → `game/tools/build_site.mjs` (ya funciona con datos reales) descarga Copernicus DEM 30 m + NASA POWER
   de ese punto → sitio jugable.
2. Las mediciones de la caja se muestran junto a las del satélite: *"el satélite dice X, nosotros medimos Y"*.
3. Fotos y video: panorama o textura de referencia (cosmético, marcado como tal).
4. Límite honesto: con 30 m por píxel, una cancha es apenas un punto → se usa una ventana de 3–6 km y se marca el punto.
   El escaneo fino de un lugar cerrado (LiDAR del iPhone Pro o fotogrametría con video en cualquier celular, quitando a
   las personas) es otra pieza, aparte del MVP.
