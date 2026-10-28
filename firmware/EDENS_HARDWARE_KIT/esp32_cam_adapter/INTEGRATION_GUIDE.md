# ESP32-CAM Cloud Sync Integration Guide

This package connects your existing physical ESP32-CAM (which serves `/photo`, `/status`, and `:81/stream` on the local greenhouse LAN) directly to `https://edens-ai.onrender.com/api/camera/upload` over verified HTTPS — **without needing any laptop or LAN relay**.

## Option A — Add 2 Lines to Your Existing `CameraWebServer` Sketch (Recommended)

1. Copy `firmware/esp32_cam_cloud_sync/edens_cloud_upload.h` into your existing ESP32-CAM sketch directory.
2. In the EDENS AI web app (`/greenhouses` -> **Setup Wizard** -> **Step 3**), issue a unique camera key (`edcam_...`) and click **Download `camera_secrets.h`** into your sketch directory, then fill in `EDENS_WIFI_SSID` and `EDENS_WIFI_PASSWORD` locally.
3. Add two lines to your `.ino` file:
   ```cpp
   #include "edens_cloud_upload.h"
   ```
   and at the end of `setup()` right after `startCameraServer();`:
   ```cpp
   edensStartCloudUploadTask();
   ```
4. If `:81/stream` is viewed continuously on LAN while cloud sync is active, wrap `esp_camera_fb_get()` / `esp_camera_fb_return(fb)` in your local HTTP handler with `edensAcquireCameraLock()` and `edensReleaseCameraLock()`. Because `edens_cloud_upload.h` copies `fb->buf` into PSRAM in ~4 ms and releases the lock **before** starting the TLS handshake, local `/photo`, `/status`, and `:81/stream` will never stall.

## Option B — Standalone Reference Sketch

Open `esp32_cam_reference.ino`, copy `../../esp32_cam_cloud_sync/edens_cloud_upload.h` into the same sketch folder, create `camera_secrets.h` from `camera_secrets.example.h`, and flash with:
- **Board**: `AI Thinker ESP32-CAM`
- **PSRAM**: `Enabled`
- **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)`
- **Power Supply**: Dedicated **5V >= 2A** regulated supply (USB-UART adapters below 500 mA will brown out during Wi-Fi + TLS handshakes).
