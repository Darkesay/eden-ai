#pragma once
/**
 * ============================================================================
 * EDENS AI — Non-Destructive ESP32 Controller Telemetry & Safety Sync Module
 * File: firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/edens_controller_sync.h
 * Version: 3.0.0-pnp-sec
 * ============================================================================
 *
 * Capabilities:
 *  - Plug-and-Play NVS + WPA2-PSK SoftAP Provisioning via `EdensPnpProvisioner`.
 *  - Safe HTTP 401 Credential Recovery: distinguishes explicit cloud key
 *    revocation/rotation (`401` + `UNAUTHORIZED_DEVICE`/`DEVICE_REVOKED`) from
 *    temporary Wi-Fi/DNS/5xx errors; requires 10 consecutive verified `401`s
 *    over >=120s (with 30m anti-abuse cooldown) before entering recovery mode;
 *    never restores revoked keys.
 *  - Hardware & Software Watchdog (`esp_task_wdt` + `EdensLocalRuntimeGuard`):
 *    enforces local Tier-1 safety interlocks every loop tick (even offline or
 *    during credential recovery):
 *      1. Water tank < 10.0% OR unreported -> Pump forced OFF
 *      2. Pump single pulse > 120s -> Pump forced OFF
 *      3. Pump 24h cumulative runtime > 900s -> Pump forced OFF
 *      4. Pump cooldown < 300s after previous run -> Pump forced OFF
 *      5. Canopy temperature >= 32.0°C OR unreported -> Heater forced OFF
 *      6. Rain detected -> Motorized roof vent forced CLOSED
 *      7. Stale sensor sample (> 45s) OR Emergency Stop -> Hazardous actuators OFF
 *  - Verified HTTPS TLS (`WiFiClientSecure::setCACert`) — `setInsecure()` forbidden.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <math.h>
#include <esp_task_wdt.h>
#if __has_include(<esp_idf_version.h>)
#include <esp_idf_version.h>
#endif

#include "../edens_pnp_provisioning.h"

#if __has_include("controller_secrets.h")
#include "controller_secrets.h"
#endif

#ifndef EDENS_WIFI_SSID
#define EDENS_WIFI_SSID ""
#endif
#ifndef EDENS_WIFI_PASSWORD
#define EDENS_WIFI_PASSWORD ""
#endif
#ifndef EDENS_GREENHOUSE_ID
#define EDENS_GREENHOUSE_ID ""
#endif
#ifndef EDENS_CONTROLLER_DEVICE_ID
#define EDENS_CONTROLLER_DEVICE_ID ""
#endif
#ifndef EDENS_TELEMETRY_UPLOAD_URL
#define EDENS_TELEMETRY_UPLOAD_URL ""
#endif
#ifndef EDENS_CONTROLLER_DEVICE_KEY
#define EDENS_CONTROLLER_DEVICE_KEY ""
#endif
#ifndef EDENS_TELEMETRY_INTERVAL_MS
#define EDENS_TELEMETRY_INTERVAL_MS 10000UL
#endif

#ifndef EDENS_CONTROLLER_FIRMWARE_VERSION
#define EDENS_CONTROLLER_FIRMWARE_VERSION "EDENS-ESP32-CTRL-v3.0-pnp"
#endif

#ifndef EDENS_CTRL_ROOT_CA_BUNDLE
#define EDENS_CTRL_ROOT_CA_BUNDLE EDENS_PNP_ROOT_CA_PEM
#endif

// Watchdog & Tier-1 Local Hardware Safety Constants
#ifndef EDENS_WDT_TIMEOUT_SECONDS
#define EDENS_WDT_TIMEOUT_SECONDS 30
#endif
#ifndef EDENS_LOCAL_STALE_SENSOR_LOCK_MS
#define EDENS_LOCAL_STALE_SENSOR_LOCK_MS 45000UL
#endif
#ifndef EDENS_LOCAL_MAX_PUMP_PULSE_MS
#define EDENS_LOCAL_MAX_PUMP_PULSE_MS 120000UL
#endif
#ifndef EDENS_LOCAL_PUMP_COOLDOWN_MS
#define EDENS_LOCAL_PUMP_COOLDOWN_MS 300000UL
#endif
#ifndef EDENS_LOCAL_MAX_DAILY_PUMP_MS
#define EDENS_LOCAL_MAX_DAILY_PUMP_MS 900000UL
#endif

// HTTP 401 Credential Recovery Thresholds & Anti-Abuse Guards
#ifndef EDENS_AUTH_RECOVERY_THRESHOLD
#define EDENS_AUTH_RECOVERY_THRESHOLD 10
#endif
#ifndef EDENS_AUTH_RECOVERY_MIN_SPAN_MS
#define EDENS_AUTH_RECOVERY_MIN_SPAN_MS 120000UL
#endif
#ifndef EDENS_AUTH_RECOVERY_COOLDOWN_MS
#define EDENS_AUTH_RECOVERY_COOLDOWN_MS 1800000UL
#endif

#ifndef EDENS_CONTROLLER_DEFAULT_CAPABILITIES_JSON
#define EDENS_CONTROLLER_DEFAULT_CAPABILITIES_JSON \
  "{\"sensors\":[\"dht22_temp_humidity\",\"capacitive_soil_moisture\",\"water_tank_ultrasonic\",\"ldr_sunlight\",\"rain_detector\",\"battery_voltage\"],\"actuators\":[\"pump\",\"fan\",\"heater\",\"grow_light\",\"roof_vent\"]}"
#endif

enum EdensSensorHealth : uint8_t {
  EDENS_SENSOR_OK = 0,
  EDENS_SENSOR_UNAVAILABLE = 1,
  EDENS_SENSOR_DISCONNECTED = 2,
  EDENS_SENSOR_OUT_OF_RANGE = 3
};

inline const char* edensHealthToStr(EdensSensorHealth h) {
  switch (h) {
    case EDENS_SENSOR_OK:           return "OK";
    case EDENS_SENSOR_DISCONNECTED: return "DISCONNECTED";
    case EDENS_SENSOR_OUT_OF_RANGE: return "OUT_OF_RANGE";
    default:                        return "UNAVAILABLE";
  }
}

struct EdensSensorSnapshot {
  float temperatureC = NAN;
  float humidityPct = NAN;
  float soilMoisturePct = NAN;
  float sunlightLux = NAN;
  float growLightLux = NAN;
  float waterLevelPct = NAN;
  float batteryVoltage = NAN;
  int8_t rainDetected = -1;
  float rainGaugeMm = NAN;

  EdensSensorHealth dht22Health = EDENS_SENSOR_UNAVAILABLE;
  EdensSensorHealth soilHealth = EDENS_SENSOR_UNAVAILABLE;
  EdensSensorHealth ldrHealth = EDENS_SENSOR_UNAVAILABLE;
  EdensSensorHealth waterHealth = EDENS_SENSOR_UNAVAILABLE;
  EdensSensorHealth rainHealth = EDENS_SENSOR_UNAVAILABLE;
  EdensSensorHealth powerHealth = EDENS_SENSOR_UNAVAILABLE;
};

struct EdensActuatorSnapshot {
  bool pumpActive = false;
  bool fanActive = false;
  bool heaterActive = false;
  bool growLightActive = false;
  bool roofOpen = false;
};

struct EdensSafetyInterlocks {
  bool waterLowLocked = false;
  bool heaterOvertempLocked = false;
  bool rainRoofLocked = false;
  bool pumpPulseLimitLocked = false;
  bool pumpCooldownLocked = false;
  bool pumpDailyCapLocked = false;
  bool staleSensorLocked = false;
  bool emergencyStopLocked = false;
};

struct EdensLocalRuntimeGuard {
  unsigned long lastSensorUpdateMs = 0;
  bool prevPumpActive = false;
  unsigned long pumpTurnedOnAtMs = 0;
  unsigned long pumpLastTurnedOffAtMs = 0;
  unsigned long dayWindowStartMs = 0;
  unsigned long cumulativePumpMsInWindow = 0;
  unsigned long lastTickMs = 0;
  bool emergencyStopActive = false;
};

/**
 * Authoritative Local Hardware Safety Interlock Enforcer.
 * Runs locally on the ESP32 every control cycle BEFORE and INDEPENDENTLY OF
 * any Wi-Fi, cloud, or credential recovery state.
 */
inline void edensEnforceLocalSafetyInterlocks(
  const EdensSensorSnapshot& sensors,
  EdensActuatorSnapshot& actuators,
  EdensSafetyInterlocks* interlocksOut = nullptr
) {
  EdensSafetyInterlocks locks;

  // 1. Water tank low-level dry-run lock (< 10.0% OR water sensor fault)
  if (isnan(sensors.waterLevelPct) ||
      sensors.waterHealth != EDENS_SENSOR_OK ||
      sensors.waterLevelPct < 10.0f) {
    locks.waterLowLocked = true;
    actuators.pumpActive = false;
  }

  // 2. Heater over-temperature lock (>= 32.0°C OR temperature sensor fault)
  if (isnan(sensors.temperatureC) ||
      sensors.dht22Health != EDENS_SENSOR_OK ||
      sensors.temperatureC >= 32.0f) {
    locks.heaterOvertempLocked = true;
    actuators.heaterActive = false;
  }

  // 3. Rain intrusion lock (close motorized roof vent immediately if raining)
  if (sensors.rainDetected == 1) {
    locks.rainRoofLocked = true;
    actuators.roofOpen = false;
  }

  if (interlocksOut != nullptr) {
    interlocksOut->waterLowLocked = locks.waterLowLocked;
    interlocksOut->heaterOvertempLocked = locks.heaterOvertempLocked;
    interlocksOut->rainRoofLocked = locks.rainRoofLocked;
  }
}

/**
 * Enforces local runtime, cooldown, cumulative daily cap, stale-sensor lock,
 * and local Emergency Stop failsafes in addition to Tier-1 sensor interlocks.
 */
inline void edensEnforceWatchdogAndRuntimeLimits(
  const EdensSensorSnapshot& sensors,
  EdensActuatorSnapshot& actuators,
  EdensLocalRuntimeGuard& guard,
  EdensSafetyInterlocks* interlocksOut = nullptr
) {
  unsigned long nowMs = millis();

  // Roll 24h cumulative pump counter window
  if (guard.dayWindowStartMs == 0 || (nowMs - guard.dayWindowStartMs) >= 86400000UL) {
    guard.dayWindowStartMs = nowMs;
    guard.cumulativePumpMsInWindow = 0;
  }

  unsigned long dtMs = (guard.lastTickMs > 0 && nowMs >= guard.lastTickMs) ? (nowMs - guard.lastTickMs) : 0;
  guard.lastTickMs = nowMs;

  if (interlocksOut != nullptr) {
    interlocksOut->pumpPulseLimitLocked = false;
    interlocksOut->pumpCooldownLocked = false;
    interlocksOut->pumpDailyCapLocked = false;
    interlocksOut->staleSensorLocked = false;
    interlocksOut->emergencyStopLocked = false;
  }

  // 1. Local Emergency Stop
  if (guard.emergencyStopActive) {
    actuators.pumpActive = false;
    actuators.heaterActive = false;
    actuators.fanActive = false;
    actuators.growLightActive = false;
    actuators.roofOpen = false;
    if (interlocksOut) interlocksOut->emergencyStopLocked = true;
  }

  // 2. Stale sensor sample protection (> 45s since fresh sensor read)
  if (guard.lastSensorUpdateMs > 0 && (nowMs - guard.lastSensorUpdateMs) > EDENS_LOCAL_STALE_SENSOR_LOCK_MS) {
    actuators.pumpActive = false;
    actuators.heaterActive = false;
    if (interlocksOut) interlocksOut->staleSensorLocked = true;
  }

  // 3. Apply Tier-1 water, heater, and rain interlocks
  edensEnforceLocalSafetyInterlocks(sensors, actuators, interlocksOut);

  // 4. Pump cooldown, single-pulse ceiling (120s), and 24h cumulative cap (900s)
  if (actuators.pumpActive) {
    if (!guard.prevPumpActive) {
      if (guard.pumpLastTurnedOffAtMs > 0 &&
          (nowMs - guard.pumpLastTurnedOffAtMs) < EDENS_LOCAL_PUMP_COOLDOWN_MS) {
        actuators.pumpActive = false;
        if (interlocksOut) interlocksOut->pumpCooldownLocked = true;
      } else {
        guard.pumpTurnedOnAtMs = nowMs;
      }
    }

    if (actuators.pumpActive) {
      guard.cumulativePumpMsInWindow += dtMs;
      if ((nowMs - guard.pumpTurnedOnAtMs) >= EDENS_LOCAL_MAX_PUMP_PULSE_MS) {
        actuators.pumpActive = false;
        guard.pumpLastTurnedOffAtMs = nowMs;
        if (interlocksOut) interlocksOut->pumpPulseLimitLocked = true;
      } else if (guard.cumulativePumpMsInWindow >= EDENS_LOCAL_MAX_DAILY_PUMP_MS) {
        actuators.pumpActive = false;
        guard.pumpLastTurnedOffAtMs = nowMs;
        if (interlocksOut) interlocksOut->pumpDailyCapLocked = true;
      }
    }
  } else if (guard.prevPumpActive) {
    guard.pumpLastTurnedOffAtMs = nowMs;
  }

  guard.prevPumpActive = actuators.pumpActive;
}

typedef void (*EdensReadSensorsFn)(EdensSensorSnapshot& outSensors, EdensActuatorSnapshot& outActuators);
typedef void (*EdensApplySafeActuatorsFn)(const EdensActuatorSnapshot& safeActuators);

class EdensControllerTelemetrySync {
public:
  EdensControllerTelemetrySync()
    : m_pnp(
        "esp32_controller",
        EDENS_CONTROLLER_FIRMWARE_VERSION,
        EDENS_CONTROLLER_DEFAULT_CAPABILITIES_JSON
      ) {}

  void begin(
    EdensReadSensorsFn readFn,
    EdensApplySafeActuatorsFn applySafeFn = nullptr,
    bool enableResetPin = true
  ) {
    m_readFn = readFn;
    m_applySafeFn = applySafeFn;

    initHardwareWatchdog();

    m_pnp.setCompileTimeFallback(
      EDENS_WIFI_SSID,
      EDENS_WIFI_PASSWORD,
      EDENS_TELEMETRY_UPLOAD_URL,
      EDENS_GREENHOUSE_ID,
      EDENS_CONTROLLER_DEVICE_ID,
      EDENS_CONTROLLER_DEVICE_KEY
    );
    m_pnp.begin(enableResetPin);
  }

  void setLocalEmergencyStop(bool active) {
    m_runtimeGuard.emergencyStopActive = active;
  }

  /**
   * Non-blocking periodic sync + watchdog + local safety interlocks.
   * Call inside `loop()`.
   */
  void tick() {
    feedHardwareWatchdog();

    // 1. ALWAYS run local sensor read + watchdog + Tier-1 safety interlocks FIRST!
    // Even if Wi-Fi is down or device is in HTTP 401 Credential Recovery Mode,
    // physical greenhouse safety is never interrupted.
    EdensSensorSnapshot reading;
    if (m_readFn != nullptr) {
      m_readFn(reading, m_actuators);
      m_runtimeGuard.lastSensorUpdateMs = millis();
      edensEnforceWatchdogAndRuntimeLimits(reading, m_actuators, m_runtimeGuard, &m_interlocks);
      if (m_applySafeFn != nullptr) {
        m_applySafeFn(m_actuators);
      }
      m_hasLatestReading = true;
      m_latestReading = reading;
    }

    // 2. Service PnP SoftAP portal, session timeout, physical reset button, and Wi-Fi reconnect
    m_pnp.tick();

    if (!m_pnp.isReadyForCloudSync() || !m_hasLatestReading) {
      return;
    }

    unsigned long now = millis();
    unsigned long effectiveInterval = m_backoffMs > EDENS_TELEMETRY_INTERVAL_MS
      ? m_backoffMs
      : EDENS_TELEMETRY_INTERVAL_MS;

    if (now - m_lastAttemptMs < effectiveInterval) {
      return;
    }
    m_lastAttemptMs = now;

    String payload = buildJsonPayload(m_latestReading, m_actuators, m_interlocks);
    bool ok = postTelemetry(payload);
    if (ok) {
      m_backoffMs = EDENS_TELEMETRY_INTERVAL_MS;
    } else {
      m_backoffMs = min(60000UL, max((unsigned long)EDENS_TELEMETRY_INTERVAL_MS, m_backoffMs * 2UL));
    }
  }

  EdensPnpProvisioner& provisioner() {
    return m_pnp;
  }

  uint16_t consecutiveAuthFailures() const {
    return m_consecutiveAuthFailures;
  }

private:
  EdensPnpProvisioner m_pnp;
  EdensReadSensorsFn m_readFn = nullptr;
  EdensApplySafeActuatorsFn m_applySafeFn = nullptr;
  EdensSensorSnapshot m_latestReading;
  EdensActuatorSnapshot m_actuators;
  EdensSafetyInterlocks m_interlocks;
  EdensLocalRuntimeGuard m_runtimeGuard;
  bool m_hasLatestReading = false;
  bool m_wdtRegistered = false;

  unsigned long m_lastAttemptMs = 0;
  unsigned long m_backoffMs = EDENS_TELEMETRY_INTERVAL_MS;

  // Consecutive HTTP 401 Credential Recovery state (strictly separated from network errors)
  uint16_t m_consecutiveAuthFailures = 0;
  unsigned long m_firstAuthFailureMs = 0;
  unsigned long m_lastAuthRecoveryAtMs = 0;

  void initHardwareWatchdog() {
#if defined(ESP_IDF_VERSION) && ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
    esp_task_wdt_config_t twdtConfig = {
      .timeout_ms = EDENS_WDT_TIMEOUT_SECONDS * 1000,
      .idle_core_mask = 0,
      .trigger_panic = true
    };
    esp_task_wdt_reconfigure(&twdtConfig);
#else
    esp_task_wdt_init(EDENS_WDT_TIMEOUT_SECONDS, true);
#endif
    if (esp_task_wdt_add(NULL) == ESP_OK) {
      m_wdtRegistered = true;
    }
  }

  void feedHardwareWatchdog() {
    if (m_wdtRegistered) {
      esp_task_wdt_reset();
    }
  }

  static bool isVerifiedServerAuthRejection(int httpCode, const String& respBody) {
    if (httpCode != 401) return false;
    return respBody.indexOf("UNAUTHORIZED_DEVICE") >= 0 ||
           respBody.indexOf("DEVICE_REVOKED") >= 0 ||
           respBody.indexOf("INVALID_HARDWARE_KEY") >= 0 ||
           respBody.indexOf("MISSING_HARDWARE_KEY") >= 0;
  }

  void handleUploadAuthOutcome(int httpCode, const String& respBody) {
    if (httpCode >= 200 && httpCode < 300) {
      m_consecutiveAuthFailures = 0;
      m_firstAuthFailureMs = 0;
      return;
    }

    // Network errors (<=0), timeouts (408), rate limits (429), and 5xx proxy errors
    // are temporary transport conditions and MUST NOT increment auth failure count!
    if (!isVerifiedServerAuthRejection(httpCode, respBody)) {
      return;
    }

    unsigned long nowMs = millis();
    if (m_consecutiveAuthFailures == 0) {
      m_firstAuthFailureMs = nowMs;
    }
    m_consecutiveAuthFailures++;

    Serial.printf(
      "[EDENS Sync SECURITY] Verified HTTP 401 auth rejection (%u/%u).\n",
      m_consecutiveAuthFailures,
      (unsigned)EDENS_AUTH_RECOVERY_THRESHOLD
    );

    bool spanMet = (nowMs - m_firstAuthFailureMs) >= EDENS_AUTH_RECOVERY_MIN_SPAN_MS;
    bool cooldownMet =
      (m_lastAuthRecoveryAtMs == 0) ||
      ((nowMs - m_lastAuthRecoveryAtMs) >= EDENS_AUTH_RECOVERY_COOLDOWN_MS);

    if (m_consecutiveAuthFailures >= EDENS_AUTH_RECOVERY_THRESHOLD && spanMet && cooldownMet) {
      m_lastAuthRecoveryAtMs = nowMs;
      m_consecutiveAuthFailures = 0;
      m_firstAuthFailureMs = 0;
      m_pnp.enterCredentialRecoveryMode("CONTROLLER_HTTP_401_REVOKED_OR_ROTATED");
    }
  }

  static void appendNullableFloat(String& out, const char* key, float val, int decimals = 1, bool trailingComma = true) {
    out += "\"";
    out += key;
    out += "\":";
    if (isnan(val) || isinf(val)) {
      out += "null";
    } else {
      out += String(val, decimals);
    }
    if (trailingComma) out += ",";
  }

  String buildJsonPayload(
    const EdensSensorSnapshot& s,
    const EdensActuatorSnapshot& a,
    const EdensSafetyInterlocks& l
  ) {
    const EdensProvisionedConfig& cfg = m_pnp.config();
    String json;
    json.reserve(960);
    json += "{\"greenhouseId\":\"";
    json += cfg.greenhouseId;
    json += "\",\"deviceId\":\"";
    json += cfg.deviceId;
    if (cfg.zoneId.length() > 0) {
      json += "\",\"zoneId\":\"";
      json += cfg.zoneId;
    }
    json += "\",\"telemetry\":{";

    appendNullableFloat(json, "temperature", s.temperatureC, 1);
    appendNullableFloat(json, "humidity", s.humidityPct, 1);
    appendNullableFloat(json, "soilMoisture", s.soilMoisturePct, 1);
    appendNullableFloat(json, "sunlight", s.sunlightLux, 0);
    appendNullableFloat(json, "growLight", s.growLightLux, 0);
    appendNullableFloat(json, "waterLevel", s.waterLevelPct, 1);
    appendNullableFloat(json, "batteryVoltage", s.batteryVoltage, 2);

    json += "\"rain\":";
    if (s.rainDetected < 0) json += "null,";
    else json += (s.rainDetected > 0 ? "true," : "false,");

    appendNullableFloat(json, "rainGaugeLevel", s.rainGaugeMm, 1);

    json += "\"sensorHealth\":{";
    json += "\"dht22\":\"";        json += edensHealthToStr(s.dht22Health);  json += "\",";
    json += "\"soilMoisture\":\""; json += edensHealthToStr(s.soilHealth);   json += "\",";
    json += "\"ldr\":\"";          json += edensHealthToStr(s.ldrHealth);    json += "\",";
    json += "\"waterLevel\":\"";   json += edensHealthToStr(s.waterHealth);  json += "\",";
    json += "\"rain\":\"";         json += edensHealthToStr(s.rainHealth);   json += "\",";
    json += "\"power\":\"";        json += edensHealthToStr(s.powerHealth);  json += "\"";
    json += "},";

    json += "\"actuators\":{";
    json += "\"pumpActive\":";      json += (a.pumpActive ? "true," : "false,");
    json += "\"fanActive\":";       json += (a.fanActive ? "true," : "false,");
    json += "\"heaterActive\":";    json += (a.heaterActive ? "true," : "false,");
    json += "\"growLightActive\":"; json += (a.growLightActive ? "true," : "false,");
    json += "\"roofOpen\":";        json += (a.roofOpen ? "true" : "false");
    json += "},";

    json += "\"interlocks\":{";
    json += "\"waterLowLocked\":";         json += (l.waterLowLocked ? "true," : "false,");
    json += "\"heaterOvertempLocked\":";   json += (l.heaterOvertempLocked ? "true," : "false,");
    json += "\"rainRoofLocked\":";         json += (l.rainRoofLocked ? "true," : "false,");
    json += "\"pumpPulseLimitLocked\":";   json += (l.pumpPulseLimitLocked ? "true," : "false,");
    json += "\"pumpCooldownLocked\":";     json += (l.pumpCooldownLocked ? "true," : "false,");
    json += "\"pumpDailyCapLocked\":";     json += (l.pumpDailyCapLocked ? "true," : "false,");
    json += "\"staleSensorLocked\":";      json += (l.staleSensorLocked ? "true," : "false,");
    json += "\"emergencyStopLocked\":";    json += (l.emergencyStopLocked ? "true" : "false");
    json += "},";

    json += "\"deviceHealth\":{";
    json += "\"firmwareVersion\":\"";        json += EDENS_CONTROLLER_FIRMWARE_VERSION; json += "\",";
    json += "\"hardwareIdentityUid\":\"";    json += cfg.hardwareUid; json += "\",";
    json += "\"wifiRssi\":";                 json += String(WiFi.RSSI()); json += ",";
    json += "\"uptimeSeconds\":";            json += String(millis() / 1000UL); json += ",";
    json += "\"freeHeapBytes\":";            json += String(ESP.getFreeHeap()); json += ",";
    json += "\"watchdogActive\":true,";
    json += "\"localSafetyControlActive\":true";
    json += "}";

    json += "}}";
    return json;
  }

  bool postTelemetry(const String& jsonBody) {
    const EdensProvisionedConfig& cfg = m_pnp.config();
    String targetUrl = cfg.uploadUrl.length() > 0
      ? cfg.uploadUrl
      : (cfg.cloudOrigin + "/api/telemetry/upload");

    HTTPClient http;
    WiFiClientSecure secureClient;
    WiFiClient plainClient;

    bool isHttps = targetUrl.startsWith("https://");
    if (isHttps) {
      secureClient.setCACert(EDENS_CTRL_ROOT_CA_BUNDLE);
      secureClient.setTimeout(10);
      if (!http.begin(secureClient, targetUrl)) {
        Serial.println("[EDENS Sync] Failed to initialize HTTPS client.");
        return false;
      }
    } else {
      if (!http.begin(plainClient, targetUrl)) {
        Serial.println("[EDENS Sync] Failed to initialize HTTP client.");
        return false;
      }
    }

    http.setTimeout(8000);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Hardware-Key", cfg.deviceKey);
    http.addHeader("X-Greenhouse-Id", cfg.greenhouseId);
    http.addHeader("X-Device-Id", cfg.deviceId);
    if (cfg.zoneId.length() > 0) {
      http.addHeader("X-Zone-Id", cfg.zoneId);
    }

    int httpCode = http.POST(jsonBody);
    String respBody = httpCode > 0 ? http.getString() : "";
    http.end();

    handleUploadAuthOutcome(httpCode, respBody);

    if (httpCode >= 200 && httpCode < 300) {
      return true;
    }

    Serial.printf("[EDENS Sync] Upload HTTP status=%d\n", httpCode);
    return false;
  }
};
