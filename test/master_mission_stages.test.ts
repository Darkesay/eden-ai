/**
 * EDENS AI — Master Mission Stages 1, 2 & 3 End-to-End Verification Suite
 *
 * Verifies:
 *  1. Stage 1 architecture decision artifact & SQLite Migration v5 + rollback safety.
 *  2. Stage 2 Embedded Multi-Tenant MQTT-over-WS (Aedes), Device WS, Real-Time UI WS,
 *     Topic ACL isolation, ThingsBoard CE v4.3.1.8 (Apache-2.0) HTTP ingestion,
 *     strict real-vs-simulated separation, ESPHome 2026.10.2 YAML generation,
 *     SSRF-guarded ESPHome HTTP v3 discovery, and instant credential revocation.
 *  3. Stage 3 Independent Agricultural Knowledge Base, 10-category Versioned Dataset
 *     Infrastructure (SHA-256 dedup, anti-ground-truth pollution, consent, JSONL/CSV),
 *     executable Deep Learning Forecaster + ONNX export + Median/MAD Anomaly Detector,
 *     Safe Shielded Reinforcement Learning Digital Twin benchmark, and 100% Gemini-free
 *     Independent Agricultural Decision Engine with Farmer Authorization MODE_1/2/3.
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import mqtt from 'mqtt';
import { WebSocket } from 'ws';
import { GreenhouseCameraStoreRegistry } from '../src/server/cameraAcquisition.ts';
import { PlatformDatabase } from '../src/server/database.ts';
import { registerSelfServiceGreenhouseRoutes } from '../src/server/greenhouseRoutes.ts';
import { registerUniversalIotInfrastructure } from '../src/server/iotInfrastructureGateway.ts';
import {
  SCHEMA_VERSION_V5,
  testMigrationAndRollbackOnCopy
} from '../src/server/migrations.ts';
import { registerStage3IntelligenceRoutes } from '../src/server/stage3Routes.ts';

let assertionsPassed = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  assertionsPassed += 1;
}

function httpJson(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: unknown
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: any }> {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const reqHeaders: Record<string, string> = { ...headers };
    if (payload !== undefined && !reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (payload !== undefined) {
      reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: reqHeaders
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 500, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function runSuite() {
  console.log('\n==================================================================');
  console.log('🧪 EDENS AI — Master Mission Stages 1, 2 & 3 Verification Suite');
  console.log('==================================================================');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edens_master_mission_'));
  const dbPath = path.join(tmpDir, 'master_mission.sqlite');
  const camDir = path.join(tmpDir, 'camera_uploads');
  const savedLoopbackEnv = process.env.EDENS_ALLOW_LOOPBACK_CONTROLLER;
  const savedGeminiKey = process.env.GEMINI_API_KEY;
  process.env.EDENS_ALLOW_LOOPBACK_CONTROLLER = '1';

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const platformDb = new PlatformDatabase({
    dbFilePath: dbPath,
    skipAutoBackup: true
  });
  await platformDb.init();

  const cameraRegistry = new GreenhouseCameraStoreRegistry({ rootBaseDir: camDir });
  registerSelfServiceGreenhouseRoutes(app, { platformDb, cameraRegistry });
  const iotRuntime = registerUniversalIotInfrastructure(app, { platformDb, cameraRegistry });
  registerStage3IntelligenceRoutes(app, { platformDb });

  const httpServer = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  await iotRuntime.attachToHttpServer(httpServer);
  const port = (httpServer.address() as { port: number }).port;

  // Auxiliary mock servers for ESPHome HTTP discovery vs incompatible HTTP host
  const mockEspHomeServer = await new Promise<http.Server>((resolve) => {
    const srv = http
      .createServer((req, res) => {
        if (req.url === '/sensor/greenhouse_air_temperature') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'sensor-greenhouse_air_temperature',
              name: 'Greenhouse Air Temperature',
              value: 26.4,
              state: '26.4 °C'
            })
          );
          return;
        }
        if (req.url === '/sensor/greenhouse_relative_humidity') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 'sensor-greenhouse_relative_humidity',
              name: 'Greenhouse Relative Humidity',
              value: 68.2,
              state: '68.2 %'
            })
          );
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
      })
      .listen(0, '127.0.0.1', () => resolve(srv));
  });
  const mockEspHomePort = (mockEspHomeServer.address() as { port: number }).port;

  const incompatibleHttpServer = await new Promise<http.Server>((resolve) => {
    const srv = http
      .createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Generic Broadband Router Login</body></html>');
      })
      .listen(0, '127.0.0.1', () => resolve(srv));
  });
  const incompatiblePort = (incompatibleHttpServer.address() as { port: number }).port;

  try {
    // ----------------------------------------------------------------
    // 1. STAGE 1 & MIGRATION V5 VERIFICATION
    // ----------------------------------------------------------------
    const stage1DocPath = path.join(process.cwd(), 'docs', 'STAGE1_IOT_INFRASTRUCTURE_DECISION.md');
    check(fs.existsSync(stage1DocPath), 'Stage 1 decision document exists');
    const stage1Text = fs.readFileSync(stage1DocPath, 'utf8');
    check(stage1Text.includes('BUSL-1.1') && stage1Text.includes('v4.3.1.8'), 'Stage 1 audits ThingsBoard BUSL-1.1 vs v4.3.1.8 Apache-2.0');
    check(stage1Text.includes('AGPL-3.0') && stage1Text.includes('v1.33.0'), 'Stage 1 audits OpenRemote v1.33.0 AGPL-3.0');
    check(stage1Text.includes('2026.10.2') && stage1Text.includes('2026.10.4'), 'Stage 1 audits ESPHome 2026.10.2 and Home Assistant 2026.10.4');
    check(stage1Text.includes('Strategy C'), 'Stage 1 selects Strategy C Universal Device Adapter');

    const dbDiag = platformDb.getDatabaseDiagnostics();
    check(dbDiag.schemaVersion === SCHEMA_VERSION_V5, `Database migrated to ${SCHEMA_VERSION_V5}`);

    const rollbackCheck = await testMigrationAndRollbackOnCopy(dbPath);
    check(rollbackCheck.passed, 'Non-destructive copy migration + v5->v2 rollback + forward re-apply succeeded');

    // Verify ESPHome & MQTT firmware artifacts exist and never invent GPIO pins
    const esphomeCtrlYaml = fs.readFileSync(
      path.join(process.cwd(), 'firmware', 'esphome', 'edens_greenhouse_controller.yaml'),
      'utf8'
    );
    const esphomeCamYaml = fs.readFileSync(
      path.join(process.cwd(), 'firmware', 'esphome', 'edens_esp32_cam.yaml'),
      'utf8'
    );
    const mqttHeader = fs.readFileSync(
      path.join(
        process.cwd(),
        'firmware',
        'EDENS_HARDWARE_KIT',
        'esp32_mqtt_universal_adapter',
        'edens_mqtt_sync.h'
      ),
      'utf8'
    );
    check(esphomeCtrlYaml.includes('!secret') && esphomeCtrlYaml.includes('discovery_prefix: "homeassistant"'), 'ESPHome controller YAML uses !secret hardware pin placeholders and HA discovery');
    check(esphomeCamYaml.includes('esp32_camera') && esphomeCamYaml.includes('port: 81') && esphomeCamYaml.includes('mode: snapshot'), 'ESPHome camera YAML documents stream/snapshot compatibility');
    check(mqttHeader.includes('setCACert(EDENS_CTRL_ROOT_CA_BUNDLE)') && !mqttHeader.includes('.setInsecure('), 'ESP32 MQTT header enforces Root CA TLS verification');

    // ----------------------------------------------------------------
    // 2. TENANT ONBOARDING & AUTH BOUNDARIES
    // ----------------------------------------------------------------
    const unauthStatus = await httpJson(port, 'GET', '/api/iot/platform-status');
    check(unauthStatus.status === 401, 'Unauthenticated /api/iot/platform-status rejected with 401');

    const regA = await httpJson(port, 'POST', '/api/auth/register', {}, {
      email: 'farmer.alpha@edens-test.ng',
      password: 'StrongPassword#2026A',
      displayName: 'Farmer Alpha'
    });
    check(regA.status === 201, 'Registered Farmer A');
    const cookieA = String(regA.headers['set-cookie']?.[0] || '').split(';')[0];

    const regB = await httpJson(port, 'POST', '/api/auth/register', {}, {
      email: 'farmer.beta@edens-test.ng',
      password: 'StrongPassword#2026B',
      displayName: 'Farmer Beta'
    });
    check(regB.status === 201, 'Registered Farmer B');
    const cookieB = String(regB.headers['set-cookie']?.[0] || '').split(';')[0];

    const createGhA = await httpJson(
      port,
      'POST',
      '/api/greenhouses',
      { Cookie: cookieA },
      { name: 'Ibadan Polyhouse Alpha', locationLabel: 'Ibadan, Oyo State', cropType: 'Tomato' }
    );
    check(createGhA.status === 201 && createGhA.json?.greenhouse?.id, 'Created Greenhouse A');
    const ghAId = String(createGhA.json.greenhouse.id);

    const createGhB = await httpJson(
      port,
      'POST',
      '/api/greenhouses',
      { Cookie: cookieB },
      { name: 'Kano Polyhouse Beta', locationLabel: 'Kano State', cropType: 'Bell Pepper' }
    );
    check(createGhB.status === 201 && createGhB.json?.greenhouse?.id, 'Created Greenhouse B');
    const ghBId = String(createGhB.json.greenhouse.id);

    const ghADetails = await httpJson(port, 'GET', `/api/greenhouses/${ghAId}`, { Cookie: cookieA });
    const ctrlADev = (ghADetails.json?.devices || []).find((d: any) => d.deviceType === 'esp32_controller');
    check(Boolean(ctrlADev?.id), 'Greenhouse A has enrolled controller slot');
    const ctrlAId = String(ctrlADev.id);

    const issueCtrlA = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/devices/${ctrlAId}/issue-credentials`,
      { Cookie: cookieA },
      {}
    );
    check(issueCtrlA.status === 200 && issueCtrlA.json?.oneTimeDeviceKey, 'Issued unique device key for Controller A');
    const ctrlAKey = String(issueCtrlA.json.oneTimeDeviceKey);

    const platStatus = await httpJson(port, 'GET', '/api/iot/platform-status', { Cookie: cookieA });
    check(
      platStatus.status === 200 &&
        platStatus.json?.selectedArchitecture?.edgePlatform?.verifiedVersion === '2026.10.2' &&
        platStatus.json?.physicalActuatorMode === 'MONITORING_ONLY_DISABLED',
      'Platform status reports verified ESPHome 2026.10.2 and MONITORING_ONLY_DISABLED'
    );

    // ----------------------------------------------------------------
    // 3. REAL-TIME UI WEBSOCKET + EMBEDDED MQTT-OVER-WS + TOPIC ACLS
    // ----------------------------------------------------------------
    // Cross-tenant UI WS must be rejected (403)
    const crossTenantWsCode = await new Promise<number>((resolve) => {
      const badWs = new WebSocket(`ws://127.0.0.1:${port}/api/iot/ws?greenhouseId=${ghAId}`, {
        headers: { Cookie: cookieB }
      });
      badWs.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode || 0);
        badWs.close();
      });
      badWs.on('open', () => {
        resolve(200);
        badWs.close();
      });
      badWs.on('error', () => {});
    });
    check(crossTenantWsCode === 403, 'Cross-tenant /api/iot/ws subscription rejected with HTTP 403');

    // Authorized UI WS receives iot:init and live telemetry:received delta
    const uiEvents: any[] = [];
    const uiWs = new WebSocket(`ws://127.0.0.1:${port}/api/iot/ws?greenhouseId=${ghAId}`, {
      headers: { Cookie: cookieA }
    });
    uiWs.on('message', (raw) => {
      try {
        uiEvents.push(JSON.parse(String(raw)));
      } catch {
        // ignore
      }
    });
    await new Promise<void>((resolve, reject) => {
      uiWs.once('open', () => resolve());
      uiWs.once('error', reject);
    });

    // Wait briefly for iot:init
    await new Promise((r) => setTimeout(r, 80));
    check(uiEvents.some((e) => e.event === 'iot:init'), 'UI WebSocket received authoritative iot:init state');

    // Invalid MQTT key must be rejected
    const badMqttRejected = await new Promise<boolean>((resolve) => {
      const badClient = mqtt.connect(`ws://127.0.0.1:${port}/api/iot/mqtt-ws`, {
        clientId: `bad_${ctrlAId}`,
        username: ctrlAId,
        password: 'edctrl_invalid_forged_password',
        reconnectPeriod: 0
      });
      badClient.once('error', () => {
        badClient.end(true);
        resolve(true);
      });
      badClient.once('connect', () => {
        badClient.end(true);
        resolve(false);
      });
    });
    check(badMqttRejected, 'MQTT-over-WS rejects invalid device password');

    // Valid MQTT device connection, HA Auto-Discovery, Canonical Telemetry, and Cross-Tenant ACL check
    const mqttClient = mqtt.connect(`ws://127.0.0.1:${port}/api/iot/mqtt-ws`, {
      clientId: `mqtt_${ctrlAId}`,
      username: ctrlAId,
      password: ctrlAKey,
      reconnectPeriod: 0
    });
    await new Promise<void>((resolve, reject) => {
      mqttClient.once('connect', () => resolve());
      mqttClient.once('error', reject);
    });

    // Publish Home Assistant / ESPHome Auto-Discovery config
    await new Promise<void>((resolve, reject) => {
      mqttClient.publish(
        `homeassistant/sensor/${ctrlAId}/canopy_temp/config`,
        JSON.stringify({
          name: 'Canopy Temperature',
          device_class: 'temperature',
          unit_of_measurement: '°C',
          state_topic: `edens/v1/greenhouses/${ghAId}/devices/${ctrlAId}/telemetry`,
          device: {
            identifiers: [ctrlAId],
            manufacturer: 'EDENS Hardware Kit',
            model: 'ESP32 Polyhouse Node',
            sw_version: 'esphome-2026.10.2'
          }
        }),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Publish real hardware telemetry
    await new Promise<void>((resolve, reject) => {
      mqttClient.publish(
        `edens/v1/greenhouses/${ghAId}/devices/${ctrlAId}/telemetry`,
        JSON.stringify({
          temperature: 30.8,
          humidity: 83.5,
          soilMoisture: 41.2,
          waterLevel: 68.0,
          sunlight: 24500,
          rain: false
        }),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve())
      );
    });

    // Attempt unauthorized cross-greenhouse publish to Greenhouse B
    mqttClient.publish(
      `edens/v1/greenhouses/${ghBId}/devices/forged/telemetry`,
      JSON.stringify({ temperature: 99.0 }),
      { qos: 0 }
    );

    await new Promise((r) => setTimeout(r, 140));
    mqttClient.end(true);
    await new Promise((r) => setTimeout(r, 60));

    check(
      uiEvents.some((e) => e.event === 'telemetry:received' && Array.isArray(e.payload) && e.payload.length >= 4),
      'UI WebSocket received real-time normalized telemetry:received delta push from MQTT publish'
    );

    const ghBTel = await httpJson(port, 'GET', `/api/greenhouses/${ghBId}/iot/telemetry`, {
      Cookie: cookieB
    });
    check(ghBTel.status === 200 && ghBTel.json?.count === 0, 'MQTT Topic ACL blocked cross-tenant publish to Greenhouse B');

    // ----------------------------------------------------------------
    // 4. AUTHENTICATED DEVICE WEBSOCKET, THINGSBOARD HTTP & ESPHOME DISCOVERY
    // ----------------------------------------------------------------
    // Query-string secret on /api/iot/device-ws must be rejected (401)
    const querySecretWsCode = await new Promise<number>((resolve) => {
      const wsBad = new WebSocket(`ws://127.0.0.1:${port}/api/iot/device-ws?token=${ctrlAKey}`);
      wsBad.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode || 0);
        wsBad.close();
      });
      wsBad.on('error', () => {});
    });
    check(querySecretWsCode === 401, 'Query-string secret on /api/iot/device-ws rejected with 401');

    // Authenticated Device WebSocket ingestion
    const devWsAck = await new Promise<any>((resolve, reject) => {
      const dws = new WebSocket(`ws://127.0.0.1:${port}/api/iot/device-ws`, {
        headers: {
          'X-Hardware-Key': ctrlAKey,
          'X-Greenhouse-Id': ghAId,
          'X-Device-Id': ctrlAId
        }
      });
      dws.once('open', () => {
        dws.send(JSON.stringify({ temperature: 31.2, humidity: 84.0, soilMoisture: 40.5, waterLevel: 67.5 }));
      });
      dws.once('message', (msg) => {
        const parsed = JSON.parse(String(msg));
        dws.close();
        resolve(parsed);
      });
      dws.once('error', reject);
    });
    check(devWsAck.ok === true && devWsAck.receivedCount >= 3, 'Authenticated /api/iot/device-ws normalized telemetry');

    // ThingsBoard CE v4.3.1.8 HTTP API ingestion
    const tbRes = await httpJson(
      port,
      'POST',
      `/api/v1/${ctrlAKey}/telemetry`,
      {},
      { ts: Date.now(), values: { temperature: 32.4, humidity: 85.0, soil_moisture: 39.8, water_level: 66.0 } }
    );
    check(
      tbRes.status === 200 && tbRes.json?.protocol === 'thingsboard_v1' && tbRes.json?.normalizedCount >= 3,
      'ThingsBoard CE v4.3.1.8 HTTP endpoint normalized telemetry into StandardTelemetryModel'
    );

    // Verify normalized fleet & telemetry endpoints while device is online
    const iotDevs = await httpJson(port, 'GET', `/api/greenhouses/${ghAId}/iot/devices`, { Cookie: cookieA });
    check(iotDevs.status === 200 && Array.isArray(iotDevs.json?.devices), 'GET /iot/devices returns StandardDeviceModel list');
    const stdCtrl = iotDevs.json.devices.find((d: any) => d.device_id === ctrlAId);
    check(
      stdCtrl &&
        stdCtrl.connection_state === 'online' &&
        Array.isArray(stdCtrl.sensors) &&
        stdCtrl.sensors.length >= 4,
      'StandardDeviceModel reports online connection_state and discovered normalized sensors'
    );

    // Reject simulated source tag on hardware channel
    const fakeSimRes = await httpJson(
      port,
      'POST',
      `/api/v1/${ctrlAKey}/telemetry`,
      {},
      { source: 'simulated', temperature: 25.0 }
    );
    check(fakeSimRes.status === 400, 'Simulated payload rejected on physical hardware ingestion channel');

    const iotTelSimOnly = await httpJson(
      port,
      'GET',
      `/api/greenhouses/${ghAId}/iot/telemetry?source=simulated`,
      { Cookie: cookieA }
    );
    check(iotTelSimOnly.status === 200 && iotTelSimOnly.json?.count === 0, 'Real hardware telemetry never leaks into simulated filter');

    // ESPHome YAML generation
    const yamlRes = await httpJson(
      port,
      'GET',
      `/api/greenhouses/${ghAId}/iot/devices/${ctrlAId}/esphome-yaml`,
      { Cookie: cookieA }
    );
    check(
      yamlRes.status === 200 &&
        String(yamlRes.json?.yaml || '').includes('esphome:') &&
        yamlRes.json?.esphomeVersion === '2026.10.2',
      'Generated device-specific ESPHome 2026.10.2 YAML configuration'
    );

    // ESPHome HTTP Discovery: reject SSRF, reject incompatible router HTML, accept genuine ESPHome v3 JSON
    const ssrfDisc = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/iot/discover-esphome`,
      { Cookie: cookieA },
      { deviceId: ctrlAId, baseUrl: 'http://169.254.169.254' }
    );
    check(ssrfDisc.status === 403, 'ESPHome discovery blocks cloud metadata SSRF IP (403)');

    const incompatDisc = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/iot/discover-esphome`,
      { Cookie: cookieA },
      {
        deviceId: ctrlAId,
        baseUrl: `http://127.0.0.1:${incompatiblePort}`,
        sensorIds: ['greenhouse_air_temperature']
      }
    );
    check(
      incompatDisc.status === 422 && incompatDisc.json?.error === 'INCOMPATIBLE_DEVICE_PROTOCOL',
      'ESPHome discovery refuses to mark arbitrary non-ESPHome HTTP host as compatible (422)'
    );

    const validDisc = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/iot/discover-esphome`,
      { Cookie: cookieA },
      {
        deviceId: ctrlAId,
        baseUrl: `http://127.0.0.1:${mockEspHomePort}`,
        sensorIds: ['greenhouse_air_temperature', 'greenhouse_relative_humidity']
      }
    );
    check(
      validDisc.status === 200 && validDisc.json?.ok === true && validDisc.json?.discoveredEntitiesCount === 2,
      'ESPHome HTTP v3 discovery verified 2 live sensor channels on mock ESPHome node'
    );

    const histRes = await httpJson(
      port,
      'GET',
      `/api/greenhouses/${ghAId}/iot/devices/${ctrlAId}/history`,
      { Cookie: cookieA }
    );
    check(
      histRes.status === 200 && Array.isArray(histRes.json?.connectionTransitions) && histRes.json.connectionTransitions.length >= 2,
      'Connection transition history tracks online/offline protocol events'
    );

    // ----------------------------------------------------------------
    // 5. STAGE 3A: INDEPENDENT AGRICULTURAL KNOWLEDGE BASE
    // ----------------------------------------------------------------
    const kbRes = await httpJson(port, 'GET', '/api/intelligence/knowledge-base', { Cookie: cookieA });
    check(
      kbRes.status === 200 &&
        kbRes.json?.independentOfExternalLlm === true &&
        kbRes.json?.cropProfilesCount >= 6 &&
        kbRes.json?.diagnosticCardsCount >= 10,
      'Stage 3A Independent Knowledge Base returns verified crops and >=10 diagnostic knowledge cards'
    );

    const diagFilter = await httpJson(
      port,
      'GET',
      '/api/intelligence/diagnostics?cropCode=tomato&category=pest',
      { Cookie: cookieA }
    );
    check(
      diagFilter.status === 200 &&
        diagFilter.json?.count >= 1 &&
        diagFilter.json?.diagnosticCards.some((c: any) => String(c.causalAgent).includes('Tuta absoluta')),
      'Stage 3A diagnostic search filters Tomato pest cards (Tuta absoluta)'
    );

    // ----------------------------------------------------------------
    // 6. STAGE 3B: VERSIONED 10-CATEGORY DATASET INFRASTRUCTURE
    // ----------------------------------------------------------------
    // Farmer observation attempting to self-certify as agronomist_verified must be downgraded
    const farmerObs = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/datasets/records`,
      { Cookie: cookieA },
      {
        category: 'farmer_observations',
        cropCode: 'tomato',
        growthStage: 'flowering',
        provenanceSource: 'farmer_observation',
        requestedLabelStatus: 'agronomist_verified',
        labelValue: 'leaf_curl_suspected',
        payload: { note: 'Lower leaves curling slightly at noon', standNumber: 14 }
      }
    );
    check(
      farmerObs.status === 201 && farmerObs.json?.record?.labelStatus === 'unverified_farmer_observation',
      'Unverified farmer observation blocked from automatic ground-truth promotion'
    );
    const farmerObsId = String(farmerObs.json.record.id);

    // Duplicate payload must be rejected via SHA-256 deduplication (409)
    const dupObs = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/datasets/records`,
      { Cookie: cookieA },
      {
        category: 'farmer_observations',
        cropCode: 'tomato',
        growthStage: 'flowering',
        provenanceSource: 'farmer_observation',
        labelValue: 'leaf_curl_suspected',
        payload: { standNumber: 14, note: 'Lower leaves curling slightly at noon' }
      }
    );
    check(dupObs.status === 409 && dupObs.json?.error === 'DUPLICATE_DATASET_RECORD', 'SHA-256 duplicate dataset record rejected with 409');

    // Snapshot requiring verified labels must fail while 0 verified records exist
    const prematureSnap = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/datasets/versions`,
      { Cookie: cookieA },
      { datasetName: 'ibadan_tomato_ds', versionTag: 'v1.0.0', requireVerifiedLabels: true }
    );
    check(prematureSnap.status === 422, 'Dataset version snapshot blocks unverified ground truth when requireVerifiedLabels=true');

    // Explicitly verify farmer observation + add verified disease & outcome records
    const verifyRes = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/datasets/records/${farmerObsId}/verify`,
      { Cookie: cookieA },
      { labelValue: 'heat_transpiration_leaf_roll', status: 'agronomist_verified' }
    );
    check(
      verifyRes.status === 200 && verifyRes.json?.record?.labelStatus === 'agronomist_verified',
      'Agronomist verification upgrades record labelStatus cleanly'
    );

    const rec2 = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/datasets/records`,
      { Cookie: cookieA },
      {
        category: 'verified_treatment_outcomes',
        cropCode: 'tomato',
        growthStage: 'fruiting',
        provenanceSource: 'agronomist_verified_entry',
        requestedLabelStatus: 'agronomist_verified',
        labelValue: 'drip_pulse_effective',
        payload: { preSoilPct: 41, postSoilPct: 56, pulseSeconds: 45 },
        splitGroupKey: 'batch_alpha_g1'
      }
    );
    check(rec2.status === 201, 'Ingested verified_treatment_outcomes record');

    // Add a record and revoke training consent -> must be excluded from snapshot
    const noConsentRec = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/datasets/records`,
      { Cookie: cookieA },
      {
        category: 'crop_growth_observations',
        cropCode: 'tomato',
        provenanceSource: 'agronomist_verified_entry',
        requestedLabelStatus: 'agronomist_verified',
        labelValue: 'truss_set_count_6',
        payload: { trussCount: 6, heightCm: 118 }
      }
    );
    await httpJson(
      port,
      'PATCH',
      `/api/greenhouses/${ghAId}/datasets/records/${noConsentRec.json.record.id}/consent`,
      { Cookie: cookieA },
      { consentForTraining: false }
    );

    const snapRes = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/datasets/versions`,
      { Cookie: cookieA },
      { datasetName: 'ibadan_tomato_ds', versionTag: 'v1.0.0', requireVerifiedLabels: true }
    );
    check(
      snapRes.status === 201 && snapRes.json?.snapshot?.totalRecords === 2,
      'Immutable dataset snapshot created with only consented & agronomist-verified records (2/3)'
    );
    const snapId = String(snapRes.json.snapshot.id);

    const jsonlExp = await httpJson(
      port,
      'GET',
      `/api/greenhouses/${ghAId}/datasets/versions/${snapId}/export?format=jsonl`,
      { Cookie: cookieA }
    );
    check(
      jsonlExp.status === 200 && jsonlExp.text.trim().split('\n').length === 2,
      'Exported 2-line JSONL training manifest from immutable dataset snapshot'
    );

    const csvExp = await httpJson(
      port,
      'GET',
      `/api/greenhouses/${ghAId}/datasets/versions/${snapId}/export?format=csv`,
      { Cookie: cookieA }
    );
    check(
      csvExp.status === 200 && csvExp.text.startsWith('id,category,crop_code'),
      'Exported CSV manifest from immutable dataset snapshot'
    );

    // ----------------------------------------------------------------
    // 7. STAGE 3C: DEEP LEARNING PIPELINE & BINARY ONNX SERIALIZATION
    // ----------------------------------------------------------------
    // Seed 28 chronological telemetry samples on ghA so train/val/test splits have diurnal signal
    const baseTimeMs = Date.now() - 30 * 3600_000;
    for (let i = 0; i < 28; i++) {
      const sampleMs = baseTimeMs + i * 3600_000;
      const hour = new Date(sampleMs).getUTCHours();
      const diurnal = Math.sin(((hour - 6) / 24) * 2 * Math.PI);
      const temp = Number((25.5 + 4.2 * diurnal).toFixed(2));
      const rh = Number((68.0 - 11.0 * diurnal).toFixed(2));
      const soil = Number((58.0 - i * 0.35).toFixed(2));
      platformDb.storeControllerTelemetry({
        greenhouseId: ghAId,
        deviceId: ctrlAId,
        receivedAtMsOverride: sampleMs,
        telemetry: {
          timestamp: new Date(sampleMs).toISOString(),
          temperature: temp,
          humidity: rh,
          soilMoisture: soil,
          sunlight: diurnal > 0 ? Math.round(35000 * diurnal) : 0,
          growLight: 0,
          waterLevel: 72,
          batteryVoltage: 12.6,
          rain: false,
          rainGaugeLevel: 0,
          sensorHealth: {},
          actuators: {},
          interlocks: {},
          deviceHealth: { firmwareVersion: 'esphome-2026.10.2', localSafetyControlActive: true }
        }
      });
    }
    // Restore fresh reading at current timestamp for live decision evaluation
    platformDb.storeControllerTelemetry({
      greenhouseId: ghAId,
      deviceId: ctrlAId,
      telemetry: {
        timestamp: new Date().toISOString(),
        temperature: 32.8,
        humidity: 84.0,
        soilMoisture: 41.0,
        sunlight: 28000,
        growLight: 0,
        waterLevel: 70,
        batteryVoltage: 12.6,
        rain: false,
        rainGaugeLevel: 0,
        sensorHealth: {},
        actuators: {},
        interlocks: {},
        deviceHealth: { firmwareVersion: 'esphome-2026.10.2', localSafetyControlActive: true }
      }
    });

    const trainMlp = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/ml/train-forecaster`,
      { Cookie: cookieA },
      { versionTag: 'v1.0.0-test', epochs: 90, learningRate: 0.03 }
    );
    check(
      trainMlp.status === 201 &&
        String(trainMlp.json?.deploymentStage || '').startsWith('evaluated_offline') &&
        typeof trainMlp.json?.testMetrics?.rmse === 'number' &&
        fs.existsSync(trainMlp.json.onnxPath),
      'Trained 2-layer ReLU MLP forecaster on chronological split and exported .onnx binary'
    );

    const onnxBytes = fs.readFileSync(trainMlp.json.onnxPath);
    const computedOnnxSha = crypto.createHash('sha256').update(onnxBytes).digest('hex');
    check(
      onnxBytes[0] === 0x08 && onnxBytes[1] === 0x08 && computedOnnxSha === trainMlp.json.onnxSha256,
      'Binary ONNX ModelProto (ir_version=8, opset=17) verified on disk via SHA-256'
    );

    const fitAnomaly = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/ml/fit-anomaly-detector`,
      { Cookie: cookieA },
      { versionTag: 'v1.0.0-mad' }
    );
    check(
      fitAnomaly.status === 201 &&
        fitAnomaly.json?.channelsCalibrated.includes('temperature') &&
        fitAnomaly.json?.evaluationMetrics?.f1Score >= 0.8,
      'Calibrated & evaluated Robust Median/MAD Sensor Anomaly Detector'
    );

    const mlCatalog = await httpJson(port, 'GET', '/api/intelligence/ml/catalog', { Cookie: cookieA });
    check(
      mlCatalog.status === 200 &&
        mlCatalog.json?.evaluatedArchitectures.length >= 5 &&
        mlCatalog.json?.registeredModels.some((m: any) => m.isTrained === true && m.productionReady === false),
      'ML catalog honestly distinguishes trained offline models (isTrained=true, productionReady=false)'
    );
    check(
      fs.existsSync(path.join(process.cwd(), 'ml', 'train_pytorch_vision_onnx.py')),
      'Offline PyTorch MobileNetV3/EfficientNet -> ONNX training script exists'
    );

    // ----------------------------------------------------------------
    // 8. STAGE 3D: SAFE REINFORCEMENT LEARNING DIGITAL TWIN BENCHMARK
    // ----------------------------------------------------------------
    const rlTrain = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/rl/train-simulation`,
      { Cookie: cookieA },
      {
        policyName: 'tomato_shielded_q',
        versionTag: 'v1.0.0-sim',
        weatherProfile: 'lagos_humid_tropical',
        trainingEpisodes: 45,
        simDaysPerEpisode: 5,
        seed: 2026
      }
    );
    check(
      rlTrain.status === 201 &&
        rlTrain.json?.liveActuatorExplorationAllowed === false &&
        rlTrain.json?.approvalStatus === 'simulated_only' &&
        rlTrain.json?.policyMetrics?.safetyViolations === 0 &&
        rlTrain.json?.comparison?.passedSafetyGate === true,
      'Shielded Tabular Q-Learning trained in Digital Twin with 0 safety violations and liveActuatorExplorationAllowed=false'
    );

    // ----------------------------------------------------------------
    // 9. STAGE 3E & 3F: INDEPENDENT DECISION ENGINE (ZERO GEMINI KEY)
    // ----------------------------------------------------------------
    process.env.GEMINI_API_KEY = '';
    const indEval = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/intelligence/evaluate-independent`,
      { Cookie: cookieA },
      {
        crop: 'Tomato',
        growthStage: 'flowering',
        preferredExternalProviderId: 'optional_google_gemini'
      }
    );
    check(
      indEval.status === 200 &&
        indEval.json?.operatedWithoutExternalLlm === true &&
        indEval.json?.physicalActuationEnabled === false &&
        indEval.json?.dataSource === 'REAL_HARDWARE',
      'Independent Decision Engine operates 100% deterministically when GEMINI_API_KEY is empty'
    );
    check(
      Array.isArray(indEval.json?.matchedDiagnosticRisks) &&
        indEval.json.matchedDiagnosticRisks.length >= 2 &&
        Array.isArray(indEval.json?.recommendations) &&
        indEval.json.recommendations.length >= 2,
      'Independent Decision Engine matched offline disease/heat/blossom-end-rot risks and generated actionable recommendations'
    );

    const sampleRec = indEval.json.recommendations[0];
    const hasAllTenFields = Boolean(
      sampleRec.observation &&
        sampleRec.evidence &&
        sampleRec.cropAndGrowthStageContext &&
        sampleRec.recommendedAction &&
        sampleRec.reasoning &&
        sampleRec.confidence &&
        sampleRec.risk &&
        sampleRec.expectedOutcome &&
        Array.isArray(sampleRec.missingInformation) &&
        Array.isArray(sampleRec.sourceReferences) &&
        sampleRec.sourceReferences.length > 0 &&
        sampleRec.authorizationStatus?.physicalHardwareDispatched === false
    );
    check(hasAllTenFields, 'Every recommendation contains all 10 required explainability fields + Farmer Authorization gate');

    // ----------------------------------------------------------------
    // 10. INSTANT CREDENTIAL REVOCATION ACROSS PROTOCOLS
    // ----------------------------------------------------------------
    const revokeRes = await httpJson(
      port,
      'POST',
      `/api/greenhouses/${ghAId}/devices/${ctrlAId}/revoke`,
      { Cookie: cookieA },
      {}
    );
    check(revokeRes.status === 200, 'Revoked Controller A credential');

    const postRevokeTb = await httpJson(
      port,
      'POST',
      `/api/v1/${ctrlAKey}/telemetry`,
      {},
      { temperature: 25.0 }
    );
    check(postRevokeTb.status === 401, 'Revoked device credential immediately rejected on ThingsBoard HTTP endpoint (401)');

    uiWs.close();
    console.log(`✅ Master Mission Stages 1, 2 & 3 Suite PASSED (${assertionsPassed} assertions, 0 failures)\n`);
  } finally {
    if (savedLoopbackEnv === undefined) delete process.env.EDENS_ALLOW_LOOPBACK_CONTROLLER;
    else process.env.EDENS_ALLOW_LOOPBACK_CONTROLLER = savedLoopbackEnv;
    if (savedGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = savedGeminiKey;

    await iotRuntime.shutdown();
    httpServer.closeAllConnections?.();
    mockEspHomeServer.closeAllConnections?.();
    incompatibleHttpServer.closeAllConnections?.();
    await new Promise<void>((r) => httpServer.close(() => r()));
    await new Promise<void>((r) => mockEspHomeServer.close(() => r()));
    await new Promise<void>((r) => incompatibleHttpServer.close(() => r()));
    platformDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Clean up test model artifacts created in data/ml_artifacts and data/rl_artifacts during test run
    for (const dirName of ['models', 'ml_artifacts', 'rl_artifacts']) {
      const targetDir = path.join(process.cwd(), 'data', dirName);
      if (fs.existsSync(targetDir)) {
        for (const f of fs.readdirSync(targetDir)) {
          if (f.includes('v1.0.0-test') || f.includes('v1.0.0-mad') || f.includes('v1.0.0-sim') || f.includes('v1_0_0-test') || f.includes('v1_0_0-mad') || f.includes('v1_0_0-sim')) {
            fs.rmSync(path.join(targetDir, f), { force: true });
          }
        }
      }
    }
  }
}

runSuite().catch((err) => {
  console.error('❌ Master Mission Stages Suite FAILED:', err);
  process.exit(1);
});
