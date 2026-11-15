# EMPEZAR AQUÍ — Seal Hackathon Team

## Paso 1 · Preparar la carpeta (10 min, en la laptop del líder)
1. Descomprimir `seal-hackathon-team.zip` donde quieran (por ejemplo, en el Escritorio).
2. Copiar el juego **dentro** de `seal-hackathon-team/game/`: todo el contenido de su carpeta `rover-analogs` (la que tiene
   los datos reales descargados). Debe quedar `game/package.json`, `game/src/`, `game/public/`… Borrar `game/LEEME.txt`.
3. Comprobar que la laptop tiene: **Python 3.11+** (`python --version`), **Node** (`node --version`), **Git**
   (`git --version`) y **Claude Code** con sesión iniciada en la cuenta Pro. Si falta algo, instalarlo ya.

## Paso 2 · Subir a GitHub (5 min)
Crear un repositorio **público** llamado `seal-hackathon-team` y subir la carpeta (con GitHub Desktop o con
`git init`, `git add .`, `git commit -m "inicio"`, `git push`). El jurado global necesita un enlace público.

## Paso 3 · El motor de Python (líder, Claude Code)
1. Abrir Claude Code **en la carpeta `seal-hackathon-team`** (app de escritorio: abrir carpeta; o terminal: `cd` a la carpeta y
   escribir `claude`). Claude lee `CLAUDE.md` solo.
2. Elegir **Opus 5.5** (`/model`).
3. Abrir `docs/PROMPT_MOTOR.md`, copiar **todo lo que está debajo de la línea** y pegarlo en Claude Code.
4. En cada **PUNTO DE CONTROL**, alguien del equipo revisa y responde "sigue" o corrige. En la **Fase 2** cambiar a
   **Fable 5.2** con `/model`, y después volver a Opus.

## Paso 4 · En paralelo, el resto del equipo
- **Caja:** completar los modelos en `docs/PROMPT_FIRMWARE.md` y pegarlo en un chat de Claude (cuenta gratis) adjuntando
  `docs/CAJA_CAMPO.md`. Probar un sensor a la vez.
- **Pitch y entrega:** crear el Proyecto de Claude con `INSTRUCCIONES_PROYECTO_CLAUDE.md` (o un chat normal adjuntando
  `CLAUDE.md` y `docs/PLAN_HACKATHON.md`). Página del proyecto en spaceappschallenge.org en borrador.
- **Prueba de campo:** al aire libre (plaza o campo libre) con sol alto, idealmente **antes de las 16:00**. Grabar las
  lecturas y un video de la caja (sin caras de menores).

## Paso 5 · Horarios que no se mueven
- 22:30 congelar el MVP · 23:00 simulacro · domingo 11:00 congelar el código · 14:00 defensa ·
  **domingo 23:59: "Submit for Judging"** en spaceappschallenge.org (es definitivo).

Todo lo demás está en `docs/` (plan, diseño del motor, caja, lugares, cómo funciona).
