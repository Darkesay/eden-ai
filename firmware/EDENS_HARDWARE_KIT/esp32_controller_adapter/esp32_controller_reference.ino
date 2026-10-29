/**
 * EDENS AI — Main ESP32 Greenhouse Controller Reference Sketch
 *
 * IMPORTANT HARDWARE COLLABORATOR NOTE:
 * Because exact physical GPIO pin assignments, sensor IC models (e.g. DHT22 vs SHT31),
 * ADC calibration curves, and relay active-HIGH/LOW polarity belong to the physical PCB/wiring,
 * this reference sketch isolates all physical I/O inside two adapter functions:
 *   1. `readPhysicalGreenhouseSensors()`
 *   2. `applyPhysicalRelayOutputs()`
 *
 * Leave any unpopulated sensor at `NAN` (or `rainDetected = -1`) — `edens_controller_sync.h`
 * will serialize `NAN` as JSON `null` (`UNREPORTED`) while preserving genuine `0.0` readings as `0`.
 */

#include <WiFi.h>
#include "edens_controller_sync.h"

static EdensControllerCloudSync g_edensCloud;
static EdensActuatorState g_actuators;
static uint32_t g_lastControlTickMs = 0;

// ============================================================================
// ADAPTER HOOK 1: Wire your actual greenhouse sensor drivers here.
// Do NOT invent fake numbers — leave any missing/faulty sensor as `NAN`.
// ============================================================================
EdensTelemetrySample readPhysicalGreenhouseSensors() {
  EdensTelemetrySample sample;

  // TODO_HARDWARE_ADAPTER: Replace with real sensor driver reads on your PCB:
  // Example (SHT31 / DHT22):
  //   float t = sht31.readTemperature();
  //   if (!isnan(t)) sample.temperatureC = t;
  //   float h = sht31.readHumidity();
  //   if (!isnan(h)) sample.humidityPct = h;
  //
  // Example (Capacitive Soil Moisture ADC -> 0..100%):
  //   sample.soilMoisturePct = readCalibratedSoilPercent();
  //
  // Example (Ultrasonic / Float Reservoir Level -> 0..100%):
  //   sample.waterLevelPct = readCalibratedReservoirPercent(); // 0.0f = empty tank, NAN = sensor not fitted
  //
  // Example (Rain Digital/Analog Sensor):
  //   sample.rainDetected = digitalRead(PIN_RAIN_DO) == LOW ? 1 : 0; // -1 if not fitted

  return sample;
}

// ============================================================================
// ADAPTER HOOK 2: Drive your physical relay/MOSFET pins AFTER safety interlocks.
// Verify whether your relay board is active-LOW or active-HIGH before wiring!
// ============================================================================
void applyPhysicalRelayOutputs(const EdensActuatorState& safeActuators) {
  (void)safeActuators;
  // TODO_HARDWARE_ADAPTER: Write `safeActuators.pumpActive`, `safeActuators.fanActive`,
  // `safeActuators.heaterActive`, `safeActuators.roofOpen`, etc. to your verified GPIO pins.
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[EDENS-CTRL] Booting Main ESP32 Greenhouse Controller...");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  if (strlen(EDENS_WIFI_SSID) > 0 && strstr(EDENS_WIFI_SSID, "REPLACE_WITH_") == nullptr && EDENS_WIFI_SSID[0] != '<') {
    // SECURITY: Log SSID only; NEVER print EDENS_WIFI_PASSWORD or EDENS_CONTROLLER_DEVICE_KEY
    Serial.printf("[EDENS-CTRL] Connecting to 2.4 GHz Wi-Fi SSID: %s\n", EDENS_WIFI_SSID);
    WiFi.begin(EDENS_WIFI_SSID, EDENS_WIFI_PASSWORD);
  } else {
    Serial.println("[EDENS-CTRL] Configure controller_secrets.h before flashing.");
  }

  g_edensCloud.begin("EDENS-ESP32-CTRL-v2.5");
}

void loop() {
  const uint32_t nowMs = millis();

  // 1 Hz local sensor & authoritative hardware safety interlock loop (runs even if offline)
  if (nowMs - g_lastControlTickMs >= 1000UL) {
    g_lastControlTickMs = nowMs;

    if (g_actuators.pumpActive) {
      g_actuators.pumpContinuousSeconds++;
    } else {
      g_actuators.pumpContinuousSeconds = 0;
    }

    EdensTelemetrySample sensors = readPhysicalGreenhouseSensors();
    EdensSafetyInterlocks locks = edensEnforceLocalSafetyInterlocks(sensors, g_actuators);
    applyPhysicalRelayOutputs(g_actuators);

    // Periodic non-blocking outbound HTTPS push to EDENS AI Cloud
    g_edensCloud.tick(sensors, g_actuators, locks);
  }

  delay(20);
}
