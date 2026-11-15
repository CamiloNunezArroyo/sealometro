# SEAL-BOX — firmware de la caja (ESP32)

> Hecho con asistencia de IA (Claude), a partir de `estacion_sensores.ino` del equipo.

1. `secrets.h` ya está creado con los datos de Firebase de `seal-box`: solo falta escribir el Wi-Fi (2,4 GHz).
   Sin Wi-Fi también funciona por cable USB (plan B, página `/estacion` → 🔌).
2. Arduino IDE → placa **ESP32 Dev Module** → subir `seal_box.ino`.
3. LCD, pantalla "Nube": `Nube OK <n>` = enviando.

v1.1.0 compilado sin errores con el núcleo esp32 3.3.12: 83 % de la memoria con Wi-Fi, 31 % en modo solo cable.
Librerías: ArduinoJson 7.4, TinyGPSPlus 1.0, Adafruit BME280 2.3 + Unified Sensor 1.1, hd44780 1.3.

Guía completa (Firebase, celular, HTTPS, problemas comunes): [`docs/CONEXION_ESTACION.md`](../../docs/CONEXION_ESTACION.md).
