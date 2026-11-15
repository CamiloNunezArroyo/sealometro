Necesito verificar este dato o estos datos para el proyecto: $ARGUMENTS

1. Busca la fuente primaria (paper con DOI, ficha oficial de NASA/ESA/CSA/JAXA, dataset en PDS o Earthdata).
   Prefiere la fuente original a la divulgación. Si solo encuentras fuentes secundarias, dilo.
2. Devuelve el objeto Value listo para pegar:
   {"value", "unit", "sigma" o "range", "status", "source", "ref", "retrieved", "note"}
   con el status correcto (literature / modeled / derived / estimated) según CLAUDE.md §4.
3. Si el dato no existe en la misma magnitud física o escala que el del otro planeta, explícalo y propone cómo
   compararlo honestamente (o déjalo como `pending`).
4. Nunca inventes un número, un DOI ni una coordenada. Si no lo encuentras: `pending` y la razón.
