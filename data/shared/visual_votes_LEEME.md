# Votación visual del equipo (eje X del cuadrante "impostor vs oculto")

> Hecho con asistencia de IA (Claude). Esta votación reemplaza, por ahora, a los embeddings de imagen (DINOv2/CLIP),
> que no alcanzan a hacerse en la hackathon. El motor la marca como `estimated`.

## Cómo votar (10–15 minutos)
1. Para cada sitio de `visual_votes.csv`, abran **una foto** del lugar (Wikimedia Commons o una foto propia, sin caras
   de menores) y, en otra pestaña, una imagen de referencia del objetivo:
   - Luna: una foto de la superficie del Apollo o de LROC.
   - Marte: una foto de Curiosity o de Perseverance.
2. Cada persona vota **sin mirar el puntaje del motor** ni los votos de los demás:
   *"¿Qué tanto se PARECE a la Luna (o a Marte) a simple vista?"* 0 = nada · 5 = algo · 10 = idéntico.
3. Una fila por votante y por sitio. En `votante` pongan `votante_1`, `votante_2`… (**nunca nombres**).
   En `foto`, el enlace o el nombre del archivo que miraron.
4. Corran `python -m seal quadrant --body moon` (y `--body mars`).

## Por qué así
- Votar a ciegas evita que el puntaje del motor influya en el voto.
- El cuadrante compara "lo que parece" con "lo que miden los datos". El ejemplo a probar es el **Valle de la Luna (La Paz)**:
  ¿parece la Luna pero no lo es en los datos (impostor)?
