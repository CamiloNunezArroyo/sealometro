# Fuentes de datos

Cada dato del proyecto declara `status` y `source`. Este documento resume de dónde sale cada uno, cómo se accede y su limitación principal. Las licencias y los plazos de las APIs cambian: **verifica cada una antes de publicar**.

## Ya integradas (Fase 1)

| Fuente | Variable(s) | Acceso | Status | Limitación |
|---|---|---|---|---|
| **NASA POWER** (climatología) | T2M, T2M_MAX/MIN, PS, RH2M, WS10M, ALLSKY_SFC_SW_DWN, ALLSKY_SFC_UV_INDEX, PRECTOTCORR, ALLSKY_SRF_ALB | API REST sin clave: `power.larc.nasa.gov/api/temporal/climatology/point`; script `tools/build_site.mjs` (`npm run data:uyuni`; hay una versión equivalente en Python) | `modeled` | Rejilla de ~50 km: representa la región, no el punto. Citar la fuente. La disponibilidad de cada parámetro en la comunidad `RE` no se pudo comprobar contra la API real al escribir el script; si uno falla queda `pending`. |
| **Copernicus DEM GLO-30** | Elevación 30 m -> relieve, pendiente | COG público en AWS (`copernicus-dem-30m`), lectura por ventana con el paquete `geotiff` (Node) o rasterio (Python) | `modeled` (relieve), `derived` (pendiente) | Es un modelo de **superficie**: incluye vegetación y edificios, y tiene ruido vertical que infla la pendiente en terreno plano. |
| **NASA NSSDC Mars Fact Sheet** | Gravedad media 3,73 m/s², temperatura media ~214 K, presión 6,36 mb (4,0-8,7 según la estación), rango diurno Viking 1 184-242 K | `nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html` (comprobada el 2026-11-10) | `literature` | Son valores globales o de un solo sitio (Viking 1), no la variabilidad real de Marte. |
| **NASA NSSDC Moon Fact Sheet** | Gravedad 1,62 m/s²; rango diurno ecuatorial 95-390 K; presión nocturna 3×10⁻¹⁵ bar | `nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html` (consultada 2026-11-11; ficha actualizada 2024-01-11) | `literature` | No da temperatura media superficial (queda `pending`); la "temperatura de cuerpo negro 270,4 K" no es la media del suelo. |
| **Wikipedia (Sol de Mañana)** | Coordenadas -22.426, -67.760; ~4900 m | consultada 2026-11-11 | `estimated` hasta fuente primaria | Fuente secundaria; NO respalda la analogía con Marte. |
| **NASA NTRS 20140008708** (Klingelhöfer et al. 2014, pruebas ISRU en Mauna Kea) | Coordenadas de Pu'u Hiwahine (19°45′39,29″N 155°28′14,56″O), ~2800 m; "análogo lunar y marciano adecuado" | `ntrs.nasa.gov/citations/20140008708` (solo el resumen; sin DOI) | `literature` pendiente de DOI | Falta leer el artículo completo. |
| **Hecht et al. 2009** (Phoenix WCL), Science 325:64-67 | pH del suelo marciano 7,7 ± 0,5 | doi:10.1126/science.1172466 (resumen leído 2026-11-11) | `literature` | Un solo sitio (68°N); solo se leyó el resumen. |
| **Beyer et al. 2003**, JGR 108(E12) | Pendientes RMS en sitios MER (referencia, NO usada como objetivo) | doi:10.1029/2003JE002120 | `literature` (no usada) | Escala de 1-12 m/píxel; incomparable con el DEM de 23 m del juego. |
| **Natural Earth 1:110m** (vía npm `world-atlas`, licencia ISC; datos de dominio público) | Costas y fronteras para la textura del globo | Archivo `public/data/geo/countries-110m.json` | decorativo | Solo ilustra; no es dato científico. Las fronteras son las de Natural Earth (de facto). |
| **Wikipedia (Laguna Verde / Licancabur)** | Coordenadas de Laguna Verde (-22,795; -67,825) | Verificadas el 2026-11-10 | `estimated` hasta fuente primaria | Fuente secundaria; falta DOI que respalde la analogía con Marte. |
| **Atmósfera estándar ISA** | Presión a 3656 m | Fórmula | `derived` | Aproximación; POWER (PS) la reemplaza. |

## Previstas (Fases 2-3)

| Fuente | Variable(s) | Acceso | Nota |
|---|---|---|---|
| **ISRIC SoilGrids 2.0** | Arcilla/arena/limo, pH, carbono | Descarga/WCS (la API REST estaba pausada en la última comprobación) | Es un modelo; funciona mal en salares, roca desnuda, hielo y lava reciente. |
| **USGS Spectral Library v7** | Espectros de minerales (referencia para un espectrómetro del rover) | ScienceBase, DOI 10.5066/F7RR1WDJ | Son espectros de laboratorio, **no** la composición del sitio: la lista de minerales de cada sitio debe salir de literatura con referencia. |
| **NASA PDS (REMS, MOLA)** | Series reales de Marte para reemplazar los valores de la ficha por estadísticas calculadas | PDS Atmospheres Node / Geosciences | Calcular media/mín/máx por estación (`derived`). |
| **NASA PDS (LOLA, Diviner, CRaTER)** | Referencia lunar: topografía, temperatura, radiación | PDS Geosciences / USGS Astrogeology | Necesario para el objetivo Luna. |
| **SENAMHI / SERGEOMIN (Bolivia)** | Estaciones y geología de los sitios bolivianos | Solicitud institucional | Disponibilidad por verificar. |

## Pendientes conocidos

- Terrenos de Laguna Verde, Sol de Mañana y Mauna Kea: SINTÉTICOS (`tools/make_placeholder_terrain.mjs`) hasta ejecutar su comando de datos.
- Sol de Mañana: la analogía con Marte no tiene fuente; Mauna Kea: falta el DOI. Ambos con métricas `pending` hasta `npm run data:sol` / `data:mauna`.
- Laguna Verde: todas las métricas `pending` hasta ejecutar `npm run data:laguna`; su `analogRationale` solo cita fuentes secundarias.
- `analogRationale.refs` del sitio está vacío: falta una cita (DOI) que respalde por qué Uyuni es análogo de Marte.
- Los minerales de Uyuni (halita, yeso) están marcados `estimated` con referencia pendiente.
- El texto de `water.note` es conocimiento general sin referencia.
- Los pesos de las categorías del puntaje son un juicio de diseño.
