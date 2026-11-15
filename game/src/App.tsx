// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { lazy, Suspense } from "react";
import { useRoute, useSettings } from "./settings";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { MapPage } from "./pages/MapPage";
import { RankingPage } from "./pages/RankingPage";
import { HowPage } from "./pages/HowPage";
import { CreditsPage } from "./pages/CreditsPage";

// el juego (Three.js) se carga solo cuando se entra a jugar
const PlayPage = lazy(() => import("./pages/PlayPage"));
const StationPage = lazy(() => import("./pages/StationPage"));
const PhonePage = lazy(() => import("./pages/PhonePage"));

export function App() {
  const route = useRoute();
  const { t } = useSettings();
  const page = route.path[0] ?? "";
  let body;
  switch (page) {
    case "mapa": body = <MapPage route={route} />; break;
    case "ranking": body = <RankingPage route={route} />; break;
    case "como-funciona": body = <HowPage />; break;
    case "jugar": body = <Suspense fallback={<p className="container section">{t("g.loading")}</p>}><PlayPage route={route} /></Suspense>; break;
    case "estacion": body = <Suspense fallback={<p className="container section">{t("app.loading")}</p>}><StationPage route={route} /></Suspense>; break;
    case "movil": body = <Suspense fallback={<p className="container section">{t("app.loading")}</p>}><PhonePage route={route} /></Suspense>; break;
    case "creditos": body = <CreditsPage />; break;
    default: body = <Home />;
  }
  return (
    <div className="app">
      <a href="#main" className="sr-only">Saltar al contenido</a>
      <Header page={page} />
      <main id="main">{body}</main>
      <footer className="footer">
        <div className="container row">
          <span>Seal Hackathon Team · NASA Space Apps Challenge 2026 · Sucre, Bolivia</span>
          <span className="spacer" />
          <span>{t("credits.nologo")}</span>
        </div>
      </footer>
    </div>
  );
}
