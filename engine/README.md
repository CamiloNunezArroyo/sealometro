# Motor de similitud — Seal Hackathon Team (NASA Space Apps Sucre 2026)

> Hecho con asistencia de IA (Claude Opus 5.5 y Claude Fable 5.2). Registro en `docs/AI_USE.md`.

Compara lugares de la Tierra con sitios concretos de **Marte** (Gale, Jezero, Gusev–Home Plate, Meridiani, Arcadia)
y de **la Luna** (regiones de Artemis III, cresta Shackleton–de Gerlache, pozo de Mare Tranquillitatis) usando datos
abiertos. Por cada par lugar × objetivo dice: **en qué se parece** (IFA por dimensión), **cuánto camino recorre hacia
Marte o la Luna comparado con el resto de la Tierra** (progreso y percentil), **para qué serviría** (perfiles),
**dónde se rompe la analogía** (brechas) y **qué tan seguro es** (robustez y validación).

## Instalar y correr (Windows, macOS o Linux; Python 3.11+)
```bash
cd engine
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m seal all              # TODO de una vez (fetch → score → validate → export); o paso a paso:
python -m seal fetch            # POWER + Copernicus DEM de 41 sitios y 300 puntos al azar (caché en engine/cache/)
python -m seal score            # IFA, perfiles, progreso, percentil y robustez (Monte Carlo, N = 2000)
python -m seal validate         # AUC: análogos conocidos contra puntos al azar
python -m seal export           # data/shared/ranking.json, ranking.csv, sites_index.json y gráficos
python -m seal field ../data/shared/field/ejemplo_sucre.json   # lectura de la caja SEAL-BOX
python -m seal discover         # rejilla de 0,5° de Bolivia y el Altiplano → mapa de calor (~8 min la 1.ª vez)
python -m seal quadrant --body moon   # cuadrante impostor/oculto (necesita la votación de data/shared/visual_votes.csv)
python -m seal fetch --modis    # NDVI de MODIS para los sitios (ORNL es lento: ~40 min la 1.ª vez; después, caché)
python -m seal emit             # minerales con NASA EMIT para el top 5 (necesita EARTHDATA_TOKEN, ver abajo)
```

### Token de NASA Earthdata (solo para `emit`)
1. Entren a https://urs.earthdata.nasa.gov (crear cuenta es gratis) → *Generate Token*.
2. En **su propia** terminal (nunca lo peguen en el chat ni en un archivo del repo):
```powershell
$env:EARTHDATA_TOKEN = "<pegar aquí el token>"
cd engine; .\.venv\Scripts\python.exe -m seal emit
.\.venv\Scripts\python.exe -m seal fetch --no-earth; .\.venv\Scripts\python.exe -m seal score; .\.venv\Scripts\python.exe -m seal validate; .\.venv\Scripts\python.exe -m seal export
pytest -q
```
Desde una caché vacía, `fetch + score + validate + export` tarda unos 10–12 minutos (casi todo es la descarga).

## Qué hay adentro
| Ruta | Qué es |
|---|---|
| `seal/features.yaml` | 15 dimensiones con unidad, espacio (lineal/log), tolerancia τ y σ (**decisiones de diseño**, con su justificación) y la marca analogable/brecha |
| `seal/profiles.yaml` | Perfiles: rover, ISRU, astrobiología, hábitat, instrumentos (pesos y compuertas = diseño) |
| `seal/sites/sites.yaml` | 43 lugares (41 procesables): candidatos de Bolivia y del mundo, controles positivos y negativos, con fuente de cada coordenada |
| `seal/targets/*.yaml` | 12 objetivos de Marte y la Luna, cada valor con referencia o `pending` |
| `seal/score/` | Funciones **puras** (sin red): similitud (§5.1), progreso y percentil (§5.2), perfiles (§5.3), robustez (§5.4), validación (§5.5) |
| `seal/fetch/` | Única parte con red, siempre con caché: NASA POWER, Copernicus DEM (une mosaicos de 1° si la ventana cruza el borde), muestra terrestre, caja de campo |
| `seal/explain/` | Brechas (gravedad, presión, atmósfera; números de las fichas NSSDC) y fichas en 3 niveles (explorador, cadete, científico), solo con plantillas |
| `seal/export/` | `ranking.json` (esquema §7, validado antes de escribir), `ranking/<objetivo>.json` + `ranking/index.json` (para la web, ~400 KB c/u), CSV y gráficos |
| `notebooks/colab.ipynb` | El flujo completo en Google Colab (sin instalar Python) |
| `tests/` | 41 tests con casos calculados a mano |
| `../docs/VALORES_A_VERIFICAR.md` | Todo lo `pending` o `estimated`, con la fuente candidata |

## Reglas de honestidad (las aplica el código)
- Cada número es un `Value` con `status`, `source`, `ref` y `retrieved`. Un dato que falta queda `pending`, **no entra al
  puntaje** y se informa la **cobertura**. `export` se niega a escribir un `ranking.json` con un número sin fuente.
- Las brechas (presión, UV) no entran al IFA: se informan como progreso y percentil.
- Un perfil sin datos para al menos el 50 % de su peso, o con una compuerta sin dato, no da número ("no evaluable").
- El IFA total solo se publica con datos para ≥ 40 % del peso y al menos un valor FIRME del objetivo (no solo
  simplificaciones como "lluvia 0"). El ranking se ORDENA por el IFA conservador (`ifa_min`: lo que falta cuenta como 0),
  para que un sitio sin datos no le gane a uno con datos; el Monte Carlo usa ese mismo índice.
- Minerales medidos por satélite (EMIT) solo se comparan contra las clases que el instrumento PUEDE ver.
- Lo medido con la caja manda donde es la misma magnitud (presión, humedad, UV; el UV sin calibrar queda `estimated`);
  la temperatura de un momento no reemplaza al promedio anual; el gas (ppm) nunca entra al IFA. Hoy la caja VERIFICA
  al satélite pero casi no mueve el IFA (presión y UV son brechas; la humedad de los objetivos sigue `pending`).

## Resultados (corrida del 14 de noviembre de 2026, después de la revisión)
- **Contra Gale (Curiosity):** Atacama–Yungay (control positivo), **Desierto de Siloli (Bolivia)** y Namib son los 3
  primeros; Siloli queda en el top 3 en el **98 %** de 2000 escenarios. EMIT ve en Siloli arcillas y óxidos de hierro
  (56 % y 35 % de los píxeles aun con el umbral estricto), minerales que Curiosity encontró en Gale.
- **Contra Marte (valores globales):** Atacama (top 3 en el 98 %), Desierto Blanco (95 %), Siloli (44 %), Namib (31 %).
  Sol de Mañana y Laguna Colorada entran al top 10.
- Modo descubrimiento (`discover`, 886 celdas de 0,5°): sin indicárselo, las 10 mejores celdas son el núcleo de Atacama;
  dentro de Bolivia, las mejores están al oeste del Salar de Uyuni y en Sur Lípez.
- **Validación (AUC, solo dimensiones satelitales):** Marte global **0,56** (IC 90 %: 0,45–0,68), Jezero 0,47, Gale 0,39,
  Luna global 0,50. Es decir: **apenas mejor que el azar contra Marte global, y no mejor contra Gale/Jezero.** Causas
  medidas: (1) el albedo de Bond del planeta comparado con albedo de superficie era la dimensión que más la hundía (se
  quitó: AUC 0,34 → 0,56); (2) la rejilla de POWER (~50 km) no ve sitios chicos rodeados de hielo (Valles Secos);
  (3) la mitad de los controles son análogos **geológicos** (Islandia, Svalbard, Lanzarote, Mauna Kea) y los puntos al
  azar no tienen minerales. 8 de 12 objetivos no se pueden validar: sus valores firmes no alcanzan.
  Advertencia de circularidad: elegimos las dimensiones sabiendo que los desiertos fríos y secos son análogos.

## Límites conocidos
- NASA POWER es una climatología de celda (~50 km), no el punto exacto; se corrige por elevación (6,5 K/km y
  atmósfera estándar). En la climatología de POWER, ANN de T2M_MAX/T2M_MIN son **extremos mensuales**: el motor usa
  T2M_RANGE para la amplitud diaria (el juego tenía este error).
- Copernicus GLO-30 es un modelo de superficie con ruido de algunos metros.
- Ningún objetivo tiene todavía pendientes a 100 m con fuente → el perfil rover no da número. Siguiente paso: calcularlas
  con LOLA (Luna) y HRSC/CTX (Marte) con el mismo código.
- NDVI (MODIS MOD13Q1 vía ORNL): la API acepta 10 fechas por pedido y tarda ~20–45 s por pedido → solo los 41 sitios
  (43 min la primera vez; `python -m seal fetch --modis`; después se lee de la caché). La muestra al azar no tiene NDVI,
  así que la validación lo deja fuera. LST día-noche (MOD11A2) no se descargó: serían ~10 pedidos por punto.

## Fuentes de datos
NASA POWER (MERRA-2/CERES) · ESA Copernicus DEM GLO-30 (AWS Open Data) · fichas NASA NSSDC de la Tierra, Marte y la Luna ·
literatura de las misiones Curiosity (REMS), Perseverance (MEDA), Spirit, Opportunity, LRO (Diviner, LROC) y Artemis III
(ver referencias en `seal/targets/` y `seal/sites/`) · máscara de tierra GLOBE 1 km (NOAA, paquete `global-land-mask`).

---

## English summary (for the global submission)
**What it is.** An open, explainable similarity engine that ranks Earth locations as analogs of specific Mars sites
(Gale, Jezero, Gusev–Home Plate, Meridiani, Arcadia Planitia) and Moon sites (Artemis III candidate regions,
Shackleton–de Gerlache ridge, a Mare Tranquillitatis pit). For each Earth site × target it reports per-dimension
similarity (IFA), **progress toward the target relative to the rest of Earth** (log-scale progress and Earth percentile
from a 300-point random land sample), mission-use profiles, quantified **gaps Earth cannot reproduce** (gravity,
pressure, atmosphere), Monte Carlo robustness (2000 scenarios) and a validation against known analogs (ROC AUC).

**Data.** NASA POWER climatology (elevation-corrected), ESA Copernicus DEM GLO-30 (slope and roughness resampled to a
common 100 m base), NASA NSSDC fact sheets and mission literature. Every number carries status, source and reference;
missing values stay `pending`, are excluded from scores and reported as coverage.

**Honest results.** Against Gale crater, the top 3 are Atacama (a known analog), Bolivia's **Siloli desert** (top-3 in
98 % of 2000 scenarios) and the Namib; NASA EMIT detects clays and iron oxides at Siloli, minerals Curiosity found at
Gale. Validation AUC (satellite dimensions only) is **0.56 for global Mars (90 % CI 0.45–0.68), 0.39–0.47 for Gale and
Jezero: barely better than chance**. Measured causes: a planetary (Bond) albedo compared with surface albedo (removed:
AUC 0.34 → 0.56), a coarse ~50 km climate grid that blurs small ice-bounded sites, and *geological* analogs (volcanic,
mineral) that climate data cannot see. Next steps: minerals for the random sample, 1 km products, Moon/Mars slopes
from LOLA/HRSC with the same code.

**How to run.** `pip install -r requirements.txt`, then `python -m seal all` (or open `notebooks/colab.ipynb`). Built during NASA Space Apps Challenge 2026 (Sucre, Bolivia) with AI assistance
(Claude); see `docs/AI_USE.md`.
