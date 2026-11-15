# PROMPT PARA EL FIRMWARE DE LA CAJA (SEAL-BOX)

> Sirve en Claude Code (abierto en la carpeta del repo) **o en un chat normal de Claude** (versión gratis), adjuntando
> `docs/CAJA_CAMPO.md`. Copien lo que está debajo
> de la línea.

---

Necesito el firmware de una caja de mediciones de campo para el NASA Space Apps Sucre 2026 (Seal Hackathon Team).
La especificación completa está en `docs/CAJA_CAMPO.md` (léela entera: pines, cuidados y contrato JSON). Responde en
español latinoamericano y explica cada paso para que podamos defenderlo frente al jurado.

**Placa:** ESP32 DevKit V1 (ESP32-WROOM-32), Arduino IDE 2 (o PlatformIO si lo recomiendas con motivo).
**Sensores:** GPS [NEO-6M o M8N] · BME280 (I²C) · UV GUVA-S12SD (analógico, GPIO 34) · luz TEMT6000 (módulo CJMCU, analógico, GPIO 35) ·
gas MQ-2 (analógico, con divisor de voltaje, GPIO 32) · (fotos y video van por el celular, no por el ESP32).

Haz esto en pasos, y en cada paso **detente** hasta que confirmemos que funciona en la placa real:
1. **Sketches de prueba, uno por sensor** (con las librerías más comunes y estables; dime cuáles instalar). Incluye un
   escáner I²C. Para cada sensor: qué lectura es normal en Sucre (~2800 m, bajo techo y al sol) para saber si está bien.
2. **Sketch único** que lea todo cada 1 s, promedie 10 lecturas y arme el JSON **exactamente** con el esquema de
   `docs/CAJA_CAMPO.md §3` (ArduinoJson). Respeta: solo pines ADC1 para lo analógico, `analogReadMilliVolts()`,
   bandera `saturated` para la luz (TEMT6000) y el UV (GUVA cerca de 1 V), atenuación del ADC por pin (34: 2,5 dB; 35: 11 dB), `calibrated: false` para UV y gas, tiempo de precalentamiento del gas,
   `gps.fix` falso si no hay señal (sin inventar coordenadas).
3. **Wi-Fi modo estación**: conectarse al hotspot de la laptop (SSID y clave en un archivo `secrets.h` que no se sube a git)
   y hacer `POST` del JSON a `http://<IP de la laptop>:8000/field`. Reintentos si falla.
4. **Modo punto de acceso de respaldo** ("SEAL-BOX"): si no encuentra el hotspot, crea su propia red y sirve una página
   simple (que funcione en Android y en iPhone) con las lecturas en vivo, un botón "Descargar JSON" y un campo para subir
   fotos con `<input type="file" accept="image/*" capture>`.
5. **Botón físico "MEDIR"** (toma una medición de 10 s y la envía) + LED: parpadeo = buscando GPS, fijo = GPS con señal,
   doble parpadeo = envío correcto.
6. Al final: diagrama de conexiones en texto (pin por pin), lista de materiales y una lista de verificación para la prueba
   de campo.

Reglas: no inventes valores de calibración; si una conversión es aproximada (UV en índice, gas), márcala así en el
código y en el JSON. Encabezado en cada archivo: `// Hecho con asistencia de IA (Claude) — Seal Hackathon Team`.
Archivos en `firmware/seal_box/`.
