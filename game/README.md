# Web + juego del rover · Seal Hackathon Team

> Hecho con asistencia de IA (Claude) — ver `../docs/AI_USE.md`.
> Hecho durante la hackathon (14 nov 2026). Lee los resultados del motor (`../data/shared/`), no inventa datos.

## Cómo correrlo

```
cd game
npm install
npm run dev        # http://localhost:5173  (copia antes los datos del motor a public/data)
npm test           # 16 tests: física, señal, cuevas y "cada partida se puede ganar" en los 41 relieves reales
npm run build      # versión para publicar en dist/ (sitio estático)
```

Si el motor vuelve a exportar (`python -m seal export` / `python -m seal terrain`), basta con `npm run data` o
volver a abrir `npm run dev`.

**Publicar (link público sin login, lo pide la entrega global):** subir `dist/` a GitHub Pages, Netlify o Vercel.
No funciona abriendo `dist/index.html` con doble clic (el navegador bloquea la lectura de los datos desde archivo).

## Páginas

| Ruta | Qué muestra |
|---|---|
| `#/` Inicio | La historia en una frase, Siloli (Bolivia) contra Marte, top 3, la advertencia de validación |
| `#/mapa` | Mapa mundial (Equal Earth). Elige Marte o Luna (12 sitios). Color = parecido; forma = candidato / análogo conocido / control. Zoom a Bolivia. Mapa de calor global (exploración). Ficha de cada lugar |
| `#/ranking` | Tabla ordenable, exportar CSV, nota de validación (AUC) |
| `#/como-funciona` | Pasos del motor, validación, límites de la Tierra (gravedad, vacío, radiación), fuentes y uso de IA |
| `#/jugar` | Juego del rover |
| `#/creditos` | Datos de NASA y agencias socias, librerías, IA |

Tres **niveles de lectura** (arriba): Explorador 8–12, Cadete 13–17, Científico 18+. Cambian los textos, cuánto detalle
se muestra (tabla con estado/fuente de cada dato solo en Científico) y la dificultad del juego. **Idiomas:** ES / EN
(los relatos de cada lugar vienen del motor en los dos idiomas).

Colores: paleta categórica oscura validada para daltonismo y contraste (azul, naranja, verde, ámbar); rampa naranja
para Marte y azul-plata para la Luna. Fuentes: Atkinson Hyperlegible (hecha para lectura fácil) y Space Grotesk.
Sin logos de la NASA.

## El juego

- **Pantalla de inicio: globo 3D** (adaptado del prototipo del equipo): un pin por región, coloreado según cuánto se
  parece a Marte o a la Luna (botón "Comparar con"). Al tocarlo se abre la región con cada lugar: **imagen satelital
  real**, rol (análogo catalogado / candidato / control), el objetivo más parecido y "Explorar". Hay una lista de texto
  para quien no use el globo.
- **Imagen satelital REAL** (Copernicus Sentinel-2 L2A, ESA, color verdadero 10 m) de la MISMA ventana de 3 × 3 km
  que el relieve: es el color del suelo en el juego, el fondo del minimapa y del mapa grande. En superficies muy
  brillantes (salares, nieve) se leen las bandas originales y se ajusta el contraste (se avisa en pantalla).
  La baja el motor: `python -m seal imagery`.
- **Relieve REAL** de cada lugar: ventana de 3 × 3 km del Copernicus DEM GLO-30 (ESA), exportada por el motor
  (`seal terrain`). Encima, detalle chico, rocas, arena blanda, muestras y cuevas **de juego** (se dice en pantalla).
- **Detalle de cerca por bioma** (generado por código): polígonos de sal en relieve (salar; solo en lo plano),
  ondas de arena, escoria volcánica, escarcha, barro agrietado y pasto. Rocas de colisión: cientos por sitio, en grupos
  y sobre todo en laderas, con el color del suelo real; miles de piedritas decorativas.
- **Salares**: varios charcos chicos (se pueden cruzar, resbalan) y uno grande con el centro hondo; el resto, sal seca.
- **Clima**: "según datos reales" = la probabilidad de lluvia sale de la lluvia anual de NASA POWER
  (p = mín(0,5; lluvia/1200 mm); Atacama casi nunca, Amazonía 1 de cada 2); bajo 0 °C de media cae nieve. La lluvia
  forma charcos en los puntos bajos del relieve real, quita agarre y carga solar. También se puede forzar.
- **Peligros**: remolinos de polvo (lugares secos; no en la Luna), rocas que ruedan desde laderas ≥ 18 ° del DEM,
  géiseres con aviso antes de la erupción (Sol de Mañana, Sajama, Dallol), tormenta solar con gravedad de Marte o
  la Luna (hay que refugiarse junto a una roca grande o en la base).
- **6 cuevas documentadas, 3 tipos**: tubos de lava (Lava Beds, Lanzarote, Etna, Teide), kárstica (Torotoro) y de
  hielo geotermal (Kverkfjöll). Grietas en el piso, derrumbes del techo, pozas y hielo. Los repetidores se calculan
  para cada cueva (los necesarios + margen por nivel).
- **Fotos reales de cada lugar** (Wikimedia Commons, solo licencias libres, con autor y licencia a la vista):
  el motor busca candidatas (`python -m seal photos`), una persona las revisa (paisaje del lugar, sin personas
  reconocibles) y se guardan con `python -m seal photos-choose`. Las que salieron de buscar por nombre dicen
  "foto de la zona" (no del punto exacto).
- **Análisis de muestras**: al perforar se abre un panel con lo del punto (elevación y pendiente del DEM, recorte
  satelital real de 160 m), lo del lugar entero (minerales EMIT, clima) y lo que NO se midió.
- **Laboratorio (minijuego)**: triturar la muestra, hacer pruebas con energía limitada (ácido, agua, horno hasta
  1000 °C como SAM, imán, dureza de Mohs, rayos X como el APXS: no ve H, B, C, N ni O), adivinar el mineral y ver
  su **descomposición química**. 29 minerales; la composición se calcula de la fórmula ideal con los pesos
  atómicos IUPAC (dato derivado). Qué mineral sale: primero los documentados del sitio, luego los propios de ese
  lugar real (salitre y perclorato en Atacama, pirita en Río Tinto, azufre en Dallol…), luego los típicos del
  terreno (se dice cuál es el caso). Cada mineral trae su conexión con Marte o la Luna y la fuente. Colección 0/29
  guardada en el navegador.
- **Suspensión del rover**: solo despega si se separa del suelo más que el recorrido de la suspensión (35 cm);
  en el aire no copia la inclinación del suelo. En los 41 relieves reales pasa < 1 % del tiempo en el aire.
- **Mapa grande** (tecla M o tocar el minimapa) y **modo foto** (tecla P): cámara libre, hora del día, foto PNG con o
  sin pie de datos.
- **"ROVER PERDIDO"** en pantalla roja con la causa y la lección, y botones: ver progreso, reintentar, menú del lugar,
  volver al globo. El progreso muestra objetivos, muestras analizadas y el recorrido (distancia, peligros, fotos…).
- **Gravedad** Tierra 9,82 / Marte 3,73 / Luna 1,62 m/s² (NASA NSSDC, gravedad media de superficie): mismo terreno,
  otra gravedad → en la Luna frenas peor y saltas más lejos.
- **Modos**
  - *Manejo libre*: 7 puertas en orden, contra reloj, con rocas, arena y pendientes.
  - *Misión*: instalar la estación meteorológica (al instalarla muestra los **datos reales** del lugar de NASA POWER y
    funciona como repetidor), tomar 3 muestras del mineral que EMIT detectó ahí (si no hay dato: "regolito") y volver.
  - *Cueva* (los 6 lugares con cueva documentada): túnel oscuro con luces, 2 cámaras con muestras; dentro no hay
    señal directa → hay que ir dejando repetidores.
- **Cómo se pierde**: choque fuerte contra una roca, vuelco por pendiente, atascado en arena (como Spirit en 2009),
  pérdida de señal por más de unos segundos (línea de vista calculada sobre el relieve real), batería agotada
  (los lugares fríos según NASA POWER gastan más por el calefactor), entrar al agua, caer en una grieta, una roca que
  rueda, la radiación de una tormenta solar o daño acumulado. Cada falla muestra una **lección real**.
- **Dificultad según el nivel**: Explorador perdona más (el agua te devuelve a la orilla, más tiempo sin señal,
  más repetidores en la cueva). Científico añade el **retraso de comandos** (simbólico: 1,3 s Luna, 1,5 s Marte; el
  real a Marte es de 3 a 22 minutos y se explica en la pausa).
- **Controles**: W/S o flechas, A/D girar, Espacio frenar, E acción (mantener), R repetidor, L luces, C cámara,
  Esc pausa. En celular: joystick + botones (probado en vista de 375 px; falta probar en un iPhone y un Android reales).

### Lo que garantizan los tests (`npm test`, 48 tests)
- Física: aceleración por gravedad, pendiente máxima, arena que atasca, choque, vuelo balístico; con baches chicos
  y lomas no despega (ni en la Luna), en una rampa con caída sí; en el aire no gira con el suelo.
- Laboratorio: composición exacta (halita 39,3 % Na / 60,7 % Cl; calcita 40,0 % Ca), las 29 fórmulas suman 100 %,
  carbonatos ⇔ burbujean con ácido y sueltan CO₂, todo mineral posible en los 41 lugares existe en el catálogo.
- Señal: línea de vista sobre el relieve y cadena de repetidores.
- **Cada partida se puede ganar**: en los 41 relieves reales, cada muestra y cada puerta tiene señal o se arregla con
  los repetidores disponibles, y ningún objetivo (ni la salida) queda dentro del agua; en las 6 cuevas alcanzan los
  repetidores del nivel más difícil y junto a cada grieta o poza queda paso de ≥ 3 m.
- Peligros y clima: la lluvia sigue la lluvia real (Atacama < 2 %, Amazonía ≈ 50 %), nieve bajo 0 °C, sin remolinos
  en la Luna, la roca rueda pendiente abajo y se detiene, el géiser avisa antes, sin tormenta solar en la Tierra;
  el salar tiene un charco grande hondo y la orilla se puede pisar.

## Qué NO hace todavía
- No se conecta a la caja de campo ni al celular (fase siguiente).
- No crea lugares nuevos: solo los 41 que analizó el motor.
- El juego en celular está probado en vista emulada, no en teléfonos reales.
- El detalle de menos de 30 m (rocas, arena) es de juego, no medido.

---
**English summary.** Static Vite + React + Three.js site that reads the similarity engine's exports. Pages: home, world
map (Equal Earth) with per-site cards at three reading levels, sortable ranking, how-it-works with validation and
Earth's limits, credits. Rover game on the REAL Copernicus DEM relief of each analysed site, with Earth/Mars/Moon
gravity, free-drive, mission (weather station showing real NASA POWER data; samples of EMIT-detected minerals) and
cave modes; failure by crash, rollover, soft-sand entrapment, signal loss (line of sight over real relief), battery,
water or damage, each with a real-world lesson. Spanish and English. Run `npm install && npm run dev`; test with
`npm test`; publish `dist/` after `npm run build`.
