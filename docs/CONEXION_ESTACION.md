# Conectar la estación (ESP32) y el celular con la página — guía paso a paso

> Hecho con asistencia de IA (Claude). Probado: firmware compilado para ESP32 (núcleo 3.3.12), página con el
> simulador, motor local (`seal serve`). **No probado todavía con la caja real ni con un proyecto de Firebase real**
> (eso lo hacen ustedes en los pasos 1 a 4).

## Cómo viajan los datos
```
ESP32 (sensores) ──Wi-Fi──► Firebase Realtime Database ◄── celular (/movil): GPS, lugar, fotos, video
                                     │
                                     ▼
                       laptop: página /estacion  ──►  motor local (python -m seal serve) → % de analogía
                                     │
                                     ▼
                         lugar jugable → manejar el rover ahí
```
Por qué así (y no otra cosa), comprobado:
- **Sin Bluetooth del navegador**: no funciona en iPhone.
- **No conecten el celular al Wi-Fi del ESP32**: el celular se queda sin internet y una página https no puede leer `http://192.168.4.1`.
- **Firebase Storage ya NO es gratis** para proyectos nuevos (desde oct. 2024 pide el plan Blaze con tarjeta). Por eso
  todo va a **Realtime Database** (plan gratis Spark): las fotos se comprimen a ~150 KB y de los videos se suben 6
  fotogramas (el video queda en el celular).
- **La página no puede usar el LiDAR del iPhone** (Safari no tiene WebXR). Para escanear el lugar se usa la app gratis
  **Scaniverse** (iPhone y Android) y se sube el archivo GLB/OBJ en la página.
- **HTTPS es obligatorio** para GPS y cámara en el celular.

## 1. Crear el proyecto de Firebase (lo hace una persona con cuenta de Google; 10 min)
1. Entren a <https://console.firebase.google.com> → **Agregar proyecto** → nombre (p. ej. `seal-box`) → sin Google Analytics.
   Plan **Spark (gratis)**: no pongan tarjeta.
2. **Realtime Database** → *Crear base de datos* → ubicación `us-central1` → *Modo bloqueado*.
3. En la pestaña **Reglas**, borren todo y peguen el contenido de [`firebase/database.rules.json`](../firebase/database.rules.json) → *Publicar*.
   (Solo pueden leer y escribir usuarios con sesión; las fotos deben ser JPEG de < 1,5 MB; nadie puede pisar una foto ajena.)
4. **Authentication** → *Comenzar* → *Método de acceso* → **Anónimo** → *Habilitar*.
5. ⚙️ **Configuración del proyecto** → *Tus apps* → ícono **</>** (app web) → nombre `pagina` → *Registrar*.
   Copien el bloque `const firebaseConfig = { ... }`. Tiene que incluir **`databaseURL`** (si no aparece, cópienlo de la
   pantalla de Realtime Database: `https://seal-box-default-rtdb.firebaseio.com` o similar).

> La configuración web (`apiKey`, etc.) es pública por diseño: lo que protege los datos son las **reglas** + el
> inicio de sesión. Igual no la suban a un repositorio público si no hace falta: usen `.env.local` (ignorado por git).

## 2. Configurar la página
Opción A (más simple): abran `/estacion`, elijan **☁️ Firebase** y peguen el bloque `firebaseConfig`. Se guarda en ese navegador
y el QR se la pasa al celular.
Opción B (para publicar): copien `game/.env.example` como `game/.env.local` y llenen los `VITE_FIREBASE_*`.
**Ya hecho para el proyecto `seal-box`:** la página publicada https://seal-box.web.app ya trae la configuración.

## 3. Subir el firmware a la caja
1. Arduino IDE → *Herramientas → Placa* → **ESP32 Dev Module** (paquete *esp32 de Espressif*; en esta PC ya quedó instalado
   el 3.3.12 con las librerías: ArduinoJson 7, TinyGPSPlus, Adafruit BME280 + Unified Sensor, hd44780).
2. Abran `firmware/seal_box/seal_box.ino`. Copien `secrets.example.h` como **`secrets.h`** (misma carpeta) y llenen:
   Wi-Fi (**2,4 GHz**: el ESP32 no ve redes de 5 GHz), `FIREBASE_API_KEY`, `FIREBASE_DB_URL` (sin `/` al final) y `DEVICE_ID`.
3. Subir. En la LCD, la pantalla **"Nube"** dice `Nube OK <n>` cuando envía; `http:401` = falta activar el inicio anónimo;
   `WiFi: buscando` = nombre/clave mal o red de 5 GHz.

Lo que hace el firmware (basado en `estacion_sensores.ino` del equipo, mismos pines):
- Lee todo cada 1 s y manda **un solo JSON** (`PATCH` a `stations/<DEVICE_ID>`: `latest` + `history/<hora>`).
- Red en el núcleo 0 y sensores/GPS en el núcleo 1 (el GPS no pierde datos mientras se envía).
- Hora real por NTP; `WiFiClientSecure` con `setInsecure()` (sin certificados: suficiente para la hackathon).
- Sin señal GPS **no inventa coordenadas**. UV marcado `calibrated: false`. Humo: `clipped` si se pega al máximo.

⚠️ Hardware a revisar antes de la prueba:
- **Sensor de humo MQ**: su salida puede llegar a 5 V y el ESP32 aguanta 3,3 V → **divisor de voltaje** (p. ej. 10 kΩ arriba,
  20 kΩ abajo). La página lo detecta si la lectura se pega en 4095.
- **"BME280" que siempre marca 0 % de humedad** = es un **BMP280** (no mide humedad). La página lo detecta.
- Pines: el código real usa UV=34, humo=35, luz=32 (en `docs/CAJA_CAMPO.md` estaban cambiados; manda el código que funciona).
- BME280 lejos del ESP32 y a la sombra (si no, mide su propio calor: la página lo detecta como "se está calentando").

### Plan B sin Wi-Fi: la caja por cable USB
El firmware (v1.1) también imprime cada segundo `SEALJSON {...}` por el cable. En la laptop, con **Chrome o Edge**:
`/estacion` → **🔌 Leer la caja por cable USB** → elegir el puerto COM. Cierren antes el Monitor Serie del Arduino IDE
(solo un programa puede usar el puerto). Al conectar, el ESP32 se reinicia (30 s de calentamiento del sensor de humo).
Si `secrets.h` todavía no tiene el Wi-Fi, la caja funciona solo por cable y la LCD dice "Modo cable USB".

## 4. Abrir la página en el celular (HTTPS)
- **Para probar en la misma red**: en la laptop `cd game && npm run dev:https`. Vite muestra `Network: https://192.168.x.x:5173`.
  Abran ESA dirección en la laptop (no `localhost`), vayan a `/estacion` y escaneen el QR con el celular. El celular avisa
  "conexión no privada" (certificado de prueba): *Avanzado → Continuar* (Android) / *Mostrar detalles → visitar* (iPhone).
- **Para la demo y la entrega**: publiquen la página (GitHub Pages, Netlify o Firebase Hosting). Ahí el HTTPS es real.
- El hotspot: la caja y el celular necesitan internet. Lo más simple: el **celular de un adulto del equipo hace de hotspot**
  (2,4 GHz) y la caja y la laptop se conectan a él.
- En iPhone la pantalla debe quedar **encendida** con la página abierta (botón "Mantener pantalla encendida").

### Publicar con Firebase Hosting (gratis, HTTPS real, mismo proyecto)
En la carpeta del repo (una sola vez):
```
npx firebase-tools@13.29.1 login                 # abre el navegador: inicien sesión con la cuenta del proyecto
npx firebase-tools@13.29.1 use --add             # elijan el proyecto (p. ej. seal-box), alias: default
```
Cada vez que quieran publicar:
```
cd game
npm run deploy                                   # compila y sube la página + las reglas de la base de datos
```
Queda en `https://<proyecto>.web.app`. Esa dirección sirve para el celular (HTTPS real, sin avisos) y para la entrega.

## 5. Usar la estación
1. `/estacion`: ver la conexión y los sensores con su calidad (bueno / aceptable / dudoso / malo + por qué + qué hacer).
   Referencias en vivo: Open-Meteo (tiempo actual) y Copernicus DEM (altura del terreno) en la coordenada del GPS.
2. Celular: activar GPS, elegir el lugar y el suelo, tomar fotos (suelo, lugar, caja; **sin caras**), video corto, y al aire
   libre **caminar el borde** del lugar.
3. **Medir 60 s** con la caja quieta → **Descargar JSON** o **Calcular % de analogía** (en la laptop: `cd engine && python -m seal serve`).
4. **Manejar en nuestro lugar**: perímetro GPS (afuera), escaneo 3D (Scaniverse → GLB/OBJ) o medidas a mano.
   - **Escaneo desde el celular** (lugares cerrados): en `/movil`, con el lugar marcado como cerrado, aparece
     "🧊 Subir escaneo (.glb)". Scaniverse → Compartir → Exportar modelo → **GLB** → Guardar en Archivos → subir
     (máx. 30 MB). Va a Firebase en pedazos de 512 KB (`scanmeta/` y `scandata/`); en la laptop, sección 6 →
     Escaneo 3D → **Usar**. Probado con un salón de prueba de 20 × 15 m → 281 m² libres, cerrado.
   Mínimo **150 m² libres y 10 m de lado** (un cuarto no alcanza; coliseo, cancha o plaza sí). Si es cerrado, el rover no sale.

Sin caja o sin internet: **🧪 Simulador** (datos inventados, marcados como tales; escenarios de fallas típicas para ensayar).

## Límites honestos (para el pitch)
- Sensores baratos: la **presión** (BME280, ±1 hPa) es lo más confiable y es la que entra al motor. Temperatura y humedad son
  de **un momento** (el satélite da promedios del año). UV = aproximación sin calibrar. Luz = relativa. Gas = no mide ppm y
  **nunca** se compara con el metano de Marte (ppb).
- El perímetro con GPS de celular tiene ±5–10 m: sirve para lugares de 30 m o más.
- El escaneo detecta piso y obstáculos de 0,3 a 1,8 m; no reconoce objetos.
- Plan gratis de Realtime Database: 1 GB guardado y 10 GB de descarga al mes (alcanza de sobra; borren las sesiones viejas).
