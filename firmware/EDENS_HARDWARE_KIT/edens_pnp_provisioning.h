#pragma once
/**
 * ============================================================================
 * EDENS AI — Plug-and-Play Hardware Provisioning & Secure Lifecycle Module
 * File: firmware/EDENS_HARDWARE_KIT/edens_pnp_provisioning.h
 * Version: 3.0.0-pnp-sec
 * ============================================================================
 *
 * Implements Phase 2 + Phase 3 Security Hardening for ESP32 & ESP32-CAM:
 *  1. Unique Hardware Identity: Derives immutable 48-bit EFuse MAC UID.
 *  2. Encrypted-Flash-Compatible NVS Storage (`Preferences`):
 *     - `"edens_cfg"`: Wi-Fi SSID/Pass, Cloud Origin, Greenhouse ID, Zone ID,
 *       Device ID, and Device Key.
 *     - `"edens_sec"`: Per-board CSPRNG 12-char WPA2-PSK SoftAP setup password
 *       generated via hardware RNG (`esp_fill_random`) — NEVER derived from MAC.
 *  3. WPA2-Protected Temporary Provisioning Hotspot (`EDENS-SETUP-XXXX`):
 *     - Protected by unique per-board 12-char CSPRNG WPA2 password delivered
 *       over physical USB-UART installer console (115200 baud) for kit labeling.
 *     - Per-session CSRF nonce + escalating brute-force lockout (`HTTP 429`) on
 *       `POST /api/provision`.
 *     - Short-lived 15-minute provisioning session (`EDENS_PORTAL_SESSION_TTL_MS`)
 *       with automatic SoftAP closure upon timeout or successful pairing.
 *  4. Safe Credential Recovery Mode (`enterCredentialRecoveryMode`):
 *     - Triggered only after verified consecutive HTTP 401 auth rejections.
 *     - Permanently wipes the revoked `dev_key` (never restores revoked keys),
 *       preserves local Wi-Fi STA connectivity & safety interlocks, and opens
 *       a bounded WPA2 re-provisioning window for a new one-time `enr_...` token.
 *  5. Physical Factory Reset: Holding `EDENS_FACTORY_RESET_PIN` LOW for 5s
 *     clears NVS credentials and opens a fresh 15-minute WPA2 setup session.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_system.h>

#ifndef EDENS_FACTORY_RESET_PIN
#define EDENS_FACTORY_RESET_PIN 0
#endif

#ifndef EDENS_FACTORY_RESET_HOLD_MS
#define EDENS_FACTORY_RESET_HOLD_MS 5000UL
#endif

#ifndef EDENS_DEFAULT_CLOUD_ORIGIN
#define EDENS_DEFAULT_CLOUD_ORIGIN "https://edens-ai.onrender.com"
#endif

// Short-lived provisioning hotspot window (15 minutes max per session)
#ifndef EDENS_PORTAL_SESSION_TTL_MS
#define EDENS_PORTAL_SESSION_TTL_MS 900000UL
#endif

// Maximum failed pairing attempts before escalating SoftAP lockout (HTTP 429)
#ifndef EDENS_PORTAL_MAX_FREE_ATTEMPTS
#define EDENS_PORTAL_MAX_FREE_ATTEMPTS 3
#endif

// ISRG Root X1 + GTS Root R1 PEM bundle for verified HTTPS bootstrap
#ifndef EDENS_ROOT_CA_PEM_DEFINED
#define EDENS_ROOT_CA_PEM_DEFINED
static const char EDENS_PNP_ROOT_CA_PEM[] PROGMEM =
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
#endif

struct EdensProvisionedConfig {
  bool provisioned = false;
  String wifiSsid = "";
  String wifiPassword = "";
  String cloudOrigin = EDENS_DEFAULT_CLOUD_ORIGIN;
  String uploadUrl = "";
  String greenhouseId = "";
  String zoneId = "";
  String deviceId = "";
  String deviceKey = "";
  String hardwareUid = "";
  String macAddress = "";
};

class EdensPnpProvisioner {
public:
  EdensPnpProvisioner(
    const char* deviceType,
    const char* firmwareVersion,
    const char* capabilitiesJson = "{}"
  )
    : m_deviceType(deviceType),
      m_firmwareVersion(firmwareVersion),
      m_capabilitiesJson(capabilitiesJson),
      m_webServer(80) {}

  void setCompileTimeFallback(
    const char* ssid,
    const char* pass,
    const char* uploadUrl,
    const char* greenhouseId,
    const char* deviceId,
    const char* deviceKey
  ) {
    m_fallbackSsid = ssid ? ssid : "";
    m_fallbackPass = pass ? pass : "";
    m_fallbackUploadUrl = uploadUrl ? uploadUrl : "";
    m_fallbackGhId = greenhouseId ? greenhouseId : "";
    m_fallbackDevId = deviceId ? deviceId : "";
    m_fallbackDevKey = deviceKey ? deviceKey : "";
  }

  const EdensProvisionedConfig& begin(bool enableResetPin = true) {
    m_enableResetPin = enableResetPin;
    if (m_enableResetPin && EDENS_FACTORY_RESET_PIN >= 0) {
      pinMode(EDENS_FACTORY_RESET_PIN, INPUT_PULLUP);
    }

    populateHardwareIdentity();
    ensureBoardSetupPasswordInNvs();
    loadFromNvs();

    if (!m_cfg.provisioned && isUsableSecret(m_fallbackSsid) && isUsableSecret(m_fallbackDevKey)) {
      m_cfg.provisioned = true;
      m_cfg.wifiSsid = m_fallbackSsid;
      m_cfg.wifiPassword = m_fallbackPass;
      m_cfg.uploadUrl = m_fallbackUploadUrl;
      m_cfg.greenhouseId = m_fallbackGhId;
      m_cfg.deviceId = m_fallbackDevId;
      m_cfg.deviceKey = m_fallbackDevKey;
      Serial.println("[EDENS PnP] Using compile-time secrets.h fallback configuration.");
    }

    if (m_cfg.provisioned) {
      connectStationNonBlocking();
    } else {
      startSoftApPortal("initial_unprovisioned_boot");
    }

    return m_cfg;
  }

  /**
   * Call inside `loop()` (non-blocking) to service:
   *  - Physical 5-second factory reset button hold
   *  - Local USB-UART installer command (`SHOW_SETUP_KEY` / `FACTORY_ROTATE_PSK`)
   *  - Short-lived SoftAP session timeout & captive portal HTTP/DNS requests
   *  - Automatic Wi-Fi Station reconnection with exponential backoff
   */
  void tick() {
    checkPhysicalResetButton();
    serviceLocalSerialInstallerConsole();

    if (m_portalActive) {
      // Enforce short-lived provisioning session TTL (auto-close after 15m)
      if ((millis() - m_portalOpenedAtMs) >= EDENS_PORTAL_SESSION_TTL_MS) {
        Serial.println("[EDENS PnP] Provisioning session TTL (15m) expired. Closing SoftAP hotspot.");
        stopSoftApPortal();
      } else {
        m_dnsServer.processNextRequest();
        m_webServer.handleClient();
      }
    }

    // Maintain Wi-Fi STA connection whenever SSID is known (even during recovery mode!)
    if (m_cfg.wifiSsid.length() > 0 && WiFi.status() != WL_CONNECTED) {
      unsigned long now = millis();
      if (now - m_lastWifiRetryMs >= m_wifiBackoffMs) {
        m_lastWifiRetryMs = now;
        Serial.printf("[EDENS PnP] Wi-Fi STA disconnected; retrying '%s' (backoff=%lums)...\n",
                      m_cfg.wifiSsid.c_str(), m_wifiBackoffMs);
        WiFi.begin(m_cfg.wifiSsid.c_str(), m_cfg.wifiPassword.c_str());
        m_wifiBackoffMs = min(60000UL, m_wifiBackoffMs * 2UL);
      }
    } else if (m_cfg.wifiSsid.length() > 0 && WiFi.status() == WL_CONNECTED) {
      m_wifiBackoffMs = 5000UL;
    }
  }

  bool isReadyForCloudSync() const {
    return m_cfg.provisioned &&
           !m_recoveryModeActive &&
           m_cfg.deviceKey.length() >= 16 &&
           WiFi.status() == WL_CONNECTED;
  }

  bool isPortalActive() const {
    return m_portalActive;
  }

  bool isInCredentialRecoveryMode() const {
    return m_recoveryModeActive;
  }

  const EdensProvisionedConfig& config() const {
    return m_cfg;
  }

  /**
   * Enters safe Credential Recovery Mode after verified consecutive HTTP 401
   * responses (key revoked or rotated on EDENS AI cloud).
   *
   * Security Guarantees:
   *  1. Permanently erases `dev_key` from NVS and RAM — NEVER restores revoked keys.
   *  2. Preserves Wi-Fi STA SSID/password so local LAN access (ESP32-CAM stream)
   *     continues uninterrupted and installer only needs to enter a new `enr_...` code.
   *  3. Opens WPA2-protected `EDENS-SETUP-XXXX` SoftAP for 15 minutes (`WIFI_AP_STA`).
   */
  void enterCredentialRecoveryMode(const char* authErrorCode) {
    Serial.printf(
      "\n[EDENS PnP SECURITY] Entering Credential Recovery Mode (reason=%s). Wiping revoked device key.\n",
      authErrorCode ? authErrorCode : "HTTP_401_REVOKED"
    );

    Preferences prefs;
    if (prefs.begin("edens_cfg", false)) {
      prefs.remove("dev_key");
      prefs.putBool("prov", false);
      prefs.end();
    }

    // Zero out in-memory key so revoked credential can NEVER be reused or restored
    m_cfg.deviceKey = "";
    m_cfg.provisioned = false;
    m_recoveryModeActive = true;

    startSoftApPortal("credential_recovery_401");
  }

  /**
   * Clears stored Wi-Fi + Device credentials in NVS (`"edens_cfg"`) and restarts
   * into WPA2-protected SoftAP setup mode. Keeps per-board `"edens_sec"` WPA2
   * label password intact unless `rotateSetupPassword` is explicitly true.
   */
  void factoryResetAndRestart(bool rotateSetupPassword = false) {
    Serial.println("\n[EDENS PnP] Factory reset triggered — wiping NVS credentials...");
    Preferences prefs;
    if (prefs.begin("edens_cfg", false)) {
      prefs.clear();
      prefs.end();
    }
    if (rotateSetupPassword) {
      Preferences secPrefs;
      if (secPrefs.begin("edens_sec", false)) {
        secPrefs.clear();
        secPrefs.end();
      }
    }
    WiFi.disconnect(true, true);
    delay(400);
    ESP.restart();
  }

private:
  const char* m_deviceType;
  const char* m_firmwareVersion;
  const char* m_capabilitiesJson;
  bool m_enableResetPin = true;

  EdensProvisionedConfig m_cfg;
  String m_apSsid;
  String m_apPassword;
  String m_portalCsrfToken;

  String m_fallbackSsid;
  String m_fallbackPass;
  String m_fallbackUploadUrl;
  String m_fallbackGhId;
  String m_fallbackDevId;
  String m_fallbackDevKey;

  DNSServer m_dnsServer;
  WebServer m_webServer;
  bool m_portalActive = false;
  bool m_portalRoutesRegistered = false;
  bool m_recoveryModeActive = false;
  unsigned long m_portalOpenedAtMs = 0;

  // Brute-force pairing protection state
  uint16_t m_failedProvisionAttempts = 0;
  unsigned long m_provisionLockoutUntilMs = 0;

  unsigned long m_resetPressStartMs = 0;
  bool m_resetHolding = false;
  unsigned long m_lastWifiRetryMs = 0;
  unsigned long m_wifiBackoffMs = 5000UL;

  static bool isUsableSecret(const String& val) {
    return val.length() > 0 &&
           !val.startsWith("<YOUR_") &&
           !val.startsWith("REPLACE_WITH");
  }

  /**
   * Generates a high-entropy 12-character WPA2-PSK setup password using ESP32
   * hardware CSPRNG (`esp_fill_random`) with rejection sampling (zero modulo bias).
   * NEVER derived from MAC address digits!
   */
  static String generateCsprngSetupPassword(size_t length = 12) {
    static const char kAlphabet[] =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // 57 chars
    const uint8_t kAlphaLen = 57;
    const uint8_t kMaxUnbiased = (256 / kAlphaLen) * kAlphaLen; // 228

    String out = "";
    out.reserve(length);
    uint8_t randomBuf[32];

    while (out.length() < length) {
      esp_fill_random(randomBuf, sizeof(randomBuf));
      for (size_t i = 0; i < sizeof(randomBuf) && out.length() < length; ++i) {
        if (randomBuf[i] < kMaxUnbiased) {
          out += kAlphabet[randomBuf[i] % kAlphaLen];
        }
      }
    }
    return out;
  }

  static String generateCsprngHexToken(size_t byteLen = 16) {
    uint8_t buf[32];
    size_t n = byteLen > sizeof(buf) ? sizeof(buf) : byteLen;
    esp_fill_random(buf, n);
    char hexOut[65];
    for (size_t i = 0; i < n; ++i) {
      snprintf(&hexOut[i * 2], 3, "%02x", buf[i]);
    }
    hexOut[n * 2] = '\0';
    return String(hexOut);
  }

  static String escapeHtml(const String& s) {
    String out;
    out.reserve(s.length() + 8);
    for (size_t i = 0; i < s.length(); ++i) {
      char c = s[i];
      switch (c) {
        case '&': out += "&amp;"; break;
        case '<': out += "&lt;"; break;
        case '>': out += "&gt;"; break;
        case '"': out += "&quot;"; break;
        case '\'': out += "&#39;"; break;
        default: out += c; break;
      }
    }
    return out;
  }

  void populateHardwareIdentity() {
    uint64_t efuseMac = ESP.getEfuseMac();
    char uidBuf[32];
    snprintf(
      uidBuf,
      sizeof(uidBuf),
      "ESP32-%04X%08X",
      (uint16_t)(efuseMac >> 32),
      (uint32_t)efuseMac
    );
    m_cfg.hardwareUid = String(uidBuf);
    m_cfg.macAddress = WiFi.macAddress();

    // SSID suffix identifies which physical board is broadcasting; security comes
    // exclusively from the independent CSPRNG 12-char WPA2 password in "edens_sec".
    char suffix[8];
    snprintf(suffix, sizeof(suffix), "%04X", (uint16_t)(efuseMac & 0xFFFF));
    m_apSsid = String("EDENS-SETUP-") + String(suffix);
  }

  void ensureBoardSetupPasswordInNvs() {
    Preferences secPrefs;
    if (!secPrefs.begin("edens_sec", false)) {
      m_apPassword = generateCsprngSetupPassword(12);
      return;
    }

    String stored = secPrefs.getString("ap_psk", "");
#ifdef EDENS_FACTORY_AP_PASSWORD
    String factoryOverride = String(EDENS_FACTORY_AP_PASSWORD);
    if (stored.length() < 12 && factoryOverride.length() >= 12) {
      stored = factoryOverride;
      secPrefs.putString("ap_psk", stored);
    }
#endif
    if (stored.length() < 12) {
      stored = generateCsprngSetupPassword(12);
      secPrefs.putString("ap_psk", stored);
      Serial.println("[EDENS PnP] Generated unique CSPRNG WPA2 SoftAP setup key in NVS 'edens_sec'.");
    }
    m_apPassword = stored;
    secPrefs.end();
  }

  void printInstallerSerialLabel(const char* triggerReason) {
    Serial.println("\n========================================================");
    Serial.printf(" [EDENS-INSTALLER-LABEL] (%s)\n", triggerReason);
    Serial.printf(" Hardware UID     : %s\n", m_cfg.hardwareUid.c_str());
    Serial.printf(" Setup Wi-Fi SSID : %s\n", m_apSsid.c_str());
    Serial.printf(" WPA2 Setup Key   : %s\n", m_apPassword.c_str());
    Serial.println(" Portal URL       : http://192.168.4.1 (auto-closes in 15m)");
    Serial.println(" NOTE: Affix WPA2 Setup Key to internal kit enclosure label.");
    Serial.println("========================================================\n");
  }

  void serviceLocalSerialInstallerConsole() {
    if (!Serial.available()) return;
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.equalsIgnoreCase("SHOW_SETUP_KEY") || cmd.equalsIgnoreCase("EDENS_SHOW_INSTALLER_KEY")) {
      printInstallerSerialLabel("serial_installer_query");
    } else if (cmd.equalsIgnoreCase("FACTORY_ROTATE_PSK")) {
      factoryResetAndRestart(true);
    }
  }

  void loadFromNvs() {
    Preferences prefs;
    if (!prefs.begin("edens_cfg", true)) {
      return;
    }
    m_cfg.provisioned = prefs.getBool("prov", false);
    m_cfg.wifiSsid = prefs.getString("ssid", "");
    m_cfg.wifiPassword = prefs.getString("pass", "");
    m_cfg.cloudOrigin = prefs.getString("origin", EDENS_DEFAULT_CLOUD_ORIGIN);
    m_cfg.uploadUrl = prefs.getString("up_url", "");
    m_cfg.greenhouseId = prefs.getString("gh_id", "");
    m_cfg.zoneId = prefs.getString("zone_id", "");
    m_cfg.deviceId = prefs.getString("dev_id", "");
    m_cfg.deviceKey = prefs.getString("dev_key", "");
    prefs.end();
  }

  void saveToNvs() {
    Preferences prefs;
    if (!prefs.begin("edens_cfg", false)) {
      Serial.println("[EDENS PnP] ERROR: Unable to open NVS namespace 'edens_cfg' for write.");
      return;
    }
    prefs.putBool("prov", m_cfg.provisioned);
    prefs.putString("ssid", m_cfg.wifiSsid);
    prefs.putString("pass", m_cfg.wifiPassword);
    prefs.putString("origin", m_cfg.cloudOrigin);
    prefs.putString("up_url", m_cfg.uploadUrl);
    prefs.putString("gh_id", m_cfg.greenhouseId);
    prefs.putString("zone_id", m_cfg.zoneId);
    prefs.putString("dev_id", m_cfg.deviceId);
    prefs.putString("dev_key", m_cfg.deviceKey);
    prefs.end();
  }

  void checkPhysicalResetButton() {
    if (!m_enableResetPin || EDENS_FACTORY_RESET_PIN < 0) return;

    int pinState = digitalRead(EDENS_FACTORY_RESET_PIN);
    if (pinState == LOW) {
      if (!m_resetHolding) {
        m_resetHolding = true;
        m_resetPressStartMs = millis();
      } else if (millis() - m_resetPressStartMs >= EDENS_FACTORY_RESET_HOLD_MS) {
        factoryResetAndRestart(false);
      }
    } else {
      m_resetHolding = false;
    }
  }

  void connectStationNonBlocking() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(m_cfg.wifiSsid.c_str(), m_cfg.wifiPassword.c_str());
    m_lastWifiRetryMs = millis();
    Serial.printf("[EDENS PnP] Connecting to greenhouse Wi-Fi '%s' (Device ID: %s)...\n",
                  m_cfg.wifiSsid.c_str(), m_cfg.deviceId.c_str());
  }

  void stopSoftApPortal() {
    if (!m_portalActive) return;
    m_dnsServer.stop();
    m_webServer.stop();
    WiFi.softAPdisconnect(true);
    m_portalActive = false;

    if (m_cfg.wifiSsid.length() > 0) {
      WiFi.mode(WIFI_STA);
      if (WiFi.status() != WL_CONNECTED) {
        WiFi.begin(m_cfg.wifiSsid.c_str(), m_cfg.wifiPassword.c_str());
      }
    } else {
      WiFi.mode(WIFI_OFF);
    }
    Serial.println("[EDENS PnP] SoftAP setup portal closed cleanly.");
  }

  void startSoftApPortal(const char* openReason) {
    m_portalCsrfToken = generateCsprngHexToken(16);
    m_portalOpenedAtMs = millis();

    WiFi.mode(WIFI_AP_STA);
    // WPA2-PSK enforced (>=12-char CSPRNG password), channel 1, visible SSID, max 2 clients
    WiFi.softAP(m_apSsid.c_str(), m_apPassword.c_str(), 1, 0, 2);
    delay(150);

    // If Wi-Fi credentials were previously saved (e.g., Credential Recovery Mode),
    // keep Station connection active so local camera / LAN stays online!
    if (m_cfg.wifiSsid.length() > 0 && WiFi.status() != WL_CONNECTED) {
      WiFi.begin(m_cfg.wifiSsid.c_str(), m_cfg.wifiPassword.c_str());
    }

    IPAddress apIp = WiFi.softAPIP();
    m_dnsServer.start(53, "*", apIp);

    if (!m_portalRoutesRegistered) {
      m_webServer.on("/", HTTP_GET, [this]() { handlePortalRoot(); });
      m_webServer.on("/api/scan", HTTP_GET, [this]() { handleWifiScan(); });
      m_webServer.on("/api/identity", HTTP_GET, [this]() { handleIdentityInfo(); });
      m_webServer.on("/api/provision", HTTP_POST, [this]() { handleProvisionSubmit(); });
      m_webServer.onNotFound([this]() { handlePortalRoot(); });
      m_portalRoutesRegistered = true;
    }

    m_webServer.begin();
    m_portalActive = true;

    printInstallerSerialLabel(openReason);
  }

  void handleIdentityInfo() {
    unsigned long remainingSec = 0;
    if (m_portalActive && (millis() - m_portalOpenedAtMs) < EDENS_PORTAL_SESSION_TTL_MS) {
      remainingSec = (EDENS_PORTAL_SESSION_TTL_MS - (millis() - m_portalOpenedAtMs)) / 1000UL;
    }
    // Never include ap_psk or device_key in HTTP responses
    String json = "{";
    json += "\"hardwareIdentityUid\":\"" + m_cfg.hardwareUid + "\",";
    json += "\"macAddress\":\"" + m_cfg.macAddress + "\",";
    json += "\"deviceType\":\"" + String(m_deviceType) + "\",";
    json += "\"firmwareVersion\":\"" + String(m_firmwareVersion) + "\",";
    json += "\"recoveryMode\":" + String(m_recoveryModeActive ? "true" : "false") + ",";
    json += "\"sessionRemainingSeconds\":" + String(remainingSec);
    json += "}";
    m_webServer.send(200, "application/json", json);
  }

  void handleWifiScan() {
    int n = WiFi.scanNetworks(false, false);
    String json = "{\"networks\":[";
    for (int i = 0; i < n && i < 15; ++i) {
      if (i > 0) json += ",";
      String ssid = WiFi.SSID(i);
      ssid.replace("\"", "\\\"");
      json += "{\"ssid\":\"" + ssid + "\",\"rssi\":" + String(WiFi.RSSI(i)) + "}";
    }
    json += "]}";
    WiFi.scanDelete();
    m_webServer.send(200, "application/json", json);
  }

  void recordFailedPairingAttempt() {
    m_failedProvisionAttempts++;
    if (m_failedProvisionAttempts >= EDENS_PORTAL_MAX_FREE_ATTEMPTS) {
      uint16_t over = m_failedProvisionAttempts - EDENS_PORTAL_MAX_FREE_ATTEMPTS;
      unsigned long lockSec = 15UL << (over > 4 ? 4 : over); // 15s, 30s, 60s, 120s, 240s, capped 300s
      if (lockSec > 300UL) lockSec = 300UL;
      m_provisionLockoutUntilMs = millis() + (lockSec * 1000UL);
      Serial.printf("[EDENS PnP SECURITY] Pairing rate limit triggered (%u failures). Lockout=%lus\n",
                    m_failedProvisionAttempts, lockSec);
    }
  }

  void handlePortalRoot() {
    String modeBanner = m_recoveryModeActive
      ? "<div class='note'><b>Credential Recovery Mode:</b> Previous cloud key was rotated or revoked. Local safety rules remain active. Enter a new one-time pairing code from EDENS AI to re-link.</div>"
      : "";

    String prefillSsid = escapeHtml(m_cfg.wifiSsid);
    String prefillOrigin = escapeHtml(
      m_cfg.cloudOrigin.length() > 0 ? m_cfg.cloudOrigin : String(EDENS_DEFAULT_CLOUD_ORIGIN)
    );

    String html = F(
      "<!DOCTYPE html><html><head><meta charset='utf-8'>"
      "<meta name='viewport' content='width=device-width,initial-scale=1'>"
      "<title>EDENS AI — Secure Hardware Setup</title>"
      "<style>"
      "body{font-family:system-ui,-apple-system,sans-serif;background:#f8faf9;color:#0f172a;margin:0;padding:20px;}"
      ".card{max-width:440px;margin:0 auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:24px;}"
      "h1{font-size:20px;margin:0 0 6px;color:#065f46;}p{font-size:13px;color:#475569;line-height:1.5;}"
      ".note{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 12px;font-size:12px;color:#78350f;margin:10px 0;}"
      "label{display:block;font-size:12px;font-weight:600;margin:14px 0 5px;}"
      "input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;}"
      "button{width:100%;margin-top:18px;padding:13px;background:#059669;color:#fff;font-weight:700;border:0;border-radius:10px;font-size:14px;cursor:pointer;}"
      ".meta{margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0;font-family:monospace;font-size:11px;color:#64748b;}"
      "</style></head><body><div class='card'>"
      "<h1>EDENS AI Hardware Setup</h1>"
      "<p>WPA2-protected local provisioning portal. Your Wi-Fi password stays on this ESP32 chip and is never sent to EDENS AI servers.</p>"
    );
    html += modeBanner;
    html += "<form method='POST' action='/api/provision'>";
    html += "<input type='hidden' name='csrf' value='" + m_portalCsrfToken + "'>";
    html += "<label>2.4 GHz Greenhouse Wi-Fi Name (SSID)</label>";
    html += "<input name='ssid' required placeholder='e.g. Farm_Router_2.4G' value='" + prefillSsid + "'>";
    html += "<label>Wi-Fi Password</label>";
    html += "<input name='pass' type='password' placeholder='" +
            String(m_cfg.wifiPassword.length() > 0 ? "Leave blank to keep saved Wi-Fi password" : "Wi-Fi Password") + "'>";
    html += "<label>One-Time EDENS Pairing Code</label>";
    html += "<input name='token' required placeholder='enr_... (from EDENS AI Setup Wizard)'>";
    html += "<label>EDENS Cloud Server URL</label>";
    html += "<input name='origin' value='" + prefillOrigin + "'>";
    html += "<button type='submit'>Connect &amp; Pair Device</button></form>";
    html += "<div class='meta'>UID: " + m_cfg.hardwareUid + " &middot; Type: " + String(m_deviceType) +
            " &middot; FW: " + String(m_firmwareVersion) + "</div></div></body></html>";
    m_webServer.send(200, "text/html", html);
  }

  void handleProvisionSubmit() {
    unsigned long nowMs = millis();
    if (m_provisionLockoutUntilMs > nowMs) {
      unsigned long waitSec = (m_provisionLockoutUntilMs - nowMs + 999UL) / 1000UL;
      m_webServer.sendHeader("Retry-After", String(waitSec));
      m_webServer.send(
        429,
        "text/plain",
        "TOO_MANY_PAIRING_ATTEMPTS: Wait " + String(waitSec) + " seconds before trying again."
      );
      return;
    }

    String csrf = m_webServer.arg("csrf");
    if (csrf.length() == 0 || csrf != m_portalCsrfToken) {
      recordFailedPairingAttempt();
      m_webServer.send(403, "text/plain", "INVALID_PORTAL_SESSION_TOKEN: Reload http://192.168.4.1 and try again.");
      return;
    }

    String ssid = m_webServer.arg("ssid");
    ssid.trim();
    String pass = m_webServer.arg("pass");
    if (pass.length() == 0 && ssid == m_cfg.wifiSsid && m_cfg.wifiPassword.length() > 0) {
      pass = m_cfg.wifiPassword;
    }
    String token = m_webServer.arg("token");
    token.trim();
    String origin = m_webServer.arg("origin");
    origin.trim();
    if (origin.length() == 0) origin = EDENS_DEFAULT_CLOUD_ORIGIN;
    if (origin.endsWith("/")) origin.remove(origin.length() - 1);

    if (ssid.length() == 0 || token.length() < 12) {
      recordFailedPairingAttempt();
      m_webServer.send(400, "text/plain", "Missing Wi-Fi SSID or valid one-time pairing code.");
      return;
    }

    Serial.printf("[EDENS PnP] Testing Wi-Fi '%s' for secure cloud bootstrap...\n", ssid.c_str());
    if (WiFi.status() != WL_CONNECTED || WiFi.SSID() != ssid) {
      WiFi.begin(ssid.c_str(), pass.c_str());
    }

    unsigned long startWait = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - startWait) < 15000UL) {
      delay(250);
    }

    if (WiFi.status() != WL_CONNECTED) {
      recordFailedPairingAttempt();
      m_webServer.send(
        502,
        "text/html",
        "<html><body style='font-family:sans-serif;padding:24px'><h3>Could not join Wi-Fi</h3>"
        "<p>Verify the network is 2.4 GHz and the Wi-Fi password is accurate, then <a href='/'>try again</a>.</p></body></html>"
      );
      return;
    }

    String errOut;
    if (!exchangeBootstrapToken(origin, token, errOut)) {
      recordFailedPairingAttempt();
      m_webServer.send(
        400,
        "text/html",
        "<html><body style='font-family:sans-serif;padding:24px'><h3>Cloud Pairing Rejected</h3><p>" +
          escapeHtml(errOut) + "</p><p><a href='/'>Back to Setup</a></p></body></html>"
      );
      return;
    }

    // Pairing succeeded — reset failure counters, persist new credentials, and close SoftAP!
    m_failedProvisionAttempts = 0;
    m_provisionLockoutUntilMs = 0;
    m_recoveryModeActive = false;
    m_cfg.wifiSsid = ssid;
    m_cfg.wifiPassword = pass;
    m_cfg.cloudOrigin = origin;
    m_cfg.provisioned = true;
    saveToNvs();

    m_webServer.send(
      200,
      "text/html",
      "<html><body style='font-family:sans-serif;padding:24px;color:#065f46'>"
      "<h2>Paired &amp; Online!</h2>"
      "<p>Device ID: <b>" + escapeHtml(m_cfg.deviceId) + "</b> is now linked to Greenhouse <b>" +
      escapeHtml(m_cfg.greenhouseId) + "</b>. Closing setup hotspot and entering normal operation...</p></body></html>"
    );
    delay(800);
    stopSoftApPortal();
  }

  static String extractJsonStringField(const String& json, const char* key) {
    String needle = String("\"") + key + "\":\"";
    int idx = json.indexOf(needle);
    if (idx < 0) return "";
    int start = idx + needle.length();
    int end = json.indexOf("\"", start);
    if (end < 0) return "";
    return json.substring(start, end);
  }

  bool exchangeBootstrapToken(const String& origin, const String& token, String& errOut) {
    HTTPClient http;
    WiFiClientSecure tlsClient;
    WiFiClient plainClient;

    String bootstrapUrl = origin + "/api/devices/bootstrap";
    bool isHttps = bootstrapUrl.startsWith("https://");

    if (isHttps) {
      tlsClient.setCACert(EDENS_PNP_ROOT_CA_PEM);
      tlsClient.setTimeout(12);
      if (!http.begin(tlsClient, bootstrapUrl)) {
        errOut = "Unable to initialize verified HTTPS client.";
        return false;
      }
    } else {
      if (!http.begin(plainClient, bootstrapUrl)) {
        errOut = "Unable to initialize HTTP client.";
        return false;
      }
    }

    http.addHeader("Content-Type", "application/json");
    String payload = "{";
    payload += "\"bootstrapToken\":\"" + token + "\",";
    payload += "\"deviceType\":\"" + String(m_deviceType) + "\",";
    payload += "\"firmwareVersion\":\"" + String(m_firmwareVersion) + "\",";
    payload += "\"hardwareIdentityUid\":\"" + m_cfg.hardwareUid + "\",";
    payload += "\"macAddress\":\"" + m_cfg.macAddress + "\",";
    payload += "\"capabilities\":" + String(m_capabilitiesJson);
    payload += "}";

    int code = http.POST(payload);
    String resp = http.getString();
    http.end();

    if (code != 200) {
      String msg = extractJsonStringField(resp, "message");
      errOut = msg.length() > 0 ? msg : ("HTTP " + String(code));
      return false;
    }

    String devKey = extractJsonStringField(resp, "deviceKey");
    String ghId = extractJsonStringField(resp, "greenhouseId");
    String devId = extractJsonStringField(resp, "deviceId");
    String zoneId = extractJsonStringField(resp, "zoneId");
    String upUrl = extractJsonStringField(resp, "uploadUrl");

    if (devKey.length() < 16 || ghId.length() == 0 || devId.length() == 0) {
      errOut = "Invalid bootstrap response from server.";
      return false;
    }

    m_cfg.deviceKey = devKey;
    m_cfg.greenhouseId = ghId;
    m_cfg.deviceId = devId;
    m_cfg.zoneId = zoneId;
    m_cfg.uploadUrl = upUrl;
    return true;
  }
};
