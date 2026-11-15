// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
// Foto REAL del lugar (Wikimedia Commons, licencia libre) con su atribución obligatoria.
import { dataUrl, useData } from "../data";
import { useSettings } from "../settings";

export interface Photo { id: string; file: string; title: string; artist: string; license: string; license_url: string; page: string; near: boolean }

export function usePhotos(): Map<string, Photo> {
  const { data } = useData<{ sites: Photo[] }>("photos/photos.json");
  return new Map((data?.sites ?? []).map((p) => [p.id, p]));
}

export function SitePhoto({ photo, alt, height = 200, compact = false }: { photo: Photo; alt: string; height?: number; compact?: boolean }) {
  const { t } = useSettings();
  return (
    <figure className="site-photo" style={{ margin: 0 }}>
      <img src={dataUrl(photo.file)} alt={alt} loading="lazy" style={{ height }} />
      <figcaption className={compact ? "compact" : ""}>
        📷 {photo.near ? t("photo.real.near") : t("photo.real.area")} · {photo.artist || "?"} ·{" "}
        <a href={photo.page} target="_blank" rel="noreferrer">{photo.license}, Wikimedia Commons</a>
      </figcaption>
    </figure>
  );
}
