// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Minijuego de laboratorio: triturar la muestra, hacer pruebas (como los instrumentos de los rovers), adivinar el
// mineral y ver su descomposición química (calculada de la fórmula). Las propiedades son las conocidas de cada mineral.
import { useMemo, useState } from "react";
import { composition, MINERALS, prettyFormula, XRF_VISIBLE, type Mineral } from "./minerals";
import type { Why } from "./samples";
import { useSettings } from "../../settings";
import { num } from "../../i18n";

type Tool = "acid" | "water" | "heat" | "magnet" | "hard" | "xrf";
const COST: Record<Tool, number> = { acid: 1, water: 1, heat: 1, magnet: 1, hard: 1, xrf: 2 };
const ENERGY = 5;
const EL_COLOR: Record<string, string> = { H: "#9fd3ff", B: "#c9a0ff", C: "#5b5b5b", N: "#7fb2ff", O: "#ef5b5b", Na: "#f2b134", Mg: "#9ee37d",
  Al: "#b9c2cf", Si: "#d9a066", S: "#e9d33a", Cl: "#5ad1a0", K: "#c77dff", Ca: "#f4f1e9", Ti: "#8a9bb0", Fe: "#c0583a" };
const COLL_KEY = "seal.lab.collection";

export function readCollection(): string[] {
  try { return JSON.parse(localStorage.getItem(COLL_KEY) ?? "[]"); } catch { return []; }
}
function saveCollection(ids: string[]) { try { localStorage.setItem(COLL_KEY, JSON.stringify(ids)); } catch { /* sin almacenamiento: no pasa nada */ } }

/** Roca dibujada (polígono con facetas) que se agrieta con cada golpe. */
function Rock({ color, hits }: { color: string; hits: number }) {
  const pts = "60,8 112,30 128,82 98,124 40,128 8,86 16,30";
  if (hits >= 5) {
    return (
      <svg viewBox="0 0 136 136" className="lab-rock powder" aria-hidden="true">
        {Array.from({ length: 46 }, (_, i) => (
          <circle key={i} cx={20 + ((i * 37) % 96)} cy={96 + ((i * 13) % 26)} r={2 + (i % 4)} fill={color} stroke="#0006" strokeWidth="0.6" />
        ))}
      </svg>
    );
  }
  const cracks = ["60,8 66,60 98,124", "8,86 66,60 112,30", "16,30 50,70 40,128", "128,82 80,80 66,60"].slice(0, hits);
  return (
    <svg viewBox="0 0 136 136" className={`lab-rock hit${hits}`} aria-hidden="true">
      <polygon points={pts} fill={color} stroke="#0008" strokeWidth="2" />
      <polygon points="60,8 112,30 66,60" fill="#ffffff22" />
      <polygon points="8,86 40,128 66,60" fill="#00000022" />
      {cracks.map((c, i) => <polyline key={i} points={c} fill="none" stroke="#1a1a1a" strokeWidth="2.2" />)}
    </svg>
  );
}

export function Lab({ mineral, why, siteName, onClose }: { mineral: Mineral; why: Why; siteName: string; onClose: (identified: boolean) => void }) {
  const { lang } = useSettings();
  const L = (es: string, en: string) => (lang === "es" ? es : en);
  const [hits, setHits] = useState(0);
  const [used, setUsed] = useState<Tool[]>([]);
  const [wrong, setWrong] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const energy = ENERGY - used.reduce((a, t) => a + COST[t], 0);
  const comp = useMemo(() => composition(mineral.formula), [mineral]);
  // opciones: la correcta + 2 parecidas (mismo grupo si se puede)
  const options = useMemo(() => {
    const same = MINERALS.filter((m) => m.id !== mineral.id && m.group.es === mineral.group.es);
    const other = MINERALS.filter((m) => m.id !== mineral.id && m.group.es !== mineral.group.es);
    let s = 0;
    for (const ch of mineral.id) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    const pick = (arr: Mineral[]) => arr.length ? arr.splice(s % arr.length, 1)[0] : null;
    const a = pick([...same]) ?? pick([...other])!;
    const rest = [...same, ...other].filter((m) => m.id !== a.id);
    const b = rest[(s >>> 3) % rest.length];
    const o = [mineral, a, b];
    return s % 3 === 0 ? o : s % 3 === 1 ? [a, mineral, b] : [a, b, mineral];
  }, [mineral]);
  const coll = readCollection();

  const result = (tool: Tool) => {
    const m = mineral;
    switch (tool) {
      case "acid":
        return m.acid === "fast" ? L("¡Burbujea fuerte! Sale gas (CO₂): es un carbonato.", "Strong fizzing! Gas comes out (CO₂): it is a carbonate.")
          : m.acid === "slow" ? L("Burbujea apenas, y solo si está en polvo.", "Barely fizzes, and only when powdered.")
            : L("No pasa nada con el ácido.", "Nothing happens with acid.");
      case "water":
        return m.water === "dissolves" ? L("Se disuelve por completo en el agua.", "It dissolves completely in water.")
          : m.water === "swells" ? L("Se hincha y se vuelve pegajosa.", "It swells and gets sticky.")
            : m.water === "slightly" ? L("Se disuelve muy poco.", "It dissolves only a little.") : L("No se disuelve.", "It does not dissolve.");
      case "heat": {
        if (!m.heat.length) return L("Hasta 1000 °C no cambia ni suelta gases.", "Up to 1000 °C it does not change or release gases.");
        const gas: Record<string, [string, string]> = { H2O: ["sale vapor de agua (H₂O)", "water vapor comes out (H₂O)"], CO2: ["sale dióxido de carbono (CO₂)", "carbon dioxide comes out (CO₂)"],
          SO2: ["sale dióxido de azufre (SO₂), olor fuerte", "sulfur dioxide comes out (SO₂), strong smell"], O2: ["sale oxígeno (O₂)", "oxygen comes out (O₂)"], melts: ["se derrite", "it melts"] };
        return L("Al calentarla: ", "When heated: ") + m.heat.map((g) => gas[g][lang === "es" ? 0 : 1]).join(L(" y ", " and ")) + ".";
      }
      case "magnet":
        return m.magnet === "strong" ? L("¡Se pega fuerte al imán!", "It sticks strongly to the magnet!")
          : m.magnet === "weak" ? L("El imán la atrae un poquito.", "The magnet attracts it slightly.") : L("El imán no la atrae.", "The magnet does not attract it.");
      case "hard": {
        const h = m.mohs;
        const txt = h < 2.5 ? L("La raya la uña", "A fingernail scratches it") : h < 3.5 ? L("La raya una moneda de cobre, no la uña", "A copper coin scratches it, a fingernail does not")
          : h < 5.5 ? L("La raya el vidrio, no la moneda", "Glass scratches it, a coin does not") : h < 6.6 ? L("Raya el vidrio; la raya el acero", "It scratches glass; steel scratches it")
            : L("Raya el vidrio y el acero", "It scratches glass and steel");
        return `${txt} → Mohs ≈ ${num(lang, h, 1)}`;
      }
      case "xrf": return "";
    }
  };
  const tools: [Tool, string, string, string][] = [
    ["acid", "🧪", L("Ácido", "Acid"), L("Gota de ácido clorhídrico diluido", "Drop of dilute hydrochloric acid")],
    ["water", "💧", L("Agua", "Water"), L("¿Se disuelve?", "Does it dissolve?")],
    ["heat", "🔥", L("Horno", "Oven"), L("Hasta 1000 °C, como SAM de Curiosity", "Up to 1000 °C, like Curiosity's SAM")],
    ["magnet", "🧲", L("Imán", "Magnet"), L("¿Tiene hierro magnético?", "Magnetic iron?")],
    ["hard", "🪛", L("Dureza", "Hardness"), L("Rayar con uña, moneda, vidrio, acero", "Scratch with nail, coin, glass, steel")],
    ["xrf", "📡", L("Rayos X", "X-ray"), L("Espectrómetro como el APXS de los rovers (cuesta 2)", "Spectrometer like the rovers' APXS (costs 2)")],
  ];
  const xrf = comp.filter((c) => XRF_VISIBLE.has(c.el));
  const xrfTot = xrf.reduce((a, c) => a + c.pct, 0);
  const guess = (m: Mineral) => {
    if (m.id === mineral.id) {
      setDone(true);
      if (!coll.includes(m.id)) saveCollection([...coll, m.id]);
    } else setWrong((w) => [...w, m.id]);
  };
  const whyTxt = why === "site" ? L("Salió de la lista de minerales documentados para este lugar (EMIT o literatura).", "Drawn from the minerals documented for this place (EMIT or literature).")
    : why === "place" ? L("Es propio de este lugar real (o de este tipo de cueva).", "It is typical of this real place (or this kind of cave).")
      : L("Es típico de este tipo de terreno: elección de juego, no medido aquí.", "Typical of this kind of terrain: a game choice, not measured here.");

  return (
    <div className="overlay lab-overlay">
      <div className="card lab-card" role="dialog" aria-labelledby="lab-title">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="kicker">🔬 {L("Laboratorio del rover", "Rover lab")} · {siteName}</div>
          <span className="lab-energy" aria-label={L("Energía", "Energy")}>{"⚡".repeat(Math.max(0, energy))}{"·".repeat(Math.max(0, ENERGY - Math.max(0, energy)))}</span>
        </div>
        <h3 id="lab-title">{done ? mineral.name[lang] : L("¿Qué mineral es?", "Which mineral is it?")}</h3>

        {!done && hits < 5 && (
          <div className="lab-crush">
            <button className="lab-rock-btn" onClick={() => setHits((h) => h + 1)} aria-label={L("Golpear la muestra", "Hit the sample")}>
              <Rock color={mineral.color} hits={hits} />
            </button>
            <p>{L("Toca la muestra para triturarla", "Tap the sample to crush it")} ({hits}/5)</p>
          </div>
        )}

        {!done && hits >= 5 && (
          <>
            <div className="lab-top">
              <Rock color={mineral.color} hits={5} />
              <p className="muted small-print">{L("Tienes 5 de energía. Elige bien las pruebas y después adivina.", "You have 5 energy. Choose your tests well, then guess.")}</p>
            </div>
            <div className="lab-tools">
              {tools.map(([tool, ic, name, hint]) => (
                <button key={tool} className={`lab-tool ${used.includes(tool) ? "used" : ""}`} disabled={used.includes(tool) || energy < COST[tool]}
                  onClick={() => setUsed((u) => [...u, tool])} title={hint}>
                  <span className="lt-ic">{ic}</span><span className="lt-n">{name}</span><span className="lt-h">{hint}</span>
                </button>
              ))}
            </div>
            <ul className="lab-results">
              {used.map((tool) => tool === "xrf" ? (
                <li key={tool} className="xrf">
                  <b>📡 {L("Rayos X (elementos del sodio para arriba):", "X-ray (sodium and heavier):")}</b>
                  <div className="bars">
                    {xrf.map((c) => (
                      <div key={c.el} className="bar"><span className="el">{c.el}</span>
                        <span className="track"><span style={{ width: `${(100 * c.pct) / Math.max(1, xrfTot)}%`, background: EL_COLOR[c.el] }} /></span>
                        <span className="v">{num(lang, (100 * c.pct) / Math.max(1, xrfTot), 0)}%</span></div>
                    ))}
                    {!xrf.length && <p className="muted">{L("No ve nada: solo hay elementos livianos (H, C, N, O).", "Sees nothing: only light elements (H, C, N, O).")}</p>}
                  </div>
                  <p className="muted small-print">{L("No ve H, B, C, N ni O: para eso hace falta calentar y medir los gases.", "It cannot see H, B, C, N or O: heating and measuring gases is needed for that.")}</p>
                </li>
              ) : <li key={tool} className={`anim-${tool}`}>{tools.find((x) => x[0] === tool)![1]} {result(tool)}</li>)}
            </ul>
            <h4>{L("Tu respuesta", "Your answer")} {used.length < 2 && <span className="muted small-print">({L("haz al menos 2 pruebas", "do at least 2 tests")})</span>}</h4>
            <div className="lab-options">
              {options.map((m) => (
                <button key={m.id} className={`btn ${wrong.includes(m.id) ? "wrong" : ""}`} disabled={used.length < 2 || wrong.includes(m.id)} onClick={() => guess(m)}>
                  {m.name[lang]}
                </button>
              ))}
            </div>
            {wrong.length > 0 && <p className="note small-print">❌ {L("No es ese. Mira de nuevo los resultados.", "Not that one. Look at the results again.")}</p>}
          </>
        )}

        {done && (
          <div className="lab-reveal">
            <p className="lab-ok">{wrong.length === 0 ? L("¡Correcto a la primera! 🎉", "Correct on the first try! 🎉") : L("¡Correcto!", "Correct!")}
              {" "}· {L("Fórmula", "Formula")}: <b className="formula">{prettyFormula(mineral.formulaShown ?? mineral.formula)}</b> · {mineral.group[lang]}</p>
            <h4>{L("Descomposición química (porcentaje en masa)", "Chemical breakdown (mass percent)")}</h4>
            <div className="comp-stack" aria-hidden="true">
              {comp.map((c) => <span key={c.el} style={{ width: `${c.pct}%`, background: EL_COLOR[c.el] }} title={`${c.el} ${c.pct.toFixed(1)} %`}>{c.pct > 7 ? c.el : ""}</span>)}
            </div>
            <div className="bars">
              {comp.map((c) => (
                <div key={c.el} className="bar"><span className="el">{c.el}</span>
                  <span className="track"><span style={{ width: `${c.pct}%`, background: EL_COLOR[c.el] }} /></span>
                  <span className="v">{num(lang, c.pct, 1)}%</span></div>
              ))}
            </div>
            <p className="muted small-print">{L("Calculada de la fórmula ideal con los pesos atómicos (dato derivado). Una muestra real tiene impurezas y varía.",
              "Computed from the ideal formula with atomic weights (derived). A real sample has impurities and varies.")}</p>
            <p>🌍 {mineral.earth[lang]}</p>
            <p>🚀 {mineral.space[lang]} <span className="muted small-print">({mineral.spaceRef})</span></p>
            <p className="muted small-print">❓ {whyTxt}</p>
            <p className="lab-coll">📚 {L("Tu colección", "Your collection")}: {readCollection().length} / {MINERALS.length}</p>
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          <button className={`btn ${done ? "primary" : "ghost"}`} onClick={() => onClose(done)}>{done ? L("Guardar y volver", "Save and return") : L("Salir del laboratorio", "Leave the lab")}</button>
        </div>
      </div>
    </div>
  );
}
