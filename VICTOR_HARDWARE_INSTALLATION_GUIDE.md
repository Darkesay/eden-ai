# EDENS AI — FIELD HARDWARE INSTALLATION & COMMISSIONING GUIDE

**Target Hardware Engineer:** Victor (Field Hardware Engineering Lead)  
**System:** EDENS AI Universal Hardware Connector  
**Platform Version:** 3.1.0-universal  
**Target Hosts:** Frontend `https://eden-ai.vercel.app` | Backend `https://edens-ai.onrender.com`  

---

## 1. PHYSICAL BENCH & EQUIPMENT CHECKLIST

Before flashing or wiring, ensure you have the following bench items:

### Required Silicon & Components
1. **ESP32-CAM (AI-Thinker Board)**:
   * OV2640 2-Megapixel Camera Module (standard ribbon cable).
   * FTDI USB-to-UART Serial Adapter (ensure jumper is set to **3.3V or 5V logic** compatible with your FTDI board).
   * Jumper wire for `GPIO 0` to `GND` (flashing mode switch).
2. **Main ESP32 DevKit V1 (ESP32-WROOM-32)**:
   * Micro-USB or Type-C data cable (must carry data, not charge-only).
   * 1x 100µF – 470µF electrolytic capacitor placed across `VIN` and `GND` (absorbs Wi-Fi TX current spikes and eliminates brownout resets).
3. **Power Supply**:
   * Regulated **5.0V DC Power Supply, minimum 2.0A capacity** (USB ports on laptops frequently brown out during concurrent OV2640 capture and Wi-Fi radio transmission).
4. **Local Network**:
   * Standard 2.4 GHz 802.11 b/g/n Wi-Fi network with internet connectivity. (ESP32 does NOT support 5 GHz Wi-Fi).

---

## 2. REPOSITORY FIRMWARE MAP

| Target Device | Firmware Source Directory | Primary Sketch File | Supported Protocols |
| :--- | :--- | :--- | :--- |
| **ESP32-CAM** | `firmware/esp32_cam_cloud_sync/` | `esp32_cam_cloud_sync.ino` | Outbound HTTPS Push (Method A) + Local LAN HTTP Server `/photo`, `/status`, `:81/stream` (Method B) |
| **ESP32 Controller** | `firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/` | `esp32_controller_reference.ino` | Outbound HTTPS Push (`/api/telemetry/upload`) with local offline ring buffering |
| **ESP32 MQTT Node** | `firmware/EDENS_HARDWARE_KIT/esp32_mqtt_universal_adapter/` | `edens_mqtt_sync.h` | MQTT v3.1.1 over TLS / WSS with Home Assistant auto-discovery |
| **ESPHome Node** | `firmware/esphome/` | `edens_greenhouse_controller.yaml` | ESPHome Native API / MQTT |
| **Edge Gateway** | `gateway/` | `edens_edge_gateway.py` | Local sensor polling, SQLite offline queue, camera relay |

---

## 3. FLASHING INSTRUCTIONS

### A. ESP32-CAM (AI-Thinker OV2640)

#### Arduino IDE Setup:
1. In Arduino IDE > Preferences, add ESP32 Board URL:  
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
2. Board Selection: **AI Thinker ESP32-CAM**
3. CPU Frequency: **240MHz (WiFi/BT)**
4. Flash Frequency: **80MHz**
5. Partition Scheme: **Huge APP (3MB No OTA / 1MB SPIFFS)**
6. PSRAM: **Enabled**
7. Upload Speed: **115200** (or 460800 if reliable)

#### Wiring FTDI to ESP32-CAM:
* FTDI `VCC (5V)` $\rightarrow$ ESP32-CAM `5V`
* FTDI `GND` $\rightarrow$ ESP32-CAM `GND`
* FTDI `TX` $\rightarrow$ ESP32-CAM `U0R` (GPIO 3)
* FTDI `RX` $\rightarrow$ ESP32-CAM `U0T` (GPIO 1)
* **FLASH JUMPER:** Connect ESP32-CAM `GPIO 0` $\rightarrow$ `GND`

#### Flashing:
1. Open `firmware/esp32_cam_cloud_sync/esp32_cam_cloud_sync.ino`.
2. Press ESP32-CAM onboard **RESET** button.
3. Click **Upload** in Arduino IDE.
4. When upload completes: **Disconnect GPIO 0 from GND**.
5. Press onboard **RESET** button.
6. Open Serial Monitor at **115200 baud** to observe boot diagnostics.

---

### B. Main ESP32 Greenhouse Controller

#### Arduino IDE Setup:
1. Board Selection: **ESP32 Dev Module**
2. Flash Size: **4MB (32Mb)**
3. Partition Scheme: **Default 4MB with spiffs**
4. Core Debug Level: **Info**

#### Flashing:
1. Open `firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/esp32_controller_reference.ino`.
2. Ensure `SAFETY_INTERLOCK_MODE = MONITORING_ONLY` (keep physical relays disconnected or simulated).
3. Connect USB cable to ESP32 DevKit.
4. Click **Upload**.
5. Open Serial Monitor at **115200 baud**.

---

## 4. ZERO-CODE ONBOARDING & PROVISIONING

Both the ESP32 Controller and ESP32-CAM feature **Plug-and-Play SoftAP Onboarding**:

1. **Boot into Setup Mode**:
   * On first boot (or by holding the BOOT button for 5 seconds), the board broadcasts a secure WPA2 hotspot:  
     **SSID:** `EDENS-SETUP-XXXX`  
     **Password:** Displayed on Serial Monitor (or defaults to `edenssetup2026`)
2. **Connect from Phone or Laptop**:
   * Join Wi-Fi `EDENS-SETUP-XXXX`.
   * Open browser to `http://192.168.4.1`.
3. **Configure Settings**:
   * Enter your Greenhouse 2.4 GHz Wi-Fi SSID and Password.
   * Enter the **Device Key** (`edctrl_...` or `edcam_...`) issued by EDENS AI.
   * Set Backend URL to `https://edens-ai.onrender.com`.
4. **Save & Reboot**:
   * Click **Save & Connect**. The board saves credentials to non-volatile storage (NVS), closes the hotspot, and connects to your greenhouse Wi-Fi.

---

## 5. LOCAL RELAY OPTIONS FOR EXISTING HARDWARE

If you wish to test with an existing camera already at `http://10.87.237.36` without flashing new firmware:

### Option 1: Node.js Relay Bridge
Run on any laptop on the greenhouse Wi-Fi:
```bash
node scripts/camera-lan-relay.mjs \
  --camera-url http://10.87.237.36/photo \
  --backend-url https://edens-ai.onrender.com \
  --camera-key edcam_YOUR_ACTUAL_KEY \
  --interval 30
```

### Option 2: Python Edge Gateway (Raspberry Pi / Linux)
```bash
cd gateway
pip3 install -r requirements.txt
cp config.example.json config.json
# Edit config.json with your keys and camera URL
python3 edens_edge_gateway.py config.json
```

---

## 6. SENSORS & PHYSICAL SAFETY INVARIANTS

### Unconnected Probes Rule
* If a sensor is not physically connected to the board (e.g. soil probe or water level float), the firmware reports `NAN`, which serializes as JSON `null`.
* **DO NOT** hardcode or fabricate dummy sensor values (e.g., reporting 0% soil moisture or 0°C).
* The EDENS AI interface automatically displays `Unpopulated` for `null` sensors.

### Physical Actuator Lockout
* **`ENABLE_ACTUATOR_DISPATCH=false` IS ACTIVE GLOBALLY.**
* The backend and firmware are strictly operating in **`MONITORING_ONLY`** mode.
* Do not connect physical AC water pumps, 220V heaters, or high-current solenoids during bench testing.

---

## 7. PHYSICAL VERIFICATION TEST MILESTONE

Follow these steps on bench to achieve First Physical Milestone sign-off:

1. [ ] **Step 1:** Log in to EDENS AI (`https://eden-ai.vercel.app`).
2. [ ] **Step 2:** Navigate to **Endpoint Fleet & Hardware** (`/devices`) and click **Add Device**.
3. [ ] **Step 3:** Enroll 1x ESP32-CAM and 1x ESP32 Controller. Download configuration headers.
4. [ ] **Step 4:** Power on ESP32-CAM. Verify in Serial Monitor that Wi-Fi connects and initial JPEG is captured.
5. [ ] **Step 5:** Check EDENS AI UI: verify badge changes to **CONNECTED** and fresh photograph appears in **Plant Vision**.
6. [ ] **Step 6:** Power on ESP32 Controller. Verify in Serial Monitor that telemetry is uploaded.
7. [ ] **Step 7:** Check EDENS AI UI: verify live temperature and humidity update on dashboard.
8. [ ] **Step 8:** Power off ESP32 Controller. Wait 90s (verify state transitions to **RECONNECTING**), then wait 180s (verify state transitions to **OFFLINE**).
9. [ ] **Step 9:** Power back on. Confirm automatic recovery to **CONNECTED** within 1 cycle.
10. [ ] **Step 10:** Confirm zero relay clicks or actuator dispatches occurred.
