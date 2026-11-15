# Sealometro — texts for the Space Apps submission form

> Copy each block into its field. Everything is in English (global judging). Numbers here are the ones the project
> actually reports; do not round them up.

## Project Name
Sealometro

## Summary (≈190 words, < 1500 characters)
No place on Earth is Mars — but some places go a long way there. Sealometro finds, measures and lets you explore those
places. Our open similarity engine compares 41 locations on Earth, starting with Bolivia and Latin America, against 12
concrete targets on Mars (Jezero, Gale, Gusev, Meridiani, ice regions) and the Moon (Artemis III regions,
Shackleton–de Gerlache, lava-tube pits) using NASA data (POWER, MODIS, EMIT) and partner data (Copernicus DEM,
Sentinel-2). For every place it shows how it is alike, how far it goes from a typical Earth place toward Mars or the
Moon, and exactly where the analogy breaks: air pressure, gravity, radiation. Missing data is never filled in; every
score reports its coverage. To bring this to the field, we built a low-cost ESP32 box (air temperature, humidity,
pressure, UV, light, gas, tilt) that streams live readings to a web station, checks each sensor against independent
references and computes the place's analogy with the same math as the engine. Photos, video and GPS from a phone turn
the measured place into a playable map where you drive a rover under Mars or Moon gravity. Science that anyone can
verify — and play.

## Project Demonstration
(Pending — the team will add the 30-second video or ≤7-slide link here.)

## Project (public link)
https://seal-box.web.app/?lang=en

Source code (public): https://github.com/CamiloNunezArroyo/sealometro — mention it at the start of Project Details.

## Project Details
**Live app:** https://seal-box.web.app/?lang=en · **Code:** https://github.com/CamiloNunezArroyo/sealometro

**What it does.** Sealometro answers three questions about any place on Earth: How similar is it to a specific site on
Mars or the Moon? How far does it go from a typical Earth place toward that site? And where does the analogy break?

**How it works.**
1. *Similarity engine (Python).* Each place and each target is described by dimensions — mean temperature, day–night
   range, rain, soil moisture, humidity, vegetation (NDVI), albedo, slope and roughness, minerals, caves — each value
   with its status (measured, modeled, literature, derived, estimated, design or pending), source and reference. Per
   dimension a Gaussian kernel gives a similarity; the Index of Analogy is a weighted mean that only counts dimensions
   with data and reports its coverage (minimum 40%). "Gaps" that Earth cannot close (air pressure, UV-C) are not scored;
   instead we show the *progress* from the median Earth place toward the target. We validated against known analogs
   versus random points and report the result as is (AUC 0.56 — weak; we explain why). Weights and tolerances are our
   design decisions and are tested with a robustness analysis.
2. *Web app.* Map, ranking and a card per place explained at three reading levels (ages 8–12, 13–17, 18+), in English and
   Spanish.
3. *Field box.* An ESP32 with BME280, GUVA-S12SD UV, light, MQ gas and MPU-6050 sensors and an LCD. It streams a
   reading every 0.5 s over Wi-Fi to Firebase (median upload 0.4 s, measured) or over USB. The station page grades each
   cheap sensor against independent references (Open-Meteo weather, Copernicus DEM), shows the measured-vs-reference
   difference with tolerances, and computes the analogy of the measured place using NASA POWER at the phone's GPS
   position with the same math as the engine (tested against it).
4. *Playable place.* Indoors, the phone's photos and a 10-second panoramic video become the walls, floor and colors of
   the map (simple, explainable image analysis — no AI). Outdoors, the GPS brings real buildings, trees and pitches from
   OpenStreetMap and the surrounding relief. Then you drive a rover there with Mars or Moon gravity.

**Benefits and impact.** Finds new, nearby, cheaper analog sites beyond the famous ones (Bolivian Altiplano first);
shows students and the public what makes Mars different, not just what looks similar; and gives schools a way to check
satellite data with their own low-cost instrument.

**Tools.** Python 3.11 (numpy, pandas, scipy, scikit-learn, rasterio, pydantic, typer, pytest, h5py); TypeScript, React 18, Vite, Three.js; ESP32 with Arduino core
3.x, ArduinoJson, Adafruit BME280; Firebase Realtime Database and Hosting; Web Serial; NASA and partner open data APIs.

**Creativity.** Instead of one "Mars-like" score, we separate similarity, progress and gaps, keep missing data visible,
and close the loop from satellite data to a field measurement to a place you can play in.

**What we considered.** Data honesty (no invented numbers), cheap-sensor limits (each sensor graded against a
reference), safety (gas alert), privacy (no faces or names of minors in published material), and accessibility (three
reading levels, two languages, phones and laptops).

**Prior work and AI.** The rover game started as a prototype made a few days before the hackathon; the engine, field
box, station and integration were built during it. We used Claude (Anthropic) as a coding and research assistant; see
the AI disclosure in the app credits and in docs/AI_USE.md.

## Use of Super Intelligence (SI) — select
Select the options that match (exact labels depend on the form):
- ✅ Code generation / coding assistance
- ✅ Text generation or editing (documentation, explanations)
- ✅ Research / data analysis assistance (finding and checking sources)
- ❌ Image generation — not used
- ❌ Audio / video generation — not used
- ❌ "I did not use SI" — do NOT select (we did use it)

Where it is indicated in the project: header "Hecho con asistencia de IA (Claude)" in source files, the "AI use" text
on the app's Credits and How-it-works pages, the README, and the full log in docs/AI_USE.md.

## NASA Data (Link Text → Link URL)
| Link Text | Link URL |
|---|---|
| NASA POWER (climate: temperature, humidity, pressure, rain, UV, soil wetness) | https://power.larc.nasa.gov/ |
| MODIS land products via ORNL DAAC MODIS Web Service (NDVI, land surface temperature, albedo) | https://modis.ornl.gov/data/modis_webservice.html |
| EMIT L2B Estimated Mineral Identification (EMITL2BMIN v002) | https://lpdaac.usgs.gov/products/emitl2bminv002/ |
| NASA Common Metadata Repository (CMR) search | https://cmr.earthdata.nasa.gov/search/ |
| NSSDC Mars Fact Sheet | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html |
| NSSDC Moon Fact Sheet | https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html |
| Mars 2020 MEDA surface pressure (Sánchez-Lavega et al. 2023) | https://doi.org/10.1029/2022JE007480 |
| Mars 2020 MEDA air temperature (Munguira et al. 2023) | https://doi.org/10.1029/2022JE007559 |
| Mars 2020 MEDA winds (Viúdez-Moreiras et al. 2022) | https://doi.org/10.1029/2022JE007523 |
| Mars 2020 MEDA humidity and albedo (Polkko et al. 2023) | https://doi.org/10.1029/2022JE007447 |
| Curiosity CheMin minerals at Yellowknife Bay (Vaniman et al. 2014) | https://doi.org/10.1126/science.1243480 |
| LROC lunar pits (Robinson et al. 2012) | https://doi.org/10.1016/j.pss.2012.05.008 |
| NASA Earth Observatory — Measuring Vegetation (NDVI) | https://earthobservatory.nasa.gov/features/MeasuringVegetation/measuring_vegetation_2.php |

## Space Agency Partner & Other Data (Link Text → Link URL)
| Link Text | Link URL |
|---|---|
| ESA Copernicus DEM GLO-30 (AWS Open Data) | https://registry.opendata.aws/copernicus-dem/ |
| ESA Copernicus Sentinel-2 L2A (Earth Search by Element 84) | https://registry.opendata.aws/sentinel-2-l2a-cogs/ |
| JAXA SELENE (Kaguya) lunar crust results (Ohtake et al. 2009) | https://doi.org/10.1038/nature08317 |
| Open-Meteo weather and elevation APIs (CC BY 4.0; Copernicus DEM GLO-90) | https://open-meteo.com/ |
| OpenStreetMap contributors (ODbL) via Overpass API | https://www.openstreetmap.org/copyright |
| Wikimedia Commons (real place photos, with author and license) | https://commons.wikimedia.org/ |
| EMIT mineral grouping matrix (emit-sds) | https://github.com/emit-sds/emit-sds-l2b |
| NOAA GLOBE land mask via global-land-mask (random Earth sample for validation) | https://pypi.org/project/global-land-mask/ |
| Firebase Realtime Database and Hosting (Google) | https://firebase.google.com/ |
| Three.js | https://threejs.org/ |
| React | https://react.dev/ |
| Vite | https://vite.dev/ |
| Arduino core for ESP32 (Espressif) | https://github.com/espressif/arduino-esp32 |
| ArduinoJson | https://arduinojson.org/ |
| Adafruit BME280 library | https://github.com/adafruit/Adafruit_BME280_Library |
| Scaniverse (optional 3D scan app) | https://scaniverse.com/ |
| Claude by Anthropic (AI coding and research assistant) | https://www.anthropic.com/claude |

## Project Submission Verification
The team leader must tick these personally after reading the guide, terms and privacy policy (Claude cannot accept
terms on the team's behalf).
