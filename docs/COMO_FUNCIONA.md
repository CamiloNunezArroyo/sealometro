# Cómo "ve" el motor los datos (explicación corta para el equipo y el pitch)

1. **Le damos un lugar** → nombre y coordenadas (lat, lon) con su fuente. La caja de campo da las coordenadas por GPS.
2. **El motor le pregunta a los satélites por ese punto**, por internet, a servicios públicos:
   - **NASA POWER** → temperatura media, máxima y mínima, presión, humedad, viento, lluvia, radiación solar, índice UV
     y albedo. Es un promedio de muchos años sobre una celda de unos 50 km → describe la región, no la piedra exacta.
   - **Copernicus DEM 30 m (ESA, en AWS)** → recorta un cuadrado de 6 × 6 km alrededor del punto → altura, pendientes y
     rugosidad (qué tan accidentado es el terreno para un rover).
   - Más tarde: **MODIS** (temperatura de la superficie de día y de noche, vegetación), **EMIT** (minerales),
     **SMAP** (humedad del suelo).
   Cada número que vuelve se guarda con su etiqueta: de dónde salió, cuándo y qué tan confiable es.
3. **Del otro lado, la Luna y Marte.** Para cada sitio objetivo (Gale, Jezero, regiones Artemis III…) el motor necesita
   pocos números (temperatura, presión, pendiente, UV, minerales). Salen de instrumentos de la NASA archivados en el
   **PDS**: LRO (LOLA relieve, Diviner temperatura) en la Luna; Curiosity (REMS: presión, temperatura, UV medidos en el
   suelo), MOLA/HiRISE (relieve) y CRISM (minerales) en Marte. En el MVP se usan los valores **publicados** de esos
   instrumentos, con su referencia; de noche se pueden extraer algunos directo de los archivos del PDS.
4. **Comparación dimensión por dimensión** → para cada dimensión, qué tan cerca está el lugar del objetivo (0 a 100 %),
   cuánto "camino hacia Marte" recorre comparado con el resto de la Tierra y en qué percentil terrestre cae.
5. **Puntaje por uso** (rover, agua/hielo, astrobiología, hábitat) + **el factor que más lo limita**.
6. **Pruebas de confianza**:
   - Validación: ¿el motor pone arriba, solo, los análogos famosos (Atacama, Valles Secos…)?
   - Robustez: si cambiamos los pesos 2000 veces, ¿el ranking aguanta?
7. **Brechas**: lo que la Tierra no puede imitar (gravedad, presión, radiación), con números.
8. **Salida**: `ranking.json` (lo leen la web y el juego), fichas en 3 niveles de lectura y gráficos.
9. **Con la caja**: lo que mide la caja reemplaza al satélite en ese punto (`measured`) y se muestran juntos:
   "el satélite dice X, nosotros medimos Y".
