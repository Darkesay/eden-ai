#pragma once

/**
 * EDENS AI — Main ESP32 Controller Secret Configuration Template
 *
 * SECURITY RULES:
 * 1. Copy this file to `controller_secrets.h` in your sketch folder:
 *      cp controller_secrets.example.h controller_secrets.h
 * 2. Or download a pre-populated `controller_secrets.h` directly from:
 *      https://edens-ai.onrender.com/greenhouses -> Setup Wizard -> Step 3
 * 3. NEVER commit `controller_secrets.h` to Git (gitignored).
 * 4. NEVER print `EDENS_WIFI_PASSWORD` or `EDENS_CONTROLLER_DEVICE_KEY` to Serial!
 */

// 2.4 GHz Greenhouse Wi-Fi (ESP32 does NOT support 5 GHz Wi-Fi)
#define EDENS_WIFI_SSID "REPLACE_WITH_2_4GHZ_WIFI_SSID"
#define EDENS_WIFI_PASSWORD "REPLACE_WITH_WIFI_PASSWORD"

// Production EDENS AI Cloud Telemetry Endpoint (HTTPS with Root CA verification)
#define EDENS_TELEMETRY_UPLOAD_URL "https://edens-ai.onrender.com/api/telemetry/upload"

// Per-device controller secret (`edctrl_...`) issued in EDENS AI Setup Wizard
// OR global Render `HARDWARE_API_KEY` for single-controller lab verification
#define EDENS_CONTROLLER_DEVICE_KEY "REPLACE_WITH_ISSUED_EDCTRL_KEY"

// Multi-tenant binding IDs from EDENS AI Setup Wizard (leave "" only when using global lab key)
#define EDENS_GREENHOUSE_ID ""
#define EDENS_CONTROLLER_DEVICE_ID ""

// Telemetry push interval in milliseconds (10s keeps device well inside <=45s ONLINE threshold)
#define EDENS_TELEMETRY_INTERVAL_MS 10000UL
