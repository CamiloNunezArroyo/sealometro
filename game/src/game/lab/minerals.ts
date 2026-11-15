// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Catálogo de minerales del laboratorio (lógica pura, testeable).
// - La COMPOSICIÓN se calcula de la fórmula ideal con los pesos atómicos estándar (IUPAC): status "derived".
//   Una muestra real tiene impurezas y varía: se dice en pantalla.
// - Las pruebas (ácido, agua, horno, imán, dureza) son propiedades conocidas de cada mineral (manuales de mineralogía).
// - Las conexiones con Marte y la Luna citan la misión o el artículo (sin DOI inventados).

export const ATOMIC: Record<string, number> = { // IUPAC, pesos atómicos convencionales
  H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085,
  S: 32.06, Cl: 35.45, K: 39.098, Ca: 40.078, Ti: 47.867, Fe: 55.845,
};
/** Elementos que ve un espectrómetro de rayos X como el APXS de los rovers (del sodio para arriba). */
export const XRF_VISIBLE = new Set(["Na", "Mg", "Al", "Si", "S", "Cl", "K", "Ca", "Ti", "Fe"]);

/** Cuenta átomos de una fórmula: admite paréntesis, decimales e hidratos con "·" (p. ej. CaSO4·2H2O). */
export function parseFormula(f: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of f.split("·")) {
    const m = /^(\d+(?:\.\d+)?)?(.*)$/.exec(part.trim())!;
    const mult = m[1] ? Number(m[1]) : 1;
    const counts = parseGroup(m[2]);
    for (const [el, n] of Object.entries(counts)) out[el] = (out[el] ?? 0) + n * mult;
  }
  return out;
}
function parseGroup(s: string): Record<string, number> {
  const stack: Record<string, number>[] = [{}];
  let i = 0;
  const num = () => { const m = /^\d+(?:\.\d+)?/.exec(s.slice(i)); if (!m) return 1; i += m[0].length; return Number(m[0]); };
  while (i < s.length) {
    const c = s[i];
    if (c === "(") { stack.push({}); i++; }
    else if (c === ")") {
      i++;
      const n = num(), top = stack.pop()!, cur = stack[stack.length - 1];
      for (const [el, k] of Object.entries(top)) cur[el] = (cur[el] ?? 0) + k * n;
    } else {
      const m = /^[A-Z][a-z]?/.exec(s.slice(i));
      if (!m) throw new Error(`fórmula inválida: ${s}`);
      i += m[0].length;
      if (!(m[0] in ATOMIC)) throw new Error(`elemento sin peso atómico: ${m[0]}`);
      const cur = stack[stack.length - 1];
      cur[m[0]] = (cur[m[0]] ?? 0) + num();
    }
  }
  return stack[0];
}
/** Porcentaje en masa de cada elemento (suma 100). */
export function composition(formula: string): { el: string; pct: number }[] {
  const at = parseFormula(formula);
  const mass = Object.entries(at).map(([el, n]) => [el, n * ATOMIC[el]] as const);
  const tot = mass.reduce((a, [, m]) => a + m, 0);
  return mass.map(([el, m]) => ({ el, pct: (100 * m) / tot })).sort((a, b) => b.pct - a.pct);
}

type L = { es: string; en: string };
export type Acid = "fast" | "slow" | "none";
export type Water = "dissolves" | "swells" | "slightly" | "none";
export type Gas = "H2O" | "CO2" | "SO2" | "O2" | "melts";
export type Magnet = "strong" | "weak" | "none";
export interface Mineral {
  id: string; name: L; formula: string; formulaShown?: string; group: L; color: string;
  mohs: number; acid: Acid; water: Water; heat: Gas[]; magnet: Magnet;
  earth: L; space: L; spaceRef: string;
}

const G = {
  chl: { es: "cloruro", en: "chloride" }, sul: { es: "sulfato", en: "sulfate" }, carb: { es: "carbonato", en: "carbonate" },
  sil: { es: "silicato", en: "silicate" }, ox: { es: "óxido", en: "oxide" }, sulf: { es: "sulfuro", en: "sulfide" },
  el: { es: "elemento nativo", en: "native element" }, bor: { es: "borato", en: "borate" }, nit: { es: "nitrato", en: "nitrate" },
  per: { es: "perclorato", en: "perchlorate" }, ice: { es: "hielo", en: "ice" }, clay: { es: "arcilla", en: "clay" },
};

export const MINERALS: Mineral[] = [
  { id: "halita", name: { es: "Halita (sal de roca)", en: "Halite (rock salt)" }, formula: "NaCl", group: G.chl, color: "#efe9e2",
    mohs: 2.5, acid: "none", water: "dissolves", heat: [], magnet: "none",
    earth: { es: "Es la costra blanca de los salares de Uyuni y Coipasa.", en: "It is the white crust of the Uyuni and Coipasa salt flats." },
    space: { es: "Orbitadores encontraron cientos de depósitos de cloruros en Marte: restos de agua que se evaporó.", en: "Orbiters found hundreds of chloride deposits on Mars: traces of evaporated water." },
    spaceRef: "Osterloo et al. 2008, Science" },
  { id: "silvita", name: { es: "Silvita", en: "Sylvite" }, formula: "KCl", group: G.chl, color: "#f1d9d2",
    mohs: 2, acid: "none", water: "dissolves", heat: [], magnet: "none",
    earth: { es: "Se forma al evaporarse salmueras ricas en potasio, como las de los salares andinos.", en: "It forms when potassium-rich brines evaporate, like those of Andean salt flats." },
    space: { es: "En Marte hay cloruros, pero la silvita en particular no está confirmada: es un buen ejemplo de lo que aún no sabemos.", en: "Mars has chlorides, but sylvite itself is not confirmed: a good example of what we still don't know." },
    spaceRef: "—" },
  { id: "yeso", name: { es: "Yeso", en: "Gypsum" }, formula: "CaSO4·2H2O", group: G.sul, color: "#f3efe6",
    mohs: 2, acid: "none", water: "slightly", heat: ["H2O"], magnet: "none",
    earth: { es: "Aparece en salares y lagos salados que se secan, como el lecho del lago Poopó.", en: "It appears in drying salt lakes and flats, such as the Lake Poopó bed." },
    space: { es: "Curiosity encontró vetas blancas de sulfato de calcio en el cráter Gale: agua circuló por grietas de la roca.", en: "Curiosity found white calcium-sulfate veins in Gale crater: water flowed through rock cracks." },
    spaceRef: "Nachon et al. 2014, JGR Planets" },
  { id: "anhidrita", name: { es: "Anhidrita", en: "Anhydrite" }, formula: "CaSO4", group: G.sul, color: "#dfe3ea",
    mohs: 3.5, acid: "none", water: "slightly", heat: [], magnet: "none",
    earth: { es: "Es yeso sin agua: se forma con más calor o más sequedad.", en: "It is water-free gypsum: it forms with more heat or dryness." },
    space: { es: "En Gale, el instrumento CheMin de Curiosity distinguió yeso, basanita y anhidrita en las mismas vetas.", en: "At Gale, Curiosity's CheMin told apart gypsum, bassanite and anhydrite in the same veins." },
    spaceRef: "Vaniman et al. 2018, American Mineralogist" },
  { id: "jarosita", name: { es: "Jarosita", en: "Jarosite" }, formula: "KFe3(SO4)2(OH)6", group: G.sul, color: "#c9a245",
    mohs: 3, acid: "none", water: "none", heat: ["H2O", "SO2"], magnet: "none",
    earth: { es: "Típica del río Tinto (España), donde el agua es muy ácida por la minería de sulfuros.", en: "Typical of Río Tinto (Spain), where water is very acidic from sulfide mining." },
    space: { es: "Opportunity la encontró en Meridiani: prueba de agua ácida en el pasado de Marte.", en: "Opportunity found it at Meridiani: evidence of acidic water in Mars's past." },
    spaceRef: "Klingelhöfer et al. 2004, Science" },
  { id: "epsomita", name: { es: "Epsomita", en: "Epsomite" }, formula: "MgSO4·7H2O", group: G.sul, color: "#f4f6f8",
    mohs: 2, acid: "none", water: "dissolves", heat: ["H2O"], magnet: "none",
    earth: { es: "Sal amarga que cristaliza en lagos salados y cuevas secas.", en: "A bitter salt that crystallizes in salt lakes and dry caves." },
    space: { es: "Los sulfatos de magnesio hidratados son comunes en Marte según los espectrómetros en órbita.", en: "Hydrated magnesium sulfates are common on Mars according to orbital spectrometers." },
    spaceRef: "OMEGA (Mars Express) y CRISM (MRO)" },
  { id: "ulexita", name: { es: "Ulexita (piedra televisión)", en: "Ulexite (TV stone)" }, formula: "NaCaB5O6(OH)6·5H2O", group: G.bor, color: "#f6f2ea",
    mohs: 2.5, acid: "none", water: "slightly", heat: ["H2O"], magnet: "none",
    earth: { es: "Se extrae en salares del Altiplano. Sus fibras llevan la luz: ¡muestra la imagen de lo que tiene abajo!", en: "Mined in Altiplano salt flats. Its fibers carry light: it shows the image of what lies beneath!" },
    space: { es: "Curiosity detectó boro en vetas de Gale; el boro ayuda a formar moléculas importantes para la vida.", en: "Curiosity detected boron in Gale veins; boron helps form molecules important for life." },
    spaceRef: "Gasda et al. 2017, Geophysical Research Letters" },
  { id: "calcita", name: { es: "Calcita", en: "Calcite" }, formula: "CaCO3", group: G.carb, color: "#f2e8d5",
    mohs: 3, acid: "fast", water: "none", heat: ["CO2"], magnet: "none",
    earth: { es: "Forma la caliza de Torotoro y las estalactitas de la caverna de Umajalanta.", en: "It makes the limestone of Torotoro and the stalactites of Umajalanta cave." },
    space: { es: "La sonda Phoenix detectó carbonato de calcio en el suelo de Marte.", en: "The Phoenix lander detected calcium carbonate in the Martian soil." },
    spaceRef: "Boynton et al. 2009, Science" },
  { id: "aragonito", name: { es: "Aragonito", en: "Aragonite" }, formula: "CaCO3", group: G.carb, color: "#e8dcc6",
    mohs: 3.5, acid: "fast", water: "none", heat: ["CO2"], magnet: "none",
    earth: { es: "Misma fórmula que la calcita, otra forma de cristal. Aparece en cuevas y en conchas.", en: "Same formula as calcite, different crystal shape. Found in caves and shells." },
    space: { es: "Para distinguirlo de la calcita hace falta difracción de rayos X, como CheMin en Curiosity.", en: "Telling it from calcite needs X-ray diffraction, like CheMin on Curiosity." },
    spaceRef: "Blake et al. 2012, Space Science Reviews (CheMin)" },
  { id: "dolomita", name: { es: "Dolomita", en: "Dolomite" }, formula: "CaMg(CO3)2", group: G.carb, color: "#e9e0d0",
    mohs: 3.5, acid: "slow", water: "none", heat: ["CO2"], magnet: "none",
    earth: { es: "Roca de muchas montañas sedimentarias; con ácido solo burbujea si está en polvo.", en: "Rock of many sedimentary mountains; with acid it only fizzes when powdered." },
    space: { es: "El meteorito marciano ALH84001 tiene glóbulos de carbonatos de calcio, magnesio y hierro.", en: "Martian meteorite ALH84001 holds globules of calcium-magnesium-iron carbonates." },
    spaceRef: "McKay et al. 1996, Science" },
  { id: "magnesita", name: { es: "Magnesita", en: "Magnesite" }, formula: "MgCO3", group: G.carb, color: "#f0ede6",
    mohs: 4, acid: "slow", water: "none", heat: ["CO2"], magnet: "none",
    earth: { es: "Se forma cuando el agua altera rocas ricas en olivino.", en: "It forms when water alters olivine-rich rocks." },
    space: { es: "Perseverance encontró en Jezero rocas de olivino alteradas a carbonatos.", en: "Perseverance found olivine rocks altered to carbonates in Jezero." },
    spaceRef: "Farley et al. 2022, Science" },
  { id: "cuarzo", name: { es: "Cuarzo", en: "Quartz" }, formula: "SiO2", group: G.sil, color: "#e8e4dc",
    mohs: 7, acid: "none", water: "none", heat: [], magnet: "none",
    earth: { es: "El mineral más común de las arenas de los desiertos: raya el vidrio.", en: "The most common mineral in desert sands: it scratches glass." },
    space: { es: "En Marte el cuarzo es raro; la sílice aparece sobre todo como ópalo.", en: "Quartz is rare on Mars; silica shows up mostly as opal." },
    spaceRef: "Revisión de mineralogía marciana (Ehlmann y Edwards 2014, Annual Review)" },
  { id: "opalo", name: { es: "Ópalo (sílice hidratada)", en: "Opal (hydrated silica)" }, formula: "SiO2·H2O", formulaShown: "SiO2·nH2O (n≈1)", group: G.sil, color: "#e6eef0",
    mohs: 5.5, acid: "none", water: "none", heat: ["H2O"], magnet: "none",
    earth: { es: "Se deposita en géiseres y aguas termales, como en Sol de Mañana.", en: "It is deposited by geysers and hot springs, as at Sol de Mañana." },
    space: { es: "Spirit encontró suelo casi de sílice pura junto a Home Plate: señal de aguas termales antiguas.", en: "Spirit found nearly pure silica soil by Home Plate: a sign of ancient hot springs." },
    spaceRef: "Squyres et al. 2008, Science" },
  { id: "montmorillonita", name: { es: "Montmorillonita (arcilla)", en: "Montmorillonite (clay)" }, formula: "Na0.33Al1.67Mg0.33Si4O10(OH)2", group: G.clay, color: "#c9b79c",
    mohs: 1.5, acid: "none", water: "swells", heat: ["H2O"], magnet: "none",
    earth: { es: "Arcilla que se hincha con agua; abunda en suelos de lagos antiguos.", en: "A clay that swells with water; common in old lake soils." },
    space: { es: "Curiosity halló arcillas de este tipo (esmectitas) en Yellowknife Bay: allí hubo un lago habitable.", en: "Curiosity found clays like this (smectites) at Yellowknife Bay: a habitable lake once existed there." },
    spaceRef: "Vaniman et al. 2014, Science" },
  { id: "caolinita", name: { es: "Caolinita", en: "Kaolinite" }, formula: "Al2Si2O5(OH)4", group: G.clay, color: "#ece4d6",
    mohs: 2, acid: "none", water: "none", heat: ["H2O"], magnet: "none",
    earth: { es: "Arcilla blanca de suelos tropicales muy lavados por la lluvia, como en la Amazonía.", en: "White clay of tropical soils heavily washed by rain, as in the Amazon." },
    space: { es: "Detectada desde órbita en Marte, por ejemplo en Mawrth Vallis.", en: "Detected from orbit on Mars, for example at Mawrth Vallis." },
    spaceRef: "CRISM (Mars Reconnaissance Orbiter)" },
  { id: "hematita", name: { es: "Hematita", en: "Hematite" }, formula: "Fe2O3", group: G.ox, color: "#8e3b2a",
    mohs: 6, acid: "none", water: "none", heat: [], magnet: "weak",
    earth: { es: "Da el color rojo a muchos suelos y rocas; su raya es rojiza.", en: "It gives many soils and rocks their red color; its streak is reddish." },
    space: { es: "Opportunity encontró esferitas de hematita (los 'arándanos') en Meridiani, formadas con agua.", en: "Opportunity found hematite spherules ('blueberries') at Meridiani, formed with water." },
    spaceRef: "Squyres et al. 2004, Science" },
  { id: "goethita", name: { es: "Goethita", en: "Goethite" }, formula: "FeO(OH)", group: G.ox, color: "#9a6a2f",
    mohs: 5, acid: "none", water: "none", heat: ["H2O"], magnet: "none",
    earth: { es: "Óxido de hierro con agua: el color ocre de suelos tropicales y de minas.", en: "An iron oxide with water: the ochre color of tropical soils and mines." },
    space: { es: "Spirit la detectó en las colinas Columbia del cráter Gusev: pista de agua.", en: "Spirit detected it in the Columbia Hills of Gusev crater: a clue of water." },
    spaceRef: "Morris et al. 2006, JGR Planets" },
  { id: "magnetita", name: { es: "Magnetita", en: "Magnetite" }, formula: "Fe3O4", group: G.ox, color: "#2b2b2e",
    mohs: 6, acid: "none", water: "none", heat: [], magnet: "strong",
    earth: { es: "Forma las arenas negras de playas y volcanes: ¡se pega al imán!", en: "It makes the black sands of beaches and volcanoes: it sticks to a magnet!" },
    space: { es: "El polvo de Marte se pega a los imanes de los rovers por minerales magnéticos como este.", en: "Mars dust sticks to rover magnets because of magnetic minerals like this one." },
    spaceRef: "Experimentos de imanes de Pathfinder y MER (Goetz et al. 2005, Nature)" },
  { id: "ilmenita", name: { es: "Ilmenita", en: "Ilmenite" }, formula: "FeTiO3", group: G.ox, color: "#323033",
    mohs: 5.5, acid: "none", water: "none", heat: [], magnet: "weak",
    earth: { es: "Mineral negro de titanio en rocas volcánicas y arenas.", en: "A black titanium mineral in volcanic rocks and sands." },
    space: { es: "Abunda en los basaltos de los mares lunares traídos por Apolo 11 y 17; se estudia para sacarle oxígeno.", en: "Common in lunar mare basalts returned by Apollo 11 and 17; studied as a source of oxygen." },
    spaceRef: "Muestras Apolo 11 y 17 (NASA)" },
  { id: "olivino", name: { es: "Olivino", en: "Olivine" }, formula: "Mg1.6Fe0.4SiO4", formulaShown: "(Mg0.8Fe0.2)2SiO4", group: G.sil, color: "#7c8b3a",
    mohs: 6.5, acid: "none", water: "none", heat: [], magnet: "none",
    earth: { es: "Cristales verdes de los basaltos de Hawái y Lanzarote.", en: "Green crystals in the basalts of Hawaii and Lanzarote." },
    space: { es: "Perseverance encontró rocas muy ricas en olivino en el cráter Jezero.", en: "Perseverance found very olivine-rich rocks in Jezero crater." },
    spaceRef: "Liu et al. 2022, Science" },
  { id: "diopsido", name: { es: "Piroxeno (diópsido)", en: "Pyroxene (diopside)" }, formula: "CaMgSi2O6", group: G.sil, color: "#3f5a3e",
    mohs: 6, acid: "none", water: "none", heat: [], magnet: "none",
    earth: { es: "Mineral oscuro de los basaltos y del manto de la Tierra.", en: "A dark mineral of basalts and Earth's mantle." },
    space: { es: "Los piroxenos están entre los minerales más comunes de Marte y de la Luna.", en: "Pyroxenes are among the most common minerals on Mars and the Moon." },
    spaceRef: "Muestras Apolo; CheMin en Gale" },
  { id: "anortita", name: { es: "Anortita (plagioclasa)", en: "Anorthite (plagioclase)" }, formula: "CaAl2Si2O8", group: G.sil, color: "#ecebe6",
    mohs: 6, acid: "none", water: "none", heat: [], magnet: "none",
    earth: { es: "Feldespato de calcio, raro en la Tierra en roca casi pura.", en: "A calcium feldspar, rare on Earth as nearly pure rock." },
    space: { es: "Las tierras altas claras de la Luna son anortosita, casi pura plagioclasa: como la 'Roca Génesis' de Apolo 15.", en: "The bright lunar highlands are anorthosite, almost pure plagioclase: like Apollo 15's 'Genesis Rock'." },
    spaceRef: "Muestra 15415 de Apolo 15 (NASA)" },
  { id: "albita", name: { es: "Albita (feldespato sódico)", en: "Albite (sodium feldspar)" }, formula: "NaAlSi3O8", group: G.sil, color: "#f0ece4",
    mohs: 6, acid: "none", water: "none", heat: [], magnet: "none",
    earth: { es: "Feldespato muy común en granitos y en arenas.", en: "A very common feldspar in granites and sands." },
    space: { es: "Curiosity encontró feldespatos (plagioclasa) en casi todas las rocas de Gale.", en: "Curiosity found feldspars (plagioclase) in almost every Gale rock." },
    spaceRef: "CheMin, Curiosity (Bish et al. 2013, Science)" },
  { id: "ortoclasa", name: { es: "Ortoclasa (feldespato potásico)", en: "Orthoclase (potassium feldspar)" }, formula: "KAlSi3O8", group: G.sil, color: "#e8c6b4",
    mohs: 6, acid: "none", water: "none", heat: [], magnet: "none",
    earth: { es: "Es el mineral que marca el 6 en la escala de dureza de Mohs.", en: "It is the mineral that marks 6 on the Mohs hardness scale." },
    space: { es: "Curiosity halló rocas ricas en feldespato potásico en Gale, algo que no se esperaba.", en: "Curiosity found potassium-feldspar-rich rocks at Gale, which was unexpected." },
    spaceRef: "Treiman et al. 2016, JGR Planets" },
  { id: "azufre", name: { es: "Azufre nativo", en: "Native sulfur" }, formula: "S", group: G.el, color: "#e9d33a",
    mohs: 2, acid: "none", water: "none", heat: ["melts", "SO2"], magnet: "none",
    earth: { es: "Cristales amarillos en Dallol y en las fumarolas de Sol de Mañana.", en: "Yellow crystals at Dallol and in the Sol de Mañana fumaroles." },
    space: { es: "En 2024 Curiosity rompió una roca en Gediz Vallis y encontró cristales de azufre puro.", en: "In 2024 Curiosity crushed a rock in Gediz Vallis and found pure sulfur crystals." },
    spaceRef: "NASA/JPL, Curiosity, julio de 2024" },
  { id: "hielo", name: { es: "Hielo de agua", en: "Water ice" }, formula: "H2O", group: G.ice, color: "#d7ecfa",
    mohs: 1.5, acid: "none", water: "none", heat: ["melts", "H2O"], magnet: "none",
    earth: { es: "Glaciares como Vatnajökull y cuevas de hielo como Kverkfjöll.", en: "Glaciers like Vatnajökull and ice caves like Kverkfjöll." },
    space: { es: "LCROSS encontró agua en un cráter polar de la Luna en sombra permanente; Phoenix vio hielo bajo el suelo de Marte.", en: "LCROSS found water in a permanently shadowed lunar polar crater; Phoenix saw ice under the Martian soil." },
    spaceRef: "Colaprete et al. 2010, Science; Smith et al. 2009, Science" },
  { id: "perclorato", name: { es: "Perclorato de magnesio", en: "Magnesium perchlorate" }, formula: "Mg(ClO4)2·6H2O", group: G.per, color: "#f7f7f2",
    mohs: 2, acid: "none", water: "dissolves", heat: ["H2O", "O2"], magnet: "none",
    earth: { es: "En los suelos del desierto de Atacama, uno de los pocos lugares de la Tierra donde se acumula.", en: "In Atacama Desert soils, one of the few places on Earth where it builds up." },
    space: { es: "Phoenix descubrió percloratos en el suelo marciano: dificultan buscar materia orgánica.", en: "Phoenix discovered perchlorates in Martian soil: they make finding organic matter harder." },
    spaceRef: "Hecht et al. 2009, Science" },
  { id: "nitratina", name: { es: "Nitratina (salitre)", en: "Nitratine (Chile saltpeter)" }, formula: "NaNO3", group: G.nit, color: "#f4f1e9",
    mohs: 1.5, acid: "none", water: "dissolves", heat: ["melts", "O2"], magnet: "none",
    earth: { es: "El famoso salitre de Atacama, explotado desde el siglo XIX.", en: "The famous Atacama saltpeter, mined since the 19th century." },
    space: { es: "Curiosity detectó nitratos en Gale: nitrógeno que la vida podría usar.", en: "Curiosity detected nitrates at Gale: nitrogen that life could use." },
    spaceRef: "Stern et al. 2015, PNAS" },
  { id: "pirita", name: { es: "Pirita (oro de los tontos)", en: "Pyrite (fool's gold)" }, formula: "FeS2", group: G.sulf, color: "#c8b25a",
    mohs: 6.5, acid: "none", water: "none", heat: ["SO2"], magnet: "none",
    earth: { es: "Abunda en la Faja Pirítica Ibérica, cuna del río Tinto.", en: "Abundant in the Iberian Pyrite Belt, source of the Río Tinto." },
    space: { es: "Se encontraron sulfuros de hierro en meteoritos marcianos.", en: "Iron sulfides have been found in Martian meteorites." },
    spaceRef: "Lorand et al. 2015, Meteoritics & Planetary Science" },
];
export const MINERAL_BY_ID = new Map(MINERALS.map((m) => [m.id, m]));

const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", ".": "." };
/** Fórmula para mostrar, con subíndices: Mg(ClO4)2·6H2O → Mg(ClO₄)₂·6H₂O (el coeficiente del hidrato queda normal). */
export function prettyFormula(f: string): string {
  return f.replace(/([A-Za-z)])(\d+(?:\.\d+)?)/g, (_, a: string, n: string) => a + [...n].map((c) => SUB[c] ?? c).join(""));
}
