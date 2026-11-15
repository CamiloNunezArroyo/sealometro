// Hecho con asistencia de IA (Claude) — Seal Hackathon Team
// COPIA este archivo como "secrets.h" (en la misma carpeta) y llena tus datos.
// "secrets.h" NO se sube a git (está en .gitignore).

#pragma once

// Wi-Fi: el hotspot del celular o el Wi-Fi del evento (2,4 GHz: el ESP32 NO ve redes de 5 GHz)
#define WIFI_SSID      "NombreDeTuRed"
#define WIFI_PASS      "ClaveDeTuRed"

// Firebase (Consola de Firebase → Configuración del proyecto → Tus apps → app web)
#define FIREBASE_API_KEY  "AIza..."                                      // apiKey
#define FIREBASE_DB_URL   "https://tu-proyecto-default-rtdb.firebaseio.com"  // databaseURL, SIN "/" al final

// Nombre de esta caja (el mismo que eligen en la página /estacion)
#define DEVICE_ID      "seal-box-01"
