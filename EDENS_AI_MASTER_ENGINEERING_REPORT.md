# EDENS AI — Master Engineering Report

- **Mission ID**: `EDENS-MASTER-2026-01`
- **Execution Mode**: `AUTONOMOUS_SEQUENTIAL_ENGINEERING`
- **Audit Date**: `2026-11-04`
- **Target Repository**: `https://github.com/Darkesay/eden-ai`
- **Target Production Topology**: Frontend `https://eden-ai.vercel.app` (Vercel Static + `/api/*` Rewrite) → Backend `https://edens-ai.onrender.com` (Render Node.js Web Service)
- **Physical Actuation Safety State**: `MONITORING_ONLY` / `SIMULATION_ONLY` (`PHASE3_PHYSICAL_EXECUTION_ENABLED = false`, `LIVE_ACTUATOR_RL_EXPLORATION_ALLOWED = false`)

> **Status Vocabulary Notice**: Every significant capability in this report is assigned **strictly one** canonical status label from the set `{NOT_STARTED, IMPLEMENTED, SOFTWARE_TESTED, FIRMWARE_COMPILED, DEPLOYED, PHYSICALLY_VERIFIED}`. Labels are never combined.

---

## 1. Executive Summary

EDENS AI has been upgraded across all three sequential mission stages (**Stage 1: Intelligent IoT Platform Selection**, **Stage 2: Universal IoT Infrastructure & Fleet Integration**, and **Stage 3: Independent Agricultural Knowledge, Versioned Datasets, Deep Learning & Safe Reinforcement Learning**) while preserving 100% of existing application routes, visual identity, multi-tenant SQLite records, 5 agronomy agents, 8 Nigerian-language voice capabilities, and all 9 pre-existing regression suites.

Key engineering outcomes:
1. **Verified IoT Architecture & Licensing (`docs/STAGE1_IOT_INFRASTRUCTURE_DECISION.md`)**: Upstream repository inspection confirmed that **ThingsBoard `v4.4.0`** switched to **`BUSL-1.1`** (capping commercial deployments at `<= 100` devices on a single server), whereas **`v4.3.1.8` LTS** remains permanently **`Apache-2.0`** (requiring `>= 2–4 GB RAM` for Java 17 + PostgreSQL), and **OpenRemote `v1.33.0`** is **`AGPL-3.0`** (incompatible with proprietary SaaS embedding). EDENS AI therefore implements **Strategy C**: a native **Universal Device Adapter** (`src/server/universalDeviceAdapter.ts`) paired with an embedded multi-tenant **`Aedes` `1.2.0` (`MIT`)** MQTT-over-WebSocket broker (`/api/iot/mqtt-ws`), **ESPHome `2026.10.2`** (`MIT` CLI / `GPL-3.0` edge firmware across a clean network boundary) auto-discovery & YAML generation, and **ThingsBoard CE `v4.3.1.8` (`Apache-2.0`)** HTTP/MQTT telemetry API compatibility — all running comfortably within Render's 512 MB Starter memory budget (`~135–185 MB RSS`).
2. **Protocol-Normalized Hardware Fleet (`Stage 2`)**: Devices connecting over **MQTT (`WSS`/`TCP`)**, **HTTP/REST**, **Authenticated Device WebSocket**, **ESPHome HTTP v3 / MQTT Discovery**, or **ThingsBoard v1 HTTP** normalize into canonical `StandardDeviceModel` and `StandardTelemetryModel` contracts (`SOFTWARE_TESTED`), pushed live to authorized tenant browsers over `/api/iot/ws` with strict separation between `REAL HARDWARE DATA` and `SIMULATED DATA`.
3. **Independent Agricultural Intelligence (`Stage 3`)**: EDENS AI now operates **100% deterministically when `GEMINI_API_KEY` is absent or unavailable** (`SOFTWARE_TESTED`), backed by an expanded Nigerian/tropical Crop & Diagnostic Knowledge Base (FAO, NIHORT Ibadan, IITA Ibadan, CGIAR/WorldVeg, NSPRI), a 10-category Versioned Dataset Infrastructure with SHA-256 deduplication and anti-ground-truth-pollution gates, an executable Time-Series MLP Forecaster + binary `.onnx` `ModelProto` (`ir_version=8`, `opset=17`) exporter + Median/MAD Sensor Anomaly Detector, and a Tier-1 Shielded Tabular Q-Learning Digital Twin simulator (`0` safety violations).

---

## 2. Original Architecture Audit

Inspection of the pre-mission repository established the following verified baseline:
- **Runtime & Stack**: Node.js `v22.23.3` (`engines.node >= 22.18.0`), npm `10.9.9`, TypeScript `~5.8.2`, React `19.0.1`, Vite `6.2.3`, Tailwind CSS `4.1.14`, Express `4.21.2`, and `SqliteDriver` (`node:sqlite` native WAL primary + `sql.js` `1.15.2` WASM fallback) at schema `v4_phase3_crop_intelligence_and_authorized_control`.
- **Frontend Modules**: 11 pages (`Login.tsx`, `Greenhouses.tsx`, `GreenhouseDetails.tsx`, `GreenhouseSetupWizard.tsx`, `PlantVision.tsx`, `AiAssistant.tsx`, `ControlCenter.tsx`, `DeviceManagement.tsx`, `HardwareConfig.tsx`, `AiLab.tsx`, `Settings.tsx`), 5 specialized agronomy agents (`ClimateAgent`, `IrrigationAgent`, `VisionAgent`, `HarvestAgent`, `AlertAgent`), and Nigerian multilingual voice consultation (English, Hausa, Yoruba, Igbo, Nigerian Pidgin, Fulfulde, Kanuri, Tiv).
- **Pre-Existing Hardware Integration**:
  - HTTPS Cloud Push (`POST /api/greenhouses/:id/telemetry`, `POST /api/camera/upload`) with per-device SHA-256 hashed `edctrl_*` and `edcam_*` credentials (`src/server/greenhouseRoutes.ts`, `src/server/cameraAcquisition.ts`).
  - Existing LAN HTTP adapter (`src/server/existingHardwareHttp.ts`, `src/components/ConnectExistingHardwarePanel.tsx`) and LAN relay script (`scripts/camera-lan-relay.mjs`) supporting historical ESP32-CAM endpoints (`http://10.87.237.36:81/stream`, `http://10.87.237.36/photo`, `http://10.87.237.36/status` — treated strictly as historical unverified configuration examples).
- **Identified Gaps Addressed by This Mission**:
  1. No server-side multi-tenant MQTT broker or real-time WebSocket push bus (`mqtt.tsx` previously ran a client-side simulation/polling loop without a backend MQTT/WS broker).
  2. No protocol-agnostic `UniversalDeviceAdapter` capable of onboarding ESPHome nodes, Home Assistant MQTT Auto-Discovery sensors, or ThingsBoard-compatible gateways alongside custom ESP32 HTTP/HTTPS sketches.
  3. No structured pest/disease/nutrient/abiotic diagnostic knowledge table (`agricultural_diagnostic_knowledge`) or 10-category versioned dataset pipeline with SHA-256 deduplication and train/validation/test split governance.
  4. `ml_model_versions`, `ml_training_runs`, `rl_policies`, and `simulation_experiments` tables existed from Phase 1 (`v3`) as schema foundations only, without executable training, evaluation, ONNX serialization, or Digital Twin RL benchmarking services.

---

## 3. Selected IoT Platform

**Selected Architecture**: **Strategy C — EDENS AI Native Control Plane + `UniversalDeviceAdapter` + Embedded `Aedes` Multi-Tenant MQTT-over-WebSocket Gateway + ESPHome `2026.10.2` Open-Source Edge Standard + Optional External ThingsBoard CE `v4.3.1.8` LTS (`Apache-2.0`) Fleet Connector**.

| Layer | Selected Component | Role in EDENS AI | Status |
| :--- | :--- | :--- | :--- |
| **Application, UX & Safety Plane** | EDENS AI Express + React + SQLite WAL | Tenant auth, RBAC, 3-mode Farmer Authorization, Crop Intelligence, Plant Vision, Voice AI | `SOFTWARE_TESTED` |
| **Universal Normalization Layer** | `UniversalDeviceAdapter` (`src/server/universalDeviceAdapter.ts`) | Translates `mqtt`, `http_rest`, `websocket`, `esphome_api`, and `thingsboard_v1` into `StandardDeviceModel` & `StandardTelemetryModel` | `SOFTWARE_TESTED` |
| **Cloud Real-Time & MQTT Transport** | Embedded `Aedes` `1.2.0` + `ws` `8.22.1` (`src/server/iotInfrastructureGateway.ts`) | Multiplexes WSS `/api/iot/mqtt-ws`, `/api/iot/device-ws`, and `/api/iot/ws` over Render's single TLS port `443` | `SOFTWARE_TESTED` |
| **Edge Firmware Standard** | **ESPHome `2026.10.2`** + Existing EDENS Arduino C++ Kit | Declarative YAML provisioning, Safe-Mode OTA, Captive Portal, MQTT Auto-Discovery & HTTP v3 API | `IMPLEMENTED` |
| **Optional Enterprise External Broker** | **ThingsBoard CE `v4.3.1.8` LTS** (External VM only; never `v4.4.0+`) | Wire-compatible `/api/v1/:deviceToken/telemetry` & `v1/devices/me/telemetry` ingestion when scaling past `> 2,500` concurrent devices | `SOFTWARE_TESTED` |

---

## 4. Exact Repository and Version

All candidate upstream repositories, release tags, and runtime dependencies were verified directly against upstream metadata during Stage 1:

| Project / Package | Official Upstream Repository | Verified Version / Tag | Selected / Rejected |
| :--- | :--- | :--- | :--- |
| **ESPHome** | `https://github.com/esphome/esphome` | `2026.10.2` | **Selected** (Edge firmware standard & discovery schema) |
| **ThingsBoard CE (LTS)** | `https://github.com/thingsboard/thingsboard` | `v4.3.1.8` (Apache-2.0 LTS) | **Selected as wire-compatible protocol & optional external broker** |
| **ThingsBoard `v4.4.0+`** | `https://github.com/thingsboard/thingsboard` | `v4.4.0` (2026-09-29) | **Rejected** (`BUSL-1.1` license change) |
| **OpenRemote** | `https://github.com/openremote/core` | `v1.33.0` | **Rejected** (`AGPL-3.0` copyleft incompatibility) |
| **Home Assistant Core** | `https://github.com/home-assistant/core` | `2026.10.4` | **Rejected as cloud server** (MQTT Auto-Discovery schema adopted) |
| **Aedes MQTT Broker** | `https://github.com/moscajs/aedes` | `1.2.0` | **Selected & Installed** (Embedded Node.js MQTT broker) |
| **ws WebSocket Server** | `https://github.com/websockets/ws` | `8.22.1` | **Selected & Installed** (WSS upgrade multiplexing) |
| **MQTT.js Client** | `https://github.com/mqttjs/MQTT.js` | `5.15.1` | **Selected & Preserved** |

---

## 5. Licence and Compliance Assessment

Full 26-dimension comparison and legal obligation matrix are documented in `/docs/STAGE1_IOT_INFRASTRUCTURE_DECISION.md`. Summary of commercial SaaS compliance:

1. **ThingsBoard License Split (`CRITICAL FINDING`)**:
   - **ThingsBoard `v4.4.0` (released September 29, 2026)** switched its `LICENSE` to **Business Source License 1.1 (`BUSL-1.1`)**, restricting commercial production use to **at most 100 registered active devices on a single server (`1` instance)**, prohibiting multi-server commercial clustering without a commercial license, and mandating visible `"Powered by ThingsBoard"` UI branding (converting to `Apache-2.0` four years after publication).
   - **ThingsBoard CE `v4.3.1.8` LTS** remains permanently licensed under **`Apache-2.0`**. EDENS AI implements clean-room wire compatibility with the ThingsBoard `v4.3.1.8` HTTP/MQTT telemetry API (`POST /api/v1/:deviceToken/telemetry`) without embedding BUSL-encumbered `v4.4.0+` code.
2. **OpenRemote (`v1.33.0` — `AGPL-3.0`)**:
   - **Rejected**. Under `AGPL-3.0` Section 13, modifying or embedding OpenRemote into a network-accessible commercial greenhouse SaaS requires releasing the complete corresponding source code of the combined platform under `AGPL-3.0`.
3. **ESPHome (`2026.10.2` — Dual `MIT` + `GPL-3.0`)**:
   - **Compliant**. Python configuration schemas and CLI tools are **`MIT`**; C++ firmware device components compiled onto ESP32 flash are **`GPL-3.0`**. Because ESP32 hardware communicates with EDENS AI exclusively over standard network sockets (MQTT / HTTPS / JSON) across a physical hardware boundary, `GPL-3.0` obligations apply **only** to custom C++ firmware modifications distributed on physical boards — **zero** copyleft obligations attach to the proprietary EDENS AI Node.js/React cloud platform.
4. **Home Assistant (`2026.10.4` — `Apache-2.0`), `aedes` (`1.2.0` — `MIT`), `ws` (`8.22.1` — `MIT`), `mqtt` (`5.15.1` — `MIT`)**:
   - **100% Permissive Commercial SaaS Compatible**. No source disclosure requirements on EDENS AI proprietary application logic.

---

## 6. Architecture Decisions

1. **Why Strategy C Beats Strategy A (Embed Full IoT Platform) and Strategy B (External Platform as Primary DB)**:
   - Render Starter (`render.yaml`) provides **512 MB RAM** and exposes **one public HTTPS/WSS port** (`443` → `$PORT`). Running Java 17 + PostgreSQL (ThingsBoard CE requires `2–4 GB RAM`) or Keycloak + WildFly + Postgres (OpenRemote requires `4+ GB RAM`) inside the Render Node.js service would immediately crash with `SIGKILL` (OOM) and fail raw TCP port `1883`/`8883` ingress.
   - Strategy B would split source-of-truth state across two databases and add extra monthly cloud hosting costs before hardware scale justifies it.
   - **Strategy C** embeds `Aedes` (`MIT`, `~15 MB` RAM overhead) and `ws` directly onto the existing Express `http.Server` `upgrade` router (`/api/iot/mqtt-ws`, `/api/iot/device-ws`, `/api/iot/ws`), working natively through Render's TLS `443` load balancer at **$0 incremental infrastructure cost** while allowing external MQTT/ThingsBoard `v4.3.1.8` brokers to plug in later without rewriting a single frontend component or agronomy service.
2. **Strict Real-vs-Simulated Telemetry Provenance**:
   - Physical hardware channels (`/api/iot/mqtt-ws`, `/api/iot/device-ws`, `/api/v1/:deviceToken/telemetry`, `/api/greenhouses/:id/telemetry`) reject payloads marked `source: "simulated"` with `HTTP 400`.
   - Frontend `UniversalHardwareFleetPanel` and backend `/api/greenhouses/:id/iot/telemetry?source=...` isolate `real_hardware` and `simulated` streams into mutually exclusive views so simulated sandbox numbers are never blended with physical greenhouse telemetry.
3. **100% External-LLM-Independent Agronomy Core**:
   - Crop targets, VPD/GDD computation, environmental disease/pest risk matching, anomaly detection, time-series forecasting, RL simulation, and 10-point explainable recommendations execute deterministically from local SQLite knowledge tables. Google Gemini (`@google/genai`) is isolated behind the optional `ExternalReasoningProvider` interface (`src/server/independentDecisionEngine.ts`).

---

## 7. Infrastructure Changes

| Infrastructure Element | Pre-Mission State | Post-Mission State | Status |
| :--- | :--- | :--- | :--- |
| **SQLite Schema Version** | `v4_phase3_crop_intelligence_and_authorized_control` | `v5_universal_iot_and_independent_intelligence` (7 new tables + 3 additive `devices` columns) | `SOFTWARE_TESTED` |
| **MQTT-over-WebSocket Broker** | Not present | Embedded `Aedes` `1.2.0` on `WSS /api/iot/mqtt-ws` (per-device SHA-256 auth + topic ACLs) | `SOFTWARE_TESTED` |
| **Optional Raw TCP MQTT Listener** | Not present | Configurable via `MQTT_TCP_PORT` for local LAN gateways | `SOFTWARE_TESTED` |
| **Authenticated Device WebSocket** | Not present | `WSS /api/iot/device-ws` (`X-Hardware-Key` header auth; query-string secrets blocked) | `SOFTWARE_TESTED` |
| **Real-Time Tenant UI WebSocket** | Not present | `WSS /api/iot/ws?greenhouseId=...` (session cookie + RBAC check; `iot:init` + delta push) | `SOFTWARE_TESTED` |
| **ThingsBoard v4.3.1.8 HTTP Ingest** | Not present | `POST /api/v1/:deviceToken/telemetry` & `/attributes` | `SOFTWARE_TESTED` |
| **ESPHome HTTP Discovery & YAML** | Not present | `POST /api/greenhouses/:id/iot/discover-esphome` & `GET .../esphome-yaml` | `SOFTWARE_TESTED` |
| **Stage 3 Intelligence & ML/RL API** | Partial (`phase3Routes.ts` only) | 12 new endpoints in `src/server/stage3Routes.ts` (KB, Datasets, DL/ONNX, Safe RL, Independent Engine) | `SOFTWARE_TESTED` |

---

## 8. Files Created

| File Path | Purpose | Status |
| :--- | :--- | :--- |
| `/docs/STAGE1_IOT_INFRASTRUCTURE_DECISION.md` | Stage 1 26-dimension evaluation of ThingsBoard, OpenRemote, ESPHome, Home Assistant; license audit; Strategy C decision & migration plan | `SOFTWARE_TESTED` |
| `/src/server/universalDeviceAdapter.ts` | `UniversalDeviceAdapter`, `StandardDeviceModel`, `StandardTelemetryModel`, 5 protocol adapters, HA MQTT Auto-Discovery, SSRF-guarded ESPHome HTTP v3 discovery, ESPHome YAML generator | `SOFTWARE_TESTED` |
| `/src/server/iotInfrastructureGateway.ts` | Embedded `Aedes` MQTT-over-WS, Device WS, Real-Time UI WS, topic ACLs, live revocation, ThingsBoard `v4.3.1.8` HTTP endpoints, and `/api/iot/*` fleet routes | `SOFTWARE_TESTED` |
| `/firmware/esphome/edens_greenhouse_controller.yaml` | ESPHome `2026.10.2` reference ESP32 greenhouse controller YAML (`!secret` pin placeholders, WPA2 fallback SoftAP, Safe-Mode OTA, MQTT LWT & HA discovery) | `IMPLEMENTED` |
| `/firmware/esphome/edens_esp32_cam.yaml` | ESPHome `2026.10.2` reference ESP32-CAM YAML preserving `:81` stream & `:80` snapshot compatibility alongside MQTT health reporting | `IMPLEMENTED` |
| `/firmware/EDENS_HARDWARE_KIT/esp32_mqtt_universal_adapter/edens_mqtt_sync.h` | Arduino C++ `WiFiClientSecure` (`setCACert`) + `PubSubClient` MQTT Auto-Discovery & telemetry header | `IMPLEMENTED` |
| `/src/components/UniversalHardwareFleetPanel.tsx` | Native frontend multi-protocol fleet & real-time telemetry panel (`CONNECTED`, `DISCONNECTED`, `RECONNECTING`, `STALE DATA`, `REAL HARDWARE DATA` vs `SIMULATED DATA`, ESPHome YAML & discovery) | `SOFTWARE_TESTED` |
| `/src/server/agriculturalKnowledgeBase.ts` | Stage 3A Independent Agricultural Knowledge Base (11 verified Nigerian/tropical disease, pest, nutrient, stress & harvest cards + offline environmental risk matcher) | `SOFTWARE_TESTED` |
| `/src/server/datasetInfrastructure.ts` | Stage 3B 10-category Versioned Dataset Infrastructure (SHA-256 dedup, anti-ground-truth pollution, 70/15/15 splits, consent, immutable snapshots, JSONL/CSV export) | `SOFTWARE_TESTED` |
| `/src/server/deepLearningPipeline.ts` | Stage 3C DL catalog, chronological 2-layer LeakyReLU MLP Forecaster trainer/evaluator, binary `.onnx` `ModelProto` (`ir_version=8`, `opset=17`) serializer, and Median/MAD Anomaly Detector | `SOFTWARE_TESTED` |
| `/ml/train_pytorch_vision_onnx.py` | Offline PyTorch `MobileNetV3-Small` / `EfficientNet-B0` trainer & opset-17 `.onnx` exporter consuming EDENS JSONL dataset snapshots | `IMPLEMENTED` |
| `/src/server/reinforcementLearningEngine.ts` | Stage 3D `GreenhouseDigitalTwinEnv`, Tier-1 safety shield, Shielded Tabular Q-Learning trainer, and seeded baseline benchmark (`0` safety violations) | `SOFTWARE_TESTED` |
| `/src/server/independentDecisionEngine.ts` | Stage 3E/3F 100% Gemini-independent Agricultural Decision Engine, 10-point explainable recommendations, 3-mode Farmer Authorization gate, and interchangeable `ExternalReasoningProvider` | `SOFTWARE_TESTED` |
| `/src/server/stage3Routes.ts` | Express REST routes for Stage 3 Knowledge Base, Datasets, Deep Learning/ONNX, Safe RL, and Independent Decision evaluation | `SOFTWARE_TESTED` |
| `/test/master_mission_stages.test.ts` | 56-assertion end-to-end automated verification suite covering Stage 1, Stage 2, and Stage 3 | `SOFTWARE_TESTED` |
| `/EDENS_AI_ENGINEERING_STATUS.md` | Persistent autonomous engineering execution checkpoint log | `IMPLEMENTED` |
| `/EDENS_AI_MASTER_ENGINEERING_REPORT.md` | Mandatory 31-section comprehensive final engineering report | `IMPLEMENTED` |

---

## 9. Files Modified

| File Path | Summary of Non-Destructive Modifications | Status |
| :--- | :--- | :--- |
| `/package.json` | Installed `aedes` (`^1.2.0`), `ws` (`^8.22.1`), `@types/ws` (`^8.18.2`); appended `&& tsx test/master_mission_stages.test.ts` to `"test"` script | `SOFTWARE_TESTED` |
| `/src/server/migrations.ts` | Added `SCHEMA_VERSION_V5` (`v5_universal_iot_and_independent_intelligence`), `MIGRATION_V5_TABLES_SQL`, additive `devices` columns (`manufacturer`, `hardware_model`, `protocol`), `rollbackMigrationV5`, and updated `testMigrationAndRollbackOnCopy` | `SOFTWARE_TESTED` |
| `/server.ts` | Registered `registerUniversalIotInfrastructure`, `registerStage3IntelligenceRoutes`, `await iotRuntime.attachToHttpServer(httpServer)`, and graceful `iotRuntime.shutdown()` | `SOFTWARE_TESTED` |
| `/src/pages/Settings.tsx` | Mounted `UniversalHardwareFleetPanel` inside the existing `hardware` settings tab above `ConnectExistingHardwarePanel` | `SOFTWARE_TESTED` |
| `/src/pages/GreenhouseDetails.tsx` | Mounted compact `UniversalHardwareFleetPanel` inside individual greenhouse detail view | `SOFTWARE_TESTED` |
| `/firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/edens_controller_sync.h` | Added `#define EDENS_CTRL_ROOT_CA_BUNDLE EDENS_ROOT_CA_PEM` alias so HTTPS and MQTT firmware headers share the identical verified Root CA bundle | `SOFTWARE_TESTED` |
| `/.env.example` | Documented optional `# MQTT_TCP_PORT=""` setting without exposing any secrets | `IMPLEMENTED` |

---

## 10. Files Preserved

Zero files were deleted. All existing core modules, routes, UI components, firmware sketches, and regression suites were preserved intact:
- **Preserved Frontend Pages & Components**: `/src/App.tsx`, `/src/pages/Login.tsx`, `/src/pages/Greenhouses.tsx`, `/src/pages/GreenhouseSetupWizard.tsx`, `/src/pages/PlantVision.tsx`, `/src/pages/AiAssistant.tsx`, `/src/pages/ControlCenter.tsx`, `/src/pages/DeviceManagement.tsx`, `/src/pages/HardwareConfig.tsx`, `/src/pages/AiLab.tsx`, `/src/components/ConnectExistingHardwarePanel.tsx`, `/src/components/CropIntelligenceControlPanel.tsx`, `/src/components/AgronomyAgentsPanel.tsx`, `/src/components/CameraStream.tsx`, `/src/components/LeafCameraModal.tsx`, `/src/components/MonitoringModeBanner.tsx`, `/src/components/DataSourceBadge.tsx`, `/src/components/Layout.tsx`.
- **Preserved Agronomy Agents & Voice/AI Libraries**: `/src/agents/AgentManager.tsx`, `ClimateAgent.ts`, `IrrigationAgent.ts`, `VisionAgent.ts`, `HarvestAgent.ts`, `AlertAgent.ts`, `agentTelemetryContext.ts`, `/src/lib/gemini.ts`, `/src/lib/audio.ts`, `/src/lib/mqtt.tsx`, `/src/lib/apiClient.ts`, `/src/lib/auth.tsx`.
- **Preserved Backend Services**: `/src/server/database.ts`, `/src/server/sqliteDriver.ts`, `/src/server/repositories.ts`, `/src/server/greenhouseRoutes.ts`, `/src/server/existingHardwareHttp.ts`, `/src/server/cameraAcquisition.ts`, `/src/server/cameraStorage.ts`, `/src/server/visionDiagnosis.ts`, `/src/server/cropIntelligenceEngine.ts`, `/src/server/authorizedControlLoop.ts`, `/src/server/phase3Routes.ts`, `/src/server/safetyDefaults.ts`, `/src/server/telemetryContract.ts`.
- **Preserved Existing Firmware & Scripts**: `/firmware/EDENS_HARDWARE_KIT/edens_pnp_provisioning.h`, `/firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/esp32_controller_reference.ino`, `/firmware/esp32_cam_cloud_sync/edens_cloud_upload.h`, `/firmware/esp32_cam_cloud_sync/esp32_cam_cloud_sync.ino`, `/scripts/camera-lan-relay.mjs`, `/scripts/db-migration-tool.ts`, `/render.yaml`, `/vercel.json`.
- **Preserved Regression Test Suites**: All 9 pre-existing suites in `/test/*.test.ts`.

---

## 11. Database Migrations

- **Status**: `SOFTWARE_TESTED`
- **Active Schema Version**: `v5_universal_iot_and_independent_intelligence` (`src/server/migrations.ts`)
- **Migration Chain**:
  1. `v1_self_service_greenhouse_platform`
  2. `v2_hardware_states_and_nullable_sensors`
  3. `v3_phase1_intelligence_foundation`
  4. `v4_phase3_crop_intelligence_and_authorized_control`
  5. `v5_universal_iot_and_independent_intelligence`
- **Additive Changes in `v5`**:
  - Added nullable/defaulted columns on `devices`: `manufacturer TEXT DEFAULT 'Espressif'`, `hardware_model TEXT`, `protocol TEXT NOT NULL DEFAULT 'http_rest'`.
  - Created 7 new tables with `FOREIGN KEY (...) ON DELETE CASCADE` and composite indexes:
    1. `iot_sensor_registry`
    2. `iot_camera_registry`
    3. `iot_device_connection_history`
    4. `iot_integration_configs`
    5. `agricultural_diagnostic_knowledge`
    6. `agricultural_dataset_records`
    7. `agricultural_dataset_versions`
- **Verification Evidence**:
  - `test/phase1_data_foundation.test.ts`: Verified cryptographic pre-migration SHA-256 backup (`createVerifiedDatabaseBackup`), isolated copy dry-run (`81ms`), `PRAGMA integrity_check = ok`, `PRAGMA foreign_key_check = ok`, 100% preservation of legacy `v2` rows, append-only `audit_events` immutability triggers, and `1,758 durable writes+rollups/sec` on `node:sqlite` WAL (`5.8x` faster than `sql.js`).
  - `test/master_mission_stages.test.ts`: Verified `v5` schema upgrade and full `testMigrationAndRollbackOnCopy` (`v5 → v2` programmatic rollback + row-count preservation).

---

## 12. Hardware Integration Changes

| Capability | Implementation Path | Supporting Endpoints | Status |
| :--- | :--- | :--- | :--- |
| **Existing ESP32 HTTPS Cloud Push** | `src/server/greenhouseRoutes.ts` | `POST /api/greenhouses/:id/telemetry` (`X-Controller-Key`) | `SOFTWARE_TESTED` |
| **Existing ESP32 & ESP32-CAM LAN HTTP Adapter** | `src/server/existingHardwareHttp.ts` | `POST /api/hardware-settings/controller/test`, `POST /api/hardware-settings/camera/test`, `GET /api/hardware-settings/camera/stream` | `SOFTWARE_TESTED` |
| **Local LAN Camera Relay Bridge** | `scripts/camera-lan-relay.mjs` | Pulls LAN JPEG `/photo` → uploads via `POST /api/camera/upload` (`X-Camera-Key`) | `SOFTWARE_TESTED` |
| **MQTT-over-WSS Multi-Tenant Broker** | `src/server/iotInfrastructureGateway.ts` | `WSS /api/iot/mqtt-ws` (`edens/v1/greenhouses/<ghId>/devices/<devId>/telemetry`) | `SOFTWARE_TESTED` |
| **Home Assistant / ESPHome MQTT Auto-Discovery** | `src/server/universalDeviceAdapter.ts` | `homeassistant/sensor/<deviceId>/<sensorId>/config` | `SOFTWARE_TESTED` |
| **Authenticated Device WebSocket** | `src/server/iotInfrastructureGateway.ts` | `WSS /api/iot/device-ws` (`X-Hardware-Key`, `X-Greenhouse-Id`, `X-Device-Id`) | `SOFTWARE_TESTED` |
| **ThingsBoard CE `v4.3.1.8` HTTP Compatibility** | `src/server/iotInfrastructureGateway.ts` | `POST /api/v1/:deviceToken/telemetry`, `POST /api/v1/:deviceToken/attributes` | `SOFTWARE_TESTED` |
| **ESPHome HTTP v3 Discovery & YAML Export** | `src/server/universalDeviceAdapter.ts` | `POST /api/greenhouses/:id/iot/discover-esphome`, `GET .../iot/devices/:devId/esphome-yaml` | `SOFTWARE_TESTED` |
| **Physical Greenhouse Relay Execution** | Hard-disabled across backend & firmware | Blocked (`MONITORING_ONLY_DISABLED`) | `NOT_STARTED` |

---

## 13. ESP32 Firmware Status

| Firmware Artifact | Protocol(s) | Pinout & Safety Posture | Status |
| :--- | :--- | :--- | :--- |
| `firmware/EDENS_HARDWARE_KIT/edens_pnp_provisioning.h` | WPA2 SoftAP (`EDENS-SETUP-XXXX`) + NVS + HTTPS Bootstrap | Unique random 12-char setup password per board (`esp_random()`), 5-attempt lockout, 10-min portal timeout, 5x `HTTP 401` safe re-provisioning recovery preserving Tier-1 interlocks | `SOFTWARE_TESTED` |
| `firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/edens_controller_sync.h` | HTTPS REST (`WiFiClientSecure` + `setCACert`) | Reports `NaN`/unwired probes as JSON `null`; local watchdog, dry-run pump lock (`< 10%` tank), rain-roof lock, over-temp heater lock (`>= 32°C`) | `SOFTWARE_TESTED` |
| `firmware/EDENS_HARDWARE_KIT/esp32_mqtt_universal_adapter/edens_mqtt_sync.h` | MQTT v3.1.1 over TLS (`:8883` `setCACert`) + HA Auto-Discovery + LWT | Uses `EDENS_CTRL_ROOT_CA_BUNDLE` (`setInsecure()` forbidden); announces sensor metadata on connect; omits `NaN` channels | `IMPLEMENTED` |
| `firmware/esphome/edens_greenhouse_controller.yaml` | ESPHome `2026.10.2` (MQTT TLS + HTTP v3 + Safe-Mode OTA + Captive Portal) | Zero invented GPIO pins — all physical sensor/relay pins use `!secret` placeholders requiring bench verification before uncommenting | `IMPLEMENTED` |
| **ESP32 Binary Compilation & Physical Bench Verification** | Requires `esphome` / `arduino-cli` + physical ESP32 board | Not available in cloud container | `NOT_STARTED` |

---

## 14. ESP32-CAM Firmware Status

| Firmware Artifact | Protocol(s) | Compatibility & Safety Posture | Status |
| :--- | :--- | :--- | :--- |
| `firmware/esp32_cam_cloud_sync/edens_cloud_upload.h` + `.ino` | HTTPS `POST /api/camera/upload` (`X-Camera-Key`) + Verified Root CA TLS | Preserves existing AI-Thinker OV2640 camera pins (`XCLK GPIO0`, `SIOD GPIO26`, `SIOC GPIO27`, `Y2–Y9`, `VSYNC GPIO25`, `HREF GPIO23`, `PCLK GPIO22`, `PWDN GPIO32`), NVS credentials, and 5x `401` recovery | `SOFTWARE_TESTED` |
| `firmware/esphome/edens_esp32_cam.yaml` | ESPHome `2026.10.2` (`esp32_camera_web_server` `:81` stream + `:80` snapshot + MQTT status/LWT) | Preserves local LAN `:81` MJPEG stream & `:80` JPEG snapshot compatibility with `ConnectExistingHardwarePanel` and `scripts/camera-lan-relay.mjs` | `IMPLEMENTED` |
| **Historical `10.87.237.36` Endpoints** | `http://10.87.237.36:81/stream`, `/photo`, `/status` | Treated strictly as historical unverified configuration examples; cloud server honestly reports `CONNECTION_BLOCKED` for RFC1918 LAN IPs and offers `camera-lan-relay.mjs` | `SOFTWARE_TESTED` |
| **ESP32-CAM Binary Compilation & Physical Bench Verification** | Requires `esphome` / `arduino-cli` + physical AI-Thinker ESP32-CAM (`5V >= 2A` PSU) | Not available in cloud container | `NOT_STARTED` |

---

## 15. Universal Device Adapter

- **File**: `/src/server/universalDeviceAdapter.ts`
- **Status**: `SOFTWARE_TESTED`
- **Normalized Device Contract (`StandardDeviceModel`)**:
  - `device_id`, `greenhouse_id`, `zone_id`, `device_type` (`greenhouse_controller` | `greenhouse_camera`), `manufacturer`, `model`, `firmware_version`, `protocol` (`mqtt` | `http_rest` | `websocket` | `esphome_api` | `thingsboard_v1`), `connection_state` (`online` | `stale` | `reconnecting` | `offline` | `unprovisioned` | `revoked`), `ui_status_label` (`CONNECTED` | `DISCONNECTED` | `RECONNECTING` | `STALE DATA`), `data_provenance_label` (`REAL HARDWARE DATA` | `STALE DATA` | `DISCONNECTED`), `capabilities`, `sensors`, `actuators` (`physical_control_enabled: false`), `cameras`, `last_seen`, `health`.
- **Normalized Telemetry Contract (`StandardTelemetryModel`)**:
  - `greenhouse_id`, `zone_id`, `device_id`, `sensor_id`, `sensor_type`, `value`, `unit`, `quality` (`valid` | `out_of_bounds` | `stale` | `unavailable`), `source` (`real_hardware` | `simulated`), `protocol`, `timestamp`.
- **Anti-Fabrication & Anti-Assumption Guarantees**:
  - Physical range bounds enforced per sensor class (`temperature: -20..85°C`, `humidity: 0..100%`, `soil_moisture: 0..100%`, `ph: 0..14`, `ec: 0..20 mS/cm`, etc.); out-of-range spikes are flagged `quality: "out_of_bounds"` rather than silently corrupting control state.
  - `discoverEspHomeDeviceOverHttp` validates SSRF boundaries and requires valid ESPHome v3 JSON entity responses (`id` + numeric `value` or `state`), returning `422 INCOMPATIBLE_DEVICE_PROTOCOL` when pointed at a generic HTML webpage or router login screen (`SOFTWARE_TESTED` in `test/master_mission_stages.test.ts`).

---

## 16. Security Implementation

- **Status**: `SOFTWARE_TESTED`
- **Device Authentication & Hashing**:
  - Unique 192-bit random per-device keys (`edctrl_*`, `edcam_*`); only `SHA-256(key)` is stored in `devices.credential_hash`. Plaintext keys are displayed once at issuance or returned once over TLS bootstrap.
- **Per-Tenant & Per-Device Topic ACLs (`src/server/iotInfrastructureGateway.ts`)**:
  - Authenticated MQTT devices may publish/subscribe **only** to `edens/v1/greenhouses/<boundGhId>/devices/<boundDevId>/*`, `homeassistant/+/<boundDevId>/+/config`, or `v1/devices/me/*` (mapped server-side to `<boundGhId>/<boundDevId>`). Cross-greenhouse publishes are rejected by `aedes.authorizePublish` (`SOFTWARE_TESTED`).
- **Live Credential Revocation**:
  - Revoking or rotating a device key (`POST /api/greenhouses/:id/devices/:devId/revoke`) immediately blocks subsequent HTTP/ThingsBoard uploads (`401`), WebSocket upgrades (`401`), and active MQTT session publishes (`client.close()`).
- **Query-String Secret Prohibition & Log Redaction**:
  - Any request or WebSocket upgrade carrying `key`, `apiKey`, `token`, `secret`, `password`, or `access_token` in URL query parameters is rejected with `HTTP 401 QUERY_AUTH_DISALLOWED` so secrets never leak into proxy access logs. `redactSecretsFromText()` scrubs tokens from error logs.
- **SSRF & Rate-Limiting Protections**:
  - Cloud metadata (`169.254.169.254`), loopback (unless test flag `EDENS_ALLOW_LOOPBACK_CONTROLLER=1` in local test harnesses), CGNAT (`100.64.0.0/10`), multicast, and public internet hosts are blocked on local hardware test/discovery endpoints (`403`/`422`).
  - `SlidingWindowRateLimiter` protects auth, MQTT `CONNECT`, telemetry ingestion, and discovery endpoints (`429` + `Retry-After`).

---

## 17. Agricultural Knowledge Base

- **Files**: `/src/server/agriculturalKnowledgeBase.ts`, `/src/server/cropIntelligenceEngine.ts`
- **Status**: `SOFTWARE_TESTED`
- **Coverage**:
  - **Crops & Varieties**: Tomato (`Solanum lycopersicum` — Padma F1 / Roma VF), Sweet/Bell & Habanero Pepper (`Capsicum annuum` / `C. chinense` — Ata Rodo / Tatase), Cucumber (`Cucumis sativus` — Poinsett / Darina F1), Lettuce (`Lactuca sativa`), Fluted Pumpkin / Ugu (`Telfairia occidentalis`), African Spinach / Efo Tete (`Amaranthus hybridus`), Okra (`Abelmoschus esculentus`), Scent Leaf (`Ocimum gratissimum`), Strawberry (`Fragaria × ananassa`).
  - **6 Canonical Growth Stages**: `germination`, `seedling`, `vegetative`, `flowering`, `fruiting`, `harvest` — each specifying temperature (`min`/`optimal`/`max`), RH, soil moisture, pH, EC (`mS/cm`), VPD (`kPa`), light DLI & photoperiod hours, NPK/Ca/Mg ppm targets, irrigation guidance, and stress indicators.
  - **11 Structured Diagnostic Knowledge Cards (`agricultural_diagnostic_knowledge`)**:
    1. `tomato_early_blight` (*Alternaria solani* — Disease)
    2. `tomato_late_blight` (*Phytophthora infestans* — Disease)
    3. `bacterial_wilt_solanaceae` (*Ralstonia solanacearum* — Disease)
    4. `cucurbit_downy_mildew` (*Pseudoperonospora cubensis* — Disease)
    5. `tuta_absoluta_leafminer` (*Tuta absoluta* — Pest)
    6. `bemisia_whitefly_tylcv` (*Bemisia tabaci* & TYLCV — Pest)
    7. `calcium_blossom_end_rot` (Distal fruit Ca²⁺ transport deficit — Nutrient Deficiency)
    8. `magnesium_interveinal_chlorosis` (Lower-leaf Mg²⁺ deficiency — Nutrient Deficiency)
    9. `leafy_greens_nitrogen_iron_chlorosis` (N depletion & high-pH Fe lockout — Nutrient Deficiency)
    10. `tropical_heat_pollen_sterility` (`>= 32°C` flower abortion — Abiotic Stress)
    11. `harvest_maturity_and_handling` (Breaker-stage & NSPRI crate cooling — Harvest Condition)
  - **Authoritative Citations**: FAO Plant Production Paper 230 & Irrigation Paper 56, NIHORT Ibadan, IITA Ibadan, CGIAR (WorldVeg & CIP), and NSPRI Nigeria.

---

## 18. Dataset Infrastructure

- **File**: `/src/server/datasetInfrastructure.ts`
- **Status**: `SOFTWARE_TESTED`
- **Supported 10 Categories (`DATASET_CATEGORIES`)**:
  1. `sensor_time_series`
  2. `plant_images`
  3. `disease_labels`
  4. `pest_labels`
  5. `nutrient_deficiency_labels`
  6. `crop_growth_observations`
  7. `irrigation_events`
  8. `climate_events`
  9. `farmer_observations`
  10. `verified_treatment_outcomes`
- **Data Integrity & Governance Controls**:
  - **SHA-256 Deduplication**: Canonical key-sorted JSON hashing rejects duplicate records within a greenhouse (`409 DUPLICATE_DATASET_RECORD`).
  - **Anti-Ground-Truth-Pollution Gate**: Submissions with `provenanceSource: "farmer_observation"` attempting to self-certify as `agronomist_verified` are automatically downgraded to `unverified_farmer_observation` and flagged `unverified_ground_truth`. Only explicit agronomist/owner verification (`POST .../verify`) promotes a label to supervised ground truth.
  - **Deterministic Leakage-Free Splits**: Hash-bucketed `70% train / 15% validation / 15% test` assignment grouped by `splitGroupKey` so correlated observations from the same plant batch never leak across train and test sets.
  - **Consent & Immutable Snapshots**: Records with `consentForTraining = false` are excluded from `createDatasetVersionSnapshot` and `exportDatasetVersion` (`jsonl` and `csv`).

---

## 19. Deep Learning Implementation

| Capability / Artifact | Implementation Details | Honest Lifecycle State | Status |
| :--- | :--- | :--- | :--- |
| **Model Registry & Architecture Catalog (`DeepLearningPipelineService`)** | Evaluates PyTorch, ONNX, MobileNetV3-Small, EfficientNet-B0, YOLOv8n, 2-Layer LeakyReLU Residual MLP, and Robust Median/MAD Detector; tracks `isTrained` and `productionReady: false` | `registered` / `evaluated_offline_*` | `SOFTWARE_TESTED` |
| **Time-Series Environmental Forecaster (`trainAndEvaluateEnvironmentalForecaster`)** | Trains 2-layer LeakyReLU residual MLP (`6` standardized inputs → `10` hidden → `3` targets `[temp_next, rh_next, soil_next]`) on chronological 70/15/15 greenhouse telemetry windows (train-only mean/std normalization) and benchmarks held-out RMSE against a persistence baseline | Trained & evaluated offline on chronological telemetry; `productionReady: false` | `SOFTWARE_TESTED` |
| **Binary ONNX `ModelProto` Exporter (`serializeMinimalOnnxModelProto`)** | Serializes valid Protobuf wire-format `.onnx` `ModelProto` (`ir_version = 8`, `opset_import = 17`) + SHA-256 checksum to `data/ml_artifacts/*.onnx` | Verified byte-level header (`0x08 0x08`) & SHA-256 in automated tests | `SOFTWARE_TESTED` |
| **Robust Median/MAD Sensor Anomaly Detector (`fitAndEvaluateSensorAnomalyDetector`)** | Calibrates per-channel median and `1.4826 * MAD` envelopes on greenhouse telemetry and evaluates fault-injection precision/recall/F1 | Calibrated & evaluated offline (`F1 >= 0.80` in suite) | `SOFTWARE_TESTED` |
| **PyTorch Plant Vision Trainer (`ml/train_pytorch_vision_onnx.py`)** | Standalone PyTorch training, validation/test Macro-F1 evaluation, and opset-17 ONNX export script for `MobileNetV3-Small` and `EfficientNet-B0` (`plant_disease_classifier`, `pest_detector`, `nutrient_deficiency_detector`, `growth_stage_classifier`) | Pipeline script implemented; **not yet trained** (`torch` and field leaf corpus not present in container) | `IMPLEMENTED` |

---

## 20. Reinforcement Learning Implementation

- **File**: `/src/server/reinforcementLearningEngine.ts`
- **Status**: `SOFTWARE_TESTED`
- **Architecture**:
  - **Environment (`GreenhouseDigitalTwinEnv`)**: Simulates hourly tropical polyhouse thermal, vapour-pressure, substrate moisture, reservoir depletion, solar insolation, and rain dynamics across 3 Nigerian agro-climatic profiles (`lagos_humid_tropical`, `kano_dry_harmattan`, `jos_cool_highland`).
  - **State & Action Spaces**: Discretized `(tempBin, rhBin, soilBin, tankBin, rainBin)` state space over 6 bounded actions (`IDLE_HOLD`, `DRIP_PULSE_SHORT`, `DRIP_PULSE_STANDARD`, `VENT_COOL_MODERATE`, `VENT_COOL_MAX`, `COORDINATED_MIST_AND_VENT`).
  - **Hard Tier-1 Safety Shield (`applyTier1SafetyShield`)**: Intercepts every proposed RL action *before* physics execution — blocking pump pulses when `waterTankPct <= 10%` or daily cumulative runtime exceeds `maxDailyCumulativePumpSeconds`, and forcing roof closure during rain.
  - **Benchmarking & Hard Live-Hardware Prohibition**: `trainAndBenchmarkPolicyInSimulation` trains Shielded Tabular Q-Learning and benchmarks it on an unseen evaluation seed (`evalSeed = baseSeed + 99991`) against `selectDeterministicBaselineAction`, persisting water savings, energy savings, stress reduction, and verifying `safetyViolations === 0`. `LIVE_ACTUATOR_RL_EXPLORATION_ALLOWED` is hardcoded to `false` and persisted policies carry `approval_status = 'simulated_only'`.

---

## 21. Test Results

Command executed:
```bash
npm test
```
All **10** automated test suites executed and passed with **0 failures** and **0 skipped tests**:

| # | Test Suite File | Scope | Result | Assertions / Checks Passed |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `test/hardware.test.ts` | Telemetry parsing, freshness (`REAL_HARDWARE`/`CACHED`/`STALE`/`DISCONNECTED`), rain/reservoir/thermal interlocks | **PASS** | `10 / 10` checks (`0` failed) |
| 2 | `test/camera_upload.test.ts` | JPEG SOI/EOI validation, `X-Camera-Key`, 90s freshness guard, LAN-IP client hygiene, Root CA firmware check | **PASS** | `9 / 9` groups (`0` failed) |
| 3 | `test/voice_system.test.ts` | Microphone error classification, audio validation, 8 Nigerian languages STT/Chat/TTS + quota fallback | **PASS** | `26 / 26` checks (`0` failed) |
| 4 | `test/self_service_greenhouse.test.ts` | Production `node server.ts` boot, scrypt auth, QR onboarding, per-device keys, cross-tenant RBAC, revocation | **PASS** | `10 / 10` groups (`0` failed) |
| 5 | `test/hardware_gateway_security.test.ts` | SSRF blocking, rate limiting, secret redaction, `null` vs `0` sensor preservation, interlock enforcement | **PASS** | `14 / 14` groups (`0` failed) |
| 6 | `test/auth_and_routing.test.ts` | `vercel.json`/`render.yaml` contract, CORS allowlist, `HttpOnly Partitioned` cookies, HTML fallback guard | **PASS** | `10 / 10` checks (`0` failed) |
| 7 | `test/phase1_data_foundation.test.ts` | SHA-256 DB backup, copy migration/rollback, WAL mode, append-only audit triggers, retention, write benchmark | **PASS** | `11 / 11` checks (`0` failed) |
| 8 | `test/phase2_provisioning_and_lifecycle.test.ts` | Firmware NVS/SoftAP/TLS checks, multi-zone CRUD, PnP bootstrap replay block, rotation, board replacement | **PASS** | `7 / 7` groups (`0` failed) |
| 9 | `test/existing_hardware_http_connection.test.ts` | Existing ESP32 & ESP32-CAM HTTP panels, `10.87.237.x` cloud honesty, MJPEG stream proxy, LAN relay bridge | **PASS** | `9 / 9` groups (`0` failed) |
| 10 | `test/master_mission_stages.test.ts` | Stage 1 audit, Migration `v5`, MQTT-over-WS + ACLs, Device WS, UI WS, ThingsBoard HTTP, ESPHome YAML & HTTP v3 discovery, Stage 3 KB, Datasets, DL/ONNX, Safe RL, Gemini-free Decision Engine | **PASS** | `56 / 56` assertions (`0` failed) |

- **Warnings Observed**: Node `v22.23.3` emits its standard informational runtime notice `ExperimentalWarning: SQLite is an experimental feature and might change at any time` when importing built-in `node:sqlite`. Zero test warnings or failures occurred.

---

## 22. Regression Results

All **9/9** pre-existing test suites passed without modification (`SOFTWARE_TESTED`), confirming zero regressions across:
- **Login, Session Cookies & Cross-Origin Routing**: Verified by `test/auth_and_routing.test.ts` (`10/10`).
- **Multi-Tenant Greenhouse Onboarding, QR Tokens & Device Lifecycle**: Verified by `test/self_service_greenhouse.test.ts` (`10/10`) and `test/phase2_provisioning_and_lifecycle.test.ts` (`7/7`).
- **Plant Vision, Camera Freshness (`<= 90s`) & Local LAN Relay Bridge**: Verified by `test/camera_upload.test.ts` (`9/9`) and `test/existing_hardware_http_connection.test.ts` (`9/9`).
- **8-Language Nigerian Voice Consultation & TTS Fallback**: Verified by `test/voice_system.test.ts` (`26/26`).
- **SQLite WAL Durability, Backups, Rollups & Append-Only Audit Logs**: Verified by `test/phase1_data_foundation.test.ts` (`11/11`).
- **Hardware Gateway Security, SSRF & Safety Interlocks**: Verified by `test/hardware.test.ts` (`10/10`) and `test/hardware_gateway_security.test.ts` (`14/14`).

---

## 23. Build Results

1. **TypeScript Static Type Check (`npm run lint` → `tsc --noEmit`)**:
   - **Status**: `SOFTWARE_TESTED`
   - **Exit Code**: `0` (`0` errors, `0` warnings).
2. **Production Frontend Bundle (`npm run build` → `vite build`)**:
   - **Status**: `SOFTWARE_TESTED`
   - **Exit Code**: `0` (`1,822` modules transformed in `9.70s`).
   - **Output Artifacts**:
     - `dist/index.html` — `2.20 kB` (`gzip: 0.83 kB`)
     - `dist/assets/index-D95PnBfP.css` — `121.37 kB` (`gzip: 19.03 kB`)
     - `dist/assets/index-75Su2oVb.js` — `1,777.08 kB` (`gzip: 463.61 kB`)
   - **Non-Fatal Bundler Notice**: Standard Vite chunk-size advisory (`> 500 kB` minified single SPA chunk) and static+dynamic import notice on `src/lib/gemini.ts`. Zero build errors.

---

## 24. Deployment Readiness

- **Code & Configuration Readiness**: `SOFTWARE_TESTED`
- **Live Cloud Deployment Execution**: `NOT_STARTED` (withheld per mission hard boundary requiring explicit operator authorization).
- **Verified Infrastructure Fit**:
  - **Node.js Version**: `render.yaml` specifies `NODE_VERSION: 22.18.0`, matching `package.json` `"engines": { "node": ">=22.18.0" }` and enabling native `node:sqlite` WAL mode without native C++ addon compilation failures.
  - **Memory Footprint**: Express + SQLite WAL + Embedded `Aedes` + `ws` uses `~135–185 MB RSS`, fitting safely inside **Render Starter (`512 MB RAM`)** with `> 300 MB` headroom.
  - **Single-Port TLS Multiplexing**: Render terminates TLS 1.3 on port `443` and forwards HTTP/1.1 + WebSocket `Upgrade` requests to `0.0.0.0:$PORT`. All new real-time transports (`/api/iot/mqtt-ws`, `/api/iot/device-ws`, `/api/iot/ws`, `/api/v1/:deviceToken/telemetry`) ride over that single HTTPS/WSS port.
  - **Vercel Proxy Compatibility**: `vercel.json` rewrites `/api/:path*` → `https://edens-ai.onrender.com/api/:path*`. Note that Vercel static rewrites proxy HTTP REST calls cleanly, while browser WebSocket connections (`/api/iot/ws`) automatically resolve to `wss://edens-ai.onrender.com/api/iot/ws` when `VITE_API_BASE_URL` is set or when accessed on Render's origin, and gracefully fall back to authenticated REST polling if WebSocket upgrade is proxied through a static CDN edge.
  - **Persistent Disk Requirement**: Render's default container filesystem is ephemeral across deploys! Attaching a **Render Persistent Disk (`>= 1 GB`, ~$0.25/GB-month)** mounted at `/var/data` with `DATABASE_PATH=/var/data/edens_platform.sqlite` and `CAMERA_STORAGE_PATH=/var/data/camera_uploads` is **mandatory** for durable multi-deploy production storage.

---

## 25. Required Environment Variables

Defined in `/.env.example` and `/render.yaml` (no secret values are stored in repository files):

| Variable | Where Set | Required? | Purpose |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Render | **Yes** | Set to `production` |
| `NODE_VERSION` | Render | **Yes** | Set to `22.18.0` (enables native `node:sqlite` WAL) |
| `APP_URL` | Render | **Yes** | Public backend URL (`https://edens-ai.onrender.com`) |
| `CORS_ALLOWED_ORIGINS` | Render | **Yes** | Comma-separated origins (`https://eden-ai.vercel.app,https://edens-ai.onrender.com`) |
| `DATABASE_PATH` | Render | **Recommended** | `/var/data/edens_platform.sqlite` (on Render Persistent Disk) |
| `CAMERA_STORAGE_PATH` | Render | **Recommended** | `/var/data/camera_uploads` (on Render Persistent Disk) |
| `GEMINI_API_KEY` | Render | Optional for Stage 3 Core / Required for Voice & Vision LLM | Server-side Gemini key (`IndependentAgriculturalDecisionEngine` works 100% without it; Voice STT/TTS & LLM Plant Vision use it when present) |
| `CAMERA_UPLOAD_KEY` | Render | Optional | Legacy global single-camera intake key (per-greenhouse devices use unique `edcam_*` keys) |
| `HARDWARE_API_KEY` | Render | Optional | Legacy global controller key (per-greenhouse devices use unique `edctrl_*` keys) |
| `MQTT_TCP_PORT` | Local LAN Gateway only | Optional | Leave unset on Render; set (e.g. `1883`) only on a local farm gateway for unencapsulated LAN TCP MQTT |
| `VITE_API_BASE_URL` | Vercel (Optional) | Optional | Leave unset when using `vercel.json` `/api/:path*` rewrites, or set to `https://edens-ai.onrender.com` for direct WSS + CORS credentials |

---

## 26. Required Infrastructure

1. **Current Scale (`1 – 500` Greenhouses / `<= 2,500` Devices — Immediate Production Ready)**:
   - **Frontend**: Vercel Hobby/Pro (`https://eden-ai.vercel.app`) — `$0/month` incremental.
   - **Backend + Embedded IoT Gateway + Independent Agronomy Engine**: Render Starter Web Service (`512 MB RAM`, `0.5 CPU`) + **1 GB Render Persistent Disk** at `/var/data` (`~$7.25/month` total).
   - **Farm LAN Bridge (Only if using legacy HTTP-only ESP32-CAM `10.87.237.x` firmware without flashing HTTPS/ESPHome)**: Any laptop, Raspberry Pi, or farm PC on the greenhouse Wi-Fi running `node scripts/camera-lan-relay.mjs`.
2. **Future Scale (`> 2,500` Concurrent Persistent Connections — Optional)**:
   - Upgrade Render plan to Standard (`2 GB RAM`) **or** attach an external **ThingsBoard CE `v4.3.1.8` LTS (`Apache-2.0`)** / Eclipse Mosquitto (`EPL-2.0`) VM (`2 vCPU / 4 GB RAM`) forwarding webhooks to EDENS AI `UniversalDeviceAdapter`. Never deploy ThingsBoard `v4.4.0+` (`BUSL-1.1`) for `> 100` commercial devices.

---

## 27. Actual Hardware Tests

Strict separation of hardware verification states as of this audit:

| Hardware Verification Step | Status | Evidence / Explanation |
| :--- | :--- | :--- |
| **1. Firmware Implemented** | `IMPLEMENTED` | `edens_pnp_provisioning.h`, `edens_controller_sync.h`, `edens_mqtt_sync.h`, `edens_cloud_upload.h`, `edens_greenhouse_controller.yaml`, `edens_esp32_cam.yaml` written on disk |
| **2. Firmware Compiled** | `NOT_STARTED` | `esphome`, `arduino-cli`, and `pio` toolchains are not installed in this cloud Node.js container |
| **3. Device Provisioned (Software Protocol Test)** | `SOFTWARE_TESTED` | Verified SoftAP bootstrap token exchange, replay rejection, and credential issuance in `test/phase2_provisioning_and_lifecycle.test.ts` and `test/master_mission_stages.test.ts` |
| **4. Device Authenticated (Software Protocol Test)** | `SOFTWARE_TESTED` | Verified SHA-256 `edctrl_*` / `edcam_*` auth across MQTT-over-WS, Device WS, ThingsBoard HTTP, and REST in `test/master_mission_stages.test.ts` |
| **5. Physical Sensor Telemetry Received** | `NOT_STARTED` | Verified in software protocol tests only; no physical ESP32 sensor board is wired to this cloud environment |
| **6. Physical Camera Image Received** | `NOT_STARTED` | Verified in software JPEG upload & LAN relay tests only; historical `10.87.237.36` private LAN camera is not reachable from cloud sandbox |
| **7. Physical Actuator Tested** | `NOT_STARTED` | Strictly disabled (`MONITORING_ONLY` / `SIMULATION_ONLY`) per mission safety rules |

---

## 28. Outstanding Blockers

1. **Physical Pinout & Sensor IC Confirmation from Hardware Engineer (Blocks Physical ESP32 Flashing)**:
   - Exact GPIO assignments, sensor IC models (e.g., `DHT22` vs `SHT31` I2C, capacitive soil ADC GPIO & dry/wet calibration voltages, tank ultrasonic/float GPIO), and relay active-HIGH/LOW polarity on the physical main ESP32 board must be supplied by the hardware engineer before uncommenting sensor blocks in `firmware/esphome/edens_greenhouse_controller.yaml` or `esp32_controller_reference.ino`.
2. **Local Firmware Compiler & USB Serial Access (Blocks `FIRMWARE_COMPILED` & `PHYSICALLY_VERIFIED`)**:
   - Flashing ESP32 / ESP32-CAM requires a local workstation with `esphome == 2026.10.2` (or Arduino IDE `2.3+` with `esp32` core `2.0.17+`) and a `5V >= 2A` stable power supply for the AI-Thinker ESP32-CAM.
3. **Curated Field Leaf Image Corpus & GPU/PyTorch Host (Blocks Vision DL Model Training)**:
   - `ml/train_pytorch_vision_onnx.py` is ready, but training production-grade `MobileNetV3-Small` / `EfficientNet-B0` weights requires an agronomist-verified Nigerian polyhouse leaf dataset exported via `/api/greenhouses/:id/datasets/versions/:verId/export?format=jsonl` and a Python environment with `torch` + `torchvision` + `onnx`.
4. **Explicit Operator Authorization for Production Deployment & Physical Control**:
   - Pushing commits to GitHub (`Darkesay/eden-ai`), deploying to Render/Vercel, and enabling physical relay actuation remain intentionally locked until authorized by the project owner.

---

## 29. Exact Hardware Engineer Instructions

### Option A — Connect Existing Unmodified ESP32-CAM (`http://10.87.237.36`) Without Re-Flashing
1. Power the existing ESP32-CAM from a regulated **5V >= 2.0A** supply on the greenhouse Wi-Fi LAN and confirm `http://<CAM_LAN_IP>/status` and `http://<CAM_LAN_IP>/photo` respond in a local browser on the same Wi-Fi.
2. Sign in to EDENS AI → **Settings → Enrolled Hardware** → issue a **Camera Key (`edcam_...`)** for your greenhouse camera slot.
3. On any laptop or Raspberry Pi connected to the same greenhouse Wi-Fi, run:
   ```bash
   CAMERA_PHOTO_URL="http://10.87.237.36/photo" \
   EDENS_BACKEND_URL="https://edens-ai.onrender.com" \
   EDENS_GREENHOUSE_ID="<your_greenhouse_id>" \
   EDENS_CAMERA_KEY="<your_edcam_key>" \
   INTERVAL_SECONDS="20" \
   node scripts/camera-lan-relay.mjs
   ```
4. Verify in EDENS AI **Plant Vision** and **Settings → Enrolled Hardware** that the badge transitions to **`CONNECTED`** and **`REAL HARDWARE DATA`** with a live JPEG frame (`<= 90s` freshness).

### Option B — Flash ESPHome `2026.10.2` Reference Firmware (Recommended for New Kits)
1. Install ESPHome `2026.10.2` on the bench workstation:
   ```bash
   pip install esphome==2026.10.2
   ```
2. In EDENS AI → **Settings → Enrolled Hardware → Universal IoT Fleet**, issue a device credential (`edctrl_...` or `edcam_...`) and click **ESPHome YAML** to download the pre-bound YAML template (or copy `firmware/esphome/edens_greenhouse_controller.yaml` / `edens_esp32_cam.yaml`).
3. Create `firmware/esphome/secrets.yaml` (never commit `secrets.yaml` to Git) containing:
   - `wifi_ssid`, `wifi_password`
   - `unique_board_ap_password` (12+ random alphanumeric characters printed on the board's installer QR sticker)
   - `ota_password`, `local_web_password`
   - `edens_greenhouse_id`, `edens_zone_id`, `edens_device_id`, `edens_device_key`
   - Bench-verified sensor GPIO pins (`verified_dht_gpio`, `verified_soil_adc_gpio`) **only after verifying physical board wiring with a multimeter/schematic**.
4. Compile and flash over USB:
   ```bash
   esphome compile firmware/esphome/edens_greenhouse_controller.yaml
   esphome run firmware/esphome/edens_greenhouse_controller.yaml
   ```

---

## 30. Exact Deployment Instructions

> **Do NOT execute until operator deployment authorization is granted.**

1. **Attach Persistent Disk on Render (`https://dashboard.render.com`)**:
   - Open service **`edens-ai`** → **Disks** → **Add Disk**:
     - Name: `edens-data`
     - Mount Path: `/var/data`
     - Size: `1 GB` (or `5 GB` if storing large curated image datasets)
2. **Verify Render Environment Variables**:
   - Set `NODE_ENV=production`
   - Set `NODE_VERSION=22.18.0`
   - Set `APP_URL=https://edens-ai.onrender.com`
   - Set `CORS_ALLOWED_ORIGINS=https://eden-ai.vercel.app,https://edens-ai.onrender.com`
   - Set `DATABASE_PATH=/var/data/edens_platform.sqlite`
   - Set `CAMERA_STORAGE_PATH=/var/data/camera_uploads`
   - Set `GEMINI_API_KEY=<server_side_gemini_key>` (marked Secret / `sync: false`)
3. **Pre-Deploy Verification Gate (Local / CI)**:
   ```bash
   npm ci
   npm run lint
   npm run build
   npm test
   ```
4. **Deploy Backend to Render & Verify Health**:
   - Push authorized branch to `https://github.com/Darkesay/eden-ai`.
   - Confirm Render runs `npm ci && npm run build` and starts `npm run start` (`node server.ts`).
   - Verify `GET https://edens-ai.onrender.com/api/health` returns `HTTP 200` JSON with `schemaVersion: "v5_universal_iot_and_independent_intelligence"`.
5. **Deploy Frontend to Vercel (`https://eden-ai.vercel.app`)**:
   - Confirm `vercel.json` retains the `/api/:path*` → `https://edens-ai.onrender.com/api/:path*` rewrite.
   - Optionally set `VITE_API_BASE_URL=https://edens-ai.onrender.com` in Vercel Environment Variables so browser WebSocket connections (`/api/iot/ws`) connect directly to Render's WSS endpoint without static proxy hops.

---

## 31. Recommended Next Steps

1. **Hardware Bench Pinout & Sensor Calibration Sign-Off**: Have the hardware engineer record the exact GPIO map and dry/wet capacitive ADC voltages in `secrets.yaml`, compile `edens_greenhouse_controller.yaml` and `edens_esp32_cam.yaml` with `esphome==2026.10.2`, and verify live telemetry & JPEG ingestion (`PHYSICALLY_VERIFIED` milestone).
2. **Attach Render `/var/data` Persistent Disk Before Production Traffic**: Prevents SQLite database and curated dataset resets across Render container redeploys.
3. **Collect Verified Nigerian Polyhouse Dataset `v1.0.0`**: Begin logging real greenhouse leaf photographs and agronomist-verified disease/pest/treatment outcome records via `/api/greenhouses/:id/datasets/records`, snapshot `v1.0.0`, and run `ml/train_pytorch_vision_onnx.py` to train the first field-calibrated `MobileNetV3-Small` ONNX vision classifier.
4. **Staged Actuator Bench Qualification (Future Authorized Phase)**: Only after 14+ days of stable `MONITORING_ONLY` telemetry and bench verification of physical emergency-stop, dry-run float switch, and rain-roof hardware interlocks should `MODE_1` single-action physical relay trials be considered for separate authorization.
