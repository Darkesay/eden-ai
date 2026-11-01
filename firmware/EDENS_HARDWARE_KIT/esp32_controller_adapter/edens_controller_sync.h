#pragma once

/**
 * EDENS AI — Main ESP32 Controller Cloud Telemetry & Local Safety Interlock Adapter
 *
 * Security & Reliability Guarantees:
 * 1. Verified HTTPS TLS (`WiFiClientSecure::setCACert`) using Root CAs (Google Trust Services
 *    GTS Root R1, GlobalSign Root CA, and Let's Encrypt ISRG Root X1) + NTP UTC clock sync.
 *    NEVER calls `setInsecure()`.
 * 2. Header-only authentication (`X-Hardware-Key`, `X-Greenhouse-Id`, `X-Device-Id`).
 *    NEVER places secrets in URL query parameters or prints Wi-Fi passwords / API keys to Serial.
 * 3. Honest Sensor Reporting:
 *    - Pass `NAN` for any sensor not wired or failing checksum -> serialized as JSON `null` (`UNREPORTED`).
 *    - Pass `0.0f` for genuine zero readings (e.g. `0%` reservoir or `0.0°C`) -> serialized as `0.00`.
 * 4. Authoritative Local Safety Interlocks:
 *    `edensEnforceLocalSafetyInterlocks(...)` runs locally on the ESP32 before any relay output,
 *    protecting crops and motors even if Wi-Fi or cloud connectivity is completely offline.
 * 5. Resilient Connectivity:
 *    Automatic `WiFi.reconnect()` and bounded exponential retry backoff (5s -> 60s max).
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <math.h>
#include <time.h>

#if __has_include("controller_secrets.h")
  #include "controller_secrets.h"
#else
  #warning "[EDENS-CTRL] controller_secrets.h not found! Copy controller_secrets.example.h to controller_secrets.h before flashing."
#endif

#if !defined(EDENS_CONTROLLER_DEVICE_KEY) && defined(EDENS_HARDWARE_API_KEY)
  #define EDENS_CONTROLLER_DEVICE_KEY EDENS_HARDWARE_API_KEY
#endif
#ifndef EDENS_WIFI_SSID
  #define EDENS_WIFI_SSID ""
#endif
#ifndef EDENS_WIFI_PASSWORD
  #define EDENS_WIFI_PASSWORD ""
#endif
#ifndef EDENS_TELEMETRY_UPLOAD_URL
  #define EDENS_TELEMETRY_UPLOAD_URL "https://edens-ai.onrender.com/api/telemetry/upload"
#endif
#ifndef EDENS_CONTROLLER_DEVICE_KEY
  #define EDENS_CONTROLLER_DEVICE_KEY ""
#endif
#ifndef EDENS_GREENHOUSE_ID
  #define EDENS_GREENHOUSE_ID ""
#endif
#ifndef EDENS_CONTROLLER_DEVICE_ID
  #define EDENS_CONTROLLER_DEVICE_ID ""
#endif
#ifndef EDENS_TELEMETRY_INTERVAL_MS
  #define EDENS_TELEMETRY_INTERVAL_MS 10000UL
#endif

// Root CA PEM Bundle covering Render / Cloudflare / Let's Encrypt TLS certificate chains:
// 1) Google Trust Services LLC — GTS Root R1
// 2) GlobalSign Root CA
// 3) Internet Security Research Group — ISRG Root X1
static const char EDENS_CTRL_ROOT_CA_BUNDLE[] PROGMEM =
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

/**
 * Use `NAN` for any analog/digital sensor that is disconnected, unpopulated, or failed CRC.
 * Genuine `0.0f` readings are preserved as `0.00` in JSON (never conflated with `null`).
 */
struct EdensTelemetrySample {
  float temperatureC = NAN;     // Range: -20 .. 85 °C
  float humidityPct = NAN;      // Range: 0 .. 100 %
  float soilMoisturePct = NAN;  // Range: 0 .. 100 %
  float waterLevelPct = NAN;    // Range: 0 .. 100 % (0.0f triggers dry-run pump lock; NAN = sensor not fitted)
  float sunlightLux = NAN;      // Range: 0 .. 200000 lx
  float growLightLux = NAN;     // Range: 0 .. 200000 lx
  float batteryVoltage = NAN;   // Range: 0 .. 36 V
  float rainGaugeMm = NAN;      // Range: 0 .. 1000 mm
  int8_t rainDetected = -1;     // -1 = sensor not fitted (`null`), 0 = dry (`false`), 1 = raining (`true`)
};

struct EdensActuatorState {
  bool pumpActive = false;
  bool fanActive = false;
  bool lightActive = false;
  bool heaterActive = false;
  bool peltierActive = false;
  bool roofOpen = false;
  uint32_t pumpContinuousSeconds = 0;
};

struct EdensSafetyInterlocks {
  bool rainLocked = false;
  bool waterLowLocked = false;
  bool thermalLocked = false;
  bool overIrrigationLocked = false;
};

/**
 * Authoritative Local Hardware Safety Interlocks.
 * Call EVERY control cycle before driving physical GPIO relays — works 100% offline.
 */
inline EdensSafetyInterlocks edensEnforceLocalSafetyInterlocks(
  const EdensTelemetrySample& sensors,
  EdensActuatorState& actuators
) {
  EdensSafetyInterlocks locks;

  // 1. Rain vs Roof Vent Interlock: Immediately close roof if rain is detected
  if (sensors.rainDetected == 1) {
    locks.rainLocked = true;
    actuators.roofOpen = false;
  }

  // 2. Reservoir Dry-Run Interlock: Lock pump OFF if waterLevel is reported and < 10.0% (including 0.0%)
  if (!isnan(sensors.waterLevelPct) && sensors.waterLevelPct < 10.0f) {
    locks.waterLowLocked = true;
    actuators.pumpActive = false;
  }

  // 3. Max Continuous Irrigation Run-Time Interlock (120 seconds max)
  if (actuators.pumpContinuousSeconds > 120U) {
    locks.overIrrigationLocked = true;
    actuators.pumpActive = false;
  }

  // 4. Thermal Runaway Interlock: Force heater OFF above 32.0°C
  if (!isnan(sensors.temperatureC) && sensors.temperatureC > 32.0f) {
    locks.thermalLocked = true;
    actuators.heaterActive = false;
  }

  return locks;
}

inline void edensAppendNullableFloat(String& out, const char* key, float val, uint8_t decimals = 2, bool trailingComma = true) {
  out += "\"";
  out += key;
  out += "\":";
  if (isnan(val) || isinf(val)) {
    out += "null";
  } else {
    out += String(val, static_cast<unsigned int>(decimals));
  }
  if (trailingComma) out += ",";
}

inline bool edensEnsureControllerUtcClock() {
  time_t now = time(nullptr);
  if (now > 1704067200) return true;
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com", "time.google.com");
  for (int i = 0; i < 20; ++i) {
    delay(250);
    now = time(nullptr);
    if (now > 1704067200) return true;
  }
  return false;
}

class EdensControllerCloudSync {
public:
  void begin(const char* firmwareVersion = "EDENS-ESP32-CTRL-v2.5") {
    m_firmwareVersion = firmwareVersion;
  }

  /**
   * Call inside `loop()`. Non-blocking unless an upload interval/backoff timer has elapsed.
   */
  bool tick(const EdensTelemetrySample& sensors, const EdensActuatorState& actuators, const EdensSafetyInterlocks& locks) {
    const uint32_t nowMs = millis();
    if (nowMs - m_lastAttemptMs < m_nextDelayMs) {
      return false;
    }
    m_lastAttemptMs = nowMs;

    bool ok = uploadNow(sensors, actuators, locks);
    if (ok) {
      m_consecutiveFailures = 0;
      m_nextDelayMs = EDENS_TELEMETRY_INTERVAL_MS < 5000UL ? 5000UL : EDENS_TELEMETRY_INTERVAL_MS;
    } else {
      m_consecutiveFailures++;
      uint32_t shift = m_consecutiveFailures > 4 ? 4 : (m_consecutiveFailures - 1);
      uint32_t backoff = 5000UL * (1UL << shift);
      m_nextDelayMs = backoff > 60000UL ? 60000UL : backoff;
    }
    return ok;
  }

  bool uploadNow(const EdensTelemetrySample& sensors, const EdensActuatorState& actuators, const EdensSafetyInterlocks& locks) {
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.reconnect();
      Serial.println("[EDENS-CTRL] Wi-Fi disconnected; triggered reconnect.");
      return false;
    }

    const char* apiKey = EDENS_CONTROLLER_DEVICE_KEY;
    if (!apiKey || strlen(apiKey) == 0 || strstr(apiKey, "REPLACE_WITH_") != nullptr || apiKey[0] == '<') {
      Serial.println("[EDENS-CTRL] Upload skipped: EDENS_CONTROLLER_DEVICE_KEY not set in controller_secrets.h");
      return false;
    }

    if (isnan(sensors.temperatureC) && isnan(sensors.humidityPct) && isnan(sensors.soilMoisturePct)) {
      Serial.println("[EDENS-CTRL] Upload skipped: all primary sensors returned NAN.");
      return false;
    }

    if (!edensEnsureControllerUtcClock()) {
      Serial.println("[EDENS-CTRL] Waiting for NTP UTC clock sync before verified TLS handshake...");
      return false;
    }

    time_t epoch = time(nullptr);
    struct tm utcTm;
    gmtime_r(&epoch, &utcTm);
    char isoTs[28];
    strftime(isoTs, sizeof(isoTs), "%Y-%m-%dT%H:%M:%SZ", &utcTm);

    String payload;
    payload.reserve(640);
    payload += "{";
    payload += "\"firmwareVersion\":\"";
    payload += m_firmwareVersion;
    payload += "\",";
    payload += "\"uptimeSeconds\":";
    payload += String(millis() / 1000UL);
    payload += ",";
    payload += "\"wifiRssi\":";
    payload += String(WiFi.RSSI());
    payload += ",";
    payload += "\"freeHeapBytes\":";
    payload += String(ESP.getFreeHeap());
    payload += ",";
    payload += "\"timestamp\":\"";
    payload += isoTs;
    payload += "\",";

    payload += "\"telemetry\":{";
    edensAppendNullableFloat(payload, "temperature", sensors.temperatureC, 2, true);
    edensAppendNullableFloat(payload, "humidity", sensors.humidityPct, 1, true);
    edensAppendNullableFloat(payload, "soilMoisture", sensors.soilMoisturePct, 1, true);
    edensAppendNullableFloat(payload, "waterLevel", sensors.waterLevelPct, 1, true);
    edensAppendNullableFloat(payload, "sunlight", sensors.sunlightLux, 0, true);
    edensAppendNullableFloat(payload, "growLight", sensors.growLightLux, 0, true);
    edensAppendNullableFloat(payload, "batteryVoltage", sensors.batteryVoltage, 2, true);
    edensAppendNullableFloat(payload, "rainGaugeLevel", sensors.rainGaugeMm, 1, true);
    payload += "\"rain\":";
    if (sensors.rainDetected < 0) payload += "null";
    else payload += (sensors.rainDetected > 0 ? "true" : "false");
    payload += "},";

    payload += "\"actuators\":{";
    payload += "\"pumpActive\":"; payload += actuators.pumpActive ? "true," : "false,";
    payload += "\"fanActive\":"; payload += actuators.fanActive ? "true," : "false,";
    payload += "\"lightActive\":"; payload += actuators.lightActive ? "true," : "false,";
    payload += "\"heaterActive\":"; payload += actuators.heaterActive ? "true," : "false,";
    payload += "\"peltierActive\":"; payload += actuators.peltierActive ? "true," : "false,";
    payload += "\"roofActive\":"; payload += actuators.roofOpen ? "true" : "false";
    payload += "},";

    payload += "\"interlocks\":{";
    payload += "\"rainLocked\":"; payload += locks.rainLocked ? "true," : "false,";
    payload += "\"waterLowLocked\":"; payload += locks.waterLowLocked ? "true," : "false,";
    payload += "\"thermalLocked\":"; payload += locks.thermalLocked ? "true," : "false,";
    payload += "\"overIrrigationLocked\":"; payload += locks.overIrrigationLocked ? "true" : "false";
    payload += "}";
    payload += "}";

    WiFiClientSecure secureClient;
    secureClient.setCACert(EDENS_CTRL_ROOT_CA_BUNDLE);
    secureClient.setTimeout(12);

    HTTPClient https;
    https.setConnectTimeout(10000);
    https.setTimeout(12000);

    bool success = false;
    if (https.begin(secureClient, EDENS_TELEMETRY_UPLOAD_URL)) {
      https.addHeader("Content-Type", "application/json");
      https.addHeader("X-Hardware-Key", apiKey);
      if (strlen(EDENS_GREENHOUSE_ID) > 0) {
        https.addHeader("X-Greenhouse-Id", EDENS_GREENHOUSE_ID);
      }
      if (strlen(EDENS_CONTROLLER_DEVICE_ID) > 0) {
        https.addHeader("X-Device-Id", EDENS_CONTROLLER_DEVICE_ID);
      }

      int httpCode = https.POST(payload);
      if (httpCode == 200) {
        m_totalUploaded++;
        success = true;
        Serial.printf("[EDENS-CTRL] Telemetry upload OK (HTTP 200, packet #%lu)\n",
                      static_cast<unsigned long>(m_totalUploaded));
      } else {
        Serial.printf("[EDENS-CTRL] Telemetry upload failed (HTTP %d)\n", httpCode);
      }
      https.end();
    } else {
      Serial.println("[EDENS-CTRL] HTTPS connection init failed");
    }

    return success;
  }

private:
  const char* m_firmwareVersion = "EDENS-ESP32-CTRL-v2.5";
  uint32_t m_lastAttemptMs = 0;
  uint32_t m_nextDelayMs = 2000UL;
  uint32_t m_consecutiveFailures = 0;
  uint32_t m_totalUploaded = 0;
};
