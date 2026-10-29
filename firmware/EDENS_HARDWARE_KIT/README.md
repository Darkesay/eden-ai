# EDENS AI — Complete Hardware Collaborator Installation Kit

This directory (`firmware/EDENS_HARDWARE_KIT/`) contains everything the hardware collaborator needs to configure, flash, verify, and operate the physical **Main ESP32 Greenhouse Controller** and **ESP32-CAM** against the production EDENS AI cloud (`https://edens-ai.onrender.com`).

---

## 1. Directory Contents

```text
firmware/EDENS_HARDWARE_KIT/
├── README.md                                        # Master setup, env vars, checklists & troubleshooting
├── THINGSBOARD_EVALUATION.md                        # Technical comparison: EDENS Gateway vs ThingsBoard CE
├── esp32_controller_adapter/
│   ├── edens_controller_sync.h                      # Verified-TLS telemetry uploader + local safety interlocks
│   ├── controller_secrets.example.h                 # Safe template -> copy to controller_secrets.h (gitignored)
│   └── esp32_controller_reference.ino               # Reference sketch with clean GPIO/sensor adapter hooks
├── esp32_cam_adapter/
│   ├── INTEGRATION_GUIDE.md                         # 2-line integration into existing CameraWebServer sketch
│   ├── camera_secrets.example.h                     # Safe template -> copy to camera_secrets.h (gitignored)
│   └── esp32_cam_reference.ino                      # Reference AI-Thinker ESP32-CAM sketch
└── diagnostics/
    └── verify_cloud_connection.mjs                  # Safe read-only CLI diagnostic tool
```

*(Note: `firmware/esp32_cam_cloud_sync/edens_cloud_upload.h` is preserved intact and referenced directly by `esp32_cam_adapter/`.)*

---

## 2. Cloud Connection & Security Architecture

Because Render runs on the public internet and cannot initiate inbound HTTP connections into a private greenhouse LAN (`10.x.x.x` / `192.168.x.x`), **both ESP32 boards initiate outbound verified HTTPS (`TLS 1.2+`) `POST` requests** to EDENS AI:

| Device | Cloud Endpoint | Auth Header | Secret Prefix / Env Var | Heartbeat Thresholds |
|---|---|---|---|---|
| **Main ESP32 Controller** | `POST /api/telemetry/upload` | `X-Hardware-Key` | Per-device `edctrl_*` (or global `HARDWARE_API_KEY`) | `<=45s` `ONLINE` · `46–180s` `STALE` · `>180s` `OFFLINE` |
| **ESP32-CAM** | `POST /api/camera/upload` | `X-Camera-Key` | Per-device `edcam_*` (or global `CAMERA_UPLOAD_KEY`) | `<=90s` `ONLINE` (`FRESH`) · `91–300s` `STALE` · `>300s` `OFFLINE` |

### Mandatory Security Rules Enforced
1. **Verified TLS Certificates Only**: Both `edens_controller_sync.h` and `edens_cloud_upload.h` sync UTC time via NTP (`configTime`) and verify server certificates with `WiFiClientSecure::setCACert(...)` (`GTS Root R1`, `GlobalSign Root CA`, `ISRG Root X1`). **`setInsecure()` is forbidden.**
2. **Independent Credentials**: A camera key (`edcam_*` / `CAMERA_UPLOAD_KEY`) **cannot** post controller telemetry or trigger actuators, and a controller key (`edctrl_*` / `HARDWARE_API_KEY`) **cannot** upload camera frames.
3. **Header-Only Secrets**: Passing `?key=`, `?auth=`, or `?token=` in any URL query string is unconditionally rejected with `HTTP 401 QUERY_AUTH_DISALLOWED`.
4. **Honest `0` vs `null` Telemetry**: Unwired or faulty sensors (`NAN` in C++) serialize as JSON `null` (`UNREPORTED` / `Unavailable` in UI), while genuine zero measurements (`0.0f` in C++, e.g. `0%` water reservoir) serialize as `0` and trigger dry-run pump protection.
5. **Local Safety Interlocks Are Authoritative**: `edensEnforceLocalSafetyInterlocks(...)` runs every second on the ESP32 even when internet is down (rain closes roof, `<10%` water locks pump off, `>32°C` locks heater off, `>120s` continuous pump run-time cap). Cloud AI agents run strictly in **Advisory Only** mode for physical hardware.

---

## 3. Render Environment Variables Required

Configure these in **Render Dashboard -> Service -> Environment** (never commit values to Git):

| Variable | Required | Example / Format | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | **Required** | `AIza...` | Server-side Gemini key for `VisionAgent`, Agronomist Chat, Harvest Prediction & Speech. |
| `CAMERA_UPLOAD_KEY` | **Required** | 32-byte random hex/base64 | Global intake secret for `POST /api/camera/upload` (`X-Camera-Key`). Must NOT be a placeholder. |
| `HARDWARE_API_KEY` | **Required** | 32-byte random hex/base64 | Global intake secret for `POST /api/telemetry/upload` (`X-Hardware-Key`). Must differ from `CAMERA_UPLOAD_KEY`. |
| `APP_URL` | Recommended | `https://edens-ai.onrender.com` | Canonical origin embedded in QR enrollment payloads. |
| `DATABASE_PATH` | **Required on Render** | `/var/data/edens-platform.sqlite` | Path on your Render Persistent Disk so users, devices, SHA-256 credentials, telemetry & AI observations persist across deploys. |
| `CAMERA_STORAGE_PATH` | **Required on Render** | `/var/data/camera` | Directory on your Render Persistent Disk for uploaded ESP32-CAM JPEG snapshots. |
| `CAMERA_FRESH_MAX_SECONDS` | Optional | `90` (default) | Maximum age in seconds for a camera snapshot to be considered `ONLINE` / `FRESH` for live `VisionAgent` diagnosis. |
| `CAMERA_MAX_UPLOAD_MB` | Optional | `10` (default) | Maximum accepted binary `image/jpeg` body size. |

Generate strong random keys locally on macOS/Linux before pasting into Render:
```bash
openssl rand -hex 32
```

---

## 4. Device Registration & Credential Issuance Guide

1. Sign in at `https://edens-ai.onrender.com/login` and open **My Greenhouses** (`/greenhouses`).
2. Click **Add Greenhouse** (or **Scan Kit QR** if claiming a pre-printed kit sticker).
3. **Step 1 (Identity)**: Enter the greenhouse name, plot location, and primary crop (e.g. `Tomato`).
4. **Step 2 (Wi-Fi Provisioning)**: Select **Guided Header Provisioning (Supported Now)** and optionally enter your **2.4 GHz** Wi-Fi SSID label (your Wi-Fi password is never sent to the cloud).
5. **Step 3 (Device Keys)**:
   - Click **Issue Unique Device Key** on **ESP32-CAM Crop Camera** -> click **Download `camera_secrets.h`**.
   - Click **Issue Unique Device Key** on **Main ESP32 Greenhouse Controller** -> click **Download `controller_secrets.h`**.
   - Plaintext keys (`edcam_...` and `edctrl_...`) are shown **only once**; SQLite stores only their SHA-256 hashes.
   - Note: Issuing a key transitions the device from `CONFIGURATION_REQUIRED` to `WAITING_FOR_FIRST_CONNECTION` — **never** `ONLINE` until the physical ESP32 uploads verified data.
6. **Step 4 (Read-Only Check-In)**: Keep this screen open while powering on both flashed ESP32 boards (`actuationCommandsSent: 0`).

---

## 5. Local Testing & Cloud Diagnostics

Run the included read-only diagnostic CLI against local dev or Render production:

```bash
# Against local server (npm run dev or npm run start):
node firmware/EDENS_HARDWARE_KIT/diagnostics/verify_cloud_connection.mjs

# Against Render production (100% read-only + query-secret rejection check):
EDENS_BASE_URL=https://edens-ai.onrender.com \
  node firmware/EDENS_HARDWARE_KIT/diagnostics/verify_cloud_connection.mjs
```

Run the full automated test suite locally:
```bash
npm run lint
npm test
npm run build
```

---

## 6. Collaborator Step-by-Step Installation Checklist

- [ ] **1. Verify 2.4 GHz Wi-Fi Coverage**: Confirm a dedicated 2.4 GHz WPA2 SSID reaches the greenhouse mounting spot (RSSI better than `-75 dBm`; ESP32 radios do not support 5 GHz).
- [ ] **2. Verify Regulated Power**: Supply **5V >= 2A** regulated DC to the ESP32-CAM and Main ESP32 (avoid powering ESP32-CAM through unpowered USB hubs during Wi-Fi TLS bursts).
- [ ] **3. Issue & Download Headers**: Download `camera_secrets.h` and `controller_secrets.h` from Step 3 of the EDENS AI Setup Wizard, and type your local 2.4 GHz Wi-Fi password into `EDENS_WIFI_PASSWORD` offline.
- [ ] **4. Wire Sensor & Relay Adapter Hooks (Main ESP32)**:
  - Copy `esp32_controller_adapter/esp32_controller_reference.ino`, `edens_controller_sync.h`, and your configured `controller_secrets.h` into an Arduino sketch folder named `esp32_controller_reference/` (or `#include "edens_controller_sync.h"` inside your existing controller sketch folder).
  - Fill in `readPhysicalGreenhouseSensors()` with your actual sensor library reads; leave any unpopulated sensor as `NAN`.
  - Verify relay active-HIGH / active-LOW polarity on a bench multimeter before connecting mains/12V pumps or heaters.
- [ ] **5. Flash Main ESP32 Controller**:
  - Board: `ESP32 Dev Module`, Upload Speed `921600` (or `115200`), Partition `Default 4MB with spiffs` (or `Huge APP`).
  - Confirm Serial Monitor (`115200` baud) prints `[EDENS-CTRL] Telemetry upload OK (HTTP 200, packet #1)`.
- [ ] **6. Flash ESP32-CAM**:
  - Follow `esp32_cam_adapter/INTEGRATION_GUIDE.md` (`AI Thinker ESP32-CAM`, `PSRAM: Enabled`, `Huge APP (3MB No OTA/1MB SPIFFS)`).
  - Confirm Serial Monitor prints `[EDENS-CAM] Cloud upload OK (HTTP 200, ... bytes, total=1)` and local `/photo`, `/status`, `:81/stream` still respond on LAN.
- [ ] **7. Confirm Cloud Dashboard**: Open `/greenhouses/<id>` on a phone over mobile data (off greenhouse Wi-Fi) and verify both devices show `ONLINE`.

---

## 7. Troubleshooting Guide

| Symptom / HTTP Status | Root Cause | Fix |
|---|---|---|
| `HTTP -1` / TLS handshake failure on ESP32 | System clock still at 1970 (NTP blocked) or wrong partition size | Ensure UDP port `123` (NTP) is open on greenhouse router; verify `edensEnsureValidUtcClock()` succeeds; never add `setInsecure()`. |
| `HTTP 401 INVALID_CAMERA_KEY` / `INVALID_HARDWARE_KEY` | Key mismatch, swapped camera vs controller key, or rotated key | Device state shows `AUTHENTICATION_ERROR` in UI. Re-issue key in Setup Wizard Step 3 and re-flash matching `*_secrets.h`. |
| `HTTP 401 QUERY_AUTH_DISALLOWED` | Firmware or script appended `?key=` or `?auth=` to URL | Remove all secrets from URL query parameters; pass only `X-Camera-Key` or `X-Hardware-Key` HTTP header. |
| `HTTP 400 INVALID_JPEG_PAYLOAD` / `MALFORMED_SENSOR_VALUE` | Truncated camera buffer or `NaN` string in JSON | Device state shows `CONNECTION_ERROR`. Check PSRAM enabled on ESP32-CAM; use `edensAppendNullableFloat` so `NAN` becomes JSON `null`. |
| `HTTP 409 STALE_CAMERA_FRAME` / `STALE_TELEMETRY` on AI Diagnosis | Latest camera frame `>90s` old or controller packet `>45s` old | Verify ESP32 power & Wi-Fi RSSI; wait for next periodic upload before clicking **Analyze Fresh Crop Snapshot**. |
| `HTTP 503 CAMERA_UPLOAD_NOT_CONFIGURED` / `HARDWARE_GATEWAY_NOT_CONFIGURED` | Global env var missing or still set to placeholder on Render | Set strong random `CAMERA_UPLOAD_KEY` and `HARDWARE_API_KEY` in Render Environment Variables, or include `X-Greenhouse-Id` + `X-Device-Id` with an enrolled per-device key. |
| Brownout detector triggered on ESP32-CAM | Voltage sag below `4.75V` during Wi-Fi TX + OV2640 capture | Feed `5V` directly from a `>=2A` buck converter with a `470µF` bulk capacitor across `5V` and `GND`. |

---

## 8. Physical Hardware Acceptance Test Checklist

1. **Cold Boot & TLS Check-In**: Power both ESP32 boards from cold start; within 25 seconds both transition from `WAITING_FOR_FIRST_CONNECTION` to `ONLINE` in `/greenhouses/<id>`.
2. **Smartphone Off-LAN Verification**: Disable Wi-Fi on an authorized phone (4G/5G cellular only), open `https://edens-ai.onrender.com/greenhouses`, and confirm fresh JPEG snapshot (`SNAPSHOT — NOT LIVE VIDEO`, age `<=90s`) and real controller readings (`REAL_HARDWARE`, age `<=45s`).
3. **Zero vs Missing Sensor Honesty**: Unplug an optional sensor (e.g. reservoir sensor -> `NAN`) and verify UI shows `Unavailable` (not `0%`). Then test `0.0%` reservoir calibration and verify UI shows `0%` with `waterLowLocked: LOCKED`.
4. **Heartbeat Expiry & Auto-Recovery**: Unplug Main ESP32 power: verify state moves `ONLINE` -> `STALE` (after 45s) -> `OFFLINE` (after 180s). Restore power: verify automatic reconnection back to `ONLINE` without restarting server or browser.
5. **Local LAN Coexistence (ESP32-CAM)**: While cloud uploads run every 15s, fetch `http://<cam-lan-ip>/photo`, `/status`, and `:81/stream` on LAN and confirm zero deadlocks.
6. **Offline Local Safety Interlock Verification**: Disconnect internet WAN uplink on the greenhouse router, trigger rain sensor / low-water condition on the bench, and confirm `edensEnforceLocalSafetyInterlocks()` immediately closes roof / locks pump OFF locally on the ESP32.
7. **Live Gemini Vision Diagnosis**: With a fresh crop snapshot (`<=90s`), click **Analyze Fresh Crop Snapshot** and confirm diagnosis returns `advisoryOnly: true` and logs an entry in **Historical AI Observations**.

---

## 9. Remaining Hardware-Specific Unknowns (Require Collaborator Confirmation)

In accordance with hardware safety rules, no physical pins or electrical polarities were guessed in software:

1. **Exact Main ESP32 GPIO Pinout**: Exact GPIO numbers wired to temperature/humidity sensor, soil ADC channel, rain sensor digital/analog pin, water reservoir sensor, and relay channels (`pump`, `fan`, `light`, `heater`, `peltier`, `roof` H-bridge/servo).
2. **Exact Sensor IC Models & Calibration Constants**: Whether air temp/humidity uses `SHT31` (I2C), `BME280`, or `DHT22`, plus dry-in-air / wet-in-water ADC counts for the capacitive soil moisture probe and tank empty/full distances for ultrasonic reservoir sensing.
3. **Relay Trigger Polarity**: Whether the physical relay driver board is **active-LOW** (common opto-isolated modules, which need pull-ups at boot to prevent relay chatter) or **active-HIGH** MOSFET stages.
4. **Main ESP32 Existing Sketch Source**: Like the ESP32-CAM sketch, the collaborator's existing Main ESP32 `.ino` source is not checked into `Darkesay/eden-ai`; `edens_controller_sync.h` is designed as a drop-in header so it can be `#include`d in 3 lines without rewriting existing control code.
5. **Future Wireless Wi-Fi Provisioning Choice**: Current boards use `Guided Header Provisioning` (`camera_secrets.h` / `controller_secrets.h`). If field customers later need zero-USB Wi-Fi setup, collaborator firmware will need a SoftAP/BLE NVS portal calling `POST /api/devices/bootstrap`.
