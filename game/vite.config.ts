// Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// base "./" para que el sitio funcione en GitHub Pages o abierto desde cualquier carpeta.
// `npm run dev:https` (modo "https"): HTTPS con un certificado de prueba, para que el CELULAR de la misma red
// pueda usar GPS y cámara (los navegadores solo los dan en HTTPS). El celular mostrará un aviso de "no es privado":
// es esperable con este certificado de prueba; hay que tocar "Avanzado → Continuar".
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === "https" ? [basicSsl()] : [])],
  server: { port: 5173, host: true },
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
}) as any);
