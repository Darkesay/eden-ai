/**
 * EDENS AI - Hardware Connection Settings, Local/Cloud HTTP & Provenance Verification Suite
 *
 * Exercises all Section 8 requirements:
 *  1. Valid controller configuration (Local HTTP + Cloud HTTPS push, never CONNECTED on save alone, SQLite persistence, dynamic sensor discovery, disconnect)
 *  2. Valid camera configuration (10.87.237.36 & loopback, never CONNECTED on save alone, HTTP status/photo/stream, JPEG SOI..EOI validation, capture, disconnect, Cloud upload mode)
 *  3. Invalid addresses & SSRF protection (malformed URLs, non-http schemes, URL credentials, query secrets, public internet IPs, AWS/GCP/Alibaba metadata IPs, CGNAT)
 *  4. Offline controller (`OFFLINE`, `CONTROLLER_HTTP_UNREACHABLE`)
 *  5. Offline camera (`OFFLINE`, `CAMERA_HTTP_UNREACHABLE`)
 *  6. Invalid JPEG (`INVALID_JPEG_BYTES`, zero bytes persisted)
 *  7. Stale images (`>90s` frame reported as `STALE_DATA` in status card & rejected with `409 STALE_CAMERA_FRAME` by Plant Vision)
 *  8. Missing telemetry (HTTP 200 `{}` or all-`null` sensor JSON -> `OFFLINE`, `MISSING_SENSOR_TELEMETRY`, unavailable sensors never marked connected)
 *  9. Authentication (`401 UNAUTHENTICATED` when unauthenticated user accesses scoped state or mutating endpoints)
 * 10. Unauthorized greenhouse access (`403 FORBIDDEN_GREENHOUSE` across tenants, `403 FORBIDDEN_ROLE` for viewers, `403 GUEST_HARDWARE_CONTROL_FORBIDDEN` for guests)
 * 11. Local network restrictions (`CONNECTION_BLOCKED` from cloud runtime to private LAN `10.87.237.36` + HTTP `503` on stream proxy + `camera-lan-relay.mjs --once` verified end-to-end)
 */

import assert from 'node:assert';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { CameraImageStore } from '../src/server/cameraStorage.ts';
import {
  GreenhouseCameraStoreRegistry,
  registerCameraRoutes
} from '../src/server/cameraAcquisition.ts';
import { type AuthenticatedUser, PlatformDatabase } from '../src/server/database.ts';
import {
  MONITORING_MODE_BANNER,
  registerExistingHardwareHttpRoutes
} from '../src/server/existingHardwareHttp.ts';
import { validateControllerTelemetryPayload } from '../src/server/telemetryContract.ts';
import {
  createVisionDiagnosisHandler,
  type VisionModelInput
} from '../src/server/visionDiagnosis.ts';

const execFileAsync = promisify(execFile);
const TEST_CAMERA_KEY = 'edens_test_cam_upload_key_2026';

function createValidTestJpeg(seedByte: number = 0x33): Buffer {
  const buf = Buffer.alloc(192, seedByte);
  // JPEG SOI marker (0xFF 0xD8)
  buf[0] = 0xff;
  buf[1] = 0xd8;
  // JFIF APP0 segment
  buf[2] = 0xff;
  buf[3] = 0xe0;
  buf[4] = 0x00;
  buf[5] = 0x10;
  buf.write('JFIF\0', 6, 'ascii');
  // JPEG EOI marker (0xFF 0xD9)
  buf[buf.length - 2] = 0xff;
  buf[buf.length - 1] = 0xd9;
  return buf;
}

function makeHttpRequest(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  body?: Buffer | string
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  rawBuffer: Buffer;
  text: string;
  json: any;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const rawBuffer = Buffer.concat(chunks);
          const text = rawBuffer.toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            rawBuffer,
            text,
            json
          });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

async function runSuite() {
  console.log('🧪 Starting EDENS AI Hardware Connection Settings & Provenance Test Suite...\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edens_existing_hw_http_'));
  const dbPath = path.join(tmpRoot, 'test_platform.sqlite');
  const camStorageDir = path.join(tmpRoot, 'camera_frames');
  const registryStorageDir = path.join(tmpRoot, 'gh_camera_frames');
  const hwConfigDir = path.join(tmpRoot, 'hw_configs');

  const platformDb = new PlatformDatabase({
    dbFilePath: dbPath,
    skipAutoBackup: true
  });
  await platformDb.init();

  // Register Farmer A (Owner), Farmer B (Cross-tenant outsider), and Viewer C
  const regA = platformDb.registerUser({
    email: 'farmera@edens.test',
    password: 'StrongPassword123!',
    displayName: 'Farmer A'
  });
  assert.strictEqual(regA.ok, true);
  const farmerA = (regA as any).user as AuthenticatedUser;

  const regB = platformDb.registerUser({
    email: 'farmerb@edens.test',
    password: 'StrongPassword123!',
    displayName: 'Farmer B'
  });
  assert.strictEqual(regB.ok, true);
  const farmerB = (regB as any).user as AuthenticatedUser;

  const regViewer = platformDb.registerUser({
    email: 'viewer@edens.test',
    password: 'StrongPassword123!',
    displayName: 'Viewer C'
  });
  assert.strictEqual(regViewer.ok, true);
  const viewerUser = (regViewer as any).user as AuthenticatedUser;

  const ghA = platformDb.createGreenhouse({
    ownerUserId: farmerA.id,
    name: 'Kano North Canopy Bay',
    locationLabel: 'Kano, Nigeria',
    cropType: 'Tomato'
  });

  // Add Viewer C with read-only 'viewer' role on ghA
  platformDb
    .getDriver()
    .run(
      `INSERT INTO greenhouse_members (id, greenhouse_id, user_id, role, added_by_user_id, created_at)
       VALUES (?, ?, ?, 'viewer', ?, ?)`,
      ['ghm_viewer_test', ghA.id, viewerUser.id, farmerA.id, new Date().toISOString()]
    );

  const globalCameraStore = new CameraImageStore({ storageBaseDir: camStorageDir });
  const cameraRegistry = new GreenhouseCameraStoreRegistry({ rootBaseDir: registryStorageDir });

  let simulateCloudHosted = false;
  let currentUser: AuthenticatedUser | null = farmerA;
  let lastVisionInput: VisionModelInput | null = null;

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  registerCameraRoutes(app, globalCameraStore, {
    getUploadSecret: () => TEST_CAMERA_KEY,
    isCloudHosted: () => simulateCloudHosted,
    allowLoopbackLanTargets: true
  });

  registerExistingHardwareHttpRoutes(app, {
    platformDb,
    globalCameraStore,
    cameraRegistry,
    requireAuthenticatedUser: () => currentUser,
    allowLoopbackTargets: true,
    isCloudHosted: () => simulateCloudHosted,
    storageBaseDir: hwConfigDir
  });

  app.post(
    '/api/ai/diagnose',
    createVisionDiagnosisHandler({
      imageStore: globalCameraStore,
      languages: {
        en: { name: 'English', native: 'Nigerian English', region: 'Nigeria' }
      },
      isAiConfigured: () => true,
      runVisionModel: async (input) => {
        lastVisionInput = input;
        return {
          modelUsed: 'gemini-3.8-flash-test-double',
          rawJsonText: JSON.stringify({
            species: 'Solanum lycopersicum (Tomato)',
            healthStatus: 'Early Blight Suspected',
            symptoms: 'Concentric dark brown lesions with yellow halos on lower foliage.',
            cause: 'Alternaria solani fungal spores favored by warm humid leaf surfaces.',
            possibleCauses: [
              'Alternaria solani fungal infection on lower leaves',
              'Prolonged leaf wetness and high canopy humidity'
            ],
            recommendation: '1. Prune affected lower leaves.\n2. Increase morning airflow.',
            recommendedActions: [
              'Prune affected lower leaves with sanitized shears',
              'Avoid overhead watering late in the afternoon'
            ],
            audioSummary: 'Tomato leaf shows concentric dark spots consistent with early blight.'
          })
        };
      }
    })
  );

  // Mock ESP32-CAM HTTP Server (simulates `/status`, `/photo`, `/stream`)
  let camPhotoMode: 'valid_jpeg' | 'corrupt_bytes' = 'valid_jpeg';
  let camStatusHits = 0;
  let camPhotoHits = 0;
  let camStreamHits = 0;

  const mockCameraServer = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl.startsWith('/status')) {
      camStatusHits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          camera: 'ESP32-CAM',
          firmwareVersion: '1.4.2-cam-http',
          rssi: -58,
          framesize: 'VGA'
        })
      );
      return;
    }
    if (reqUrl.startsWith('/photo')) {
      camPhotoHits += 1;
      if (camPhotoMode === 'corrupt_bytes') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(Buffer.from('NOT_A_VALID_JPEG_STREAM_AT_ALL', 'utf8'));
        return;
      }
      const jpeg = createValidTestJpeg(0x41 + (camPhotoHits % 20));
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(jpeg.length) });
      res.end(jpeg);
      return;
    }
    if (reqUrl.startsWith('/stream')) {
      camStreamHits += 1;
      const frame = createValidTestJpeg(0x55);
      res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache'
      });
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n--frame--\r\n');
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  // Mock ESP32 Controller HTTP Server
  let controllerMode:
    | 'telemetry_status'
    | 'missing_telemetry_empty_json'
    | 'softap_identity_only'
    | 'outbound_push_only' = 'telemetry_status';
  let controllerActuationHits = 0;

  const mockControllerServer = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (
      reqUrl.startsWith('/override') ||
      reqUrl.startsWith('/roof') ||
      reqUrl.startsWith('/control') ||
      req.method !== 'GET'
    ) {
      controllerActuationHits += 1;
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ACTUATION_MUST_NEVER_BE_CALLED' }));
      return;
    }

    if (reqUrl === '/status' || reqUrl === '/telemetry') {
      if (controllerMode === 'telemetry_status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            firmwareVersion: '3.0.0-pnp-sec',
            temperature: 26.8,
            humidity: 67,
            soilMoisture: 58,
            waterLevel: null, // Disconnected / unavailable sensor — must NEVER be marked connected!
            sunlight: 12400,
            rain: false,
            soilTempC: 23.4 // Extra dynamically discovered sensor!
          })
        );
        return;
      }
      if (controllerMode === 'missing_telemetry_empty_json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            uptimeSeconds: 182,
            temperature: null,
            humidity: null,
            soilMoisture: null
          })
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No /status endpoint in this sketch');
      return;
    }

    if (reqUrl === '/api/identity') {
      if (controllerMode === 'softap_identity_only') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            deviceType: 'controller',
            firmwareVersion: '3.0.0-pnp-sec',
            hardwareUid: 'ESP32-CTRL-9A2B'
          })
        );
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not in SoftAP setup mode');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const appServer = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  await new Promise<void>((resolve) => mockCameraServer.listen(0, '127.0.0.1', () => resolve()));
  await new Promise<void>((resolve) => mockControllerServer.listen(0, '127.0.0.1', () => resolve()));

  const appPort = (appServer.address() as any).port as number;
  const camPort = (mockCameraServer.address() as any).port as number;
  const ctrlPort = (mockControllerServer.address() as any).port as number;

  // Allocate and immediately close a server to get a guaranteed-unreachable local port
  const closedPort = await new Promise<number>((resolve) => {
    const tmpSrv = http.createServer();
    tmpSrv.listen(0, '127.0.0.1', () => {
      const p = (tmpSrv.address() as any).port as number;
      tmpSrv.close(() => resolve(p));
    });
  });

  try {
    // =========================================================================
    // 1. Monitoring Mode, Default Examples & Honest Initial State
    // =========================================================================
    console.log('1️⃣  Verifying Monitoring Mode banner, status dashboard cards, and default examples...');
    const initRes = await makeHttpRequest(
      appPort,
      'GET',
      `/api/hardware-http/state?greenhouseId=${encodeURIComponent(ghA.id)}`
    );
    assert.strictEqual(initRes.status, 200);
    assert.strictEqual(initRes.json.success, true);
    assert.strictEqual(initRes.json.monitoringMode.active, true);
    assert.strictEqual(initRes.json.monitoringMode.physicalControlDisabled, true);
    assert.strictEqual(initRes.json.monitoringMode.banner, MONITORING_MODE_BANNER);
    assert.strictEqual(initRes.json.controllerStatusCard.connectionStatus, 'OFFLINE');
    assert.strictEqual(initRes.json.controllerStatusCard.dataCategory, 'OFFLINE');
    assert.strictEqual(initRes.json.cameraStatusCard.connectionStatus, 'OFFLINE');
    assert.strictEqual(initRes.json.cameraStatusCard.dataCategory, 'OFFLINE');
    assert.strictEqual(initRes.json.defaultCameraExamples.cameraIp, '10.87.237.36');
    assert.strictEqual(initRes.json.defaultCameraExamples.streamUrl, 'http://10.87.237.36:81/stream');
    assert.strictEqual(initRes.json.defaultCameraExamples.photoUrl, 'http://10.87.237.36/photo');
    assert.strictEqual(initRes.json.defaultCameraExamples.statusUrl, 'http://10.87.237.36/status');
    console.log('   ✅ Monitoring Mode active, status cards OFFLINE, and supplied 10.87.237.36 examples returned to authenticated owner.\n');

    // =========================================================================
    // 2. Authentication (401) & Unauthorized Greenhouse / Role / Guest RBAC (403)
    // =========================================================================
    console.log('2️⃣  Verifying Authentication (401) and Cross-Tenant / Viewer / Guest RBAC (403)...');
    currentUser = null;
    const unauthStateRes = await makeHttpRequest(
      appPort,
      'GET',
      `/api/hardware-http/state?greenhouseId=${encodeURIComponent(ghA.id)}`
    );
    assert.strictEqual(unauthStateRes.status, 401);
    assert.strictEqual(unauthStateRes.json.error, 'UNAUTHENTICATED');

    const unauthSaveCtrl = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/save',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ greenhouseId: ghA.id, host: '10.87.237.35', port: 80 })
    );
    assert.strictEqual(unauthSaveCtrl.status, 401);
    assert.strictEqual(unauthSaveCtrl.json.error, 'UNAUTHENTICATED');

    // Cross-tenant Farmer B attempting to access/configure Farmer A's greenhouse -> 403 FORBIDDEN_GREENHOUSE
    currentUser = farmerB;
    const crossTenantGet = await makeHttpRequest(
      appPort,
      'GET',
      `/api/hardware-http/state?greenhouseId=${encodeURIComponent(ghA.id)}`
    );
    assert.strictEqual(crossTenantGet.status, 403);
    assert.strictEqual(crossTenantGet.json.error, 'FORBIDDEN_GREENHOUSE');

    const crossTenantCamSave = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/save',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        cameraIp: '10.87.237.36',
        photoUrl: 'http://10.87.237.36/photo'
      })
    );
    assert.strictEqual(crossTenantCamSave.status, 403);
    assert.strictEqual(crossTenantCamSave.json.error, 'FORBIDDEN_GREENHOUSE');

    // Read-only Viewer C can read state (200) but cannot mutate/test hardware (403 FORBIDDEN_ROLE)
    currentUser = viewerUser;
    const viewerRead = await makeHttpRequest(
      appPort,
      'GET',
      `/api/hardware-http/state?greenhouseId=${encodeURIComponent(ghA.id)}`
    );
    assert.strictEqual(viewerRead.status, 200);

    const viewerMutate = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/save',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        deviceName: 'Unauthorized Edit',
        host: '10.87.237.35',
        port: 80
      })
    );
    assert.strictEqual(viewerMutate.status, 403);
    assert.strictEqual(viewerMutate.json.error, 'FORBIDDEN_ROLE');

    // Guest account blocked with 403 GUEST_HARDWARE_CONTROL_FORBIDDEN
    currentUser = {
      id: 'usr_guest',
      email: 'guest@preview.edens-ai.local',
      displayName: 'Guest Viewer',
      isGuest: true,
      createdAt: new Date().toISOString()
    };
    const guestTestRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        cameraName: 'Guest Cam',
        photoUrl: `http://127.0.0.1:${camPort}/photo`
      })
    );
    assert.strictEqual(guestTestRes.status, 403);
    assert.strictEqual(guestTestRes.json.error, 'GUEST_HARDWARE_CONTROL_FORBIDDEN');

    currentUser = farmerA;
    console.log('   ✅ Unauthenticated (401), cross-tenant (403), viewer (403), and guest (403) protections verified.\n');

    // =========================================================================
    // 3. Invalid URLs, Invalid Hosts & SSRF Protection -> INVALID_ADDRESS
    // =========================================================================
    console.log('3️⃣  Verifying strict URL/IP validation and SSRF protection (INVALID_ADDRESS)...');
    const invalidUrls = [
      'not-a-valid-url',
      'ftp://10.87.237.36/photo',
      'https://10.87.237.36/photo',
      'http://admin:password@10.87.237.36/photo',
      'http://10.87.237.36/photo?key=secret123',
      'http://8.8.8.8/photo',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.100.100.200/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://100.64.1.10/status'
    ];
    for (const badUrl of invalidUrls) {
      const badCamRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/hardware-http/camera/test',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ cameraName: 'Test Cam', photoUrl: badUrl })
      );
      assert.strictEqual(badCamRes.status, 400, `Expected 400 for invalid camera URL: ${badUrl}`);
      assert.strictEqual(badCamRes.json.connectionState, 'INVALID_ADDRESS');

      const badCtrlRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/hardware-http/controller/save',
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          greenhouseId: ghA.id,
          connectionMethod: 'LOCAL',
          statusUrl: badUrl
        })
      );
      assert.strictEqual(badCtrlRes.status, 400, `Expected 400 for invalid controller URL: ${badUrl}`);
      assert.strictEqual(badCtrlRes.json.connectionState, 'INVALID_ADDRESS');
    }
    console.log('   ✅ Malformed schemes, URL credentials, query secrets, public IPs, CGNAT, and metadata IPs rejected as INVALID_ADDRESS.\n');

    // =========================================================================
    // 4. Local Network Restrictions (Cloud-to-Private-LAN `CONNECTION_BLOCKED`)
    // =========================================================================
    console.log('4️⃣  Verifying Cloud-to-Private-LAN honesty for http://10.87.237.36 endpoints...');
    simulateCloudHosted = true;
    const cloudBlockedCam = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        cameraName: 'North Canopy ESP32-CAM',
        cameraIp: '10.87.237.36',
        streamUrl: 'http://10.87.237.36:81/stream',
        photoUrl: 'http://10.87.237.36/photo',
        statusUrl: 'http://10.87.237.36/status'
      })
    );
    assert.strictEqual(cloudBlockedCam.status, 200);
    assert.strictEqual(cloudBlockedCam.json.success, false);
    assert.strictEqual(cloudBlockedCam.json.connectionState, 'CONNECTION_BLOCKED');
    assert.strictEqual(cloudBlockedCam.json.error, 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD');
    assert.ok(
      Array.isArray(cloudBlockedCam.json.remediationOptions) &&
        cloudBlockedCam.json.remediationOptions.some(
          (opt: any) =>
            typeof opt.command === 'string' && opt.command.includes('http://10.87.237.36/photo')
        )
    );

    const cloudBlockedStream = await makeHttpRequest(
      appPort,
      'GET',
      '/api/hardware-http/camera/stream?streamUrl=' +
        encodeURIComponent('http://10.87.237.36:81/stream')
    );
    assert.strictEqual(cloudBlockedStream.status, 503);
    assert.strictEqual(cloudBlockedStream.json.connectionState, 'CONNECTION_BLOCKED');

    const cloudBlockedCtrl = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        controllerName: 'Main ESP32',
        connectionMethod: 'LOCAL',
        host: '10.87.237.37',
        port: 80
      })
    );
    assert.strictEqual(cloudBlockedCtrl.status, 200);
    assert.strictEqual(cloudBlockedCtrl.json.success, false);
    assert.strictEqual(cloudBlockedCtrl.json.connectionState, 'CONNECTION_BLOCKED');
    assert.strictEqual(cloudBlockedCtrl.json.provenance, 'OFFLINE');
    simulateCloudHosted = false;
    console.log('   ✅ Cloud runtime truthfully reports CONNECTION_BLOCKED for private 10.87.237.x LAN addresses and provides bridge remediation.\n');

    // =========================================================================
    // 5. Offline Camera, Offline Controller & Corrupted Non-JPEG Rejection
    // =========================================================================
    console.log('5️⃣  Verifying offline controller, offline camera, and corrupted non-JPEG rejection...');
    const offlineCtrlRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        deviceName: 'Unplugged ESP32 Controller',
        connectionMethod: 'LOCAL',
        host: '127.0.0.1',
        port: closedPort,
        statusUrl: `http://127.0.0.1:${closedPort}/status`,
        telemetryUrl: `http://127.0.0.1:${closedPort}/status`
      })
    );
    assert.strictEqual(offlineCtrlRes.status, 200);
    assert.strictEqual(offlineCtrlRes.json.success, false);
    assert.strictEqual(offlineCtrlRes.json.connectionState, 'OFFLINE');
    assert.strictEqual(offlineCtrlRes.json.error, 'CONTROLLER_HTTP_UNREACHABLE');

    const offlineCamRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        cameraName: 'Unplugged ESP32-CAM',
        photoUrl: `http://127.0.0.1:${closedPort}/photo`,
        statusUrl: `http://127.0.0.1:${closedPort}/status`
      })
    );
    assert.strictEqual(offlineCamRes.status, 200);
    assert.strictEqual(offlineCamRes.json.success, false);
    assert.strictEqual(offlineCamRes.json.connectionState, 'OFFLINE');

    camPhotoMode = 'corrupt_bytes';
    const corruptCamRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        cameraName: 'Corrupt Cam',
        photoUrl: `http://127.0.0.1:${camPort}/photo`,
        statusUrl: `http://127.0.0.1:${camPort}/status`
      })
    );
    assert.strictEqual(corruptCamRes.status, 200);
    assert.strictEqual(corruptCamRes.json.success, false);
    assert.strictEqual(corruptCamRes.json.connectionState, 'OFFLINE');
    assert.strictEqual(corruptCamRes.json.error, 'INVALID_JPEG_BYTES');
    assert.strictEqual(globalCameraStore.getLatest(), null, 'Corrupted bytes must never be stored');
    camPhotoMode = 'valid_jpeg';
    console.log('   ✅ Offline controller, offline camera, and corrupted non-JPEG payloads handled honestly.\n');

    // =========================================================================
    // 6. Valid Camera Configuration: Save (Stays OFFLINE), Test, Stream, Capture & Disconnect
    // =========================================================================
    console.log('6️⃣  Verifying valid ESP32-CAM save (never CONNECTED on save), test, MJPEG stream, capture & disconnect...');
    const saveCamRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/save',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        cameraName: 'Canopy ESP32-CAM',
        connectionMethod: 'LOCAL',
        cameraIp: '127.0.0.1',
        streamUrl: `http://127.0.0.1:${camPort}/stream`,
        photoUrl: `http://127.0.0.1:${camPort}/photo`,
        statusUrl: `http://127.0.0.1:${camPort}/status`
      })
    );
    assert.strictEqual(saveCamRes.status, 200);
    assert.strictEqual(saveCamRes.json.success, true);
    assert.strictEqual(
      saveCamRes.json.connectionState,
      'OFFLINE',
      'Saving camera configuration must NEVER mark device CONNECTED before testing'
    );
    assert.strictEqual(saveCamRes.json.cameraConnected, false);

    // Verify SQLite persistence in `devices` table
    const dbCamRow = platformDb
      .getDriver()
      .queryOne<{ label: string; capabilities_json: string }>(
        `SELECT label, capabilities_json FROM devices WHERE greenhouse_id = ? AND device_type = 'esp32_cam'`,
        [ghA.id]
      );
    assert.ok(dbCamRow);
    assert.strictEqual(dbCamRow.label, 'Canopy ESP32-CAM');
    assert.ok(dbCamRow.capabilities_json.includes(`http://127.0.0.1:${camPort}/photo`));

    const validCamRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        cameraName: 'Canopy ESP32-CAM',
        cameraIp: '127.0.0.1',
        streamUrl: `http://127.0.0.1:${camPort}/stream`,
        photoUrl: `http://127.0.0.1:${camPort}/photo`,
        statusUrl: `http://127.0.0.1:${camPort}/status`
      })
    );
    assert.strictEqual(validCamRes.status, 200);
    assert.strictEqual(validCamRes.json.success, true);
    assert.strictEqual(validCamRes.json.connectionState, 'IMAGE_RECEIVED');
    assert.strictEqual(validCamRes.json.firmwareVersion, '1.4.2-cam-http');
    assert.strictEqual(validCamRes.json.statusCheck.ok, true);
    assert.strictEqual(validCamRes.json.photoCheck.ok, true);
    assert.strictEqual(validCamRes.json.frame.imageOriginLabel, 'REAL_CAMERA_IMAGE');
    assert.ok(typeof validCamRes.json.lastSuccessfulConnAt === 'string');
    assert.ok(typeof validCamRes.json.streamCheck?.proxyStreamUrl === 'string');
    assert.ok(camStatusHits >= 1 && camPhotoHits >= 1);

    const streamProxyRes = await makeHttpRequest(
      appPort,
      'GET',
      validCamRes.json.streamCheck.proxyStreamUrl
    );
    assert.strictEqual(streamProxyRes.status, 200);
    assert.ok(
      String(streamProxyRes.headers['content-type'] || '').includes('multipart/x-mixed-replace')
    );
    assert.ok(streamProxyRes.rawBuffer.includes(Buffer.from([0xff, 0xd8])));
    assert.ok(camStreamHits >= 1);

    // Cloud Camera Mode Check (verifies actual stored frame in CameraImageStore)
    const cloudModeCamTest = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        cameraName: 'Canopy ESP32-CAM Cloud',
        connectionMethod: 'CLOUD'
      })
    );
    assert.strictEqual(cloudModeCamTest.status, 200);
    assert.strictEqual(cloudModeCamTest.json.success, true);
    assert.strictEqual(cloudModeCamTest.json.connectionState, 'IMAGE_RECEIVED');
    console.log('   ✅ Camera save (OFFLINE), HTTP test (IMAGE_RECEIVED), MJPEG stream proxy, and Cloud upload mode verified.\n');

    // =========================================================================
    // 7. Plant Vision Provenance, Stale Image Guard (>90s) & Disconnect Camera
    // =========================================================================
    console.log('7️⃣  Verifying Plant Vision provenance, stale image guard (>90s), and camera disconnect...');
    // Restore LOCAL photoUrl and capture fresh frame
    await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/save',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        cameraName: 'Canopy ESP32-CAM',
        connectionMethod: 'LOCAL',
        cameraIp: '127.0.0.1',
        photoUrl: `http://127.0.0.1:${camPort}/photo`,
        statusUrl: `http://127.0.0.1:${camPort}/status`,
        streamUrl: `http://127.0.0.1:${camPort}/stream`
      })
    );

    const captureRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/capture',
      { 'Content-Type': 'application/json' },
      JSON.stringify({})
    );
    assert.strictEqual(captureRes.status, 200);
    assert.strictEqual(captureRes.json.success, true);
    assert.strictEqual(captureRes.json.connectionState, 'IMAGE_RECEIVED');

    const liveDiagRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/ai/diagnose',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ source: 'LATEST_CAMERA_FRAME', languageId: 'en' })
    );
    assert.strictEqual(liveDiagRes.status, 200);
    assert.strictEqual(liveDiagRes.json.imageOriginLabel, 'REAL_CAMERA_IMAGE');
    assert.strictEqual(liveDiagRes.json.dataSource, 'REAL_HARDWARE');
    assert.strictEqual(liveDiagRes.json.capturedAt, captureRes.json.frame.capturedAt);
    assert.strictEqual(liveDiagRes.json.confidenceCalibrated, false);
    assert.strictEqual(liveDiagRes.json.confidenceScore, null);
    assert.ok(Array.isArray(liveDiagRes.json.possibleCauses) && liveDiagRes.json.possibleCauses.length === 2);
    assert.ok(Array.isArray(liveDiagRes.json.recommendedActions) && liveDiagRes.json.recommendedActions.length === 2);
    assert.ok(lastVisionInput && lastVisionInput.base64Data.length > 32);

    // Manual uploaded test image must be explicitly labeled UPLOADED_TEST_IMAGE
    const manualJpegBase64 = `data:image/jpeg;base64,${createValidTestJpeg(0x77).toString('base64')}`;
    const manualDiagRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/ai/diagnose',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ source: 'MANUAL_UPLOAD', imageBase64: manualJpegBase64, languageId: 'en' })
    );
    assert.strictEqual(manualDiagRes.status, 200);
    assert.strictEqual(manualDiagRes.json.imageOriginLabel, 'UPLOADED_TEST_IMAGE');
    assert.strictEqual(manualDiagRes.json.dataSource, 'MANUAL_UPLOAD');
    assert.strictEqual(manualDiagRes.json.capturedAt, null);
    assert.strictEqual(manualDiagRes.json.confidenceCalibrated, false);
    assert.strictEqual(manualDiagRes.json.confidenceScore, null);

    // Simulated images must be rejected
    const simDiagRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/ai/diagnose',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ source: 'SIMULATED', imageBase64: manualJpegBase64 })
    );
    assert.strictEqual(simDiagRes.status, 400);
    assert.strictEqual(simDiagRes.json.error, 'SIMULATED_IMAGE_REJECTED');

    // Stale camera frame (>90s) must report STALE_DATA in status card & fail live diagnosis with 409
    const staleIso = new Date(Date.now() - 125_000).toISOString();
    globalCameraStore.validateAndStoreJpeg(createValidTestJpeg(0x66), {
      acquisitionMethod: 'LAN_GATEWAY_PULL',
      capturedAt: staleIso,
      overrideTimestamp: staleIso
    });
    const staleStateRes = await makeHttpRequest(appPort, 'GET', '/api/hardware-http/state');
    assert.strictEqual(staleStateRes.json.cameraStatusCard.dataCategory, 'STALE_DATA');
    assert.strictEqual(staleStateRes.json.cameraStatusCard.connectionStatus, 'OFFLINE');

    const staleDiagRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/ai/diagnose',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ source: 'LATEST_CAMERA_FRAME', languageId: 'en' })
    );
    assert.strictEqual(staleDiagRes.status, 409);
    assert.strictEqual(staleDiagRes.json.error, 'STALE_CAMERA_FRAME');

    // Disconnect Camera -> OFFLINE
    const discCamRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/camera/disconnect',
      { 'Content-Type': 'application/json' },
      JSON.stringify({})
    );
    assert.strictEqual(discCamRes.status, 200);
    assert.strictEqual(discCamRes.json.connectionState, 'OFFLINE');
    console.log('   ✅ REAL_CAMERA_IMAGE vs UPLOADED_TEST_IMAGE, >90s STALE_DATA guard, and Disconnect Camera verified.\n');

    // =========================================================================
    // 8. Controller Save, Dynamic Sensor Discovery, Missing Telemetry, Cloud Mode & Disconnect
    // =========================================================================
    console.log('8️⃣  Verifying ESP32 Controller save, dynamic sensor discovery, missing telemetry, Cloud mode & disconnect...');
    const saveCtrlRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/save',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        deviceName: 'Main Bench ESP32',
        connectionMethod: 'LOCAL',
        host: '127.0.0.1',
        port: ctrlPort,
        statusUrl: `http://127.0.0.1:${ctrlPort}/status`,
        telemetryUrl: `http://127.0.0.1:${ctrlPort}/telemetry`
      })
    );
    assert.strictEqual(saveCtrlRes.status, 200);
    assert.strictEqual(saveCtrlRes.json.success, true);
    assert.strictEqual(
      saveCtrlRes.json.connectionState,
      'OFFLINE',
      'Saving controller configuration must NEVER mark controller CONNECTED before testing'
    );

    // Missing Telemetry (HTTP 200 JSON with all null / no valid sensor readings) -> MISSING_SENSOR_TELEMETRY
    controllerMode = 'missing_telemetry_empty_json';
    const missingTelRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        deviceName: 'Main Bench ESP32',
        connectionMethod: 'LOCAL',
        host: '127.0.0.1',
        port: ctrlPort,
        statusUrl: `http://127.0.0.1:${ctrlPort}/status`,
        telemetryUrl: `http://127.0.0.1:${ctrlPort}/telemetry`
      })
    );
    assert.strictEqual(missingTelRes.status, 200);
    assert.strictEqual(missingTelRes.json.success, false);
    assert.strictEqual(missingTelRes.json.connectionState, 'OFFLINE');
    assert.strictEqual(missingTelRes.json.error, 'MISSING_SENSOR_TELEMETRY');
    assert.ok(
      Array.isArray(missingTelRes.json.discoveredSensors) &&
        missingTelRes.json.discoveredSensors.every((s: any) => s.connected === false),
      'Unavailable sensors must NEVER be marked connected'
    );

    // Valid Local HTTP Controller Telemetry + Dynamic Sensor Discovery + SQLite `device_capabilities` sync
    controllerMode = 'telemetry_status';
    const ctrlOkRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        deviceName: 'Main Bench ESP32',
        connectionMethod: 'LOCAL',
        host: '127.0.0.1',
        port: ctrlPort,
        statusUrl: `http://127.0.0.1:${ctrlPort}/status`,
        telemetryUrl: `http://127.0.0.1:${ctrlPort}/telemetry`
      })
    );
    assert.strictEqual(ctrlOkRes.status, 200);
    assert.strictEqual(ctrlOkRes.json.success, true);
    assert.strictEqual(ctrlOkRes.json.connectionState, 'CONNECTED');
    assert.strictEqual(ctrlOkRes.json.provenance, 'REAL_HARDWARE');
    assert.strictEqual(ctrlOkRes.json.dataCategory, 'REAL_HARDWARE_DATA');
    assert.strictEqual(ctrlOkRes.json.firmwareVersion, '3.0.0-pnp-sec');
    assert.strictEqual(ctrlOkRes.json.readings.temperature, 26.8);
    assert.strictEqual(controllerActuationHits, 0, 'Must never call controller actuation endpoints');

    // Verify dynamic sensor discovery:
    // - temperature (26.8 °C) -> connected: true, validity: 'VALID'
    // - waterLevel (null) -> connected: false, validity: 'UNAVAILABLE'
    // - soilTempC (23.4 °C) -> dynamically discovered custom sensor!
    const sensors: any[] = ctrlOkRes.json.discoveredSensors;
    const tempSensor = sensors.find((s) => s.key === 'temperature');
    const waterSensor = sensors.find((s) => s.key === 'waterLevel');
    const customSoilTemp = sensors.find((s) => s.key === 'soilTempC');
    assert.ok(tempSensor && tempSensor.connected === true && tempSensor.validity === 'VALID' && tempSensor.unit === '°C');
    assert.ok(waterSensor && waterSensor.connected === false && waterSensor.validity === 'UNAVAILABLE');
    assert.ok(customSoilTemp && customSoilTemp.connected === true && customSoilTemp.value === 23.4);
    assert.ok(tempSensor.timestamp && tempSensor.sourceDevice.includes('Main Bench ESP32'));

    // Verify SQLite `device_capabilities` table persisted discovered sensors
    const dbCaps = platformDb
      .getDriver()
      .queryAll<{ channel_key: string; is_enabled: number }>(
        `SELECT channel_key, is_enabled FROM device_capabilities WHERE greenhouse_id = ? AND capability_kind = 'sensor'`,
        [ghA.id]
      );
    assert.ok(dbCaps.some((c) => c.channel_key === 'temperature' && c.is_enabled === 1));
    assert.ok(dbCaps.some((c) => c.channel_key === 'waterLevel' && c.is_enabled === 0));
    assert.ok(dbCaps.some((c) => c.channel_key === 'soilTempC' && c.is_enabled === 1));

    // Verify GET /state retains custom sensor `soilTempC` and reports REAL_HARDWARE_DATA
    const stateAfterCtrl = await makeHttpRequest(
      appPort,
      'GET',
      `/api/hardware-http/state?greenhouseId=${encodeURIComponent(ghA.id)}`
    );
    assert.strictEqual(stateAfterCtrl.json.controllerStatusCard.connectionStatus, 'CONNECTED');
    assert.strictEqual(stateAfterCtrl.json.controllerStatusCard.dataCategory, 'REAL_HARDWARE_DATA');
    assert.ok(
      stateAfterCtrl.json.controllerStatusCard.discoveredSensors.some(
        (s: any) => s.key === 'soilTempC' && s.connected === true
      )
    );

    // Disconnect Controller -> OFFLINE & clears cached readings
    const discCtrlRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/disconnect',
      { 'Content-Type': 'application/json' },
      JSON.stringify({ greenhouseId: ghA.id })
    );
    assert.strictEqual(discCtrlRes.status, 200);
    assert.strictEqual(discCtrlRes.json.connectionState, 'OFFLINE');
    const stateAfterDisc = await makeHttpRequest(
      appPort,
      'GET',
      `/api/hardware-http/state?greenhouseId=${encodeURIComponent(ghA.id)}`
    );
    assert.strictEqual(stateAfterDisc.json.controllerStatusCard.connectionStatus, 'OFFLINE');
    assert.strictEqual(stateAfterDisc.json.controllerStatusCard.dataCategory, 'OFFLINE');

    // SoftAP /api/identity mode & missing firmware HTTP mode
    controllerMode = 'softap_identity_only';
    const ctrlSoftApRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        controllerName: 'Setup Mode ESP32',
        connectionMethod: 'LOCAL',
        baseUrl: `http://127.0.0.1:${ctrlPort}`
      })
    );
    assert.strictEqual(ctrlSoftApRes.status, 200);
    assert.strictEqual(ctrlSoftApRes.json.success, true);
    assert.strictEqual(ctrlSoftApRes.json.connectionState, 'CONNECTED');
    assert.strictEqual(ctrlSoftApRes.json.provenance, 'OFFLINE');
    assert.strictEqual(ctrlSoftApRes.json.identityEndpoint.ok, true);

    controllerMode = 'outbound_push_only';
    const ctrlNoHttpRes = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        controllerName: 'Cloud-Push ESP32',
        connectionMethod: 'LOCAL',
        baseUrl: `http://127.0.0.1:${ctrlPort}`
      })
    );
    assert.strictEqual(ctrlNoHttpRes.status, 200);
    assert.strictEqual(ctrlNoHttpRes.json.success, false);
    assert.strictEqual(ctrlNoHttpRes.json.connectionState, 'OFFLINE');
    assert.strictEqual(ctrlNoHttpRes.json.error, 'MISSING_FIRMWARE_HTTP_TELEMETRY_ENDPOINT');

    // Cloud Outbound Push Mode (`connectionMethod: 'CLOUD'`):
    // Before check-in -> OFFLINE; after real telemetry upload in SQLite -> CONNECTED + REAL_HARDWARE_DATA
    const cloudCtrlEmpty = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        deviceName: 'Cloud ESP32 Controller',
        connectionMethod: 'CLOUD'
      })
    );
    assert.strictEqual(cloudCtrlEmpty.status, 200);
    assert.strictEqual(cloudCtrlEmpty.json.success, false);
    assert.strictEqual(cloudCtrlEmpty.json.connectionState, 'OFFLINE');
    assert.strictEqual(cloudCtrlEmpty.json.error, 'MISSING_CLOUD_TELEMETRY_CHECKIN');

    // Insert genuine controller telemetry into SQLite and re-test Cloud Mode
    const ctrlDevice = platformDb
      .listDevicesForGreenhouse(ghA.id)
      .find((d) => d.deviceType === 'esp32_controller')!;
    const validCloudPayload = validateControllerTelemetryPayload({
      temperature: 27.4,
      humidity: 63,
      soilMoisture: 54,
      waterLevel: 79,
      sunlight: 9800,
      firmwareVersion: '3.0.0-pnp-sec'
    });
    assert.ok(!('errorCode' in validCloudPayload));
    platformDb.storeControllerTelemetry({
      greenhouseId: ghA.id,
      deviceId: ctrlDevice.id,
      telemetry: validCloudPayload
    });

    const cloudCtrlLive = await makeHttpRequest(
      appPort,
      'POST',
      '/api/hardware-http/controller/test',
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        greenhouseId: ghA.id,
        deviceName: 'Cloud ESP32 Controller',
        connectionMethod: 'CLOUD'
      })
    );
    assert.strictEqual(cloudCtrlLive.status, 200);
    assert.strictEqual(cloudCtrlLive.json.success, true);
    assert.strictEqual(cloudCtrlLive.json.connectionState, 'CONNECTED');
    assert.strictEqual(cloudCtrlLive.json.dataCategory, 'REAL_HARDWARE_DATA');
    assert.strictEqual(cloudCtrlLive.json.firmwareVersion, '3.0.0-pnp-sec');
    assert.strictEqual(controllerActuationHits, 0);
    console.log('   ✅ Controller Save, Dynamic Discovery, Missing Telemetry, SoftAP, Cloud Push, SQLite Sync & Disconnect verified.\n');

    // =========================================================================
    // 9. Local LAN Relay Bridge (`scripts/camera-lan-relay.mjs --once`)
    // =========================================================================
    console.log('9️⃣  Verifying Local LAN Relay Bridge (`scripts/camera-lan-relay.mjs --once`)...');
    const relayScriptPath = path.join(process.cwd(), 'scripts', 'camera-lan-relay.mjs');
    const { stdout } = await execFileAsync(process.execPath, [relayScriptPath, '--once'], {
      env: {
        ...process.env,
        CAMERA_PHOTO_URL: `http://127.0.0.1:${camPort}/photo`,
        CAMERA_STATUS_URL: `http://127.0.0.1:${camPort}/status`,
        EDENS_BACKEND_URL: `http://127.0.0.1:${appPort}`,
        CAMERA_UPLOAD_KEY: TEST_CAMERA_KEY
      }
    });
    assert.ok(stdout.includes('Uploaded '), `Unexpected relay output: ${stdout}`);

    const latestAfterRelay = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
    assert.strictEqual(latestAfterRelay.status, 200);
    assert.strictEqual(latestAfterRelay.json.exists, true);
    assert.strictEqual(latestAfterRelay.json.isFresh, true);
    console.log('   ✅ Local LAN Relay Bridge pulled HTTP /photo and uploaded verified JPEG to /api/camera/upload.\n');

    console.log('🎉 ALL 9 HARDWARE CONNECTION SETTINGS, SECURITY & PROVENANCE TEST GROUPS PASSED!');
  } finally {
    appServer.close();
    mockCameraServer.close();
    mockControllerServer.close();
    platformDb.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runSuite().catch((err) => {
  console.error('❌ Existing Hardware HTTP Connection Test Suite FAILED:', err);
  process.exit(1);
});
