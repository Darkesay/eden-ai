/**
 * EDENS AI — ESP32-CAM Reference Sketch Integration Example
 *
 * Demonstrates integrating `../../esp32_cam_cloud_sync/edens_cloud_upload.h`
 * alongside an existing AI-Thinker ESP32-CAM sketch that serves local
 * `/photo`, `/status`, and `:81/stream` on the greenhouse LAN.
 */

#include <WiFi.h>
#include "esp_camera.h"

#if __has_include("camera_secrets.h")
  #include "camera_secrets.h"
#else
  #include "camera_secrets.example.h"
#endif

// Prefer local sketch-folder copy (required by Arduino IDE temp build dir), with repo-tree fallback
#if __has_include("edens_cloud_upload.h")
  #include "edens_cloud_upload.h"
#else
  #include "../../esp32_cam_cloud_sync/edens_cloud_upload.h"
#endif

// AI-Thinker ESP32-CAM Standard OV2640 Pin Map (verify if using another board variant such as ESP32-S3-EYE)
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

// Optional hook: call your existing `startCameraServer()` if keeping local `/photo`, `/status`, `:81/stream`
void startLocalLanCameraServerIfPresent() {
  // startCameraServer();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[EDENS-CAM] Initializing ESP32-CAM...");

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = psramFound() ? FRAMESIZE_SVGA : FRAMESIZE_VGA;
  config.jpeg_quality = psramFound() ? 12 : 15;
  config.fb_count = psramFound() ? 2 : 1;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[EDENS-CAM] Camera init failed: 0x%x\n", err);
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (strlen(EDENS_WIFI_SSID) > 0 && strstr(EDENS_WIFI_SSID, "REPLACE_WITH_") == nullptr && EDENS_WIFI_SSID[0] != '<') {
    // SECURITY: Log SSID only; NEVER print EDENS_WIFI_PASSWORD or EDENS_CAMERA_UPLOAD_KEY
    Serial.printf("[EDENS-CAM] Joining 2.4 GHz Wi-Fi SSID: %s\n", EDENS_WIFI_SSID);
    WiFi.begin(EDENS_WIFI_SSID, EDENS_WIFI_PASSWORD);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000UL) {
      delay(250);
    }
  } else {
    Serial.println("[EDENS-CAM] Configure EDENS_WIFI_SSID and EDENS_WIFI_PASSWORD in camera_secrets.h before flashing.");
  }

  startLocalLanCameraServerIfPresent();

  // Launch non-blocking FreeRTOS Core 0 verified-TLS cloud upload task
  edensStartCloudUploadTask();
}

void loop() {
  delay(1000);
}
