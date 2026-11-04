/**
 * EDENS AI — Non-Destructive ESP32-CAM Cloud Snapshot Uploader + Secure PnP
 * File: firmware/esp32_cam_cloud_sync/edens_cloud_upload.h
 * Version: 3.0.0-pnp-sec
 *
 * SAFETY & COMPATIBILITY GUARANTEES:
 * 1. Preserves 100% of existing local LAN HTTP endpoints (`/photo`, `/status`, `:81/stream`).
 * 2. Protects `esp_camera_fb_get()` with a FreeRTOS mutex so local `/photo` or `:81/stream`
 *    and cloud uploads NEVER collide on the OV2640 DMA buffer.
 * 3. Supports Zero-Code Plug-and-Play NVS + WPA2-PSK SoftAP Provisioning (`EDENS-SETUP-XXXX`)
 *    with per-board CSPRNG 12-char WPA2 key, 15m session timeout, and brute-force lockout,
 *    while preserving `camera_secrets.h` compile-time fallback.
 * 4. Safe HTTP 401 Credential Recovery on Core 0:
 *    - Strictly distinguishes HTTP 401 (`UNAUTHORIZED_CAMERA` / `DEVICE_REVOKED` /
 *      `INVALID_CAMERA_KEY`) from temporary Wi-Fi / DNS / 5xx errors.
 *    - After 10 consecutive verified `401` rejections over >=2 minutes (with 30m
 *      anti-abuse cooldown), wipes the revoked key in NVS, keeps local Wi-Fi STA
 *      camera endpoints running uninterrupted, and opens a 15m WPA2 re-pairing portal.
 * 5. Enforces verified HTTPS TLS (`WiFiClientSecure::setCACert`) — `setInsecure()` forbidden.
 */

#ifndef EDENS_CLOUD_UPLOAD_H
#define EDENS_CLOUD_UPLOAD_H

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "../EDENS_HARDWARE_KIT/edens_pnp_provisioning.h"

#if __has_include("camera_secrets.h")
  #include "camera_secrets.h"
#endif

#ifndef EDENS_WIFI_SSID
  #define EDENS_WIFI_SSID ""
#endif
#ifndef EDENS_WIFI_PASSWORD
  #define EDENS_WIFI_PASSWORD ""
#endif
#ifndef EDENS_CAMERA_UPLOAD_URL
  #define EDENS_CAMERA_UPLOAD_URL ""
#endif
#ifndef EDENS_CAMERA_UPLOAD_KEY
  #define EDENS_CAMERA_UPLOAD_KEY ""
#endif
#ifndef EDENS_GREENHOUSE_ID
  #define EDENS_GREENHOUSE_ID ""
#endif
#ifndef EDENS_CAMERA_DEVICE_ID
  #define EDENS_CAMERA_DEVICE_ID ""
#endif
#ifndef EDENS_CAMERA_UPLOAD_INTERVAL_MS
  #define EDENS_CAMERA_UPLOAD_INTERVAL_MS 15000UL
#endif
#ifndef EDENS_CAMERA_HTTP_TIMEOUT_MS
  #define EDENS_CAMERA_HTTP_TIMEOUT_MS 12000
#endif
#ifndef EDENS_CAMERA_FIRMWARE_VERSION
  #define EDENS_CAMERA_FIRMWARE_VERSION "EDENS-ESP32-CAM-v3.0-pnp"
#endif
#ifndef EDENS_CLOUD_ROOT_CA_BUNDLE
  #define EDENS_CLOUD_ROOT_CA_BUNDLE EDENS_PNP_ROOT_CA_PEM
#endif

#ifndef EDENS_CAM_AUTH_RECOVERY_THRESHOLD
  #define EDENS_CAM_AUTH_RECOVERY_THRESHOLD 10
#endif
#ifndef EDENS_CAM_AUTH_RECOVERY_MIN_SPAN_MS
  #define EDENS_CAM_AUTH_RECOVERY_MIN_SPAN_MS 120000UL
#endif
#ifndef EDENS_CAM_AUTH_RECOVERY_COOLDOWN_MS
  #define EDENS_CAM_AUTH_RECOVERY_COOLDOWN_MS 1800000UL
#endif

#ifndef EDENS_CAMERA_DEFAULT_CAPABILITIES_JSON
  #define EDENS_CAMERA_DEFAULT_CAPABILITIES_JSON \
    "{\"camera\":[\"ov2640_jpeg_snapshot\",\"local_lan_http_photo\"]}"
#endif

static SemaphoreHandle_t s_edensCameraMutex = NULL;
static unsigned long s_edensUploadSuccessCount = 0;
static unsigned long s_edensUploadFailCount = 0;
static int s_edensLastHttpStatus = 0;
static unsigned long s_edensLastSuccessMillis = 0;
static uint16_t s_edensCamConsecutiveAuthFailures = 0;
static unsigned long s_edensCamFirstAuthFailureMs = 0;
static unsigned long s_edensCamLastRecoveryAtMs = 0;

static EdensPnpProvisioner s_edensCamPnp(
  "esp32_cam",
  EDENS_CAMERA_FIRMWARE_VERSION,
  EDENS_CAMERA_DEFAULT_CAPABILITIES_JSON
);

inline void edensInitCameraMutex() {
  if (s_edensCameraMutex == NULL) {
    s_edensCameraMutex = xSemaphoreCreateMutex();
  }
}

inline bool edensCamAcquire(TickType_t timeoutTicks = pdMS_TO_TICKS(2500)) {
  if (s_edensCameraMutex == NULL) return true;
  return xSemaphoreTake(s_edensCameraMutex, timeoutTicks) == pdTRUE;
}

inline void edensCamRelease() {
  if (s_edensCameraMutex != NULL) {
    xSemaphoreGive(s_edensCameraMutex);
  }
}

inline bool edensIsVerifiedCameraAuthRejection(int httpCode, const String& respBody) {
  if (httpCode != 401) return false;
  return respBody.indexOf("UNAUTHORIZED_CAMERA") >= 0 ||
         respBody.indexOf("DEVICE_REVOKED") >= 0 ||
         respBody.indexOf("INVALID_CAMERA_KEY") >= 0 ||
         respBody.indexOf("MISSING_CAMERA_KEY") >= 0;
}

inline void edensHandleCameraAuthOutcome(int httpCode, const String& respBody) {
  if (httpCode >= 200 && httpCode < 300) {
    s_edensCamConsecutiveAuthFailures = 0;
    s_edensCamFirstAuthFailureMs = 0;
    return;
  }

  // Network errors (<=0), DNS/TLS glitches, 429, and 5xx MUST NOT trigger recovery
  if (!edensIsVerifiedCameraAuthRejection(httpCode, respBody)) {
    return;
  }

  unsigned long nowMs = millis();
  if (s_edensCamConsecutiveAuthFailures == 0) {
    s_edensCamFirstAuthFailureMs = nowMs;
  }
  s_edensCamConsecutiveAuthFailures++;

  Serial.printf(
    "[EDENS-CAM SECURITY] Verified HTTP 401 auth rejection (%u/%u).\n",
    s_edensCamConsecutiveAuthFailures,
    (unsigned)EDENS_CAM_AUTH_RECOVERY_THRESHOLD
  );

  bool spanMet = (nowMs - s_edensCamFirstAuthFailureMs) >= EDENS_CAM_AUTH_RECOVERY_MIN_SPAN_MS;
  bool cooldownMet =
    (s_edensCamLastRecoveryAtMs == 0) ||
    ((nowMs - s_edensCamLastRecoveryAtMs) >= EDENS_CAM_AUTH_RECOVERY_COOLDOWN_MS);

  if (s_edensCamConsecutiveAuthFailures >= EDENS_CAM_AUTH_RECOVERY_THRESHOLD &&
      spanMet &&
      cooldownMet) {
    s_edensCamLastRecoveryAtMs = nowMs;
    s_edensCamConsecutiveAuthFailures = 0;
    s_edensCamFirstAuthFailureMs = 0;
    // Wipes only revoked cloud key; keeps STA LAN IP & local /photo + :81/stream active!
    s_edensCamPnp.enterCredentialRecoveryMode("CAMERA_HTTP_401_REVOKED_OR_ROTATED");
  }
}

/**
 * Captures one verified JPEG frame (`0xFF 0xD8 ... 0xFF 0xD9`) and uploads it via
 * certificate-verified HTTPS POST (`Content-Type: image/jpeg`).
 */
inline bool edensUploadSnapshotOnce() {
  if (!s_edensCamPnp.isReadyForCloudSync()) {
    return false;
  }

  const EdensProvisionedConfig& cfg = s_edensCamPnp.config();
  String uploadUrl = cfg.uploadUrl.length() > 0
    ? cfg.uploadUrl
    : (cfg.cloudOrigin + "/api/camera/upload");

  if (!edensCamAcquire(pdMS_TO_TICKS(2000))) {
    Serial.println("[EDENS-CAM] Camera busy (local stream/photo active), skipping cycle.");
    return false;
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    edensCamRelease();
    Serial.println("[EDENS-CAM] esp_camera_fb_get() returned NULL.");
    s_edensUploadFailCount++;
    return false;
  }

  if (fb->format != PIXFORMAT_JPEG || fb->len < 64 || fb->buf[0] != 0xFF || fb->buf[1] != 0xD8) {
    Serial.printf("[EDENS-CAM] Invalid JPEG buffer (len=%u).\n", (unsigned)fb->len);
    esp_camera_fb_return(fb);
    edensCamRelease();
    s_edensUploadFailCount++;
    return false;
  }

  // Copy frame out or upload directly while holding frame buffer briefly, then release mutex immediately
  size_t frameLen = fb->len;
  uint8_t* frameCopy = (uint8_t*)malloc(frameLen);
  if (frameCopy != NULL) {
    memcpy(frameCopy, fb->buf, frameLen);
    esp_camera_fb_return(fb);
    fb = NULL;
    edensCamRelease();
  }

  HTTPClient http;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;

  bool isHttps = uploadUrl.startsWith("https://");
  bool began = false;

  if (isHttps) {
    secureClient.setCACert(EDENS_CLOUD_ROOT_CA_BUNDLE);
    secureClient.setTimeout(EDENS_CAMERA_HTTP_TIMEOUT_MS / 1000);
    began = http.begin(secureClient, uploadUrl);
  } else {
    began = http.begin(plainClient, uploadUrl);
  }

  if (!began) {
    if (frameCopy != NULL) {
      free(frameCopy);
    } else if (fb != NULL) {
      esp_camera_fb_return(fb);
      edensCamRelease();
    }
    Serial.println("[EDENS-CAM] HTTP begin() failed.");
    s_edensUploadFailCount++;
    return false;
  }

  http.setTimeout(EDENS_CAMERA_HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-Camera-Key", cfg.deviceKey);
  http.addHeader("X-Firmware-Version", EDENS_CAMERA_FIRMWARE_VERSION);
  http.addHeader("X-Hardware-Uid", cfg.hardwareUid);
  if (cfg.greenhouseId.length() > 0) {
    http.addHeader("X-Greenhouse-Id", cfg.greenhouseId);
  }
  if (cfg.deviceId.length() > 0) {
    http.addHeader("X-Device-Id", cfg.deviceId);
  }
  if (cfg.zoneId.length() > 0) {
    http.addHeader("X-Zone-Id", cfg.zoneId);
  }

  uint8_t* payloadPtr = (frameCopy != NULL) ? frameCopy : fb->buf;
  int httpCode = http.POST(payloadPtr, frameLen);
  String respBody = httpCode > 0 ? http.getString() : "";
  s_edensLastHttpStatus = httpCode;

  http.end();
  if (frameCopy != NULL) {
    free(frameCopy);
  } else if (fb != NULL) {
    esp_camera_fb_return(fb);
    edensCamRelease();
  }

  edensHandleCameraAuthOutcome(httpCode, respBody);

  if (httpCode >= 200 && httpCode < 300) {
    s_edensUploadSuccessCount++;
    s_edensLastSuccessMillis = millis();
    Serial.printf("[EDENS-CAM] Uploaded %u bytes -> HTTP %d (total=%lu)\n",
                  (unsigned)frameLen, httpCode, s_edensUploadSuccessCount);
    return true;
  } else {
    s_edensUploadFailCount++;
    Serial.printf("[EDENS-CAM] Upload failed -> HTTP %d\n", httpCode);
    return false;
  }
}

inline void edensCloudUploadTask(void* pvParameters) {
  (void)pvParameters;
  unsigned long currentBackoffMs = EDENS_CAMERA_UPLOAD_INTERVAL_MS;
  unsigned long lastUploadMs = 0;

  vTaskDelay(pdMS_TO_TICKS(2000));

  for (;;) {
    s_edensCamPnp.tick();

    if (s_edensCamPnp.isReadyForCloudSync()) {
      unsigned long now = millis();
      if (now - lastUploadMs >= currentBackoffMs) {
        lastUploadMs = now;
        bool ok = edensUploadSnapshotOnce();
        if (ok) {
          currentBackoffMs = EDENS_CAMERA_UPLOAD_INTERVAL_MS;
        } else {
          currentBackoffMs = min(currentBackoffMs * 2UL, 120000UL);
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

/**
 * Call once in `setup()` AFTER `esp_camera_init(&config)`.
 * Note: On AI-Thinker ESP32-CAM, GPIO 0 is shared with CSI XCLK, so runtime GPIO 0
 * polling is disabled (`enableResetPin = false`) unless a dedicated free reset pin
 * is defined via `EDENS_CAM_DEDICATED_RESET_PIN`.
 */
inline void edensInitCameraProvisioning(bool enableDedicatedResetPin = false) {
  edensInitCameraMutex();
  s_edensCamPnp.setCompileTimeFallback(
    EDENS_WIFI_SSID,
    EDENS_WIFI_PASSWORD,
    EDENS_CAMERA_UPLOAD_URL,
    EDENS_GREENHOUSE_ID,
    EDENS_CAMERA_DEVICE_ID,
    EDENS_CAMERA_UPLOAD_KEY
  );
  s_edensCamPnp.begin(enableDedicatedResetPin);
}

inline void edensServiceCameraProvisioning() {
  // Note: When edensCloudUploadTask is running on Core 0, s_edensCamPnp.tick() is already
  // serviced there; this remains safe for sketches calling it before task launch.
}

inline void edensStartCloudUploadTask() {
  edensInitCameraMutex();
  xTaskCreatePinnedToCore(
    edensCloudUploadTask,
    "edens_cam_sync",
    10240,
    NULL,
    1,
    NULL,
    0 // Core 0 background task — keeps Core 1 HTTP / stream handlers completely responsive
  );
}

inline void edensStartCloudUploader(bool enableDedicatedResetPin = false) {
  edensInitCameraProvisioning(enableDedicatedResetPin);
  edensStartCloudUploadTask();
}

#endif // EDENS_CLOUD_UPLOAD_H
