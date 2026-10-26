# Direct ESP32-CAM -> EDENS AI Cloud Upload Firmware Module

## Firmware Audit Note
The original Arduino/ESP-IDF sketch currently flashed on the greenhouse ESP32-CAM (`CameraWebServer.ino` and `app_httpd.cpp`, serving local `/photo`, `/status`, and port `81` `/stream`) is **not checked into this repository** (`Darkesay/eden-ai`).

Rather than replacing your working local camera endpoints, `edens_cloud_upload.h` is a **drop-in non-blocking background module** that adds direct camera-to-cloud HTTPS uploads (`POST https://edens-ai.onrender.com/api/camera/upload`) while keeping `/photo`, `/status`, and `:81/stream` intact.

---

## Architecture & Security Summary
- **No PC Relay Required**: The ESP32-CAM uploads periodic JPEG snapshots directly to `https://edens-ai.onrender.com/api/camera/upload` over greenhouse Wi-Fi -> internet.
- **Verified HTTPS TLS**: Uses `WiFiClientSecure::setCACert(...)` with authentic Root CAs (`GTS Root R1`, `GlobalSign Root CA`, and `ISRG Root X1`) plus automatic NTP UTC clock sync (`configTime`). Never disables certificate verification with `setInsecure()`.
- **Header Authentication**: Sends `X-Camera-Key` read from `camera_secrets.h` (gitignored so secrets are never committed).
- **Non-Blocking Capture**: Copies `fb->buf` into PSRAM/heap in ~3–5 ms and immediately returns the frame buffer (`esp_camera_fb_return(fb)`) before starting the TLS handshake on FreeRTOS Core 0.
- **Resilient Retries**: Exponential backoff (`5s -> 10s -> 20s -> 40s -> 60s` max) and automatic `WiFi.reconnect()` on network drops.

---

## Step-by-Step Flashing Instructions for Victor

1. **Copy Module Files into Your Existing Sketch Folder**
   Copy `edens_cloud_upload.h` and `camera_secrets.example.h` into the same directory as your existing ESP32-CAM `.ino` sketch (e.g., `CameraWebServer/`).

2. **Create Unversioned `camera_secrets.h`**
   Rename or copy `camera_secrets.example.h` to `camera_secrets.h` and set `EDENS_CAMERA_UPLOAD_KEY` to match the `CAMERA_UPLOAD_KEY` configured in **Render Dashboard -> Environment Variables**:
   ```cpp
   #define EDENS_CAMERA_UPLOAD_URL "https://edens-ai.onrender.com/api/camera/upload"
   #define EDENS_CAMERA_UPLOAD_KEY "<SAME_SECRET_AS_RENDER_CAMERA_UPLOAD_KEY>"
   #define EDENS_CAMERA_UPLOAD_INTERVAL_MS 15000UL
   ```

3. **Add 2 Lines to Your Existing `.ino` Sketch**
   Near the top of your `.ino` file (below `#include "esp_camera.h"`):
   ```cpp
   #include "edens_cloud_upload.h"
   ```
   At the bottom of `setup()`, right after `startCameraServer();`:
   ```cpp
   edensStartCloudUploadTask();
   ```
   *(Optional if `:81/stream` runs continuously alongside cloud uploads)*: Wrap `esp_camera_fb_get()` / `esp_camera_fb_return(fb)` in `app_httpd.cpp` with `edensAcquireCameraLock()` and `edensReleaseCameraLock()`.

4. **Arduino IDE Board & Partition Settings**
   - **Board**: `AI Thinker ESP32-CAM`
   - **PSRAM**: `Enabled`
   - **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)` *(required so WebServer + mbedTLS fit comfortably)*
   - **Power**: Use a stable **5V 2A** supply during Wi-Fi TLS transmission.

5. **Flash & Verify**
   - Bridge `GPIO 0` to `GND`, upload the sketch, disconnect `GPIO 0` from `GND`, and press **RST**.
   - Open Serial Monitor (`115200` baud) and confirm:
     `[EDENS-CAM] Cloud upload OK (HTTP 200, ... bytes, total=1)`
   - Open `https://edens-ai.onrender.com/ai-lab` on any phone (over mobile data) or computer — the status badge will switch automatically to **CONNECTED · FRESH** and display the greenhouse snapshot.
