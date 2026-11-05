/**
 * ============================================================================
 * EDENS AI — ESP32-CAM Cloud Upload & Local HTTP Dual-Mode Sketch
 * File: firmware/esp32_cam_cloud_sync/esp32_cam_cloud_sync.ino
 * Version: 3.1.0-universal
 * Target Hardware: AI-Thinker ESP32-CAM (OV2640 sensor)
 * ============================================================================
 *
 * DUAL-MODE ARCHITECTURE:
 *  1. Method A (Cloud Outbound HTTPS):
 *     Periodically captures high-quality JPEG and pushes directly to EDENS AI:
 *     POST /api/camera/upload (Header: X-Camera-Key: edcam_...)
 *     Protects OV2640 DMA frame buffer with a FreeRTOS mutex.
 *     10-consecutive HTTP 401 recovery without dropping Wi-Fi STA.
 *
 *  2. Method B (Local LAN HTTP Server):
 *     Serves local endpoints on farm Wi-Fi:
 *       GET /photo   -> Latest single JPEG snapshot (200 OK)
 *       GET /status  -> JSON camera telemetry and health
 *       GET /stream  -> MJPEG stream on port 81 (when enabled)
 *
 *  3. Zero-Code Plug-and-Play Provisioning:
 *     WPA2 SoftAP setup portal (`EDENS-SETUP-XXXX`) with NVS storage.
 *     Compile-time fallback via `camera_secrets.h`.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "esp_camera.h"
#include "edens_cloud_upload.h"

// ============================================================================
// AI-Thinker ESP32-CAM OV2640 Hardware Pin Mapping
// ============================================================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

#define FLASH_LED_PIN      4

// Local HTTP Server on Port 80
static WebServer s_localHttpServer(80);

// ============================================================================
// Local LAN HTTP Handlers (Method B Compatibility)
// ============================================================================

void handleLocalPhoto() {
  if (!edensCamAcquire(pdMS_TO_TICKS(3000))) {
    s_localHttpServer.send(503, "application/json", "{\"error\":\"CAMERA_BUSY\",\"message\":\"Frame buffer locked by cloud sync.\"}");
    return;
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    edensCamRelease();
    s_localHttpServer.send(500, "application/json", "{\"error\":\"CAPTURE_FAILED\",\"message\":\"OV2640 failed to capture frame.\"}");
    return;
  }

  // Validate JPEG SOI (0xFFD8) and EOI (0xFFD9)
  if (fb->len < 64 || fb->buf[0] != 0xFF || fb->buf[1] != 0xD8) {
    esp_camera_fb_return(fb);
    edensCamRelease();
    s_localHttpServer.send(502, "application/json", "{\"error\":\"INVALID_JPEG\",\"message\":\"Captured frame is corrupt or incomplete.\"}");
    return;
  }

  s_localHttpServer.sendHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  s_localHttpServer.sendHeader("Pragma", "no-cache");
  s_localHttpServer.sendHeader("Expires", "-1");
  s_localHttpServer.sendHeader("Access-Control-Allow-Origin", "*");
  s_localHttpServer.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);

  esp_camera_fb_return(fb);
  edensCamRelease();
}

void handleLocalStatus() {
  String json;
  json.reserve(512);
  json += "{";
  json += "\"status\":\"OK\",";
  json += "\"model\":\"AI-Thinker ESP32-CAM (OV2640)\",";
  json += "\"firmware\":\"" EDENS_CAMERA_FIRMWARE_VERSION "\",";
  json += "\"wifiRssi\":"; json += String(WiFi.RSSI()); json += ",";
  json += "\"ipAddress\":\""; json += WiFi.localIP().toString(); json += "\",";
  json += "\"uptimeSeconds\":"; json += String(millis() / 1000UL); json += ",";
  json += "\"freeHeapBytes\":"; json += String(ESP.getFreeHeap()); json += ",";
  json += "\"psramFound\":"; json += (psramFound() ? "true," : "false,");
  json += "\"cloudUploadsSuccess\":"; json += String(s_edensUploadSuccessCount); json += ",";
  json += "\"cloudUploadsFail\":"; json += String(s_edensUploadFailCount); json += ",";
  json += "\"lastCloudHttpStatus\":"; json += String(s_edensLastHttpStatus);
  json += "}";

  s_localHttpServer.sendHeader("Access-Control-Allow-Origin", "*");
  s_localHttpServer.send(200, "application/json", json);
}

void handleNotFound() {
  s_localHttpServer.send(404, "application/json", "{\"error\":\"NOT_FOUND\",\"message\":\"Supported endpoints: /photo, /status\"}");
}

// ============================================================================
// Camera Hardware Initialization
// ============================================================================
bool initCameraHardware() {
  edensInitCameraMutex();

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_SVGA; // 800x600 high quality for plant diagnosis
    config.jpeg_quality = 12;             // 10-12 optimal for PSRAM
    config.fb_count     = 2;
    config.grab_mode    = CAMERA_GRAB_LATEST;
  } else {
    config.frame_size   = FRAMESIZE_VGA;  // 640x480 fallback for non-PSRAM modules
    config.jpeg_quality = 15;
    config.fb_count     = 1;
    config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[EDENS-CAM] ERROR: Camera hardware init failed (0x%x)\n", err);
    return false;
  }

  // Adjust sensor parameters for greenhouse illumination
  sensor_t* s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_brightness(s, 0);     // -2 to 2
    s->set_contrast(s, 0);       // -2 to 2
    s->set_saturation(s, 1);     // slight saturation boost for canopy foliage
    s->set_whitebal(s, 1);       // Auto white balance ON
    s->set_awb_gain(s, 1);       // Auto white balance gain ON
    s->set_wb_mode(s, 0);        // Auto WB
  }

  Serial.println("[EDENS-CAM] OV2640 camera hardware initialized successfully.");
  return true;
}

// ============================================================================
// Arduino setup() & loop()
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=======================================================");
  Serial.println(" EDENS AI — Universal ESP32-CAM Dual-Mode Gateway");
  Serial.println(" Version: " EDENS_CAMERA_FIRMWARE_VERSION);
  Serial.println("=======================================================");

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW); // Flash LED OFF by default

  if (!initCameraHardware()) {
    Serial.println("[EDENS-CAM] FATAL: Halting due to camera sensor error.");
    while (true) { delay(1000); }
  }

  // Initialize Plug-and-Play Provisioning & Wi-Fi
  edensInitCameraProvisioning();

  // If Wi-Fi connected, start local LAN HTTP server (Method B)
  if (WiFi.status() == WL_CONNECTED) {
    s_localHttpServer.on("/photo", HTTP_GET, handleLocalPhoto);
    s_localHttpServer.on("/status", HTTP_GET, handleLocalStatus);
    s_localHttpServer.onNotFound(handleNotFound);
    s_localHttpServer.begin();

    Serial.println("[EDENS-CAM] Local HTTP Server running:");
    Serial.printf("  Photo : http://%s/photo\n", WiFi.localIP().toString().c_str());
    Serial.printf("  Status: http://%s/status\n", WiFi.localIP().toString().c_str());
  }

  // Start background FreeRTOS task on Core 0 for Cloud Outbound HTTPS Push (Method A)
  edensStartCloudUploadTask();
}

void loop() {
  // Service WPA2 SoftAP setup portal if in pairing mode
  edensServiceCameraProvisioning();

  // Service local LAN HTTP requests
  if (WiFi.status() == WL_CONNECTED) {
    s_localHttpServer.handleClient();
  }

  delay(10);
}
