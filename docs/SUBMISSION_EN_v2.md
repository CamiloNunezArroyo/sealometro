# Sealometro — submission form texts, version 2

<!-- Hecho con asistencia de IA (Claude). Reviewed against the official 2026 guides and challenge page on 2026-11-15. -->

> Copy each block into its field. Everything is in English. Every number below comes from `data/shared/ranking.json`,
> the live app or the project docs; do not round them up. The previous version stays in `docs/SUBMISSION_EN.md`.
>
> Official pages read for this version:
> - Judging & Awards Guide: https://www.spaceappschallenge.org/resources/judging-awards-guide/
> - Project Submission Guide: https://www.spaceappschallenge.org/resources/project-submission-guide/
> - Challenge: https://www.spaceappschallenge.org/2026/challenges/permanent-moon-base-locations-and-mars/

## Project Name
**Sealometro**

Optional tagline (use it in the demo title, not in the name field): *How far toward Mars does your place go?*

## High-Level Project Summary (≈200 words, ≈1200 characters)
No place on Earth is Mars or the Moon. The useful question is how far a place goes, and where the analogy breaks down.
Sealometro is an open similarity-ranking tool that answers it with NASA and partner data. Our engine compares 41 Earth
locations (22 new candidates, mostly in Bolivia and Latin America, plus known analogs and negative controls) with 12
targets, including Jezero, Gale, Gusev and Meridiani on Mars, and Artemis III regions, the Shackleton–de
Gerlache ridge and lava-tube pits on the Moon. For each pair it reports the similarity per dimension, the progress from
a typical Earth place toward the target, and Earth's limits (pressure, gravity, radiation) as gaps. Key
result: Bolivia's Siloli desert scores 61/100 against Gale crater, within one point of Atacama–Yungay, a classic analog. We do
not hide weaknesses: missing data is never filled in, scores are withheld below 40% data coverage (still the case for
the lunar south pole), and our weak validation (AUC 0.56) is published as is. A low-cost ESP32 field box
measures the place, a web station checks each sensor against independent references, and a phone turns the site into a
map where you drive a rover under Mars or Moon gravity.

## Link to Project Demo
https://github.com/CamiloNunezArroyo/sealometro/blob/main/docs/demo/Sealometro_slides.pdf

(7 slides, English, real screenshots of the app; NASA stickers on the box photo are blurred.)

## Link to Final Project
https://seal-box.web.app/?lang=en

## Detailed Project Description
**Live app (no login):** https://seal-box.web.app/?lang=en · **Open code:** https://github.com/CamiloNunezArroyo/sealometro

**What it does.** Sealometro answers three questions about a place on Earth: How similar is it to one specific site on
Mars or the Moon? How far does it go from a typical Earth place toward that site? Where does the analogy break down?

**How it works.**
- **Similarity engine (Python).** Each place and each target is described by dimensions: mean temperature, day–night
  range, rain, soil moisture, wind, vegetation (NDVI), albedo, slope and roughness, mineral classes. Per dimension a
  Gaussian kernel gives a similarity; the Index of Analogy is a weighted mean over the dimensions that have data.
- **Progress instead of a zero.** Even on the high Altiplano Earth's air is far too thick (at Siloli, 88 times
  Jezero's pressure), so a plain distance gives every place a zero. We measure the share of the way from the median Earth place to the target: Sucre covers
  about 6% of the way to Jezero's pressure, and Siloli's soil is drier than 92% of our Earth reference sample.
- **Gaps stay gaps.** Gravity, atmosphere and pressure are shown as numbers Earth cannot reach and are never scored.
  Radiation dose is shown as "pending" because we have not yet verified a source.
- **Field box.** An ESP32 with BME280, GUVA-S12SD UV, light, MQ gas and MPU-6050 sensors and an LCD sends a reading
  every 0.5 s over Wi-Fi (median upload 0.4 s, measured). The station page grades each sensor against independent
  references (Open-Meteo weather, Copernicus DEM) and computes the analogy of the measured place with the same math as
  the engine, checked by tests against the Python engine.
- **Playable place.** Phone photos and a 10-second video (indoors), or GPS, OpenStreetMap and relief (outdoors), build a
  map of the real place where you drive a rover with Mars or Moon gravity. The image analysis is simple and
  explainable; no AI model is involved.

**What we found.**
- Against Gale crater, the known analog Atacama–Yungay ranks first (61.2/100) and the Bolivian candidate Siloli desert
  is within one point of it (60.6/100), staying in the top 3 in 98% of 2,000 Monte Carlo runs that vary our weights and the data
  uncertainty. Namib–Sossusvlei follows (60/100). These scores use 56% of the weighted dimensions.
- Against Jezero, Siloli is second (46/100) behind Atacama–Yungay (57/100).

**Where it breaks down (our own limits).**
- Validation: known analogs versus 300 random land points give AUC 0.56 for global Mars (90% interval 0.45–0.68, 13
  known analogs). For Gale and Jezero alone it is not better than chance (0.44 and 0.46). The engine recognizes
  extreme-climate analogs but not yet geological ones, because the random points have no mineral data.
- Six of the 12 targets (the three Artemis III regions, Shackleton–de Gerlache, global Moon and the Arcadia ice
  region) get no score yet: coverage is below our 40% minimum or the target values are only estimates. The engine says
  so and shows the gaps only.
- Climate comes from a coarse grid (about 50 km). Weights and tolerances are our design decisions, labelled as such.
- The sensors are low-cost, so each one is graded against a reference before its reading is used.

**Benefits and what we hope to achieve.** Point mission teams and field scientists to lesser-known, cheaper analog
candidates beyond the famous ones, starting with the Bolivian Altiplano; teach what makes Mars and the Moon different,
not only what looks similar (three reading levels: ages 8–12, 13–17 and 18+, in English and Spanish); and let any
school check satellite data with its own instrument. Next steps: mineral and terrain data for the random sample, and
LRO Diviner and LOLA data to score the lunar south pole.

**Why it is creative.** One "Mars-like" score hides the science. We separate similarity, progress and gaps, keep
missing data visible, and close the loop from satellite data to a field measurement to a place you can play in.

**Tools.** Python 3.11 (numpy, pandas, scipy, scikit-learn, rasterio, pydantic, typer, pytest, h5py); TypeScript,
React 18, Vite, Three.js (104 automated tests in the web app); ESP32 with Arduino core 3.x, ArduinoJson, Adafruit
BME280; Firebase Realtime Database and Hosting; Web Serial.

**Prior work and AI.** The rover game started as a prototype the team made a few days before the hackathon. The
engine, field box, station page and integration were built during it. We used Claude (Anthropic) as an assistant for
code, source checking and drafting; files carry an AI-assistance header and the log is in `docs/AI_USE.md`. No
AI-generated images, audio or video. No NASA logos.

## Use of Super Intelligence (SI)
The guide says this answer is for data collection and is not shown to judges; judges do see the AI indicators inside
the project. Answer "Yes" and paste:

> Yes. We used Claude (Anthropic), a large language model, as an assistant to write and debug code (Python engine, web
> app, ESP32 firmware), to find and check data sources, and to draft and translate documentation and these texts. The
> idea, the design decisions (dimensions, weights, tolerances), the hardware and the field measurements are the team's.
> AI-assisted source files carry the header "Hecho con asistencia de IA (Claude)" ("made with AI assistance"), the app's
> Credits and How-it-works pages state it, and the full log is in docs/AI_USE.md in the repository. We used no
> AI-generated images, audio or video, and no NASA branding. The product itself does not use machine-learning models.

If the form shows checkboxes (labels may differ): tick code, text and research assistance. Do not tick image, audio
or video generation. Do not tick "did not use".

## NASA Data (Link Text → Link URL), most important first
| Link Text | Link URL |
|---|---|
| NASA POWER (climate: temperature, humidity, pressure, rain, wind, UV, soil wetness) | https://power.larc.nasa.gov/ |
| MODIS land products via ORNL DAAC MODIS Web Service (NDVI, land surface temperature, albedo) | https://modis.ornl.gov/data/modis_webservice.html |
| EMIT L2B Estimated Mineral Identification (EMITL2BMIN v002) | https://lpdaac.usgs.gov/products/emitl2bminv002/ |
| NASA Common Metadata Repository (CMR) search | https://cmr.earthdata.nasa.gov/search/ |
| Mars 2020 MEDA surface pressure, published results (Sánchez-Lavega et al. 2023) | https://doi.org/10.1029/2022JE007480 |
| Mars 2020 MEDA air temperature, published results (Munguira et al. 2023) | https://doi.org/10.1029/2022JE007559 |
| Mars 2020 MEDA winds, published results (Viúdez-Moreiras et al. 2022) | https://doi.org/10.1029/2022JE007523 |
| Mars 2020 MEDA humidity and albedo, published results (Polkko et al. 2023) | https://doi.org/10.1029/2022JE007447 |
| Curiosity CheMin minerals at Yellowknife Bay, published results (Vaniman et al. 2014) | https://doi.org/10.1126/science.1243480 |
| LROC lunar pits, published results (Robinson et al. 2012) | https://doi.org/10.1016/j.pss.2012.05.008 |
| NSSDC Mars Fact Sheet | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html |
| NSSDC Moon Fact Sheet | https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html |
| NSSDC Earth Fact Sheet | https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html |
| NASA Earth Observatory, Measuring Vegetation (NDVI) | https://earthobservatory.nasa.gov/features/MeasuringVegetation/measuring_vegetation_2.php |

Changes from v1: reordered (Earth datasets, then Mars and Moon mission results, then fact sheets); the mission papers
are labelled "published results" so nobody reads them as raw PDS downloads; "wind" added to POWER; the NSSDC Earth
Fact Sheet added because `ranking.json` already cites it for gravity and atmosphere.

## Space Agency Partner & Other Data (Link Text → Link URL), partners first
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

No changes to the entries. ESA and JAXA are official 2026 Space Agency Partners, so they stay at the top. This field
is also the "References" list that the originality checkbox refers to: if the team used any other library, photo or
text, add it here before submitting.

## Project Submission Verification
The team leader ticks both boxes personally after reading the guide, the terms and the privacy policy.

---

## Demo recommendation (not made yet)

Rules confirmed in the official guide: video of 30 seconds or less, or at most 7 slides including title and intro;
English (a video may be spoken in another language with English subtitles); public link with no login; going over the
limit makes the project ineligible. Nothing in the demo may show images, video, audio or other likeness of anyone under
18. No NASA logos.

The guide also asks slide decks to include the team name, the names of team members and the challenge. Because most of
the team is under 18, the team leader should decide how to handle names (for example team name plus roles, or names
of adult members only) and may want to ask the Local Lead. The demo should carry no voice of a minor: use screen
recordings with subtitles and, if narration is wanted, an adult voice.

### Option A: 30-second video (screen recording plus the box on a table, hands only)
| Time | On screen | English subtitle |
|---|---|---|
| 0:00–0:03 | Title card: "Sealometro", team name, challenge name | Team Seal, Sucre, Bolivia. Challenge: Earth analogs of the Moon and Mars. |
| 0:03–0:07 | App home, headline | No place on Earth is Mars. But some go a long way there. |
| 0:07–0:13 | Ranking for Gale crater; Siloli next to Atacama | Our open engine ranks 41 Earth places against 12 Mars and Moon targets with NASA and ESA data. Bolivia's Siloli desert comes within one point of Atacama for Gale crater. |
| 0:13–0:18 | Site card: progress bars, then the gaps panel | It shows how far each place goes, and where Earth cannot follow: pressure, gravity, radiation. Missing data is never filled in. |
| 0:18–0:23 | Field box LCD and the station page with live readings | A low-cost sensor box measures the place live; each sensor is checked against an independent reference. |
| 0:23–0:28 | Rover driving in the generated map, gravity switch to Mars | Then you drive a rover in that same place, with Mars or Moon gravity. |
| 0:28–0:30 | End card: app URL and GitHub URL | Open data, open code. Verify it. Play it. |

Keep the cut at 29 seconds to be safe. Record the app in English (`?lang=en`).

### Option B: 7 slides (if there is no time to edit video)
1. **Title.** Sealometro; tagline "How far toward Mars does your place go?"; team name, Sucre, Bolivia; challenge name.
2. **The problem.** Earth analogs are used to test missions, yet a plain comparison gives every Earth place a zero
   (pressure about 100 times too high) and "looks like Mars" is not science. One sentence, one picture of the app.
3. **Our idea.** Three outputs per place and target: similarity, progress from a typical Earth place, and gaps.
   Screenshot of a site card with the progress bars.
4. **Data.** NASA POWER, MODIS, EMIT; published MEDA, CheMin and LROC results; ESA Copernicus DEM and Sentinel-2. 41
   places, 12 targets; every value carries its status and source. Simple pipeline diagram.
5. **Result and honesty.** Gale ranking (Atacama–Yungay 61.2, Siloli 60.6, Namib–Sossusvlei 60.5; top-3 in 98% of 2,000
   runs) next to the limits: AUC 0.56, lunar south pole not scored yet, coverage shown.
6. **From orbit to the ground to play.** Photo of the box (no people), the station page, the rover in the measured place.
7. **Why it matters and what is next.** Lesser-known analog candidates for mission tests, schools verifying satellite
   data, lunar data next. App and code links. AI use and prior-work note in small print.

Award categories this story fits best (from the guide): Best Use of Science ("best and most valid use of the
scientific method"), Best Use of Data and Local Impact.
