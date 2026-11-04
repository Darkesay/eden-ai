# EDENS AI — Plug-and-Play Hardware Kit & Security Architecture (`v3.0.0-pnp-sec`)

This directory contains the hardened **Plug-and-Play (PnP)** firmware modules for EDENS AI greenhouse controllers and ESP32-CAM crop cameras. Farmers never edit C++ source code or expose their farm Wi-Fi password to the cloud.

---

## 1. Directory Contents

| File | Purpose |
|------|---------|
| `edens_pnp_provisioning.h` | Shared NVS storage (`Preferences`), per-board CSPRNG WPA2-PSK SoftAP hotspot (`EDENS-SETUP-XXXX`), CSRF + brute-force pairing lockout, 15-minute session timeout, auto-close on pairing, and safe HTTP `401` Credential Recovery Mode. |
| `esp32_controller_adapter/edens_controller_sync.h` | Non-blocking ESP32 controller telemetry uploader, hardware/software watchdog (`esp_task_wdt` + `EdensLocalRuntimeGuard`), local Tier-1 safety interlocks, and consecutive-`401` credential recovery. |
| `esp32_controller_adapter/esp32_controller_reference.ino` | Ready-to-flash reference sketch for an ESP32 greenhouse controller node (with optional physical E-STOP input on `GPIO 33`). |
| `esp32_cam_adapter/esp32_cam_reference.ino` | Ready-to-flash reference sketch for an AI-Thinker ESP32-CAM (`OV2640` PSRAM) using `../esp32_cam_cloud_sync/edens_cloud_upload.h`. |
| `controller_secrets.example.h` | Optional technician compile-time fallback header (never required for normal farmer setup). |

---

## 2. Secure Initial Provisioning Hotspot (`EDENS-SETUP-XXXX`)

The onboarding hotspot is **never** open or protected by a guessable MAC-derived password:

1. **Per-Board Hardware CSPRNG WPA2-PSK Key**:
   - On first factory boot, `edens_pnp_provisioning.h` generates a 12-character alphanumeric WPA2 password (~68.4 bits entropy) using the ESP32 hardware random number generator (`esp_fill_random`) with rejection sampling (zero modulo bias) and persists it in dedicated NVS namespace `"edens_sec"` (`key: "ap_psk"`).
   - It is **never** derived from MAC address digits.
2. **Secure Installer Password Delivery**:
   - During factory bench flashing / quality check (`115200` baud USB-UART), the firmware prints the `[EDENS-INSTALLER-LABEL]` block (or responds to local serial command `SHOW_SETUP_KEY`) containing the Hardware UID, `EDENS-SETUP-XXXX` SSID, and 12-char WPA2 Setup Key so the installer prints and affixes it inside the weatherproof enclosure lid / kit card.
   - The WPA2 Setup Key is never transmitted over HTTP or cloud logs.
3. **Pairing Brute-Force & Session Protections**:
   - Every portal form render embeds a 128-bit CSPRNG CSRF token (`csrf`) verified on `POST /api/provision`.
   - After 3 failed pairing attempts, `POST /api/provision` enforces escalating lockout (`15s -> 30s -> 60s -> 120s -> 300s`) returning `HTTP 429 Too Many Requests`.
   - **Short-Lived Session (`15 minutes`)**: `EDENS-SETUP-XXXX` automatically shuts down after `15 minutes` (`900,000 ms`) if unpaired.
   - **Immediate Closure on Success**: Immediately after `/api/devices/bootstrap` succeeds, the board saves its `deviceKey` in NVS and shuts down `EDENS-SETUP-XXXX` (`WiFi.softAPdisconnect(true)`).

---

## 3. Safe HTTP `401` Credential Recovery (Key Rotation / Revocation)

When a farmer rotates or revokes a board's key in EDENS AI:

1. **Strict Separation of Auth vs Network Errors**:
   - Temporary Wi-Fi drops, DNS timeouts (`<= 0`), rate limits (`429`), and proxy `5xx` (`500`, `502`, `503`, `504`) errors trigger exponential retry backoff only and **never** increment the auth failure counter.
   - Only verified `HTTP 401` responses containing authoritative server error codes (`UNAUTHORIZED_DEVICE`, `DEVICE_REVOKED`, `INVALID_HARDWARE_KEY`, `UNAUTHORIZED_CAMERA`, `INVALID_CAMERA_KEY`) increment `m_consecutiveAuthFailures`. Any `HTTP 200` resets the counter to `0`.
2. **Anti-Abuse Threshold & Cooldown**:
   - Requires **10 consecutive verified `401` responses** spanning **at least 2 minutes (`120,000 ms`)**, plus a **30-minute (`1,800,000 ms`) recovery cooldown**, preventing transient glitches or abuse from resetting a healthy board.
3. **Safe Re-Provisioning State (`enterCredentialRecoveryMode`)**:
   - Permanently deletes `dev_key` from NVS and RAM (**revoked credentials are never restored**).
   - Keeps saved Wi-Fi STA credentials active (`WIFI_AP_STA`) so local ESP32-CAM `/photo` & `:81/stream` continue uninterrupted, and opens the WPA2-protected `EDENS-SETUP-XXXX` portal for 15 minutes so the farmer can submit a fresh one-time `enr_...` pairing token.
   - On the Main ESP32 Controller, `edensEnforceWatchdogAndRuntimeLimits()` and `edensEnforceLocalSafetyInterlocks()` continue running every `20 ms` loop tick throughout recovery.

---

## 4. Factory Reset & Multi-Zone Replacement

- **ESP32 Controller Factory Reset**: Hold `BOOT` (`GPIO 0`) for **5 seconds** while powered on. Wipes `"edens_cfg"` NVS credentials (`ssid`, `pass`, `dev_key`) while preserving the board's printed `"edens_sec"` WPA2 label key (send `FACTORY_ROTATE_PSK` over local USB Serial if rotating the enclosure label key).
- **ESP32-CAM Re-Provisioning**: Because AI-Thinker ESP32-CAM shares `GPIO 0` with `OV2640 XCLK`, trigger re-provisioning safely by rotating/revoking the camera key in EDENS AI (which triggers automatic `HTTP 401` Credential Recovery Mode) or wiring a dedicated push-button to `GPIO 12`/`13` with `EDENS_FACTORY_RESET_PIN` defined before incluirng `edens_cloud_upload.h`.

---

## 5. Local Hardware Watchdog & Tier-1 Safety Interlocks

Every controller loop cycle feeds the ESP32 hardware task watchdog (`esp_task_wdt`, 30s panic reset) and enforces local Tier-1 protection limits before any cloud logic:
- **Water Tank `< 10.0%` or Sensor Fault**: Pump forced `OFF`
- **Single Pump Pulse `> 120s`**: Pump forced `OFF`
- **Cumulative 24h Pump Runtime `> 900s`**: Pump forced `OFF`
- **Pump Cooldown `< 300s`**: Pump blocked from restarting
- **Temperature `>= 32.0°C` or Sensor Fault**: Heater forced `OFF`
- **Rain Detected**: Motorized roof vent forced `CLOSED`
- **Stale Sensor Loop (`> 45s`) or Physical E-STOP (`GPIO 33`)**: Hazardous actuators forced `OFF`
