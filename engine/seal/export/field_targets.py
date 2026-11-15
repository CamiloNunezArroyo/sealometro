# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
# Uso: cd engine && python seal/export/field_targets.py
# Exporta para la página /estacion lo necesario para comparar la caja con Marte/Luna con la MISMA matemática del motor.
import json, sys
sys.path.insert(0, ".")
from seal.catalog import load_features, load_targets
from seal import store
from seal.fetch.earth_sample import earth_stats
from seal.score.similarity import kernel
DIMS = ["t_mean", "t_range_diurnal", "precip", "soil_moisture", "rh", "pressure", "uv_index"]
feats = {f.id: f for f in load_features()}
sample = store.read_earth_sample() if store.EARTH_SAMPLE.exists() else []
stats = earth_stats(sample, DIMS) if sample else {}
out = {"generated_from": "engine/seal/features.yaml + engine/seal/targets/*.yaml + muestra terrestre (earth_sample)",
       "kernel": "gaussiano: s = exp(-0.5 (d/tau)^2), d = distancia al rango del objetivo en el espacio de la dimensión",
       "check_kernel_1tau": kernel(1.0, 1.0, "gaussian") if True else None,
       "features": {}, "earth_median": {}, "targets": [],
       "ifa_weights_all": {f.id: f.weight for f in load_features() if f.analogable and f.weight > 0}, "min_ifa_coverage": 0.4}
for d in DIMS:
    f = feats[d]
    out["features"][d] = {"label": f.label, "unit": f.unit, "space": f.space, "tau": f.tau, "weight": f.weight,
                          "analogable": f.analogable, "tau_note": getattr(f, "tau_note", None), "note": getattr(f, "note", None)}
    st = stats.get(d) or {}
    out["earth_median"][d] = st.get("median")
for t in load_targets():
    vals = {}
    for d in DIMS:
        v = t.values.get(d)
        if v is None: continue
        a, b = (v.interval() if v.usable() else (None, None))
        vals[d] = {"value": v.value, "range": v.range, "lo": a, "hi": b, "unit": v.unit, "status": v.status,
                   "source": v.source, "ref": getattr(v, "ref", None), "usable": v.usable()}
    out["targets"].append({"id": t.id, "body": t.body, "name": t.name, "values": vals})
json.dump(out, open("../game/public/data/engine/field_targets.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(out["targets"]), "objetivos;", "mediana Tierra:", out["earth_median"], "kernel(1 tau)=", out["check_kernel_1tau"])
