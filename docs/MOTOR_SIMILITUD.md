# Motor de similitud — Seal Hackathon Team — diseño (v1, 14 nov 2026)

> Objetivo: decir **qué lugares de la Tierra sirven como análogos de qué sitio de la Luna o de Marte, para qué uso, qué
> tan seguros estamos y dónde se rompe la analogía**. Todo con datos abiertos y trazables.

---

## 1. El problema de fondo (y por qué un motor ingenuo pierde)

Si comparamos "Uyuni vs Marte" con distancia simple:
- **Presión:** Uyuni ~65 kPa, Marte ~0,6 kPa → todo lugar de la Tierra saca ~0. **Ningún lugar terrestre se parece.**
- **Gravedad, vacío, radiación cósmica:** iguales para todos los sitios de la Tierra → no ayudan a rankear.
- **"Marte" no es un lugar:** Jezero (delta antiguo) y Arcadia Planitia (hielo enterrado) piden análogos distintos.
- **Escala:** una pendiente medida a 30 m (DEM terrestre) no es comparable con una a 463 m (MOLA) ni a 1 m (HiRISE).
- **Pesos arbitrarios:** si el ranking cambia al mover un peso 5 %, el jurado lo va a preguntar.

El motor resuelve cada uno de estos puntos con una idea concreta (secciones 4 y 5). Eso es lo que lo hace **válido**
(criterio del jurado) y **creativo**.

---

## 2. Las 4 preguntas que responde el motor (salida por cada par lugar-Tierra × sitio-objetivo)

| # | Pregunta | Salida | Para el público |
|---|---|---|---|
| 1 | ¿En qué se parece, físicamente? | **IFA**: Índice de Fidelidad Analógica por dimensión y total (0–100) + cobertura | "Se parece 72 % en terreno y 40 % en clima" |
| 2 | ¿Qué tan "marciano" es comparado con el resto de la Tierra? | **Progreso hacia el objetivo (PO)** y **percentil terrestre** por dimensión | "Es más seco que el 99 % de la Tierra: recorre el 85 % del camino hacia Marte" |
| 3 | ¿Para qué sirve? | Puntaje por **perfil de misión** (movilidad de rover, ISRU/agua, astrobiología, hábitat/operaciones humanas, aterrizaje, cuevas) + **factor limitante** | "Excelente para probar rovers; malo para buscar hielo" |
| 4 | ¿Dónde se rompe la analogía? | **Brechas** cuantificadas (gravedad, presión, radiación, atmósfera) + **robustez** del ranking | "La Tierra no puede imitar esto: la radiación en Marte es ~X veces mayor" |

El juego ya tiene **IFA** (similitud) e **IVO** (viabilidad operativa). El motor mantiene esos nombres y agrega PO,
perfiles, brechas y robustez.

---

## 3. Catálogo de dimensiones (features)

Cada dimensión tiene: unidad, espacio (lineal / log), si es **analogable** (la Tierra puede acercarse) o **brecha**
(no puede), fuente Tierra / Luna / Marte y nota de comparabilidad. Vive en `engine/seal/features.yaml`.

**Prioridad:** T1 = MVP del sábado (antes del simulacro de las 23:00) · T2 = noche · T3 = si sobra tiempo.

### A. Terreno y movilidad
| id | Qué mide | Tierra | Luna | Marte | Comparabilidad | T |
|---|---|---|---|---|---|---|
| `slope_p50_100m`, `slope_p90_100m` | Pendiente mediana y percentil 90 a **una misma base de 100 m** | Copernicus GLO-30 (ESA) remuestreado; AW3D30 (JAXA) de contraste | LOLA (20 m/px en el polo sur; SLDEM2015 ~60 m) | HRSC (~50–75 m) / DEM CTX en sitios de aterrizaje | Mismo cálculo, misma base → comparable | T1 |
| `hurst` | **Exponente de Hurst** (cómo cambia la rugosidad con la escala) | DEM a 30–300 m | publicado para la Luna con LOLA (Rosenburg et al. 2011, verificar) | MOLA/HRSC | Es **independiente de la escala**: resuelve el problema de comparar resoluciones distintas | T2 |
| `rock_abundance` | Fracción de área cubierta por rocas | Fotos del celular (caja) segmentadas | Diviner rock abundance (Bandfield et al. 2011, verificar) | TES/HiRISE (Golombek, seguridad de aterrizaje) | Proxy; usado en selección real de sitios de aterrizaje | T2 |

### B. Térmico
| id | Qué mide | Tierra | Luna | Marte | Comparabilidad | T |
|---|---|---|---|---|---|---|
| `t_mean` | Temperatura media | POWER T2M (corregida por elevación) | Diviner | NSSDC / MCD / REMS | aire (Tierra, Marte) vs superficie (Luna): **marcarlo** | T1 |
| `t_range_diurnal` | Amplitud día-noche | POWER T2M_MAX-MIN; **MODIS LST día-noche** (superficie) | Diviner | REMS ground temp / THEMIS | Usar LST (superficie) contra Diviner/REMS-ground: misma magnitud física | T1 (POWER) / T2 (LST) |
| `freeze_thaw_days` | Días al año que cruzan 0 °C | POWER diario | — | REMS | Proceso clave en Marte (hielo, regolito) | T2 |
| `thermal_inertia_apparent` | Inercia térmica aparente ≈ (1−albedo)/ΔT | MODIS albedo + LST | Diviner | TES/THEMIS (Putzig & Mellon) | Proxy en la Tierra; indica polvo fino vs roca | T3 |

### C. Radiación y atmósfera
| id | Qué mide | Tierra | Luna | Marte | Analogable | T |
|---|---|---|---|---|---|---|
| `uv_index` / `uv_dose` | UV en superficie | POWER ALLSKY_SFC_UV_INDEX, UVA, UVB; OMI | sin atmósfera: UV solar completo | REMS UV (W/m², bandas A/B/C) / modelos | **Parcial**: Marte recibe UV-C y la Tierra casi nada. Comparar dosis en W/m² por banda, no "índice UV" | T1 |
| `pressure` | Presión superficial | POWER PS | ~0 | NSSDC 6,36 mbar; REMS (Gale) | **Brecha** → solo PO y percentil, en log | T1 |
| `ionizing_dose` | Dosis de radiación ionizante | Literatura (fondo + componente cósmica por altitud) | Chang'e-4 LND / CRaTER | MSL RAD (Hassler et al. 2014, verificar) | **Brecha** → se reporta "la Tierra llega a X % de la dosis" | T2 |
| `dust_aod`, `wind` | Polvo en el aire y viento | MODIS/MERRA-2 AOD; POWER WS10M | — | MCS/REMS tau; MCD | Proceso eólico analogable | T2 |

### D. Agua, hielo, vida
| id | Qué mide | Tierra | Luna | Marte | T |
|---|---|---|---|---|---|
| `precip` | Precipitación anual (log1p) | POWER PRECTOTCORR / GPM IMERG | 0 | ~0 | T1 |
| `rh` | Humedad relativa | POWER RH2M | 0 | REMS | T1 |
| `ndvi` | Vegetación | MODIS MOD13 (ORNL subsets) | 0 | 0 | T1 |
| `ice_presence` | Hielo / permafrost / glaciares de roca | ESA CCI Permafrost; MODIS nieve; literatura | LEND, Diviner (trampas frías < 110 K) | SWIM (mapa de hielo subsuperficial) | T2 |
| `soil_moisture` | Humedad del suelo | SMAP (la caja no la mide) | 0 | ~0 | T2 |
| `gas_anomaly` | CO / metano del aire (ppm) | Caja (sensor MQ) | — | Curiosity mide metano en ppb | **No entra al IFA**: escala mil veces distinta; solo contexto y seguridad | T2 |

### E. Composición
| id | Qué mide | Tierra | Luna | Marte | T |
|---|---|---|---|---|---|
| `mineral_classes` | Vector de presencia de clases: sulfatos, cloruros, arcillas, carbonatos, sílice hidratada/ópalo, óxidos de Fe (hematita/goethita), olivino-piroxeno (basalto), plagioclasa/anortosita | **EMIT** (NASA, en la ISS, mapea minerales en zonas áridas) + literatura | M3 / Diviner (Christiansen) / literatura | CRISM / OMEGA / literatura por sitio | T2 (literatura en T1) |
| `albedo` | Reflectividad | MODIS MCD43 / POWER ALLSKY_SRF_ALB | LROC/Diviner | TES | T1 |

### F. Subsuelo y radar
| id | Qué mide | Fuente | T |
|---|---|---|---|
| `cave_lava_tube` | Hay cuevas o tubos de lava accesibles (sí/no + tipo) | Literatura; para Luna: pozos de Marius Hills y Mare Tranquillitatis (Haruyama 2009, Robinson 2012, verificar) | T1 (literatura) |
| `radar_roughness` | Rugosidad de radar | **CSA RADARSAT-1/RCM** o Sentinel-1 (banda C) vs **Mini-RF** (banda S, CPR) | T3: bandas distintas → solo "textura", con peso bajo |

### G. Visual (con cuidado)
| id | Qué mide | Fuente | T |
|---|---|---|---|
| `visual_sim` | Parecido de imagen (embeddings DINOv2 o CLIP) | Sentinel-2 / fotos del celular vs HiRISE, CTX, LROC NAC | T3 |

**`visual_sim` NO entra al IFA.** Se usa solo para el cuadrante "impostor vs oculto" (§5.6).

---

## 4. Objetivos: sitios concretos, no "Marte promedio"

Archivo por objetivo en `engine/seal/targets/*.yaml`, cada valor con `status` y `ref`. **Valores a llenar y verificar con
fuente** (usar `/verificar-dato`); los que tienen ✓ ya están verificados en el juego (`game/public/data/targets/`).

**Luna — base permanente y aterrizaje**
- Las **9 regiones candidatas de Artemis III** (NASA, oct 2024): Peak near Cabeus B, Haworth, Malapert Massif,
  Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Slater Plain.
  Para el MVP: agrupar en 2–3 perfiles representativos (meseta / macizo / borde de cráter).
- **Cresta Shackleton–de Gerlache:** candidata clásica para una base permanente por su iluminación casi continua
  (Bussey et al. 2010, verificar).
- **Hábitat subterráneo:** pozos de Marius Hills y Mare Tranquillitatis.
- **Verdad de terreno:** Apollo 17 (Taurus-Littrow): muestras con composición medida.
- Luna global ✓: gravedad 1,62 m/s², rango diurno ecuatorial 95–390 K, presión ~3×10⁻¹⁵ bar (NSSDC).

**Marte — aterrizaje y exploración**
- **Gale** (Curiosity): REMS da presión, T del aire y del suelo y UV *medidos en superficie* → el mejor objetivo con verdad de terreno.
- **Jezero** (Perseverance): delta y lago antiguos, carbonatos; MEDA.
- **Gusev – Home Plate** (Spirit): sílice opalina hidrotermal. Ruff & Farmer 2016 (Nature Communications, verificar)
  la compararon con los sínteres de **El Tatio (Chile)**, que está a ~25–30 km de **Sol de Mañana (Bolivia)**.
  → Hipótesis fuerte para un análogo boliviano con respaldo de literatura.
- **Meridiani** (Opportunity): hematita y sulfatos (jarosita) → análogos de drenaje ácido (Río Tinto; ¿Potosí?).
- **Zonas con hielo para misiones humanas:** Arcadia Planitia, Deuteronilus Mensae (lóbulos de detritos con hielo).
  → Hipótesis: glaciares de roca de los Andes bolivianos.
- Marte global ✓: gravedad 3,73 m/s², T media ~214 K, presión 6,36 mbar (4,0–8,7), pH 7,7 ± 0,5 (Phoenix, Hecht 2009).

---

## 5. Cómo se calcula

### 5.1 Similitud por dimensión (IFA parcial)
Para un valor del sitio `x` y un objetivo con rango `[a, b]` (si es un valor puntual, `a = b`):
```
d  = 0                      si a ≤ x ≤ b
d  = min(|x − a|, |x − b|)  en otro caso        (en log10 para presión, dosis, UV; log1p para lluvia)
s  = exp(−½ · (d / τ)²)                        τ = tolerancia (status: design, documentada)
```
Si `x` o el objetivo es `pending`, la dimensión **se excluye** y los pesos se renormalizan; se informa la **cobertura**.
Es la misma regla que ya usa el juego (`game/src/scoring/score.ts`), así ambos dan el mismo número.

### 5.2 Progreso hacia el objetivo (PO) y percentil terrestre
Resuelve el problema de la presión. Con `m_T` = mediana de la Tierra (muestra de ~300–500 puntos de tierra firme):
```
PO = clip( (x − m_T) / (t − m_T), 0, 1 )      (en log para presión y dosis)
percentil = % de la muestra terrestre que está más lejos del objetivo que x
```
Ejemplo de lectura: *"En presión, este lugar recorre solo el 9 % del camino de la Tierra a Marte (escala logarítmica),
pero está en el 2 % más alto de la Tierra."* Es honesto y fácil de explicar a cualquier edad.

### 5.3 Perfiles de misión
`engine/seal/profiles.yaml`. Pesos `design`, **compuertas críticas** = dimensiones que deben pasar un mínimo
(ley del mínimo de Liebig: un análogo de movilidad con pendientes absurdas no sirve aunque el clima sea perfecto).

| Perfil | Pesos principales | Compuerta |
|---|---|---|
| Movilidad de rover / aterrizaje | pendiente, rugosidad, rocas, polvo | slope_p90 ≥ 0,4 |
| ISRU / agua y hielo | hielo, temperatura mínima, minerales hidratados | ice_presence o hidratados |
| Astrobiología | sílice/sulfatos/carbonatos, UV, aridez, extremófilos (literatura) | mineral_classes |
| Hábitat y operaciones humanas | térmico, UV, polvo, cuevas, logística | — |
| Instrumentos y ciencia de campo | minerales, albedo, térmico | — |

Además se reporta un **IFA total** (todas las dimensiones analogables) y el **factor limitante** (la dimensión con peor `s`).

### 5.4 Robustez (la respuesta a "¿y si cambian los pesos?")
Monte Carlo, N = 2000:
1. pesos ~ Dirichlet(α · w) alrededor de los pesos del perfil;
2. valores del sitio ~ Normal(x, σ_x) (σ desde la fuente o, si no hay, `estimated` y conservador);
3. objetivo ~ Uniforme[a, b].
Salida: rango mediano, intervalo 90 % y **P(top-3)** por sitio. Frase del pitch: *"Sol de Mañana queda en el top 3 en el
X % de 2000 escenarios."* (X sale del cálculo, no se escribe antes.)

### 5.5 Validación (la respuesta a "¿cómo saben que su motor funciona?")
- **Controles positivos** (análogos reconocidos en la literatura, con referencia): Atacama–Yungay, Valles Secos de
  McMurdo, Haughton/Devon, Mauna Kea, Cinder Lake, Río Tinto, Askja.
- **Controles negativos:** Amazonía, Pantanal, una ciudad.
- **Muestra al azar:** ~200 puntos de tierra firme.
- Métrica: **AUC ROC** (probabilidad de que un análogo conocido puntúe más que un punto al azar). Se reporta también
  "dejando una dimensión fuera" para ver qué dimensión hace el trabajo.
- Advertencia honesta: elegimos las dimensiones sabiendo que los desiertos son análogos → hay algo de circularidad.
  Se dice en el informe.
- Si el motor **redescubre los análogos famosos sin que se los demos**, entonces los lugares **nuevos** que encuentra
  en Bolivia tienen credibilidad. Ese es el argumento central de "Validez".

### 5.6 El cuadrante "impostor vs oculto" (la idea para sorprender)
Eje X = parecido **visual** (`visual_sim`), eje Y = parecido **físico** (IFA).
- Arriba-izquierda: **análogos ocultos** (no parecen Marte, pero lo son en los datos) → descubrimientos.
- Abajo-derecha: **impostores** (parecen la Luna, pero no lo son). Hipótesis para probar: el **Valle de la Luna (La Paz)**
  se llama "de la Luna" por su aspecto, pero es una zona de cárcavas en arcilla con lluvia estacional.
  **No asumir el resultado: medirlo.** Si sale impostor, es el ejemplo perfecto de "más allá de lo visual" que pide el reto.
- T3: si no da el tiempo para embeddings, el eje X puede ser una votación del equipo con fotos (marcado `estimated`).

### 5.7 Modo descubrimiento (búsqueda sistemática)
Rejilla sobre Bolivia y el Altiplano (Chile, Perú, Argentina): POWER (endpoint regional o muestreo de puntos a 0,25–0,5°)
+ DEM grueso (GLO-90) → IFA y PO por celda → **mapa de calor** "¿dónde está Marte en Bolivia?" → las 10 mejores
celdas reciben el análisis completo. Responde al "search systematically" y al "surprise us" del reto.

### 5.8 Mapa de parecidos
PCA (o UMAP) de todas las dimensiones normalizadas por la estadística terrestre: puntos de la Tierra, de la Luna y de
Marte en un mismo plano. Se ve cómo los sitios bolivianos se alejan de la nube de la Tierra hacia Marte. Gran
imagen para el pitch.

---

## 6. Arquitectura del código (`engine/`)
```
engine/
  requirements.txt        numpy pandas scipy scikit-learn requests pyyaml pydantic typer
                          rasterio matplotlib plotly   (T3: earthaccess, torch + open_clip / dinov2)
  seal/
    __main__.py, cli.py   typer: fetch | score | validate | discover | export | field
    schema.py             Value, Site, Target, FeatureDef, Profile (pydantic; mismo Value que el juego)
    features.yaml         catálogo de §3
    profiles.yaml         perfiles de §5.3
    sites/sites.yaml      lugares de la Tierra: id, nombre, lat, lon, país, rol (candidato|control+|control−), refs
    targets/*.yaml        objetivos de §4
    fetch/
      cache.py            caché en disco por (fuente, lat, lon, parámetros)
      power.py            POWER climatología + corrección por elevación (misma lógica que game/tools/build_site.mjs)
      dem.py              ventana de Copernicus GLO-30 (AWS, sin login) → pendiente a 100 m, rugosidad, Hurst
      modis.py            ORNL MODIS subsets: LST día/noche, NDVI, albedo (T2)
      emit.py             earthaccess (necesita cuenta Earthdata) (T2)
      field.py            JSON de la caja → Value(status="measured")
      earth_sample.py     muestra global de tierra firme para la mediana y los percentiles
    score/
      similarity.py       §5.1 (función pura) + PO y percentil §5.2
      profiles.py         §5.3 + compuertas + factor limitante
      robustness.py       §5.4
      validate.py         §5.5 (AUC)
    explain/
      narrative.py        fichas en 3 niveles; plantillas, nunca texto inventado sin datos
      gaps.py             brechas: gravedad, presión, dosis, atmósfera
    export/
      shared.py           data/shared/ranking.json (§7)
      game.py             parcha los JSON de game/public/data/sites/ SIN cambiar su esquema
      plots.py            radar por sitio, mapa de parecidos, mapa de calor, cuadrante impostor/oculto
  notebooks/colab.ipynb   todo el flujo en Google Colab (por si una PC no tiene Python)
  tests/                  similitud con casos a mano, renormalización con pending, AUC con datos sintéticos
```
Reglas: `score/` no hace red ni lee archivos (funciones puras, testeables). `fetch/` siempre pasa por la caché.
Un parámetro que falla queda `pending`; el resto sigue.

---

## 7. Contrato de datos compartido (`data/shared/ranking.json`)
```json
{
  "generated": "2026-11-14T20:00:00-04:00",
  "engine_version": "0.1.0",
  "validation": {"auc": 0.0, "n_pos": 7, "n_rand": 200, "note": "..."},
  "targets": [{"id": "mars_gale", "body": "mars", "name": "Cráter Gale (Curiosity)"}],
  "results": [
    {
      "site_id": "sol_de_manana", "target_id": "mars_gusev_homeplate",
      "ifa": 0.0, "coverage": 0.0,
      "profiles": {"rover": 0.0, "isru": 0.0, "astrobio": 0.0, "habitat": 0.0},
      "limiting": "pressure",
      "robust": {"median_rank": 0, "p90": [0, 0], "p_top3": 0.0},
      "dims": [{"id": "precip", "s": 0.0, "po": 0.0, "pct_earth": 0.0,
                "site": {"value": 0, "unit": "mm/año", "status": "modeled", "source": "...", "ref": "..."},
                "target": {"value": 0, "unit": "mm/año", "status": "estimated", "source": "...", "ref": "..."}}],
      "gaps": [{"id": "gravity", "earth": 9.81, "target": 3.73, "unit": "m/s²", "text_key": "gap.gravity"}],
      "story": {"explorador": "...", "cadete": "...", "cientifico": "..."}
    }
  ]
}
```
(Los ceros son marcadores del esquema, no resultados.)

---

## 8. Orden de construcción (para pedirle a Claude Code, una tarea por vez)
1. `schema.py` + `similarity.py` + tests (sin red). **30–45 min.**
2. `sites.yaml` (11 sitios del juego + candidatos bolivianos/latinos + controles) y `targets/*.yaml` con los valores ya
   verificados; el resto, `pending`. **45 min** (usar `/verificar-dato`).
3. `fetch/power.py` + caché + `earth_sample.py` → primer ranking real con clima. **1 h.**
4. `fetch/dem.py` (pendiente a 100 m, rugosidad) → dimensiones de terreno. **1 h.**
5. `profiles.py` + `robustness.py` + `validate.py` → AUC. **1 h.** ← **MVP para el simulacro de las 23:00**
6. `export/shared.py` + `export/game.py` + `narrative.py` (3 niveles). **1 h.**
7. Noche: `discover` (mapa de calor), MODIS LST/NDVI, EMIT en el top 5, cuadrante, mapa de parecidos.

## 9. Lugares de la Tierra a evaluar
La lista completa (Bolivia, Latinoamérica, Europa, África, Asia y controles) está en `docs/SITIOS_CANDIDATOS.md`.
