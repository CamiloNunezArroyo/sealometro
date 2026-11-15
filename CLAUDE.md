# CLAUDE.md — Seal Hackathon Team · NASA Space Apps Sucre 2026

> Este archivo es el contexto permanente del proyecto. Claude Code lo lee solo al abrir el repo.
> Si algo aquí cambia (decisión, horario, rol), actualícenlo aquí primero.

## 0. Cómo responder
- Siempre en **español latinoamericano** ("ustedes", nunca "vosotros"). El texto para la entrega global va en **inglés**.
- El equipo trabaja contra reloj: respuestas cortas, código que funcione, una pregunta solo si cambia lo que se construye.
- Antes de decir "listo", **ejecutar** (tests, script, build) y mostrar el resultado. Si no se pudo ejecutar, decirlo.
- No inventar datos, cifras, DOIs ni coordenadas. Si falta una fuente: el dato queda `pending` (ver §4).

## 1. El reto y la meta
- Hackathon **NASA Space Apps Challenge 2026, sede Sucre (Bolivia)**, 14–15 nov 2026. Equipo de 6, **categoría
  colegial** (todos de colegio; hay menores y mayores de 18). Saben programación, diseño y robótica.
- **Solo el líder del equipo tiene Claude Pro** → opera Claude Code; los demás usan Claude gratis para tareas chicas.
  Cuidar el uso: no leer archivos grandes sin necesidad (`*.bin`, `countries-110m.json`, `package-lock.json`),
  no imprimir salidas enormes, resúmenes cortos. **Opus 5.5 por defecto**; Fable 5.2 solo para verificar ciencia y fuentes
  y para `/juez`.
- Celulares: Android y iPhone (el líder tiene iPhone 16 Pro con LiDAR) → todo lo del celular debe funcionar en ambos.
- La demo será **bajo techo** (lugar cerrado y grande). La prueba de campo se hará afuera (plaza o campo libre).
- Reto oficial: **"Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars"**.
  Pide usar datos abiertos de la Tierra, la Luna y Marte para **identificar y caracterizar análogos terrestres nuevos**,
  explicar **en qué se parecen y dónde se rompe la analogía**, y presentarlo como mapa, visualización o herramienta.
  Pide mirar más allá de lo visual, buscar más allá de los sitios ya famosos y reconocer los límites de la Tierra
  (gravedad, vacío, atmósfera delgada, radiación).
- Meta: **1.er lugar en Sucre → nominación global → finalista global.**

## 2. Qué construimos (4 piezas, una sola historia)
1. **Motor de similitud (Python, `engine/`)**: rankea lugares de la Tierra (Bolivia y Latinoamérica primero) contra
   sitios concretos de la Luna (regiones Artemis III, cresta de Shackleton, pozos de tubos de lava) y de Marte
   (Jezero, Gale, Gusev, Meridiani, zonas con hielo). Da similitud por dimensión, **progreso hacia Marte/Luna
   respecto del resto de la Tierra**, perfil de uso (rover, ISRU, astrobiología, hábitat), brechas y robustez.
   Diseño completo: `docs/MOTOR_SIMILITUD.md`.
2. **Web didáctica (`game/`, misma app Vite)**: ranking, ficha de cada lugar en 3 niveles de lectura
   (Explorador 8–12 / Cadete 13–17 / Científico 18+), "en qué se parece y en qué no".
3. **Juego del rover (`game/`)**: ya existe (Three.js + TypeScript, globo 3D → región → sitio, modos libre y misión,
   IFA/IVO, cueva en Lava Beds, ~145 tests). Se integra con el motor: lee `ranking.json` y abre sitios nuevos
   creados desde la caja.
4. **Caja de campo (`firmware/`, ESP32)**: mide en el lugar (GPS, temperatura, humedad y presión del aire, UV, luz, CO/metano) + fotos y video del celular
   → calcula el % de analogía → crea el sitio en el juego (relieve real por GPS) → lo sube al mapa mundial.
   Detalle: `docs/CAJA_CAMPO.md`.
   Idea a futuro (no es parte del motor): escanear un lugar cerrado con el celular (LiDAR en iPhone Pro o fotogrametría
   con video en cualquier celular), quitar a las personas del modelo y manejar el rover dentro del modelo.

**Historia del pitch (una frase):** *"No hay un lugar en la Tierra igual a Marte, pero sí hay lugares que recorren gran
parte del camino. Nuestro motor los encuentra con datos de la NASA, cualquiera puede verificarlo con la caja,
y luego manejar un rover ahí."*

## 3. Estructura del repositorio
```
CLAUDE.md                 ← este archivo
docs/PLAN_HACKATHON.md    ← horario, roles, checklist de entrega
docs/MOTOR_SIMILITUD.md   ← diseño científico y técnico del motor
docs/PROMPT_FIRMWARE.md    ← prompt para el firmware de la caja
docs/CAJA_CAMPO.md        ← hardware, conexiones, contrato JSON
docs/COMO_FUNCIONA.md      ← explicación simple del motor (equipo y pitch)
docs/SITIOS_CANDIDATOS.md  ← lugares a evaluar (hipótesis)
docs/PROMPT_MOTOR.md       ← prompt para construir el motor en Claude Code
docs/AI_USE.md            ← registro de uso de IA (obligatorio para la entrega global)
referencias/juego/         ← copia de solo lectura de archivos del juego (sitios, Marte, Luna, puntaje)
engine/                   ← Python 3.11 (paquete seal/)
game/                     ← juego + web (Vite/TS/Three.js); tiene su propio README y docs/
firmware/                 ← ESP32 (Arduino IDE o PlatformIO)
data/shared/              ← contrato entre piezas: ranking.json, sites_index.json, field/*.json
```
Regla de trabajo en paralelo: **cada subequipo toca solo su carpeta**. Lo compartido se cambia en `data/shared/`
siguiendo el esquema de `docs/MOTOR_SIMILITUD.md §7`. Una rama de git por pieza y merge frecuente.

## 4. Regla central: honestidad de los datos (no negociable)
Todo valor numérico es un objeto `Value`, el mismo esquema del juego:
```json
{"value": 59.91, "unit": "kPa", "status": "derived", "source": "NASA POWER PS, corregido por elevación",
 "ref": "https://power.larc.nasa.gov/docs/", "retrieved": "2026-11-14", "sigma": 1.5, "range": null, "note": "..."}
```
`status` ∈ `measured` (caja de campo) · `modeled` (satélite/reanálisis/DEM) · `literature` (paper o ficha oficial
con referencia) · `derived` (calculado de otros valores) · `estimated` (aproximado, provisional) · `design` (decisión
nuestra: pesos, tolerancias) · `gameplay` (solo juego) · `pending` (falta: **no entra al puntaje**).
- Un dato sin fuente **no se rellena**: queda `pending` y el puntaje informa su **cobertura** (% del peso con datos).
- Pesos y tolerancias son `design`: se dicen como decisión nuestra y se prueban con el análisis de robustez.
- Cada cifra que vaya al pitch o a la entrega debe tener su referencia en `docs/` o en el JSON.

## 5. Reglas de la competencia que afectan al código
- **Convocatoria Sucre:** pitch de **3 min + 2 min de preguntas**; criterios: Impacto, Creatividad, Validez, Relevancia,
  Presentación. La IA está permitida como apoyo **si el equipo puede explicar y defender todo**. Citar fuentes, datos,
  código e imágenes. La solución debe desarrollarse durante la hackathon → **el juego es un prototipo de prueba que
  el equipo hizo unos días antes: declararlo así** y mostrar qué se hizo en la hackathon (motor, caja, integración).
  El motor (`engine/`) se hace entero durante la hackathon.
- **Entrega global (spaceappschallenge.org), cierre: domingo 15 nov, 23:59 hora local.** Página en inglés; demo de
  **30 s máximo con subtítulos en inglés** o **7 diapositivas máximo** en inglés (pasarse = no elegible); enlaces
  públicos sin login; campos de datos NASA, datos de agencias socias y **uso de IA**.
- **Menores de 18:** en lo que se entregue no deben aparecer nombres, voces ni caras reconocibles de menores.
- **IA:** marcar en el código y la documentación dónde se usó (encabezado `# Hecho con asistencia de IA (Claude)`
  + `docs/AI_USE.md`). Las imágenes o videos generados con IA llevan marca de agua. **Nunca** usar logos ni insignias
  de la NASA en material generado.

## 6. Datos (resumen; detalle en `docs/MOTOR_SIMILITUD.md §3`)
- **Tierra (NASA):** POWER (clima, UV, radiación, presión, viento), MODIS (LST día/noche, NDVI, albedo vía ORNL
  MODIS subsets), GPM IMERG (lluvia), EMIT (minerales, fase 2), SMAP (humedad del suelo), NASADEM.
- **Tierra (agencias socias):** ESA Copernicus DEM GLO-30 y Sentinel-1/2; CSA RADARSAT-1/RCM (rugosidad radar);
  JAXA AW3D30 (DEM de contraste) y GCOM-C.
- **Luna:** LRO — LOLA (relieve, pendiente, rugosidad), Diviner (temperatura, abundancia de rocas, frío polar),
  LEND (hidrógeno), Mini-RF (radar), CRaTER (radiación); LROC (imágenes).
- **Marte:** MOLA/HRSC/CTX/HiRISE (relieve), TES/THEMIS (inercia térmica, albedo), CRISM/OMEGA (minerales),
  REMS (Curiosity) y MEDA (Perseverance) (presión, T, UV en superficie), RAD (radiación), Mars Climate Database.
- Lo que ya funciona en el juego: `npm run data:<sitio>` descarga POWER + Copernicus DEM y escribe el JSON del sitio.

## 7. Comandos
```
# motor
cd engine && pip install -r requirements.txt     # si no hay Python local: Google Colab (notebooks/colab.ipynb)
python -m seal fetch --sites sites/sites.yaml
python -m seal score --profile todos
python -m seal validate                          # AUC con análogos conocidos vs puntos al azar
python -m seal export --to ../data/shared/ranking.json
python -m seal terrain                           # relieve real de cada sitio para el juego
python -m seal imagery                           # imagen satelital real (Sentinel-2) de cada sitio para el juego
python -m seal photos                            # candidatas de fotos reales (Wikimedia Commons); luego revisar y:
python -m seal photos-choose "sitio=índice,..."   # guarda la foto elegida con su autor y licencia
python -m seal serve                             # motor local para la página /estacion (% de analogía del lugar medido)
pytest -q
# juego + web
cd game && npm install && npm run dev            # http://localhost:5173
npx tsc --noEmit && npx vitest run && npm run build
```

## 8. Cómo trabaja Claude en este repo
- Pasos pequeños: cada entrega con código funcional y prueba. Lógica de puntaje **pura** (sin red ni DOM), testeable.
- No cambiar nombres de campos de los JSON del juego sin migrar sitios y tests (ver `game/docs/PROMPT_CONTINUAR.md`).
- Datos descargados se cachean en `engine/cache/` (no se suben a git si pesan > 5 MB).
- Si una API no responde desde el entorno, decirlo y dejar el comando para que el equipo lo corra en su PC o en Colab.
- Al cerrar cada tarea: qué cambió, qué se verificó, qué no; una línea en `docs/AI_USE.md`.
- Comandos útiles: `/juez` (simula al jurado y ataca el proyecto), `/verificar-dato` (busca la fuente de una cifra).

## 9. Estado (actualizar en cada hito)
- [ ] Repo creado y público · [ ] Página del proyecto en borrador en spaceappschallenge.org
- [x] Motor v1 (sitios + objetivos + puntaje + validación; AUC 0,56 tras quitar el albedo de Bond; informado tal cual) · [x] Web + juego v2 (`game/`, globo, imagen satelital, peligros, clima, 6 cuevas, ES/EN, fotos reales, laboratorio de 29 minerales, 48 tests; falta probar en celulares reales) · [x] Conexión caja/celular/página lista (firmware compilado, Firebase + simulador; guía docs/CONEXION_ESTACION.md) · [x] Página publicada: https://seal-box.web.app (Firebase Hosting; reglas y sesión anónima verificadas) · [x] Caja real enviando a Firebase por Wi-Fi (hotspot Android 2,4 GHz, firmware 1.4.1, 2026-11-15)
- [ ] Prueba de campo de día (sábado antes de las 18:00) · [ ] Integración caja → motor → juego
- [ ] Simulacro 23:00 · [ ] Video de 30 s con subtítulos · [ ] Entrega global enviada
