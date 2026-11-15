# PROMPT PARA CLAUDE CODE — Motor de similitud del Seal Hackathon Team (Python)

> Cómo usarlo: abrir Claude Code en la carpeta `seal-hackathon-team/` con el modelo **Opus 5.5**, copiar TODO lo que está
> debajo de la línea y pegarlo. Claude se va a detener en cada **PUNTO DE CONTROL**: revisen y respondan
> "sigue" (o corrijan). Para la Fase 2 (verificar valores de la Luna y Marte) cambien a **Fable 5.2** con `/model`
> y luego vuelvan a Opus.

---

Vas a construir el **motor de similitud del Seal Hackathon Team** (nombre del equipo y del proyecto) en `engine/`: un programa de Python que junta datos abiertos de
la Tierra (NASA y agencias socias), los compara con sitios concretos de la Luna y de Marte, y produce un ranking
honesto y explicable de análogos terrestres. Es para el NASA Space Apps Sucre 2026 (reto "Identify Earth Locations that
Analog the Permanent Moon Base Locations and Mars"). La defensa es mañana domingo a las 14:00 y hay un simulacro a las
23:00 de hoy: **necesitamos un MVP que funcione de punta a punta antes de las 22:30.**

## 0. Lee primero (sin leer de más)
1. `CLAUDE.md` (contexto, reglas de datos, reglas de la competencia).
2. `docs/MOTOR_SIMILITUD.md` completo: **es la especificación**. Si este prompt y ese documento chocan, gana este prompt.
3. `docs/SITIOS_CANDIDATOS.md` (lugares a evaluar) y `docs/CAJA_CAMPO.md §3` (JSON que manda la caja).
4. Referencia del juego, ya copiada en **`referencias/juego/`** (léela, no la edites): `LEEME.md`, `types.ts`, `score.ts`,
   `targets/mars.json`, `targets/moon.json`, `index.json`, `sites/laguna_verde.json` (ejemplo con datos reales),
   `build_site.mjs` (cómo llama a NASA POWER, cómo arma el nombre del mosaico de Copernicus DEM en AWS y cómo corrige
   por elevación) y `DATA_SOURCES.md`. **No hace falta la carpeta `game/`** para construir el motor.

## 1. Reglas que no se negocian
- **Honestidad de datos:** todo número es un `Value` con `status`, `source`, `ref` y `retrieved` (esquema en `CLAUDE.md §4`,
  compatible con el del juego). Si un dato no se pudo obtener o no tiene fuente: `pending`, y **no entra al puntaje**;
  se informa la cobertura. Nunca inventes cifras, DOIs ni coordenadas. Pesos y tolerancias son `design`.
- **No toques `game/` ni `referencias/`.** El motor escribe solo en `engine/` y `data/shared/`. (Si existe `game/`,
  además copia `ranking.json` a `game/public/data/engine/`; si no existe, sáltalo.)
- `engine/seal/score/` son **funciones puras** (sin red ni archivos) con tests. La red solo en `fetch/`, siempre con caché
  en disco (`engine/cache/`, ya ignorada en git).
- Una fuente que falla no tumba el programa: ese dato queda `pending`, con la razón, y el resto sigue.
- Reintentos con espera; como mucho 4 pedidos a la vez por API; un `User-Agent` que identifique al proyecto.
- El paquete se llama `seal` (`engine/seal/`, se corre con `python -m seal`). Python 3.11+, entorno virtual en `engine/.venv`. Dependencias mínimas: numpy, pandas, scipy, scikit-learn, requests,
  pyyaml, pydantic, typer, rasterio, matplotlib, plotly, pytest. Nada pesado (torch, etc.) sin pedirlo.
- Encabezado en cada archivo: `# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026`.
  Al terminar cada fase, agrega una línea a `docs/AI_USE.md`.
- Si algo tarda más de 20 minutos de trabajo, **simplifica, avisa y sigue**. Respuestas cortas: qué hiciste, qué
  verificaste ejecutándolo y qué no.
- Comunícate en español latinoamericano.

## 2. Fases

### FASE 0 — Entorno (10 min)
- Detecta el sistema operativo y la versión de Python. Si falta Python 3.11+, dime exactamente qué instalar
  (en Windows: python.org con "Add to PATH") y espera.
- Crea `engine/.venv`, `engine/requirements.txt` e instala.
- Prueba la red con **un** pedido a NASA POWER (climatología de un punto, p. ej. Sucre -19.04, -65.26) y **uno** a
  Copernicus DEM en AWS (lectura de la cabecera del mosaico). Informa si respondieron.
- **PUNTO DE CONTROL 0:** muéstrame en 10 líneas el entorno, lo que respondió la red y tu plan. Espera mi "sigue".

### FASE 1 — Núcleo sin red (45 min)
- `seal/schema.py`: `Value`, `FeatureDef`, `Site`, `Target`, `Profile` (pydantic), compatibles con el `Value` del juego.
- `seal/features.yaml`: las dimensiones **T1** de `MOTOR_SIMILITUD.md §3`: `t_mean`, `t_range_diurnal`, `pressure`,
  `uv_index`, `precip`, `rh`, `wind`, `albedo`, `slope_p50_100m`, `slope_p90_100m`, `roughness_100m`, `ndvi`,
  `cave_lava_tube`, `mineral_classes` (de literatura). Cada una con unidad, espacio (lineal / log / log1p), tolerancia τ
  (`design`, con su justificación de una línea) y la marca **analogable** o **brecha**.
- `seal/score/similarity.py`: §5.1 (similitud con rango del objetivo, gaussiana, log donde corresponde, exclusión de
  `pending`, renormalización y cobertura) y §5.2 (progreso hacia el objetivo y percentil terrestre).
- `seal/score/profiles.py`: §5.3 (perfiles en `profiles.yaml`, compuertas, factor limitante, IFA total solo con
  dimensiones analogables).
- Tests con casos calculados a mano (valor dentro del rango, fuera, en log, todo `pending`, cobertura parcial,
  progreso con el valor más allá del objetivo). Comprueba que tu similitud lineal da lo mismo que
  `referencias/juego/score.ts` en 3 casos, o explica en qué difiere y por qué.
- **PUNTO DE CONTROL 1:** resultado de `pytest -q` y una tabla de 5 líneas con los ejemplos.

### FASE 2 — Sitios y objetivos (45 min) ← usar Fable 5.2
- `seal/sites/sites.yaml` a partir de **`docs/SITIOS_CANDIDATOS.md`** (léelo entero): los sitios de Bolivia, los controles
  y, si alcanza, Latinoamérica, Europa, África y Asia. Primero Bolivia + controles (para tener el MVP), luego el resto.
  Para los 11 sitios que ya tiene el juego (`referencias/juego/sites/`), usa sus coordenadas tal como están. Para los demás, busca la coordenada de un
  **punto concreto** con fuente citable (si solo hay Wikipedia/GeoNames: `estimated`); si no la encuentras, `pending` y
  el sitio no se procesa. La Reserva Eduardo Avaroa es una **región**, no un sitio. Rol: `candidate`, `control_pos` o
  `control_neg`; un `control_pos` necesita una referencia que diga que es análogo (si no la hay, pasa a `candidate`).
  **No pongas coordenadas pegadas al borde de un mosaico de 1°** (al juego le pasó con Etna y Valles Secos).
- `seal/targets/*.yaml`: Marte global y Luna global (copia los valores ya verificados de `referencias/juego/targets/mars.json` y `moon.json`);
  Gale, Jezero, Gusev–Home Plate, Meridiani, una zona con hielo (Arcadia Planitia o Deuteronilus Mensae), 2–3 grupos de
  regiones Artemis III, cresta Shackleton–de Gerlache y un pozo de tubo de lava lunar. Cada valor con referencia
  verificable o `pending`. Busca fuentes primarias.
- Entrega `docs/VALORES_A_VERIFICAR.md`: tabla de lo que quedó `pending` o `estimated`, con la fuente candidata.
- **PUNTO DE CONTROL 2:** cuántos sitios y objetivos, cobertura por objetivo y lo más dudoso. Espera.

### FASE 3 — Datos reales de la Tierra (1 h 15 min)
- `fetch/power.py`: climatología de POWER (T2M, T2M_MAX, T2M_MIN, PS, RH2M, WS10M, PRECTOTCORR, ALLSKY_SFC_SW_DWN,
  ALLSKY_SFC_UV_INDEX, ALLSKY_SRF_ALB; si un parámetro falla, sigue con los demás), con la misma corrección por elevación
  del juego (temperatura con 6,5 K/km y presión barométrica, usando la elevación del DEM; el valor sin corregir va en la nota).
- `fetch/dem.py`: ventana de 6 × 6 km de Copernicus GLO-30 alrededor del punto → elevación, pendiente a 30 m y
  **remuestreada a 100 m** (p50 y p90) y rugosidad (desviación estándar de la elevación sin tendencia, a 100 m).
  Declara que GLO-30 es un modelo de superficie con ruido.
- `fetch/earth_sample.py`: ~300 puntos al azar en tierra firme (semilla fija; máscara de tierra con el TopoJSON de
  Natural Earth del juego o un paquete liviano), solo con datos de POWER → mediana y percentiles de la Tierra.
  Si tarda demasiado, baja a 150 y avisa.
- `cli.py` (typer): `python -m seal fetch`, `score`, `export`.
- **PUNTO DE CONTROL 3:** el top 10 contra Marte global y contra Gale, con IFA, cobertura y factor limitante. Espera.

### FASE 4 — Robustez y validación (1 h) ← MVP
- `score/robustness.py`: Monte Carlo §5.4 (N = 2000, semilla fija): mediana del puesto, intervalo de 90 % y P(top-3).
- `score/validate.py`: §5.5, AUC de los controles positivos contra la muestra al azar, por objetivo; versión "dejando una
  dimensión fuera"; dónde caen los controles negativos. Incluye la advertencia de circularidad.
- `python -m seal validate`.
- **PUNTO DE CONTROL 4:** el AUC y lo que significa en una frase para el pitch. Si el AUC es bajo, **no lo maquilles**:
  dime por qué y qué dimensión falta.

### FASE 5 — Salidas para la web, el juego y el pitch (1 h)
- `export/shared.py`: `data/shared/ranking.json` con el esquema de `MOTOR_SIMILITUD.md §7` y, si existe la carpeta `game/`, copia en
  `game/public/data/engine/ranking.json`. También `data/shared/ranking.csv`.
- `explain/gaps.py`: brechas (gravedad, presión, dosis de radiación si hay fuente, composición de la atmósfera),
  con números citados.
- `explain/narrative.py`: ficha por sitio en 3 niveles (`explorador` 8–12, `cadete` 13–17, `cientifico` 18+), hecha
  con plantillas y los números del motor: qué se parece, qué no, para qué sirve, qué tan seguro es. Sin adjetivos que
  los datos no respalden.
- `export/plots.py` en `data/shared/plots/`: radar por sitio (top 5), mapa de parecidos (PCA de la Tierra, la Luna y Marte
  normalizado con la estadística terrestre), barras de "progreso hacia Marte" por dimensión.
- `fetch/field.py` + `python -m seal field data/shared/field/<archivo>.json`: lee el JSON de la caja
  (`docs/CAJA_CAMPO.md §3`), lo convierte en `Value(status="measured")`, combina con el satélite en ese GPS
  (lo medido manda donde existe) y da el % de analogía del lugar y la comparación "satélite vs medido". Con lecturas
  saturadas o sin calibrar, baja la confianza. El gas (CO/metano) se guarda y se muestra, pero **no entra al IFA**
  (mide ppm; Marte se mide en ppb). La altitud del barómetro es `derived`; manda la del GPS. Prueba con un JSON de ejemplo inventado y marcado `"ejemplo": true`.
- **PUNTO DE CONTROL 5:** muéstrame una ficha en los 3 niveles y la lista de archivos generados.

### FASE 6 — Noche (solo si las fases 0–5 están cerradas)
En este orden, con un punto de control después de cada uno:
(a) `discover`: rejilla de Bolivia y el Altiplano (POWER + DEM grueso) → mapa de calor HTML;
(b) MODIS (LST día-noche y NDVI vía ORNL MODIS subsets; verifica la API antes de usarla);
(c) cuadrante "impostor vs oculto" (§5.6), con el eje visual marcado `estimated` si no hay embeddings;
(d) EMIT para el top 5 (necesita cuenta de NASA Earthdata: pídeme las credenciales por variable de entorno, nunca en
el código).

## 3. Cómo sabemos que está terminado (MVP)
`pytest -q` pasa · `python -m seal fetch && python -m seal score && python -m seal validate && python -m seal export`
corre de punta a punta desde una caché vacía en menos de 15 min · `ranking.json` es válido con el esquema · cada número
del ranking tiene su fuente · README corto en `engine/README.md` (en español, con un resumen en inglés para la entrega
global).

Empieza por la FASE 0.
