# Lugares a evaluar — Seal Hackathon Team

> Son **hipótesis**, no conclusiones. El motor decide con datos qué tanto se parece cada lugar, a qué objetivo y para qué
> uso. Las coordenadas **no** están aquí a propósito: Claude Code las busca con una fuente citable (de preferencia un
> paper o un sitio oficial; Wikipedia o GeoNames solo como `estimated`) y elige un **punto concreto**, no un área entera.
>
> Rol: `candidate` = lo que queremos descubrir · `control_pos` = análogo ya reconocido en la literatura (sirve para validar el
> motor) · `control_neg` = no debería parecerse (para comprobar que el motor no le pone buena nota a todo).
>
> **Estrategia para el pitch:** lo de Europa y otros sitios famosos es la **referencia** (el reto pide no quedarse en lo ya
> conocido); **Bolivia es el descubrimiento**. Si el motor pone a Bolivia al nivel de los análogos famosos, ese es el hallazgo.

## Bolivia (candidatos principales)
| id | Lugar | Hipótesis (objetivo y dimensión) | Punto sugerido | Fuentes candidatas / cuidado |
|---|---|---|---|---|
| `siloli` | Desierto de Siloli – Árbol de Piedra (Potosí) | Marte: erosión eólica, aridez, UV, frío; movilidad en arena y roca | Llanura junto al Árbol de Piedra | Wikipedia (secundaria). No se encontró un estudio que lo use formalmente como análogo → candidato sin respaldo |
| `laguna_colorada` | Laguna Colorada | Marte: frío extremo, sulfatos (yeso), boratos | Orilla seca con depósitos blancos | El rojo es biológico (algas), **no** óxido de hierro: no sirve para el color marciano |
| `sol_de_manana` | Géiseres Sol de Mañana | Marte: hidrotermal (astrobiología); comparación con El Tatio ↔ Home Plate (Gusev) | Ya está en el juego | Verificar Ruff & Farmer 2016 (Nature Communications). Terreno peligroso: solo referencia |
| `laguna_verde` | Laguna Verde – Licancabur | Marte: lago salino con estromatolitos y tapetes microbianos; UV récord | Ya está en el juego (datos reales) | UV 43,3 en el Licancabur (2003): buscar el paper primario (Cabrol et al.). No confundir con la Laguna Verde de Chile |
| `uyuni` | Salar de Uyuni (Incahuasi) | Marte: evaporitas, salmueras, arcillas; albedo alto; navegación | Ya está en el juego | NASA Earth Observatory (salares bolivianos); Remote Sensing 2019, doi:10.3390/rs11182104 (drones; las "rayas de pendiente" no se prueban aquí). Agua estacional dic–mar |
| `coipasa` | Salar de Coipasa | Marte: transición de lago a salar seco | Borde del salar en Bolivia (~2 % está en Chile) | NASA Earth Observatory |
| `poopo` | Lago Poopó (lecho seco) | Marte: lecho de lago que se seca | Lecho expuesto | La analogía **no tiene fuente** (es hipótesis nuestra). Agua temporal: usar datos de varios años, no uno solo |
| `uturuncu` | Volcán Uturuncu (falda, no la cumbre) | ¿Luna? (ceniza y pendientes) / Marte (volcánico) | Falda baja | Una investigación previa del equipo no encontró un análogo lunar **de ambiente** en Bolivia; lo comparable es el **suelo** (simulante JSC-1 = ceniza basáltica, NTRS 19940011925). Volcán que se infla (AGU 2014) |
| `sajama` | Parque Nacional Sajama | Marte: geotermia de altura (géiseres de Juchusuma), periglaciar; ¿hielo? | Zona de los géiseres o puna al pie del volcán | No se encontró uso formal como análogo |
| `valle_de_la_luna` | Valle de la Luna (La Paz) | **Prueba de "impostor"**: parece lunar, ¿lo es en los datos? | Área protegida | Arcilla y arenisca, lluvias considerables. Movilidad en suelo blando |
| `valle_de_las_animas` | Valle de las Ánimas (La Paz) | Impostor / movilidad en cárcavas | Mirador principal | — |
| `canones_de_palca` | Cañones de Palca (La Paz) | Impostor / movilidad, erosión | Fondo del cañón | — |
| `sucre_campo` | Punto de la prueba de campo en Sucre (plaza o campo libre) | Referencia local + validación de la caja contra el satélite | El que se mida con la caja (GPS) | `measured` |
| (opcional) `chacaltaya` | Chacaltaya (5200 m) | Brecha de radiación: laboratorio histórico de rayos cósmicos | — | Sirve para la sección "dónde se rompe la analogía" |
| (opcional) `torotoro_umajalanta` | Caverna de Umajalanta (Torotoro) | Operaciones en cuevas (es caliza, no tubo de lava: decirlo) | Entrada | — |
| (opcional) `cordillera_real_glaciar_roca` | Glaciar de roca de la Cordillera Real | Marte: hielo bajo detritos (zonas con hielo para misiones humanas) | Uno con estudio publicado | Buscar inventario de glaciares de roca de Bolivia |

**Ojo: la Reserva Eduardo Avaroa no es un punto, es un área** que contiene Siloli, Laguna Colorada, Sol de Mañana y
Laguna Verde. En el motor y en el juego va como **región** (`region_id: reserva_eduardo_avaroa`) que agrupa esos sitios;
también sirve como la "ruta" del pitch: viento → frío y sulfatos → hidrotermal → lago con vida microbiana.

## Latinoamérica (si alcanza el tiempo)
| id | Lugar | Hipótesis | Rol |
|---|---|---|---|
| `atacama_yungay` | Atacama – Yungay (Chile) | Marte: hiperaridez | `control_pos` (ya está en el juego) |
| `pampas_la_joya` | Pampas de La Joya (Perú) | Marte: aridez | candidate |
| `campo_piedra_pomez` | Campo de Piedra Pómez (Argentina) | Marte: erosión eólica | candidate |
| `payunia` | La Payunia (Argentina) | Luna/Marte: campos de lava | candidate |
| `pinacate` | El Pinacate (México) | Luna: campo volcánico (verificar entrenamiento Apollo) | candidate |

## Europa (sobre todo referencia / controles)
| id | Lugar | Hipótesis | Rol sugerido | Verificar |
|---|---|---|---|---|
| `teide` | Parque Nacional del Teide (España) | Marte/Luna: volcánico; pruebas de instrumentos | control_pos si hay fuente | Uso por ESA/ExoMars |
| `lanzarote` | Lanzarote (España) | Luna/Marte: campos de lava; entrenamiento de astronautas | control_pos si hay fuente | Programa PANGAEA de la ESA |
| `rio_tinto` | Río Tinto (España) | Marte: agua ácida, jarosita y hematita (como Meridiani) | control_pos | Paper primario (Fernández-Remolar et al.) |
| `vatnajokull` | Vatnajökull (Islandia) | Marte: hielo y volcanes | candidate | Elegir un punto sin glaciar encima si se quiere terreno |
| `svalbard` | Svalbard (Noruega) – Bockfjorden | Marte: volcanes en ambiente polar; expediciones AMASE | control_pos si hay fuente | — |
| `etna` | Monte Etna (Italia) | Luna/Marte: volcánico | candidate (ya está en el juego; **coordenada provisional**) | Confirmar coordenada |
| `ries` | Cráter de Ries – Nördlingen (Alemania) | Luna: cráter de impacto (entrenamiento de astronautas Apollo) | control_pos si hay fuente | — |

## África y Asia (referencia)
| id | Lugar | Hipótesis | Verificar |
|---|---|---|---|
| `namib_sossusvlei` | Sossusvlei (Namibia) | Marte: dunas y arcilla seca | ya está en el juego |
| `danakil_dallol` | Depresión de Danakil – Dallol (Etiopía) | Marte: ambiente poliextremo, sales, hidrotermal (astrobiología) | paper primario |
| `desierto_blanco` | Desierto Blanco (Egipto) | **Impostor probable**: caliza y yeso con aspecto "lunar" | — |
| `wadi_rum` | Wadi Rum (Jordania) | Marte: arenisca rojiza; movilidad | si hubo misiones análogas, con fuente |
| `dasht_e_lut` | Dasht-e Lut (Irán) | Marte: yardangs (crestas eólicas); temperaturas de superficie extremas (MODIS) | fuente del récord de LST |
| `capadocia` | Capadocia (Turquía) | Marte/Luna: toba volcánica erosionada | — |
| `bromo` | Monte Bromo (Indonesia) | Luna: ceniza volcánica | — |

## Controles ya conocidos (del juego y de la literatura)
`control_pos`: Atacama–Yungay, Valles Secos de McMurdo, Mauna Kea, Cinder Lake, Askja, Lava Beds, Haughton–Devon,
Río Tinto (+ los europeos que tengan fuente).
`control_neg`: Amazonía (cerca de Manaus), Pantanal, centro de una ciudad.

## Notas de una investigación previa del equipo (para no repetir errores)
- La **sal no sirve** como regolito lunar (es cristalina y soluble); para el suelo lunar se compara con ceniza volcánica
  o pómez (el simulante JSC-1 de la NASA es ceniza basáltica).
- Presión de control: el BME280 debería leer ~640 hPa a 3650 m (atmósfera estándar). Si lee algo muy distinto, revisar el sensor.
- Frase segura para el pitch: *"medimos presión, UV y temperatura en un sitio que comparte con Marte la sequedad, las sales
  y el frío"* (no "es Marte").
- Contacto posible para validar el sensor UV: trabajos de Francesco Zaratti (UMSA) sobre UV-B en Uyuni.
