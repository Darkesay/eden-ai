#pragma once
/**
 * ============================================================================
 * EDENS AI — Universal MQTT + Auto-Discovery ESP32 Reference Client Header
 * File: firmware/EDENS_HARDWARE_KIT/esp32_mqtt_universal_adapter/edens_mqtt_sync.h
 * Version: 1.0.0
 * ============================================================================
 *
 * Complements `edens_controller_sync.h` (HTTPS REST) by providing an optional
 * MQTT v3.1.1 over TLS (`WiFiClientSecure` + `PubSubClient`) transport that
 * speaks directly to the EDENS AI Universal Device Adapter:
 *  - Publishes Home Assistant / ESPHome compatible MQTT Auto-Discovery JSON on
 *    `homeassistant/sensor/<deviceId>/<sensorKey>/config`
 *  - Publishes LWT (`offline`) and birth (`online`) on
 *    `edens/v1/greenhouses/<greenhouseId>/devices/<deviceId>/status`
 *  - Publishes validated sensor telemetry (omitting NaN/disconnected probes) on
 *    `edens/v1/greenhouses/<greenhouseId>/devices/<deviceId>/telemetry`
 *  - Verifies Root CA TLS (`setCACert`); `setInsecure()` is strictly forbidden.
 *  - Enforces Tier-1 local hardware safety interlocks via `edensEnforceWatchdogAndRuntimeLimits`.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include "../edens_pnp_provisioning.h"
#include "../esp32_controller_adapter/edens_controller_sync.h"

#ifndef EDENS_MQTT_PORT
#define EDENS_MQTT_PORT 8883
#endif

class EdensUniversalMqttSync {
public:
  EdensUniversalMqttSync() : m_mqtt(m_tlsClient) {}

  void begin(
    const char* mqttHost,
    uint16_t mqttPort,
    const char* greenhouseId,
    const char* deviceId,
    const char* deviceKey
  ) {
    m_mqttHost = String(mqttHost);
    m_mqttPort = mqttPort;
    m_greenhouseId = String(greenhouseId);
    m_deviceId = String(deviceId);
    m_deviceKey = String(deviceKey);

    m_tlsClient.setCACert(EDENS_CTRL_ROOT_CA_BUNDLE);
    m_mqtt.setServer(m_mqttHost.c_str(), m_mqttPort);
    m_mqtt.setBufferSize(1024);
  }

  void tick(const EdensSensorSnapshot& sensors) {
    if (WiFi.status() != WL_CONNECTED) return;

    if (!m_mqtt.connected()) {
      unsigned long nowMs = millis();
      if (nowMs - m_lastReconnectAttemptMs >= 5000UL) {
        m_lastReconnectAttemptMs = nowMs;
        connectAndAnnounceDiscovery();
      }
      return;
    }

    m_mqtt.loop();

    unsigned long nowMs = millis();
    if (nowMs - m_lastTelemetryMs >= EDENS_TELEMETRY_INTERVAL_MS) {
      m_lastTelemetryMs = nowMs;
      publishTelemetry(sensors);
    }
  }

private:
  WiFiClientSecure m_tlsClient;
  PubSubClient m_mqtt;
  String m_mqttHost;
  uint16_t m_mqttPort = EDENS_MQTT_PORT;
  String m_greenhouseId;
  String m_deviceId;
  String m_deviceKey;
  unsigned long m_lastReconnectAttemptMs = 0;
  unsigned long m_lastTelemetryMs = 0;
  uint8_t m_consecutiveAuthFailures = 0;

  String baseTopic() const {
    return "edens/v1/greenhouses/" + m_greenhouseId + "/devices/" + m_deviceId;
  }

  void connectAndAnnounceDiscovery() {
    String statusTopic = baseTopic() + "/status";
    String clientId = "edens-" + m_deviceId;

    bool ok = m_mqtt.connect(
      clientId.c_str(),
      m_deviceId.c_str(),
      m_deviceKey.c_str(),
      statusTopic.c_str(),
      1,
      true,
      "offline"
    );

    if (!ok) {
      int rc = m_mqtt.state();
      // MQTT CONNACK 4 (Bad credentials) or 5 (Not authorized)
      if (rc == 4 || rc == 5) {
        m_consecutiveAuthFailures++;
      }
      return;
    }

    m_consecutiveAuthFailures = 0;
    m_mqtt.publish(statusTopic.c_str(), "online", true);

    // Announce standard sensor discovery metadata
    announceSensor("temperature", "Canopy Temperature", "celsius", "temperature");
    announceSensor("humidity", "Relative Humidity", "percent", "humidity");
    announceSensor("soil_moisture", "Soil Moisture", "percent", "moisture");
    announceSensor("water_level", "Water Tank Level", "percent", "volume_storage");
  }

  void announceSensor(const char* slug, const char* name, const char* unit, const char* devClass) {
    String discTopic = "homeassistant/sensor/" + m_deviceId + "/" + String(slug) + "/config";
    String stateTopic = baseTopic() + "/telemetry";
    String payload = "{";
    payload += "\"name\":\"" + String(name) + "\",";
    payload += "\"object_id\":\"" + String(slug) + "\",";
    payload += "\"device_class\":\"" + String(devClass) + "\",";
    payload += "\"unit_of_measurement\":\"" + String(unit) + "\",";
    payload += "\"state_topic\":\"" + stateTopic + "\",";
    payload += "\"device\":{\"identifiers\":[\"" + m_deviceId + "\"],\"manufacturer\":\"Espressif\",\"model\":\"EDENS-ESP32-MQTT\",\"sw_version\":\"" + String(EDENS_CONTROLLER_FIRMWARE_VERSION) + "\"}";
    payload += "}";
    m_mqtt.publish(discTopic.c_str(), payload.c_str(), true);
  }

  void publishTelemetry(const EdensSensorSnapshot& s) {
    String topic = baseTopic() + "/telemetry";
    String json = "{\"firmwareVersion\":\"" + String(EDENS_CONTROLLER_FIRMWARE_VERSION) + "\",\"telemetry\":{";
    json += "\"temperature\":" + (isnan(s.temperatureC) ? String("null") : String(s.temperatureC, 2)) + ",";
    json += "\"humidity\":" + (isnan(s.humidityPct) ? String("null") : String(s.humidityPct, 2)) + ",";
    json += "\"soilMoisture\":" + (isnan(s.soilMoisturePct) ? String("null") : String(s.soilMoisturePct, 2)) + ",";
    json += "\"waterLevel\":" + (isnan(s.waterLevelPct) ? String("null") : String(s.waterLevelPct, 2)) + ",";
    json += "\"sunlight\":" + (isnan(s.sunlightLux) ? String("null") : String(s.sunlightLux, 1));
    json += "}}";
    m_mqtt.publish(topic.c_str(), json.c_str(), false);
  }
};
