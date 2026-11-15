// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { useSettings } from "../settings";
import { Logo } from "../components/Header";
import { usePhotos } from "../components/SitePhoto";

export function CreditsPage() {
  const { t } = useSettings();
  const photos = [...usePhotos().values()].sort((a, b) => a.id.localeCompare(b.id));
  return (
    <div className="container section">
      <div className="row"><Logo size={56} /><h1 style={{ margin: 0 }}>{t("credits.title")}</h1></div>
      <div className="card" style={{ marginTop: 16 }}>
        <p>{t("credits.team")}</p>
        <p>{t("credits.data")}</p>
        <p>{t("credits.built")}</p>
        <p>{t("credits.imagery")}</p>
        <p>{t("credits.osm")}</p>
        <p>{t("credits.lab")}</p>
        <p className="muted" style={{ margin: 0 }}>{t("credits.nologo")}</p>
      </div>
      {photos.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3>{t("credits.photos")}</h3>
          <ul className="small-print" style={{ columns: "2 320px", margin: 0 }}>
            {photos.map((p) => <li key={p.id}><b>{p.id}</b>: {p.artist || "?"} · <a href={p.page} target="_blank" rel="noreferrer">{p.license}</a></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
