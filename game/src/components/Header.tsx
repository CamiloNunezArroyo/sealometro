// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import type { Lang, Level } from "../i18n";
import { useSettings } from "../settings";

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="19" fill="#d95926" />
      <circle cx="26" cy="27" r="4" fill="#a8492a" />
      <circle cx="38" cy="38" r="3" fill="#a8492a" />
      <ellipse cx="32" cy="32" rx="30" ry="9" fill="none" stroke="#c9dcff" strokeWidth="3" transform="rotate(-20 32 32)" />
      <circle cx="56" cy="22" r="3.5" fill="#3987e5" />
    </svg>
  );
}

export function Header({ page }: { page: string }) {
  const { t, lang, setLang, level, setLevel } = useSettings();
  const links: [string, string][] = [["", "nav.home"], ["mapa", "nav.map"], ["ranking", "nav.ranking"], ["como-funciona", "nav.how"], ["estacion", "nav.station"], ["creditos", "nav.credits"]];
  return (
    <header className="header">
      <div className="container header-inner">
        <a className="brand" href="#/">
          <Logo />
          <span>Sealometro<small>{t("brand.sub")}</small></span>
        </a>
        <nav className="nav" aria-label="principal">
          {links.map(([p, k]) => (
            <a key={k} href={`#/${p}`} aria-current={page === p ? "page" : undefined}>{t(k)}</a>
          ))}
          <a href="#/jugar" className="play" aria-current={page === "jugar" ? "page" : undefined}>▶ {t("nav.play")}</a>
        </nav>
        <span className="spacer" />
        <div className="seg" role="group" aria-label={t("level.label")}>
          {(["explorador", "cadete", "cientifico"] as Level[]).map((l) => (
            <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)} title={`${t(`level.${l}`)} · ${t(`level.${l}.age`)}`} aria-label={t(`level.${l}`)}>
              {l === "explorador" ? "🔭 " : l === "cadete" ? "🚀 " : "🧪 "}<span className="lvl-name">{t(`level.${l}`)}</span>
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label={t("lang.label")}>
          {(["es", "en"] as Lang[]).map((l) => (
            <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </div>
    </header>
  );
}
