#pragma once

/**
 * EDENS AI — ESP32-CAM Private Cloud Upload Configuration Template
 *
 * SECURITY INSTRUCTIONS:
 * 1. Copy this file to `camera_secrets.h` in the same folder as your ESP32-CAM sketch:
 *      cp camera_secrets.example.h camera_secrets.h
 * 2. Fill in your actual CAMERA_UPLOAD_KEY matching the Render backend environment variable.
 * 3. NEVER commit `camera_secrets.h` to Git (it is ignored via `.gitignore`).
 */

// Production EDENS AI HTTPS camera intake endpoint
#define EDENS_CAMERA_UPLOAD_URL "https://edens-ai.onrender.com/api/camera/upload"

// Per-device camera key (edcam_...) issued in EDENS AI Greenhouse Setup Wizard,
// OR global CAMERA_UPLOAD_KEY environment variable for single-unit lab testing
#define EDENS_CAMERA_UPLOAD_KEY "REPLACE_WITH_ISSUED_CAMERA_DEVICE_KEY"

// Optional multi-tenant binding headers (auto-populated when downloaded from Setup Wizard)
#define EDENS_GREENHOUSE_ID ""
#define EDENS_CAMERA_DEVICE_ID ""

// Periodic snapshot upload interval in milliseconds (15000 ms = 15 seconds; keeps frames well within 90s FRESH window)
#define EDENS_CAMERA_UPLOAD_INTERVAL_MS 15000UL
