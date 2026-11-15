# Valores a verificar — Seal Hackathon Team

> Hecho con asistencia de IA (Claude). Búsqueda y comprobación de fuentes del 2026-11-14 con Claude Fable 5.2
> (WebSearch/WebFetch, Crossref, Europe PMC). Todo lo que figura aquí está en el motor como `pending` o `estimated`
> y **no debe ir al pitch como dato firme** hasta que alguien del equipo lea la fuente y lo confirme.
> "Solo resumen" = se leyó el resumen o un extracto, no el texto completo.

## 1. Objetivos (Marte y Luna)

### Lo que más pesa en la cobertura
| Objetivo | Dimensión | Estado | Qué falta / fuente candidata |
|---|---|---|---|
| **Todos** | `slope_p50_100m`, `slope_p90_100m`, `roughness_100m` | pending | Ninguna fuente accesible da pendientes a 100 m por sitio. **Mejor camino: calcularlas nosotros** con el DEM de LOLA (polo sur, 20 m/px) y HRSC/CTX (Marte), con el mismo código que la Tierra (Fase 6). Candidatas: Barker et al. 2021 (doi:10.1016/j.pss.2020.105119), Golombek et al. 2005 (doi:10.1038/nature03600), Golombek et al. 2012 (doi:10.1007/s11214-012-9916-y). |
| **Todos** | `uv_index` | pending | REMS/MEDA miden W/m² por banda, no índice UV. No convertir sin un modelo citado. |
| Luna (polares) | `t_mean`, `t_range_diurnal` | pending | Williams et al. 2019, JGR Planets (Diviner polar), doi:10.1029/2019JE006028. |
| Luna global | `t_mean` | pending | La ficha NSSDC solo da la temperatura de cuerpo negro (270,4 K), que no es la media del suelo. Williams et al. 2017 (doi:10.1016/j.icarus.2016.08.012). |
| Gale | `t_mean`, `wind` | pending | Martínez et al. 2017, Space Sci. Rev., doi:10.1007/s11214-017-0360-x (sin acceso al texto). |
| Gale | `rh` | pending | Solo se encontró un **máximo** nocturno (~70 %, JPL 2016), no comparable con una media. Harri et al. 2014, doi:10.1002/2013JE004514. |
| Jezero | `t_range_diurnal` | pending | Solo la envolvente anual 183–266 K (Munguira et al. 2024), que no es la amplitud de un día. |
| Jezero | `rh` | pending | Polkko et al. 2023, doi:10.1029/2022JE007447. |
| Gusev, Meridiani, Arcadia | `t_mean`, `t_range_diurnal`, `rh`, `wind` | pending | Sin meteorología local verificada. Martínez et al. 2017 (MER Mini-TES); Mars Climate Database (modelo). |
| Arcadia | `mineral_classes` | pending | Las fuentes hablan de hielo de agua, que no está entre las clases; la dimensión clave (`ice_presence`) es T2. |
| Albedo por sitio (Marte) | `albedo` | heredado (estimated) | Se usa el albedo de Bond del planeta (0,25), que NO es el de la superficie local. Mejor: mapa TES (Christensen et al. 2001); Vasavada et al. 2017 (Gale), Martínez et al. 2023 (Jezero, doi:10.1029/2022JE007537). |

### Valores `estimated` (están en el puntaje, pero son débiles)
| Objetivo | Dimensión | Valor | Por qué es débil |
|---|---|---|---|
| Gale | `pressure` | 0,74 kPa [0,685–0,78] | Comunicado de Europlanet 2012: ciclo diario de las primeras semanas, no el anual. Primaria: Harri et al. 2014 (doi:10.1002/2013JE004423). |
| Gale | `t_range_diurnal` | 76 K | Derivado de +6 / −70 °C de las primeras semanas (comunicado). |
| Jezero | `t_mean` | 217 K [209–225] | Visto solo en un extracto de Munguira et al. 2024 (doi:10.1029/2024JE008385); 217 es el punto medio nuestro. |
| Marte global | `albedo` | 0,25 | Albedo de Bond del planeta (NSSDC), no de la superficie. |
| Luna global | `albedo` | 0,11 | Albedo de Bond de todo el disco. |
| Luna (polares) | `mineral_classes` | anortosita | Generalización de tierras altas (Ohtake et al. 2009, doi:10.1038/nature08317), no un estudio del sitio. |
| Marte / Luna | `precip`, `ndvi` | 0 | Simplificación (sin lluvia líquida, sin vegetación). |
| Marte / Luna | `soil_moisture` | 0 | Simplificación (sin agua líquida en el suelo). En la Tierra viene de POWER GWETTOP (MERRA-2), que rara vez baja de ~0,1 aun en Atacama: la brecha es en parte del modelo. |

### Decisiones nuestras que hay que decir en voz alta
- **Grupos de Artemis III:** la NASA (28-oct-2024) solo publica los 9 nombres; **no** los clasifica en meseta/macizo/borde.
  La agrupación es nuestra, por el nombre. Dudosas: *Haworth* (puesto en "borde") y *Slater Plain* (es llanura).
- **Pozo lunar:** se eligió el de Mare Tranquillitatis porque Horvath et al. 2022 da su temperatura (~290 K, **modelo**).
  Que sea la entrada a un tubo de lava es hipótesis. Haruyama et al. 2009 trata de **Marius Hills**, no de este pozo.
- **Shackleton:** la iluminación es "casi continua" (Mazarico et al. 2011: ~240 días al año de sol continuo en un punto
  del borde), no "continua". La cifra "86 % del año" solo se vio en un blog: no usarla.
- **Herencia:** Gusev, Meridiani y Arcadia toman la presión de Marte global (Spirit y Opportunity no tenían barómetro).

### Solo se leyó el resumen
Ruff & Farmer 2016 · Squyres 2004/2007/2008 · Klingelhöfer 2004 · Vaniman 2014 · Goudge 2015 · Farley 2022 ·
Bramson 2015 · Dundas 2018 (no es específico de Arcadia) · Morgan 2021 · Horvath 2022 · Mazarico 2011 · Bussey 2010
(DOI verificado; resumen no leído). Texto completo leído: Sánchez-Lavega 2023 (presión de Jezero) y Viúdez-Moreiras 2022 (viento de Jezero).

## 2. Sitios de la Tierra

| Sitio | Qué falta | Fuente candidata |
|---|---|---|
| `uturuncu` | **pending, no se procesa**: solo hay coordenada de la cumbre | Un punto de la falda con fuente (p. ej. de los papers de deformación, AGU 2014) |
| `pampas_la_joya` | **pending, no se procesa**: el paper solo da 16–17°S | Valdivia-Silva et al. 2011 (doi:10.1016/j.gca.2011.01.017), buscar coordenadas de muestreo |
| `sajama` | Coordenada genérica del parque, no de los géiseres de Juchusuma | Tesis UMSA (repositorio.umsa.bo/xmlui/handle/123456789/35517) |
| `laguna_colorada` | Punto de mirador (OSM), sin confirmar los depósitos blancos | Imagen satelital o paper de boratos |
| `sol_de_manana` | **La analogía con Home Plate es nuestra**: Ruff & Farmer 2016 habla de El Tatio (Chile), a ~25–30 km | — Decirlo así en el pitch |
| `laguna_verde_licancabur` | `control_pos` apoyado en el High Lakes Project (Cabrol et al. 2009, doi:10.1029/2008JG000818, visto en un espejo + nota de la NASA). El paper del UV récord (2014) no menciona Marte | Leer Cabrol 2009 |
| `uyuni_incahuasi` | Solo un resumen de congreso (EPSC 2024); minerales `estimated` | Paper revisado por pares |
| `namib_sossusvlei` | Pasó a `candidate`: la literatura encontrada lo usa como análogo de **Titán** | — |
| `ries`, `pinacate` | `candidate`: entrenamiento Apollo documentado, pero ninguna fuente leída dice "análogo" | ALSJ de la NASA |
| `dry_valleys_wright` | DOIs de Toner 2022 y Burton 2023 vistos solo en extractos | Abrir los DOIs |
| `rio_tinto` | Punto en un camino de OSM, no de muestreo; DOI de Fernández-Remolar 2005 visto en extracto | Coordenadas del paper |
| `coipasa` | Halita del IRD vista solo en un extracto | Abrir el PDF del IRD |
| Bordes de mosaico | Etna (lon 15,0), Valles Secos (lon 162,0), Askja (lat 65,03), Valle de las Ánimas, Palca, Bromo | El DEM une mosaicos vecinos (Fase 3); Etna es coordenada **provisional** |
| Minerales omitidos | Basalto en Mauna Kea, Askja, Lava Beds; arcilla en Valle de la Luna; boratos/sulfatos en Laguna Colorada | Falta una fuente directa del sitio |
| Coordenadas `estimated` | La mayoría (Wikipedia/OSM) | Reemplazar por un paper o un sitio oficial cuando se pueda |

## 3. Cambios tras la revisión del 2026-11-14 (Fable 5.2)
- **Albedo de Marte y la Luna → `pending`.** El albedo de Bond de las fichas NSSDC es del planeta entero (con atmósfera),
  no de la superficie. Ahora solo Gale (TES 0,20–0,25, vía Martínez et al. 2014) y Jezero (MEDA 0,12, vía Munguira et al.
  2023) tienen albedo de superficie, ambos `estimated` (fuente secundaria).
- **Gale `t_range_diurnal` → 45–75 K, `literature`** (Martínez et al. 2016, Física de la Tierra 28, texto completo). Reemplaza
  al dato de prensa (76 K).
- **Jezero `t_range_diurnal` → 40–65 K, `literature`** (Munguira et al. 2023, JGR Planets 128, e2022JE007559). Cubre ~medio año.
- **Pozo lunar `t_mean` → `pending`:** 290 K es temperatura modelada DENTRO del pozo, no comparable con aire.
- **NDVI objetivo → rango −0,2 a 0,1 (`design`)**, umbral de NASA Earth Observatory ("0,1 o menos = roca, arena o nieve").
- Siguen `pending` por falta de acceso (403): Gale t_mean, viento y presión anual (Martínez 2017, Harri 2014); Jezero RH
  (Polkko 2023); Gusev y Meridiani; temperaturas del polo sur lunar (Williams 2019). Abrir esos papers en un navegador.
- Minerales nuevos: Askja (Cousins et al. 2013, `literature`), Atacama–Yungay (Sutter et al. 2005, `literature`),
  Lava Beds (Kulkarni et al. 2022, `estimated`: solo resumen).
- **Leídos por el equipo (2026-11-14):** Gale `albedo` → 0,10–0,30, `literature` (Martínez et al. 2017, sec. 3.4, citando a
  Vasavada et al. 2017). Jezero `albedo` → 0,12–0,14, `literature` (Polkko et al. 2023, sec. 6). La HR de Gale y Jezero sigue
  `pending`: los papers dan máximos nocturnos (Gale 10–70 %, Jezero hasta 100 %) y valores diurnos < 5 % / < 2 %, no una
  media comparable con POWER. Shackleton: ~200 K de superficie en verano (Williams et al. 2019), solo como contexto.
