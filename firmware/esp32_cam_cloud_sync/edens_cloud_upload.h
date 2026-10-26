#pragma once

/**
 * EDENS AI — Non-Blocking Direct ESP32-CAM -> Cloud HTTPS Upload Module
 *
 * Designed as a drop-in companion header for existing ESP32-CAM firmware
 * that already serves local HTTP endpoints (`/photo`, `/status`, and `:81/stream`).
 *
 * Key Guarantees:
 * 1. Verified HTTPS TLS (`WiFiClientSecure::setCACert`) using authentic Root CAs
 *    (Google Trust Services GTS Root R1, GlobalSign Root CA, and Let's Encrypt ISRG Root X1)
 *    plus NTP UTC clock sync (`configTime`). Never disables TLS verification with `setInsecure()`.
 * 2. Authenticated `POST /api/camera/upload` using `X-Camera-Key` from unversioned `camera_secrets.h`.
 * 3. Non-blocking FreeRTOS background task pinned to Core 0:
 *    Acquires the camera mutex only long enough (~3-5 ms) to copy `fb->buf` into PSRAM/heap
 *    and immediately calls `esp_camera_fb_return(fb)` BEFORE opening the TLS socket.
 *    Local `/photo`, `/status`, and `:81/stream` handlers remain responsive.
 * 4. Automatic Wi-Fi recovery check and bounded exponential retry backoff (5s -> 60s max).
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include "esp_camera.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#if __has_include("camera_secrets.h")
  #include "camera_secrets.h"
#else
  #warning "[EDENS-CAM] camera_secrets.h not found! Copy camera_secrets.example.h to camera_secrets.h and set EDENS_CAMERA_UPLOAD_KEY before flashing."
  #ifndef EDENS_CAMERA_UPLOAD_URL
    #define EDENS_CAMERA_UPLOAD_URL "https://edens-ai.onrender.com/api/camera/upload"
  #endif
  #ifndef EDENS_CAMERA_UPLOAD_KEY
    #define EDENS_CAMERA_UPLOAD_KEY ""
  #endif
  #ifndef EDENS_CAMERA_UPLOAD_INTERVAL_MS
    #define EDENS_CAMERA_UPLOAD_INTERVAL_MS 15000UL
  #endif
#endif

#ifndef EDENS_CAMERA_UPLOAD_URL
  #define EDENS_CAMERA_UPLOAD_URL "https://edens-ai.onrender.com/api/camera/upload"
#endif
#ifndef EDENS_CAMERA_UPLOAD_INTERVAL_MS
  #define EDENS_CAMERA_UPLOAD_INTERVAL_MS 15000UL
#endif
#ifndef EDENS_GREENHOUSE_ID
  #define EDENS_GREENHOUSE_ID ""
#endif
#ifndef EDENS_CAMERA_DEVICE_ID
  #define EDENS_CAMERA_DEVICE_ID ""
#endif

// Root CA PEM Bundle covering Render / Cloudflare / Let's Encrypt TLS certificate chains:
// 1) Google Trust Services LLC — GTS Root R1
// 2) GlobalSign Root CA (cross-signer for GTS)
// 3) Internet Security Research Group — ISRG Root X1 (Let's Encrypt)
static const char EDENS_CLOUD_ROOT_CA_BUNDLE[] PROGMEM =
"-----BEGIN CERTIFICATE-----\n"
"MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw\n"
"CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU\n"
"MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw\n"
"MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp\n"
"Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA\n"
"A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo\n"
"27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w\n"
"Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw\n"
"TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl\n"
"qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH\n"
"szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8\n"
"Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBm\n"
"kMiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc9\n"
"2wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70\n"
"paDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVr\n"
"NVjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQI\n"
"DAQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E\n"
"FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb\n"
"C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe\n"
"QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy\n"
"h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4\n"
"7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J\n"
"ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef\n"
"MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/\n"
"Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT\n"
"6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ\n"
"0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm\n"
"2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb\n"
"bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c\n"
"-----END CERTIFICATE-----\n"
"-----BEGIN CERTIFICATE-----\n"
"MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG\n"
"A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv\n"
"b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw\n"
"MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i\n"
"YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT\n"
"aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ\n"
"jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp\n"
"xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp\n"
"1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG\n"
"snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ\n"
"U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8\n"
"9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E\n"
"BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B\n"
"AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz\n"
"yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE\n"
"38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP\n"
"AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad\n"
"DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME\n"
"HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==\n"
"-----END CERTIFICATE-----\n"
"-----BEGIN CERTIFICATE-----\n"
"MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\n"
"TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\n"
"cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\n"
"WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\n"
"ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\n"
"MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc\n"
"h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+\n"
"0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U\n"
"A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW\n"
"T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH\n"
"B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC\n"
"B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv\n"
"KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn\n"
"OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn\n"
"jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw\n"
"qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI\n"
"rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV\n"
"HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq\n"
"hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL\n"
"ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ\n"
"3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK\n"
"NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5\n"
"ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur\n"
"TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC\n"
"jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc\n"
"oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq\n"
"4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA\n"
"mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d\n"
"emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=\n"
"-----END CERTIFICATE-----\n";

static SemaphoreHandle_t s_edensCameraMutex = nullptr;
static TaskHandle_t s_edensUploadTaskHandle = nullptr;
static volatile uint32_t s_edensTotalUploaded = 0;
static volatile int s_edensLastHttpCode = 0;

/**
 * Optional mutex helpers so local HTTP `/photo` and `:81/stream` handlers can share
 * the OV2640 sensor cleanly with the background cloud uploader if called concurrently.
 */
inline bool edensAcquireCameraLock(TickType_t timeoutTicks = pdMS_TO_TICKS(1500)) {
  if (!s_edensCameraMutex) return true;
  return xSemaphoreTake(s_edensCameraMutex, timeoutTicks) == pdTRUE;
}

inline void edensReleaseCameraLock() {
  if (s_edensCameraMutex) {
    xSemaphoreGive(s_edensCameraMutex);
  }
}

inline bool edensEnsureValidUtcClock() {
  time_t now = time(nullptr);
  // X.509 certificate verification requires a valid system clock (> 2024-01-01 UTC)
  if (now > 1704067200) {
    return true;
  }
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com", "time.google.com");
  for (int i = 0; i < 20; ++i) {
    vTaskDelay(pdMS_TO_TICKS(250));
    now = time(nullptr);
    if (now > 1704067200) {
      return true;
    }
  }
  return false;
}

inline bool edensIsCompleteJpeg(const uint8_t* buf, size_t len) {
  if (!buf || len < 64) return false;
  if (buf[0] != 0xFF || buf[1] != 0xD8 || buf[2] != 0xFF) return false;
  // Scan last 16 bytes for EOI marker (0xFF 0xD9)
  size_t scanStart = len > 16 ? len - 16 : 2;
  for (size_t i = len - 2; i >= scanStart; --i) {
    if (buf[i] == 0xFF && buf[i + 1] == 0xD9) {
      return true;
    }
    if (i == scanStart) break;
  }
  return false;
}

inline bool edensUploadSingleSnapshot() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    return false;
  }

  const char* uploadKey = EDENS_CAMERA_UPLOAD_KEY;
  if (!uploadKey || strlen(uploadKey) == 0 || strcmp(uploadKey, "REPLACE_WITH_RENDER_CAMERA_UPLOAD_KEY") == 0) {
    Serial.println("[EDENS-CAM] Upload skipped: EDENS_CAMERA_UPLOAD_KEY not configured in camera_secrets.h");
    return false;
  }

  if (!edensEnsureValidUtcClock()) {
    Serial.println("[EDENS-CAM] Waiting for NTP UTC clock sync before verified TLS upload...");
    return false;
  }

  // 1. Capture JPEG frame quickly and copy to PSRAM/heap so camera buffer is released immediately
  if (!edensAcquireCameraLock(pdMS_TO_TICKS(1000))) {
    return false; // Camera busy with local /stream or /photo client; retry next cycle without blocking
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    edensReleaseCameraLock();
    Serial.println("[EDENS-CAM] esp_camera_fb_get() returned nullptr");
    return false;
  }

  if (fb->format != PIXFORMAT_JPEG || !edensIsCompleteJpeg(fb->buf, fb->len)) {
    esp_camera_fb_return(fb);
    edensReleaseCameraLock();
    Serial.println("[EDENS-CAM] Captured frame is not a complete JPEG");
    return false;
  }

  size_t jpegLen = fb->len;
  uint8_t* copyBuf = nullptr;
  if (psramFound()) {
    copyBuf = static_cast<uint8_t*>(heap_caps_malloc(jpegLen, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  }
  if (!copyBuf) {
    copyBuf = static_cast<uint8_t*>(malloc(jpegLen));
  }

  if (!copyBuf) {
    esp_camera_fb_return(fb);
    edensReleaseCameraLock();
    Serial.println("[EDENS-CAM] Insufficient RAM to stage JPEG copy for background upload");
    return false;
  }

  memcpy(copyBuf, fb->buf, jpegLen);
  esp_camera_fb_return(fb);
  edensReleaseCameraLock();

  // Format ISO-8601 UTC capture timestamp
  time_t capturedEpoch = time(nullptr);
  struct tm utcTm;
  gmtime_r(&capturedEpoch, &utcTm);
  char isoTimestamp[28];
  strftime(isoTimestamp, sizeof(isoTimestamp), "%Y-%m-%dT%H:%M:%SZ", &utcTm);

  // 2. Perform verified HTTPS POST to EDENS AI cloud outside the camera lock
  WiFiClientSecure secureClient;
  secureClient.setCACert(EDENS_CLOUD_ROOT_CA_BUNDLE);
  secureClient.setTimeout(12); // seconds

  HTTPClient https;
  https.setConnectTimeout(10000);
  https.setTimeout(15000);

  bool ok = false;
  if (https.begin(secureClient, EDENS_CAMERA_UPLOAD_URL)) {
    https.addHeader("Content-Type", "image/jpeg");
    https.addHeader("X-Camera-Key", uploadKey);
    https.addHeader("X-Captured-At", isoTimestamp);
    if (strlen(EDENS_GREENHOUSE_ID) > 0) {
      https.addHeader("X-Greenhouse-Id", EDENS_GREENHOUSE_ID);
    }
    if (strlen(EDENS_CAMERA_DEVICE_ID) > 0) {
      https.addHeader("X-Device-Id", EDENS_CAMERA_DEVICE_ID);
    }

    int httpCode = https.POST(copyBuf, jpegLen);
    s_edensLastHttpCode = httpCode;

    if (httpCode == 200) {
      s_edensTotalUploaded++;
      ok = true;
      Serial.printf("[EDENS-CAM] Cloud upload OK (HTTP 200, %u bytes, total=%lu)\n",
                    static_cast<unsigned>(jpegLen),
                    static_cast<unsigned long>(s_edensTotalUploaded));
    } else {
      Serial.printf("[EDENS-CAM] Cloud upload failed (HTTP %d): %s\n",
                    httpCode,
                    https.errorToString(httpCode).c_str());
    }
    https.end();
  } else {
    Serial.println("[EDENS-CAM] Failed to initialize HTTPS connection");
  }

  free(copyBuf);
  return ok;
}

inline void edensCloudUploadTaskLoop(void* /*param*/) {
  uint32_t consecutiveFailures = 0;
  const uint32_t baseIntervalMs =
    EDENS_CAMERA_UPLOAD_INTERVAL_MS < 5000UL ? 5000UL : EDENS_CAMERA_UPLOAD_INTERVAL_MS;

  // Brief startup delay so Wi-Fi & local HTTP server settle cleanly
  vTaskDelay(pdMS_TO_TICKS(3000));

  for (;;) {
    bool uploaded = edensUploadSingleSnapshot();
    if (uploaded) {
      consecutiveFailures = 0;
      vTaskDelay(pdMS_TO_TICKS(baseIntervalMs));
    } else {
      consecutiveFailures++;
      uint32_t shift = consecutiveFailures > 4 ? 4 : (consecutiveFailures - 1);
      uint32_t backoffMs = 5000UL * (1UL << shift);
      if (backoffMs > 60000UL) backoffMs = 60000UL;
      vTaskDelay(pdMS_TO_TICKS(backoffMs));
    }
  }
}

/**
 * Call once at the end of `setup()` after `WiFi.begin(...)` and `startCameraServer()`.
 */
inline void edensStartCloudUploadTask() {
  if (!s_edensCameraMutex) {
    s_edensCameraMutex = xSemaphoreCreateMutex();
  }
  if (!s_edensUploadTaskHandle) {
    // 10 KB stack accommodates mbedTLS X.509 handshake on Core 0
    xTaskCreatePinnedToCore(
      edensCloudUploadTaskLoop,
      "edens_cam_sync",
      10240,
      nullptr,
      1,
      &s_edensUploadTaskHandle,
      0
    );
    Serial.println("[EDENS-CAM] Background verified HTTPS upload task started.");
  }
}
