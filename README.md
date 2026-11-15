# Sealometro — Earth analogs of Mars and the Moon

*NASA Space Apps Challenge 2026 · Sucre, Bolivia · Challenge: "Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars".*

**Live app (no login):** https://seal-box.web.app/?lang=en · **Code:** https://github.com/CamiloNunezArroyo/sealometro

> No place on Earth is Mars. But some places go a long way there. Sealometro finds them with open NASA and partner data,
> anyone can check a place with a low-cost field box, and then drive a rover in that same place.

## What it does
1. **Similarity engine (`engine/`, Python).** Compares 41 places on Earth (Bolivia and Latin America first) with 12 concrete
   targets on Mars (Jezero, Gale, Gusev/Home Plate, Meridiani, Arcadia ice, global) and the Moon (Artemis III regions,
   Shackleton–de Gerlache ridge, lava-tube pits, global). Per dimension it gives a similarity score, the **progress
   toward Mars/Moon from a typical Earth place**, where the analogy breaks (pressure, gravity, radiation), data coverage
   and robustness. Validation against known analogs is reported as is (AUC 0.56, i.e. weak — we say so).
2. **Web app (`game/`, Vite + React + TypeScript).** Ranking, map, a card per place explained at three reading levels,
   "how it is alike and how it is not", in English and Spanish.
3. **Field box (`firmware/`, ESP32).** BME280 (air temperature, humidity, pressure), GUVA-S12SD UV, analog light, MQ gas,
   MPU-6050 tilt and an LCD. It sends a reading every 0.5 s over Wi-Fi to Firebase (≈0.4 s upload, measured), or over USB.
   The **station page** (`/#/estacion`) checks every sensor against independent references (Open-Meteo weather,
   Copernicus DEM) and shows the measured-vs-reference difference.
4. **Analogy % on site.** With the place's GPS (from a phone), the station page downloads the NASA POWER climatology and
   computes the similarity to each Mars/Moon target with the **same math as the engine** (verified in tests against the
   Python engine), plus the "progress" on gaps such as air pressure.
5. **Playable place.** Photos and a 10 s video from the phone (indoors) or GPS + OpenStreetMap + relief (outdoors) build a
   map of the real place where you drive a rover with Mars or Moon gravity.

## Data honesty
Every number is a `Value` with `status` (measured / modeled / literature / derived / estimated / design / pending), source
and reference. Missing data stays `pending` and is **not** counted; scores report their **coverage**. Weights and
tolerances are our design decisions and are labelled as such.

## Run it
```bash
# engine
cd engine && pip install -r requirements.txt
python -m seal fetch --sites sites/sites.yaml && python -m seal score --profile todos
python -m seal validate && python -m seal export --to ../data/shared/ranking.json
pytest -q
# web app
cd game && npm install && npm run dev        # http://localhost:5173
npx tsc --noEmit && npx vitest run && npm run build
# firmware: open firmware/seal_box/seal_box.ino in Arduino IDE (ESP32 core 3.x);
# copy secrets.example.h to secrets.h and fill in Wi-Fi and Firebase settings.
```

## Use of AI (Super Intelligence) — disclosure
The team used **Claude (Anthropic)** as an assistant to write and debug code (engine, web app, firmware), to search and
check sources, and to draft documentation. The team reviewed, made the decisions and can explain every part. Files
written with AI assistance carry the header `Hecho con asistencia de IA (Claude)` ("made with AI assistance"), and the
full log is in [`docs/AI_USE.md`](docs/AI_USE.md). **No AI-generated images, audio or video** are used: photos are real
(Wikimedia Commons, with author and license) or taken by the team. No NASA logos or branding are used.

## Prior work
The rover game started as a prototype the team built a few days before the hackathon. Built during the hackathon: the
similarity engine, the field box firmware, the station and phone pages, the analogy panel and the integration.

## Data and resources
NASA POWER, MODIS (ORNL DAAC), EMIT L2B minerals, NASA CMR, NSSDC Mars and Moon fact sheets and published Mars 2020 MEDA,
Curiosity REMS/CheMin and LROC results; ESA Copernicus DEM GLO-30/90 and Sentinel-2; JAXA SELENE (via Ohtake et al. 2009);
Open-Meteo; OpenStreetMap (ODbL) via Overpass; Wikimedia Commons; Firebase. Full list with links in
[`docs/SUBMISSION_EN.md`](docs/SUBMISSION_EN.md). Project documentation is mostly in Spanish (`docs/`).

*Not affiliated with or endorsed by NASA or ESA.*
