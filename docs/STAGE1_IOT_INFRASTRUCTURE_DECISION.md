# STAGE 1 — Intelligent IoT Infrastructure Selection & Architecture Decision

- **Mission ID**: `EDENS-MASTER-2026-01`
- **Stage**: `STAGE_1` (`COMPLETE`)
- **Decision Date**: `2026-11-04`

---

## 1. Candidate Repositories, Verified Versions & License Audit

| Candidate | Official Repository & Docs | Verified Latest Release(s) | Exact License (`LICENSE` Audit) | Commercial SaaS & Network-Service Obligations |
|---|---|---|---|---|
| **1. ThingsBoard** | `https://github.com/thingsboard/thingsboard` • `https://thingsboard.io/docs/` | **`v4.4.0`** (2026-09-29, unified codebase) vs **`v4.3.1.8` LTS** (final CE release) | **`v4.4.0+`: `BUSL-1.1`** (Business Source License 1.1; converts to `Apache-2.0` 4 years post-release, e.g., 2030-09-29).<br>**`<= v4.3.1.8`: `Apache-2.0`** (irrevocable). | **CRITICAL VERSION TRAP**: Adopting `v4.4.0+` imposes a hard commercial limit of `<= 100` devices on a single server and prohibits white-labeling/rebranding without a paid ThingsBoard commercial license. Only **`v4.3.1.8` LTS** (and ThingsBoard's open MQTT/HTTP telemetry JSON specification) is safe for unrestricted commercial SaaS use under `Apache-2.0`. |
| **2. OpenRemote** | `https://github.com/openremote/core` • `https://docs.openremote.io/` | **`v1.33.0`** | **`AGPL-3.0-only` / `AGPL-3.0-or-later`** (GNU Affero General Public License v3.0) | **DISQUALIFIED FOR CORE SAAS EMBEDDING**: Under AGPLv3 Section 13 (*Remote Network Interaction*), modifying OpenRemote or tightly coupling derivative backend modules into a networked SaaS platform (Render/Vercel) requires releasing the complete corresponding source code of the combined network service under AGPLv3 unless a commercial OEM license is purchased. |
| **3. ESPHome** | `https://github.com/esphome/esphome` • `https://esphome.io/` | **`2026.10.2`** | **Dual-Licensed**:<br>• Python CLI, YAML compiler & schemas: **`MIT`**<br>• C++ firmware runtime (`.c`, `.cpp`, `.h`, `.ino`): **`GPL-3.0`** | **PERMISSIVE NETWORK BOUNDARY**: GPL-3.0 applies strictly to firmware binaries flashed onto ESP32 microcontrollers (not to cloud servers communicating with devices over standard MQTT, HTTP REST, or SSE). Any distributed ESPHome C++ custom components remain open-source on the device side, while EDENS AI's Node.js/TypeScript cloud platform and proprietary agronomy/ML engines incur **zero** copyleft obligations. |
| **4. Home Assistant Core** | `https://github.com/home-assistant/core` • `https://www.home-assistant.io/docs/` | **`2026.10.4`** | **`Apache-2.0`** | Permissive commercial SaaS use, patent grant included, requires preservation of copyright/NOTICE files. However, Home Assistant Core is architected as a **single-household smart-home hub**, lacking multi-tenant farm/greenhouse RBAC isolation. Its **MQTT Auto-Discovery specification** (`homeassistant/<component>/<node_id>/<object_id>/config`) is open `Apache-2.0` and natively spoken by ESPHome. |
| **5. Embedded Transport Layer (`aedes` + `mqtt` + `ws`)** | `https://github.com/moscajs/aedes` • `https://github.com/mqttjs/MQTT.js` • `https://github.com/websockets/ws` | `aedes` `v0.51.x`, `mqtt` `v5.15.1`, `ws` `v8.18.x` | **`MIT`** across all three packages | Fully permissive for commercial SaaS, embedded cloud gateways, and private distribution; runs inside the existing Node.js `>=22.18.0` process. |

---

## 2. 26-Dimension Technical Evaluation Matrix

| Evaluation Dimension | ThingsBoard CE (`v4.3.1.8` Apache-2.0) | OpenRemote (`v1.33.0` AGPLv3) | ESPHome (`2026.10.2` MIT/GPLv3) | Home Assistant (`2026.10.4` Apache-2.0) |
|---|---|---|---|---|
| **1. Architecture** | Monolithic/Microservice Java 17 Spring Boot + PostgreSQL (+ optional Kafka/Redis) | Java WildFly + Keycloak + PostgreSQL Docker stack | Declarative YAML -> C++ PlatformIO ESP-IDF/Arduino firmware generator + device runtime | Python `asyncio` single-instance event bus + local SQLite recorder |
| **2. Supported Protocols** | MQTT, HTTP, CoAP, LwM2M, SNMP | MQTT, HTTP, WebSocket, KNX, Modbus | MQTT (with HA Auto-Discovery), Native Protobuf API, HTTP REST/SSE Web Server (`v3`) | 2,500+ consumer integrations, MQTT, ESPHome Native API, WebSocket |
| **3. ESP32 Compatibility** | Generic MQTT/HTTP JSON client required | Generic MQTT/HTTP client required | **First-class native target** (ESP-IDF & Arduino, 200+ sensors, ADC, PWM, watchdog, OTA) | First-class via ESPHome or MQTT Auto-Discovery |
| **4. ESP32-CAM Compatibility** | Poor for binary frames (JSON `ts_kv` table bloats on base64 JPEGs) | Poor for high-frequency binary JPEG snapshots | Built-in `esp32_camera` & `esp32_camera_web_server` MJPEG/snapshot components | Supports MJPEG/still proxy on local LAN only |
| **5. HTTP Support** | `POST /api/v1/$TOKEN/telemetry` & `/attributes` | REST Asset API | Built-in HTTP REST `/sensor/<id>`, `/switch/<id>` & outbound `http_request` | REST API + webhook triggers |
| **6. MQTT Support** | Built-in Netty MQTT broker (`1883`/`8883`) | Built-in MQTT broker | Native MQTT client with TLS, LWT (`birth_message`/`will_message`), and JSON state/discovery | Requires external broker (Mosquitto) |
| **7. WebSockets** | Dashboard UI telemetry subscriptions | Manager UI WebSocket | EventSource SSE (`/events`); MQTT-over-WSS via broker | Client WebSocket API (`/api/websocket`) |
| **8. Device Provisioning** | ProvisionKey + ProvisionSecret flow | X.509 / Keycloak client credentials | Improv Wi-Fi Serial/BLE, Captive Portal SoftAP (`captive_portal`), QR/OTA | UI Config Flows (consumer local LAN) |
| **9. Device Discovery** | Manual rule-chain mapping | Manual agent/asset mapping | **Automatic capability & unit announcement** via MQTT Discovery & `/events` | Automatic mDNS/ZeroConf & MQTT Auto-Discovery |
| **10. Device Authentication** | Access Token, MQTT Basic, X.509 | OAuth2 / Keycloak / MQTT Basic | Per-device MQTT credentials, API Noise PSK encryption, HTTP Digest/Bearer | Long-Lived User Tokens (not per-device scoped) |
| **11. Telemetry** | Key-value time-series (`ts_kv`) | Asset attribute history | Typed sensor states with `unit_of_measurement`, `device_class`, `accuracy_decimals`, NaN handling | Entity state history (short-term recorder) |
| **12. Device Management** | Device profiles, alarms, RPC | Asset hierarchy & rules | Health sensors (`wifi_signal`, `uptime`, `free_heap`), safe-mode boot rollback, OTA | Device registry per single home |
| **13. Local Connectivity** | Requires ThingsBoard Edge (paid/BUSL) or local 4 GB server | Heavy Docker host required | **Native local SoftAP, mDNS, HTTP REST, local automations without internet** | Local LAN hub (requires Raspberry Pi/NUC per farm) |
| **14. Cloud Connectivity** | Strong for JSON telemetry via MQTT/HTTPS | Strong via MQTT/HTTPS | Native outbound MQTT-over-TLS / MQTT-over-WSS (`wss://`) to cloud gateway | Requires Nabu Casa or VPN tunnel for cloud |
| **15. Multi-Device Management** | Native fleet profiles | Asset tree | YAML packages (`packages:` / `substitutions:`) for standardized fleet builds | Single-home entity list |
| **16. Multi-Tenant Security** | Tenant -> Customer RBAC | Realm isolation | Enforced by upstream cloud broker/gateway ACLs (`greenhouse_id` / `device_id`) | **None** (single-tenant household design) |
| **17. Device Replacement** | Token swap on device entity | Manual asset re-binding | Re-flash/re-pair with new one-time token while gateway preserves historical `device_id` lineage | Manual entity rename |
| **18. Firmware Management** | Checksummed OTA binary repository | Limited generic OTA | **Industry-leading OTA** with safe-mode boot-loop detection & automatic rollback | Delegates ESP32 OTA to ESPHome |
| **19. APIs** | REST + MQTT + Rule Engine | REST + Manager GraphQL/WS | Device HTTP `v3` JSON, MQTT Discovery JSON, Native Protobuf | REST + WebSocket |
| **20. Deployment Requirements** | Java 17 + PostgreSQL 15+ (`>= 2–4 GB RAM`) | Docker Compose (`Keycloak + WildFly + Postgres`, `>= 4 GB RAM`) | Zero extra cloud server needed; firmware compiled at dev/CI time | Dedicated Python Linux host (`>= 2 GB RAM`) |
| **21. Resource Consumption** | **High** (`2.2–4.0 GB RAM` idle; OOMs on Render 512 MB Starter) | **High** (`3.0–4.5 GB RAM` idle) | **Zero cloud RAM overhead**; ~45 KB RAM on ESP32 | Moderate (`600 MB–1.2 GB RAM` per instance) |
| **22. Maintenance** | Heavy JVM/DB schema upgrades | Complex Keycloak + WildFly upgrades | Declarative 60-line YAML replaces hundreds of lines of C++ driver boilerplate | Monthly breaking integration changes |
| **23. Community Activity** | Large enterprise IoT community | Moderate smart-city community | Massive ESP32 hardware community (Nabu Casa / Open Home Foundation) | Largest smart-home community |
| **24. Production Suitability** | High for external JVM clusters (`v4.3.1.8` only); unsuitable inside Render Starter | Unsuitable due to AGPLv3 + RAM footprint | **High** for ESP32 sensor/actuator edge reliability & safe-mode watchdogs | Consumer home focus; unsuitable as multi-tenant SaaS backend |
| **25. Licensing** | `v4.3.1.8`: `Apache-2.0` • `v4.4.0+`: `BUSL-1.1` | `AGPL-3.0` | Python: `MIT` • Firmware C++: `GPL-3.0` | `Apache-2.0` |
| **26. Redistribution & SaaS Risk** | Safe **only** on `<= v4.3.1.8`; `v4.4.0+` restricts `>100` commercial devices | High legal risk (AGPLv3 network copyleft) | **Low risk** (clean network protocol boundary; firmware source stays open) | Low license risk, high architectural mismatch |

---

## 3. Evaluation of Architectural Strategies (A vs B vs C)

### Strategy A — External IoT Platform as a Separate Service
- **Pros**: Offloads raw MQTT connection fan-out at `>1,000` concurrent devices.
- **Cons**: Cannot run inside EDENS AI's existing Render Starter service (`512 MB RAM` limit vs `2–4 GB RAM` required by ThingsBoard/OpenRemote); introduces a mandatory `$25–$85/month` external VM + PostgreSQL cluster immediately; splits user/greenhouse RBAC across two databases; still cannot handle binary JPEG ESP32-CAM uploads cleanly.
- **Verdict**: Rejected as mandatory baseline; supported **optionally** as an external bridge target (`ThingsBoard CE v4.3.1.8`).

### Strategy B — Reuse Communication Protocols, Firmware Components & Libraries Only
- **Pros**: Zero external server cost; embeds cleanly in Node.js 22.
- **Cons**: Without a unified **Universal Device Adapter** normalizing device state, discovery manifests, and telemetry schemas, protocol handling becomes scattered across route files.
- **Verdict**: Necessary foundation, but insufficient alone without Strategy C's canonical adapter layer.

### Strategy C (SELECTED) — EDENS AI Universal Device Adapter Around Proven Open-Source Infrastructure
We select **Strategy C**, combining:
1. **Embedded Multi-Tenant IoT Gateway inside EDENS AI (`aedes` MIT + `ws` MIT + Express HTTPS)**:
   - Provides real **MQTT v3.1.1/v5.0 over WebSockets** (`wss://<host>/api/iot/mqtt-ws` on Render's single TLS port 443, plus optional raw TCP `MQTT_TCP_PORT=1883` on LAN/VPS deployments) with per-device SHA-256 credential authentication (`edctrl_*`, `edcam_*`, `eddev_*`), per-greenhouse topic ACL enforcement, and Last-Will-and-Testament (LWT) instant disconnect detection.
   - Provides real **Authenticated Real-Time Frontend WebSocket Streaming** (`/api/iot/ws`) pushing normalized `device:updated` and `telemetry:received` events to the React UI without relying on public demo brokers (`broker.hivemq.com`).
2. **ESPHome (`2026.10.2`, MIT/GPLv3) as Standard Edge Firmware & Auto-Discovery Platform**:
   - Native support in the Universal Device Adapter for **ESPHome / Home Assistant MQTT Auto-Discovery** (`homeassistant/<component>/<node_id>/<object_id>/config`) and **ESPHome HTTP REST `v3` Discovery & Polling** (`/sensor/<id>`, `/binary_sensor/<id>`, `/switch/<id>`).
   - Ready-to-flash declarative ESPHome YAML templates (`firmware/esphome/`) alongside preserved compatibility with existing EDENS Arduino C++ firmware (`firmware/EDENS_HARDWARE_KIT/` and `firmware/esp32_cam_cloud_sync/`) and existing HTTP ESP32-CAM endpoints (`http://10.87.237.36/{status,photo}` and `:81/stream`).
3. **ThingsBoard CE `v4.3.1.8` (`Apache-2.0`) Protocol & Bridge Adapter**:
   - Native ingestion compatibility with ThingsBoard's industry-standard device API (`POST /api/v1/:deviceToken/telemetry`, `POST /api/v1/:deviceToken/attributes`, and MQTT `v1/devices/me/telemetry`) plus optional upstream forwarding (`THINGSBOARD_CE_URL`) strictly pinned to `Apache-2.0` (`<= v4.3.1.8`), never `BUSL-1.1` (`>= v4.4.0`).

---

## 4. Source-of-Truth & Deployment Specification

- **Authoritative Source of Truth**:
  - **Device Identity, Credentials, Greenhouse/Zone RBAC & Sensor Registry**: EDENS AI SQLite (`PlatformDatabase` WAL mode: `devices`, `device_capabilities`, `iot_device_registry`, `iot_sensor_registry`, `iot_camera_registry`).
  - **Time-Series Telemetry & Rollups**: `telemetry_readings` (raw 90d), `telemetry_rollups_hourly` (365d), `telemetry_rollups_daily` (1825d).
  - **Camera Frames & Curated Datasets**: `CameraImageStore` (`CAMERA_STORAGE_PATH` atomic disk files) + SQLite `curated_dataset_samples` / `dataset_versions`.
- **Render Starter Compatibility (`512 MB RAM`, Single Port)**:
  - Runs 100% inside the existing `node server.ts` process (`~135–195 MB RSS`), sharing port `PORT` (`3000` locally / Render dynamic port behind TLS 443) for HTTP REST, `/api/iot/mqtt-ws` (MQTT-over-WSS), and `/api/iot/ws` (UI real-time WebSocket).
  - Requires **zero** paid external VMs for `< 500` concurrent greenhouses.

---

## 5. Non-Destructive Migration Plan (`STAGE_1 -> STAGE_2`)

1. Preserve 100% of existing SQLite `v1`–`v4` tables, API endpoints (`/api/telemetry/upload`, `/api/camera/*`, `/api/hardware-http/*`, `/api/greenhouses/*`, `/api/crops/*`, `/api/ai/*`), and UI workflows.
2. Add additive, versioned SQLite migration **`v5_universal_iot_and_independent_intelligence`** with backup & copy-test compatibility.
3. Route all protocol adapters (`mqtt`, `http_rest`, `websocket`, `esphome_api`, `thingsboard_v1`) through `UniversalDeviceAdapter` -> `StandardDeviceModel` & `StandardTelemetryModel` -> `PlatformDatabase` + Real-Time WebSocket broadcast.
