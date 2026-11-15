# Plan de la hackathon — NASA Space Apps Sucre 2026

> Horario oficial de la convocatoria. Defensa: **domingo desde las 14:00, 3 min de pitch + 2 min de preguntas.**
> Entrega global: **domingo 23:59 (hora local)**. Pero conviene tenerla lista **antes de la defensa**.

## Regla de oro
Cuatro piezas, **una historia**. Si a las 22:30 del sábado una pieza no conecta con las otras, se recorta.
Mejor 3 piezas que funcionan juntas que 4 sueltas. Orden de prioridad si falta tiempo:
**motor (validez) > integración caja→juego (la demo) > web didáctica > extras del juego.**

## Roles sugeridos (ajustar a lo que sabe cada uno)
| Rol | Qué entrega | Herramienta |
|---|---|---|
| A. Motor (ciencia + datos), 2 personas | `engine/`, ranking, validación, gráficos | Claude Code (Fable para la metodología, Opus para el código) |
| B. Caja de campo | firmware ESP32, caja física, prueba de campo | Claude Code (Opus) + Arduino IDE |
| C. Juego + web | integrar `ranking.json`, fichas en 3 niveles, "Mi lugar" | Claude Code (Opus) |
| D. Historia y entrega | pitch de 3 min, video de 30 s con subtítulos en inglés, página en inglés, preguntas del jurado | Proyecto de Claude (Fable para atacar el pitch) |
El líder coordina, integra y hace las demos. Nadie trabaja más de 2 h sin hacer merge.

## Bloques
### Sábado
**Arranque (1 h, ya mismo)**
- [ ] Preguntar al Local Lead (Beltran, WhatsApp de la convocatoria) si se puede usar el **prototipo previo del juego**
      declarándolo como tal. Hacerlo por escrito y guardar la respuesta.
- [ ] Repo en GitHub **público** con `CLAUDE.md` + `docs/`; mover el juego a `game/`.
- [ ] Crear el borrador del proyecto en spaceappschallenge.org (nombre, equipo, reto).
- [ ] Crear cuentas **NASA Earthdata** (gratis, 5 min) para quien haga el motor (EMIT, MODIS).
- [ ] ¿Hay Python en las PCs? Si no: Google Colab. Probar `npm run dev` del juego en la PC de demo.
- [ ] Probar cada sensor **por separado** (sketch de ejemplo de cada librería) antes de juntarlos.

**Sprint 1 (hasta el refrigerio de las 19:00)**
- A: pasos 1–4 de `MOTOR_SIMILITUD.md §8` → primer ranking con clima y terreno reales.
- B: todos los sensores en un solo sketch → JSON por Wi-Fi (ver `CAJA_CAMPO.md`).
- C: el juego lee `data/shared/ranking.json` (aunque sea de prueba) y muestra el ranking.
- D: guion del pitch v1 y lista de 10 preguntas difíciles con respuesta.
- **Todos, de 14:00 a 16:00 (sol alto): PRUEBA DE CAMPO AL AIRE LIBRE con la caja**, en 2–3 puntos distintos
  (asfalto, tierra, pasto). La defensa será adentro: sin estos datos grabados, el UV y la luz darán ~0.
  Grabar video de la caja midiendo (sin caras de menores).

**Sprint 2 (20:00–23:00): integración de punta a punta**
- Caja → JSON → motor (`python -m seal field`) → % de analogía → sitio nuevo en el juego con relieve real por GPS.
- 22:30: **congelar el MVP.** Subirlo a git con etiqueta `mvp`.
- **23:00 simulacro:** pedir al jurado del simulacro que ataque la validez. Anotar todo.

**Noche (00:00–06:00), con turnos de sueño de 2 h**
- A: modo descubrimiento (mapa de calor de Bolivia), robustez, MODIS/EMIT en el top 5, mapa de parecidos, cuadrante
  impostor/oculto.
- C: fichas en 3 niveles, modo misión con objetivos basados en el perfil del sitio.
- D: video de 30 s (inglés o con subtítulos en inglés), página del proyecto en inglés, `docs/AI_USE.md`.

### Domingo
- 06:00 simulacro 2 → corregir.
- 08:00–11:00 solo arreglos y pulido. **11:00: congelar el código.**
- 11:00–12:00 terminar la página global (todos los campos), probar los enlaces en una ventana privada.
- 12:00–14:00 almuerzo + **ensayar el pitch 5 veces cronometrado** + demo de respaldo en video por si falla el Wi-Fi.
- 14:00 defensa. Después: revisar y presionar **"Submit for Judging"** (es definitivo) antes de las 23:59.

## Pitch de 3 minutos (esqueleto)
| Tiempo | Contenido |
|---|---|
| 0:00–0:20 | Gancho: "Ningún lugar de la Tierra es Marte… pero algunos recorren gran parte del camino. ¿Cuáles? ¿Y cómo lo sabemos?" |
| 0:20–0:50 | Problema: los análogos conocidos son pocos y se eligen a ojo; Bolivia casi no aparece. |
| 0:50–1:40 | Motor: datos NASA + ESA + CSA + JAXA vs sitios reales (Artemis III, Gale, Jezero). Validación: redescubre los análogos famosos (AUC). Hallazgo boliviano con su "en qué sí y en qué no". |
| 1:40–2:30 | Demo en vivo: caja → % → manejar el rover en ESE lugar. |
| 2:30–3:00 | Impacto: ciencia ciudadana que verifica satélites, educación por edades, mapa mundial abierto. Cierre. |

## Preguntas probables del jurado (preparar respuesta de 20 s cada una)
1. ¿Por qué esos pesos? → Robustez: P(top-3) en 2000 escenarios.
2. ¿Cómo saben que funciona? → Validación con análogos conocidos (AUC) + controles negativos.
3. La presión de la Tierra nunca se parece a la de Marte. → Progreso y percentil; las brechas se declaran.
4. ¿Qué tan buenos son sus sensores? → Rangos, calibración contra POWER/MODIS, limitaciones (TEMT6000 y GUVA se saturan al sol; se marca y se declara).
5. ¿Qué hicieron en la hackathon y qué ya existía? → Respuesta honesta y concreta.
6. ¿Qué hizo la IA y qué hicieron ustedes? → `docs/AI_USE.md`; cada integrante explica su pieza.
7. ¿Por qué un 30 m de DEM sirve para un rover? → Escala declarada; la caja aporta la escala de 30 cm.

## Checklist de la entrega global (todo en inglés)
- [ ] Project Name · High-Level Summary · Detailed Description
- [ ] Demo: video ≤ 30 s **con subtítulos en inglés** (o ≤ 7 diapositivas) en enlace público
- [ ] Link to Final Project: repo público (README en inglés)
- [ ] NASA Data · Space Agency Partner & Other Data (Copernicus/ESA, RADARSAT/CSA, AW3D30/JAXA si se usa)
- [ ] Use of Artificial Intelligence (qué, dónde y cómo)
- [ ] Nada de caras, voces ni nombres de menores de 18; nada de logos de la NASA en material generado con IA
- [ ] Enlaces probados en ventana privada · "Submit for Judging" antes de las 23:59 del domingo
