# ThingsBoard Community Edition vs. EDENS AI Native Gateway — Technical Evaluation

## Context

Phase 6 evaluates whether **ThingsBoard Community Edition (CE)** should be introduced alongside or in place of EDENS AI's built-in authenticated Express/SQLite cloud gateway (`POST /api/telemetry/upload` and `POST /api/camera/upload`) for connecting the Main ESP32 controller and ESP32-CAM over the internet.

---

## Side-by-Side Comparison

| Dimension | EDENS AI Native HTTPS Gateway (Current) | ThingsBoard Community Edition (CE) |
|---|---|---|
| **Device Management & Multi-Tenancy** | Built directly into SQLite (`greenhouses`, `devices`, `greenhouse_memberships`, `device_enrollment_tokens`, `audit_events`) with QR kit onboarding, per-device revocable SHA-256 hashed secrets (`edcam_*` & `edctrl_*`), and 7 explicit device connection states. | Rich generic IoT entity graph (Tenants -> Customers -> Devices -> Assets), dashboards, and rule chains, but duplicates EDENS AI's existing user/greenhouse RBAC model and requires dual user/device synchronization. |
| **Hosting & Operational Complexity** | Runs inside the **single existing Node.js (`>=22.18.0`) Render Web Service** (`node server.ts`) + one Render Persistent Disk (`/var/data`). Typical memory footprint: **~110–180 MB RAM**. Zero external brokers or JVMs to monitor. | Requires a **Java 17 Spring Boot JVM (`>= 2 GB – 4 GB RAM` minimum)** plus a separate **PostgreSQL** instance (and optional Kafka/Redis queues for scale). Cannot run inside a standard lightweight Render instance alongside EDENS AI without OOM crashes. |
| **Security & Credential Management** | Independent header-only secrets (`X-Camera-Key` vs `X-Hardware-Key`), constant-time `crypto.timingSafeEqual` verification, SHA-256 hashed per-device keys, URL query secret rejection (`401 QUERY_AUTH_DISALLOWED`), rate limiting, and verified Root CA TLS (`setCACert`). | Supports Access Tokens, X.509 client certs, and MQTT Basic Auth, **but** requires synchronizing a second set of webhook/REST API credentials between ThingsBoard Rule Engine and EDENS AI on Render. |
| **Camera Binary JPEG Compatibility** | **Native binary `image/jpeg` intake** (`POST /api/camera/upload`, SOI `0xFF 0xD8 FF` & EOI `0xFF 0xD9` verified, up to `10 MB`, stored atomically on disk) directly consumable by Gemini `VisionAgent` (`POST /api/ai/diagnose`). | **Poor fit for camera frames**: ThingsBoard telemetry is designed for small JSON/Protobuf numeric key-value pairs (`POST /api/v1/$TOKEN/telemetry`). Pushing base64 SVGA/UXGA JPEGs bloats PostgreSQL `ts_kv` tables, hits payload limits, and still requires forwarding frames to EDENS AI for Gemini analysis. |
| **Firmware & Integration Effort** | **Zero extra dependencies**: Standard Arduino `WiFiClientSecure` + `HTTPClient` (`edens_controller_sync.h` & `edens_cloud_upload.h`). Data lands directly in the same store queried by `VisionAgent`, `ClimateAgent`, `IrrigationAgent`, and `AlertAgent`. | Requires either MQTT TLS (`PubSubClient` + keepalive tuning) or ThingsBoard REST client on Main ESP32, **plus** ThingsBoard Rule Chain webhooks to forward telemetry into EDENS AI, while ESP32-CAM would *still* upload JPEGs directly to EDENS AI anyway. |
| **Monthly Infrastructure Cost** | **$0 incremental platform cost** beyond the existing EDENS AI Render Web Service + Persistent Disk. | **$25–$85+/month extra** for a dedicated `>= 4 GB RAM` VM/container + managed PostgreSQL instance, or ThingsBoard Cloud subscription fees. |

---

## Architectural Recommendation

**Keep EDENS AI's built-in authenticated HTTPS gateway as the single authoritative cloud ingestion layer. Do NOT deploy ThingsBoard Community Edition at this stage.**

### Rationale
1. **Eliminates Split-Brain Architecture**: Because ThingsBoard CE is ill-suited for binary JPEG camera snapshots, introducing ThingsBoard would force the ESP32-CAM to talk to EDENS AI while the Main ESP32 talked to ThingsBoard, splitting device onboarding, credentials, and health monitoring across two servers.
2. **Simpler Operations on Render**: Running a single Node.js 22 service + SQLite on a Render Persistent Disk avoids maintaining and paying for a 4 GB JVM + PostgreSQL cluster.
3. **Zero Lost Capability**: EDENS AI already provides multi-tenant greenhouse RBAC, QR enrollment, independent camera/controller SHA-256 credentials, 7-state heartbeat monitoring (`<=45s` controller / `<=90s` camera), `0` vs `null` telemetry persistence, and direct binding to Gemini agronomic agents.

### When to Revisit ThingsBoard CE (or EMQX MQTT)
Revisit adding a dedicated broker/IoT platform **only if** fleet scale exceeds **~500+ concurrent greenhouses** pushing sub-second telemetry streams or requiring sub-100 ms bidirectional command push over persistent MQTT/TLS connections.
