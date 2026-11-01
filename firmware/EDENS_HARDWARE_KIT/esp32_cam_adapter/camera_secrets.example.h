#pragma once

/**
 * EDENS AI — ESP32-CAM Secret Configuration Template
 *
 * SECURITY RULES:
 * 1. Copy this file to `camera_secrets.h` inside your ESP32-CAM sketch directory:
 *      cp camera_secrets.example.h camera_secrets.h
 * 2. Or download a pre-populated `camera_secrets.h` from:
 *      https://edens-ai.onrender.com/greenhouses -> Setup Wizard -> Step 3
 * 3. NEVER commit `camera_secrets.h` to Git (gitignored).
 * 4. NEVER log `EDENS_WIFI_PASSWORD` or `EDENS_CAMERA_UPLOAD_KEY` to Serial!
 */

#define EDENS_WIFI_SSID "REPLACE_WITH_2_4GHZ_WIFI_SSID"
#define EDENS_WIFI_PASSWORD "REPLACE_WITH_WIFI_PASSWORD"

// Production EDENS AI HTTPS Camera Upload Endpoint
#define EDENS_CAMERA_UPLOAD_URL "https://edens-ai.onrender.com/api/camera/upload"

// Per-device camera secret (`edcam_...`) issued in EDENS AI Setup Wizard
// OR global Render `CAMERA_UPLOAD_KEY` for single-camera lab verification
#define EDENS_CAMERA_UPLOAD_KEY "REPLACE_WITH_ISSUED_EDCAM_KEY"

// Multi-tenant binding IDs from EDENS AI Setup Wizard
#define EDENS_GREENHOUSE_ID ""
#define EDENS_CAMERA_DEVICE_ID ""

// Upload interval in ms (15s keeps frames well inside the <=90s ONLINE / FRESH window)
#define EDENS_CAMERA_UPLOAD_INTERVAL_MS 15000UL
