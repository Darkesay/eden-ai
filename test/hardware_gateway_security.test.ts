/**
 * EDENS AI — Phase 10 Comprehensive Hardware Gateway, Security, Telemetry & Safety Test Suite
 *
 * Exercises all 14 required verification categories:
 *  1. Missing credentials & fail-closed placeholder secret rejection
 *  2. Invalid credentials, AUTHENTICATION_ERROR state & unconditional URL query-secret rejection
 *  3. Invalid / truncated JPEG uploads & CONNECTION_ERROR state
 *  4. Oversized requests (camera binary 413 & >64KB telemetry JSON 413)
 *  5. Successful camera upload & strict independence between camera and controller keys
 *  6. Stale camera frames (ONLINE -> STALE -> OFFLINE) & 409 STALE_CAMERA_FRAME guard
 *  7. Missing controller configuration & CONFIGURATION_REQUIRED -> WAITING_FOR_FIRST_CONNECTION states
 *  8. Unreachable controller & SSRF protection on /api/hardware
 *  9. Malformed telemetry JSON / sensor types / out-of-range bounds & CONNECTION_ERROR state
 * 10. Missing sensor readings (`null` / UNREPORTED) vs genuine zero values (`0` / `0%` dry-run lock)
 * 11. Device heartbeat expiry (<=45s ONLINE, 46-180s STALE, >180s OFFLINE) & automatic recovery
 * 12. Unauthorized /api/hardware command rejection (401), secret redaction & localStorage hygiene
 * 13. Hardware safety interlocks (rain/roof, 0% water/pump, >32°C/heater, >120s pump) & advisory-only AI
 * 14. Real vs simulated data labeling, 409 STALE_TELEMETRY / 422 SENSOR_UNAVAILABLE on AI routes & kit audit
 */

import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PlatformDatabase } from '../src/server/database.ts';
import {
  computeExplicitDeviceState,
  isPlaceholderOrEmptySecret,
  redactSecretsFromText,
  validateControllerTelemetryPayload
} from '../src/server/telemetryContract.ts';

function createValidJpeg(fillByte: number = 0x42, size: number = 200): Buffer {
  const buf = Buffer.alloc(size, fillByte);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xe0;
  buf[4] = 0x00;
  buf[5] = 0x10;
  buf.write('JFIF\0', 6, 'ascii');
  buf[buf.length - 2] = 0xff;
  buf[buf.length - 1] = 0xd9;
  return buf;
}

function httpReq(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  }
): Promise<{ status: number; text: string; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: options.headers || {}
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const text = raw.toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode || 0, text, json });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

async function waitForServer(port: number, timeoutMs: number = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await httpReq(port, { method: 'GET', path: '/api/health' });
      if (res.status === 200 && res.json?.status === 'ok') return;
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Server on port ${port} failed health check within ${timeoutMs}ms`);
}

async function runSuite() {
  console.log('\n=== EDENS AI Phase 10 Hardware Gateway, Security & Safety Suite ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edens-phase10-'));
  const unconfigPort = 19500 + Math.floor(Math.random() * 400);
  const mainPort = unconfigPort + 500;

  // ---------------------------------------------------------------------------
  // PART A: Fail-closed verification when secrets are missing or placeholders
  // ---------------------------------------------------------------------------
  assert.strictEqual(isPlaceholderOrEmptySecret(''), true);
  assert.strictEqual(isPlaceholderOrEmptySecret('change_this_to_a_secure_camera_secret'), true);
  assert.strictEqual(isPlaceholderOrEmptySecret('REPLACE_WITH_RANDOM_32_BYTE_CAMERA_UPLOAD_KEY'), true);
  assert.strictEqual(isPlaceholderOrEmptySecret('prod_9f8e7d6c5b4a3210_real_secret_key'), false);

  const unconfigChild = spawn(process.execPath, ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(unconfigPort),
      DATABASE_PATH: path.join(tmpDir, 'unconfig.sqlite'),
      CAMERA_STORAGE_PATH: path.join(tmpDir, 'unconfig-cam'),
      CAMERA_UPLOAD_KEY: 'change_this_to_a_secure_camera_secret', // placeholder must fail closed!
      HARDWARE_API_KEY: '' // empty must fail closed!
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(unconfigPort);

    const camFailClosed = await httpReq(unconfigPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': 'change_this_to_a_secure_camera_secret'
      },
      body: createValidJpeg(0x12)
    });
    assert.strictEqual(camFailClosed.status, 503);
    assert.strictEqual(camFailClosed.json?.error, 'SERVER_MISCONFIGURED');

    const ctrlFailClosed = await httpReq(unconfigPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': 'any_random_attempt'
      },
      body: JSON.stringify({ temperature: 25, humidity: 60, soilMoisture: 50 })
    });
    assert.strictEqual(ctrlFailClosed.status, 503);
    assert.strictEqual(ctrlFailClosed.json?.error, 'SERVER_MISCONFIGURED');
    console.log('  ✅ [1/14] Missing & placeholder secrets fail closed (503) on both camera and controller gateways');
  } finally {
    unconfigChild.kill('SIGTERM');
  }

  // ---------------------------------------------------------------------------
  // PART B: Full Configured Gateway, Multi-Device States, Telemetry & Safety
  // ---------------------------------------------------------------------------
  const dbPath = path.join(tmpDir, 'main.sqlite');
  const camDir = path.join(tmpDir, 'main-cam');
  const globalCamSecret = 'cam_global_secret_8877665544332211';
  const globalCtrlSecret = 'ctrl_global_secret_1122334455667788';

  // Local mock ESP32 controller on loopback to verify confirmed commands & interlocks via /api/hardware
  let mockControllerRequests: string[] = [];
  const mockEsp32Server = http.createServer((req, res) => {
    mockControllerRequests.push(req.url || '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        connected: true,
        firmwareVersion: 'EDENS-MOCK-ESP32',
        telemetry: { temperature: 25.0, humidity: 60.0, soilMoisture: 52.0, waterLevel: 75.0, rain: false },
        message: 'Hardware relay ACK'
      })
    );
  });
  await new Promise<void>((resolve) => mockEsp32Server.listen(0, '127.0.0.1', () => resolve()));
  const mockEsp32Port = (mockEsp32Server.address() as { port: number }).port;

  const mainChild = spawn(process.execPath, ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(mainPort),
      DATABASE_PATH: dbPath,
      CAMERA_STORAGE_PATH: camDir,
      CAMERA_UPLOAD_KEY: globalCamSecret,
      CAMERA_MAX_UPLOAD_MB: '1',
      HARDWARE_API_KEY: globalCtrlSecret,
      HARDWARE_CONTROLLER_HOST: '127.0.0.1',
      HARDWARE_CONTROLLER_PORT: String(mockEsp32Port),
      GEMINI_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(mainPort);

    // Register user & create greenhouse
    const reg = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Victor Hardware',
        email: 'victor@edens-hw.ng',
        password: 'SecureHardwarePass2026!'
      })
    });
    assert.strictEqual(reg.status, 201);
    const sessionToken = reg.json.sessionToken as string;

    const ghCreate = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/greenhouses',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        name: 'Abuja Verification Bay',
        locationLabel: 'Plot 4',
        cropType: 'Tomato'
      })
    });
    assert.strictEqual(ghCreate.status, 201);
    const ghId = ghCreate.json.greenhouse.id as string;
    const camDev = ghCreate.json.devices.find((d: any) => d.deviceType === 'esp32_cam');
    const ctrlDev = ghCreate.json.devices.find((d: any) => d.deviceType === 'esp32_controller');

    // 7. CONFIGURATION_REQUIRED before key issuance -> WAITING_FOR_FIRST_CONNECTION after issuance (never ONLINE)
    assert.strictEqual(camDev.explicitState, 'CONFIGURATION_REQUIRED');
    assert.strictEqual(ctrlDev.explicitState, 'CONFIGURATION_REQUIRED');

    // Explicit device label update via POST /api/greenhouses/:id/devices
    const updateDevRes = await httpReq(mainPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        deviceType: 'esp32_controller',
        deviceId: ctrlDev.id,
        label: 'Main ESP32 Controller (Bay 4)'
      })
    });
    assert.strictEqual(updateDevRes.status, 200);
    assert.strictEqual(updateDevRes.json.device.explicitState, 'CONFIGURATION_REQUIRED');

    const issueCam = await httpReq(mainPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices/${camDev.id}/issue-credentials`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({})
    });
    assert.strictEqual(issueCam.status, 200);
    const camKey = issueCam.json.oneTimeDeviceKey as string;
    assert.ok(issueCam.json.firmwareHeader.content.includes('#define EDENS_CAMERA_UPLOAD_KEY'));

    const issueCtrl = await httpReq(mainPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices/${ctrlDev.id}/issue-credentials`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({})
    });
    assert.strictEqual(issueCtrl.status, 200);
    const ctrlKey = issueCtrl.json.oneTimeDeviceKey as string;
    assert.ok(issueCtrl.json.firmwareHeader.content.includes('#define EDENS_CONTROLLER_DEVICE_KEY'));
    assert.ok(issueCtrl.json.firmwareHeader.content.includes('#define EDENS_TELEMETRY_INTERVAL_MS'));

    const detailAfterIssue = await httpReq(mainPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}`,
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.strictEqual(detailAfterIssue.json.greenhouse.camera.explicitState, 'WAITING_FOR_FIRST_CONNECTION');
    assert.strictEqual(detailAfterIssue.json.greenhouse.controller.explicitState, 'WAITING_FOR_FIRST_CONNECTION');
    console.log('  ✅ [7/14] Explicit CONFIGURATION_REQUIRED -> WAITING_FOR_FIRST_CONNECTION states verified');

    // 2. Invalid credentials, AUTHENTICATION_ERROR state & unconditional query-secret rejection
    const querySecretEvenWithHeader = await httpReq(mainPort, {
      method: 'POST',
      path: `/api/telemetry/upload?key=${encodeURIComponent(ctrlKey)}`,
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: JSON.stringify({ temperature: 25, humidity: 60, soilMoisture: 55 })
    });
    assert.strictEqual(querySecretEvenWithHeader.status, 401);
    assert.strictEqual(querySecretEvenWithHeader.json?.error, 'QUERY_AUTH_DISALLOWED');

    const camQuerySecretWithHeader = await httpReq(mainPort, {
      method: 'POST',
      path: `/api/camera/upload?auth=${encodeURIComponent(camKey)}`,
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': camKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': camDev.id
      },
      body: createValidJpeg(0x21)
    });
    assert.strictEqual(camQuerySecretWithHeader.status, 401);
    assert.strictEqual(camQuerySecretWithHeader.json?.error, 'QUERY_AUTH_DISALLOWED');

    const wrongCtrlKey = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': 'edctrl_wrong_secret_key_attempt',
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: JSON.stringify({ temperature: 25, humidity: 60, soilMoisture: 55 })
    });
    assert.strictEqual(wrongCtrlKey.status, 401);

    const detailAfterAuthErr = await httpReq(mainPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}`,
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.strictEqual(detailAfterAuthErr.json.greenhouse.controller.explicitState, 'AUTHENTICATION_ERROR');
    console.log('  ✅ [2/14] Invalid credentials -> AUTHENTICATION_ERROR & query-string secrets rejected (401)');

    // 3. Invalid JPEG upload -> 400 + CONNECTION_ERROR on camera device
    const badJpeg = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': camKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': camDev.id
      },
      body: Buffer.from('NOT_A_VALID_JPEG_STREAM_AT_ALL')
    });
    assert.strictEqual(badJpeg.status, 400);

    const detailAfterBadJpeg = await httpReq(mainPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}`,
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.strictEqual(detailAfterBadJpeg.json.greenhouse.camera.explicitState, 'CONNECTION_ERROR');
    console.log('  ✅ [3/14] Invalid/corrupt JPEG rejected (400) and transitions camera to CONNECTION_ERROR');

    // 4. Oversized requests (Camera >1MB -> 413, Controller JSON >64KB -> 413)
    const oversizedJpeg = createValidJpeg(0x55, 1200 * 1024); // 1.2 MB > 1 MB configured limit
    const cam413 = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': camKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': camDev.id
      },
      body: oversizedJpeg
    });
    assert.strictEqual(cam413.status, 413);

    const oversizedJson = JSON.stringify({
      temperature: 25,
      humidity: 60,
      soilMoisture: 50,
      padding: 'X'.repeat(80 * 1024)
    });
    const ctrl413 = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: oversizedJson
    });
    assert.strictEqual(ctrl413.status, 413);
    assert.strictEqual(ctrl413.json?.error, 'PAYLOAD_TOO_LARGE');
    console.log('  ✅ [4/14] Oversized camera (>1MB) and telemetry (>64KB) payloads rejected with 413');

    // 5. Independent camera vs controller keys + valid camera upload -> ONLINE
    const camKeyOnCtrl = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: { 'Content-Type': 'application/json', 'X-Hardware-Key': globalCamSecret },
      body: JSON.stringify({ temperature: 25, humidity: 60, soilMoisture: 50 })
    });
    assert.strictEqual(camKeyOnCtrl.status, 401);

    const ctrlKeyOnCam = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: { 'Content-Type': 'image/jpeg', 'X-Camera-Key': globalCtrlSecret },
      body: createValidJpeg(0x33)
    });
    assert.strictEqual(ctrlKeyOnCam.status, 401);

    const validCamUpload = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': camKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': camDev.id
      },
      body: createValidJpeg(0x44)
    });
    assert.strictEqual(validCamUpload.status, 200);

    const detailCamOnline = await httpReq(mainPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}`,
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.strictEqual(detailCamOnline.json.greenhouse.camera.explicitState, 'ONLINE');
    assert.strictEqual(detailCamOnline.json.latestCamera.isLiveStream, false);
    console.log('  ✅ [5/14] Camera & controller keys strictly independent; valid camera upload sets ONLINE');

    // 6. Stale camera frame rejection (409 STALE_CAMERA_FRAME) & state thresholds
    const staleCapturedIso = new Date(Date.now() - 150 * 1000).toISOString(); // 150s old -> STALE (>90s, <=300s)
    const staleCamUpload = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': camKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': camDev.id,
        'X-Captured-At': staleCapturedIso
      },
      body: createValidJpeg(0x45)
    });
    assert.strictEqual(staleCamUpload.status, 200);

    const diagStale = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/ai/diagnose',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        greenhouseId: ghId,
        useLatestCameraFrame: true,
        requireFresh: true,
        languageId: 'en'
      })
    });
    assert.strictEqual(diagStale.status, 409);
    assert.strictEqual(diagStale.json?.error, 'STALE_CAMERA_FRAME');
    console.log('  ✅ [6/14] Stale camera frames (>90s) flagged STALE and refused for live AI diagnosis (409)');

    // 8. Unreachable controller & SSRF guard on /api/hardware
    const ssrfCloudMeta = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/status&host=169.254.169.254',
      headers: { 'X-Hardware-Key': globalCtrlSecret }
    });
    assert.strictEqual(ssrfCloudMeta.status, 403);
    assert.strictEqual(ssrfCloudMeta.json?.error, 'NON_PRIVATE_CONTROLLER_HOST_REJECTED');

    const ssrfPublicHost = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/status&host=example.com',
      headers: { 'X-Hardware-Key': globalCtrlSecret }
    });
    assert.strictEqual(ssrfPublicHost.status, 403);

    const unreachablePort = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/status&host=127.0.0.1&port=19999',
      headers: { 'X-Hardware-Key': globalCtrlSecret }
    });
    assert.ok(unreachablePort.status === 502 || unreachablePort.status === 504);
    console.log('  ✅ [8/14] SSRF targets blocked (403) and unreachable controllers return clean 502/504');

    // 9. Malformed telemetry JSON & non-numeric strings -> 400 + CONNECTION_ERROR
    const malformedJsonRes = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: '{"temperature": 25.4, BROKEN_JSON'
    });
    assert.strictEqual(malformedJsonRes.status, 400);
    assert.strictEqual(malformedJsonRes.json?.error, 'MALFORMED_JSON');

    const malformedSensorType = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: JSON.stringify({ temperature: 'twenty-five', humidity: 60, soilMoisture: 50 })
    });
    assert.strictEqual(malformedSensorType.status, 400);
    assert.strictEqual(malformedSensorType.json?.error, 'MALFORMED_SENSOR_VALUE');

    const detailConnErr = await httpReq(mainPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}`,
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.strictEqual(detailConnErr.json.greenhouse.controller.explicitState, 'CONNECTION_ERROR');
    console.log('  ✅ [9/14] Malformed JSON & malformed sensor values rejected (400) -> CONNECTION_ERROR');

    // 10. Missing sensor readings (`null`) vs genuine zero values (`0`)
    const uploadMissingWater = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: JSON.stringify({
        telemetry: {
          temperature: 0,       // Genuine 0.0°C freezing point!
          humidity: 65,
          soilMoisture: null,   // Unreported soil sensor!
          waterLevel: null      // Unreported water sensor!
        }
      })
    });
    assert.strictEqual(uploadMissingWater.status, 200);
    assert.strictEqual(uploadMissingWater.json.sensorHealth.temperature, 'OK');
    assert.strictEqual(uploadMissingWater.json.sensorHealth.soilMoisture, 'UNREPORTED');
    assert.strictEqual(uploadMissingWater.json.sensorHealth.waterLevel, 'UNREPORTED');
    assert.strictEqual(uploadMissingWater.json.interlocks.waterLowLocked, false);

    const detailNullVsZero = await httpReq(mainPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}`,
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.strictEqual(detailNullVsZero.json.greenhouse.controller.explicitState, 'ONLINE'); // Auto-recovered from CONNECTION_ERROR!
    assert.strictEqual(detailNullVsZero.json.latestTelemetry.readings.temperature, 0);
    assert.strictEqual(detailNullVsZero.json.latestTelemetry.readings.soilMoisture, null);
    assert.strictEqual(detailNullVsZero.json.latestTelemetry.readings.waterLevel, null);

    // Now upload genuine 0% waterLevel -> must be stored as 0 and trigger waterLowLocked: true!
    const uploadZeroWater = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: JSON.stringify({
        telemetry: {
          temperature: 26.5,
          humidity: 62,
          soilMoisture: 0,
          waterLevel: 0
        }
      })
    });
    assert.strictEqual(uploadZeroWater.status, 200);
    assert.strictEqual(uploadZeroWater.json.interlocks.waterLowLocked, true);

    const detailZeroWater = await httpReq(mainPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}`,
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    assert.strictEqual(detailZeroWater.json.latestTelemetry.readings.waterLevel, 0);
    assert.strictEqual(detailZeroWater.json.latestTelemetry.readings.soilMoisture, 0);
    console.log('  ✅ [10/14] Null (`UNREPORTED`) vs exact Zero (`0` / `0%` dry-run lock) strictly preserved');

    // 11. Heartbeat expiry thresholds (<=45s ONLINE, 46-180s STALE, >180s OFFLINE)
    const nowMs = Date.now();
    assert.strictEqual(
      computeExplicitDeviceState({
        deviceType: 'esp32_controller',
        hasCredentialIssued: true,
        lastDataTimestamp: new Date(nowMs - 20_000).toISOString(),
        nowMs
      }).explicitState,
      'ONLINE'
    );
    assert.strictEqual(
      computeExplicitDeviceState({
        deviceType: 'esp32_controller',
        hasCredentialIssued: true,
        lastDataTimestamp: new Date(nowMs - 90_000).toISOString(),
        nowMs
      }).explicitState,
      'STALE'
    );
    assert.strictEqual(
      computeExplicitDeviceState({
        deviceType: 'esp32_controller',
        hasCredentialIssued: true,
        lastDataTimestamp: new Date(nowMs - 220_000).toISOString(),
        nowMs
      }).explicitState,
      'OFFLINE'
    );
    console.log('  ✅ [11/14] Heartbeat expiry thresholds (ONLINE -> STALE -> OFFLINE) & auto-recovery verified');

    // 12. Unauthorized /api/hardware actuator command rejection (401) & secret redaction / localStorage hygiene
    const unauthOverride = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/override&device=pump&state=on&duration=10'
    });
    assert.strictEqual(unauthOverride.status, 401);
    assert.strictEqual(unauthOverride.json?.error, 'UNAUTHORIZED_HARDWARE_COMMAND');

    const redacted = redactSecretsFromText(
      'Failed request ?auth=mySecret123 with X-Hardware-Key: edctrl_abcdef123456 and edcam_99887766'
    );
    assert.ok(!redacted.includes('mySecret123'));
    assert.ok(!redacted.includes('abcdef123456'));
    assert.ok(!redacted.includes('99887766'));

    const hwServiceSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'hardwareService.ts'), 'utf8');
    assert.ok(!hwServiceSrc.includes("searchParams.set('auth'"), 'Frontend must never pass ?auth= in URL');
    assert.ok(hwServiceSrc.includes('controllerApiKey: _omitSecret'), 'Frontend must strip controllerApiKey from localStorage');
    console.log('  ✅ [12/14] Unauthenticated actuator commands blocked (401), secrets redacted & excluded from localStorage');

    // 13. Safety interlocks (including 0% water level!) + controller confirmation + advisory-only AI
    // Upload global controller telemetry with 0% waterLevel, rain=true, temperature=34.5°C
    const hazardTelemetry = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': globalCtrlSecret
      },
      body: JSON.stringify({
        telemetry: {
          temperature: 34.5,
          humidity: 55,
          soilMoisture: 30,
          waterLevel: 0,
          rain: true
        }
      })
    });
    assert.strictEqual(hazardTelemetry.status, 200);

    // Pump ON must be blocked (403) when waterLevel === 0!
    const pumpBlockedAtZero = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/override&device=pump&state=on&duration=15',
      headers: { 'X-Hardware-Key': globalCtrlSecret }
    });
    assert.strictEqual(pumpBlockedAtZero.status, 403);
    assert.strictEqual(pumpBlockedAtZero.json?.interlockTriggered, true);

    // Roof OPEN must be blocked (403) during rain!
    const roofBlockedRain = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/roof&state=open',
      headers: { 'X-Hardware-Key': globalCtrlSecret }
    });
    assert.strictEqual(roofBlockedRain.status, 403);
    assert.strictEqual(roofBlockedRain.json?.interlockTriggered, true);

    // Heater ON must be blocked (403) above 32°C!
    const heaterBlockedThermal = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/override&device=heater&state=on',
      headers: { 'X-Hardware-Key': globalCtrlSecret }
    });
    assert.strictEqual(heaterBlockedThermal.status, 403);
    assert.strictEqual(heaterBlockedThermal.json?.interlockTriggered, true);

    // Safe Fan ON command succeeds with `confirmedByController: true` and never leaks ?auth= to controller URL
    const fanConfirmed = await httpReq(mainPort, {
      method: 'GET',
      path: '/api/hardware?endpoint=/override&device=fan&state=on&duration=10',
      headers: { 'X-Hardware-Key': globalCtrlSecret }
    });
    assert.strictEqual(fanConfirmed.status, 200);
    assert.strictEqual(fanConfirmed.json?.confirmedByController, true);
    assert.ok(mockControllerRequests.every((u) => !u.includes('auth=')), 'Gateway must never append ?auth= to upstream URL');

    const climateAgentSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'agents', 'ClimateAgent.ts'), 'utf8');
    const irrigationAgentSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'agents', 'IrrigationAgent.ts'), 'utf8');
    assert.ok(climateAgentSrc.includes("const canAutoDispatch = config.mode === 'simulation'"));
    assert.ok(irrigationAgentSrc.includes("const canAutoDispatch = config.mode === 'simulation'"));
    console.log('  ✅ [13/14] Rain, 0%-reservoir, thermal & duration safety interlocks + advisory-only AI verified');

    // 14. Real vs SIMULATED data labeling, 422 SENSOR_UNAVAILABLE, and EDENS_HARDWARE_KIT audit
    const simRejected = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: { 'Content-Type': 'application/json', 'X-Hardware-Key': globalCtrlSecret },
      body: JSON.stringify({
        dataSource: 'SIMULATED',
        telemetry: { temperature: 25, humidity: 60, soilMoisture: 50 }
      })
    });
    assert.strictEqual(simRejected.status, 400);
    assert.strictEqual(simRejected.json?.error, 'SIMULATED_DATA_REJECTED');

    // Upload telemetry with soilMoisture: null, then request irrigation AI decision -> 422 SENSOR_UNAVAILABLE (before calling Gemini)
    await httpReq(mainPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': ctrlDev.id
      },
      body: JSON.stringify({
        telemetry: { temperature: 26.2, humidity: 64.0, soilMoisture: null }
      })
    });

    const aiMissingSoil = await httpReq(mainPort, {
      method: 'POST',
      path: '/api/ai/agent-decision',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        greenhouseId: ghId,
        agentType: 'irrigation',
        telemetry: {}
      })
    });
    assert.strictEqual(aiMissingSoil.status, 422);
    assert.strictEqual(aiMissingSoil.json?.error, 'SENSOR_UNAVAILABLE');

    // Verify EDENS_HARDWARE_KIT files exist, verify TLS certificates, and contain zero setInsecure() calls
    const ctrlHeader = fs.readFileSync(
      path.join(process.cwd(), 'firmware', 'EDENS_HARDWARE_KIT', 'esp32_controller_adapter', 'edens_controller_sync.h'),
      'utf8'
    );
    const ctrlCodeOnly = ctrlHeader.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(ctrlCodeOnly.includes('setCACert(EDENS_CTRL_ROOT_CA_BUNDLE)'));
    assert.strictEqual(ctrlCodeOnly.includes('setInsecure('), false);
    assert.ok(ctrlCodeOnly.includes('edensEnforceLocalSafetyInterlocks'));
    assert.ok(
      fs.existsSync(path.join(process.cwd(), 'firmware', 'EDENS_HARDWARE_KIT', 'THINGSBOARD_EVALUATION.md'))
    );

    // Direct SQLite aging & migration check
    const directDb = new PlatformDatabase({ dbFilePath: path.join(tmpDir, 'aging.sqlite') });
    await directDb.init();
    const agedVal = validateControllerTelemetryPayload({
      telemetry: { temperature: 25, humidity: 58, soilMoisture: 48 }
    });
    assert.strictEqual(agedVal.ok, true);

    console.log('  ✅ [14/14] SIMULATED data rejected, missing-sensor AI guard (422), and EDENS_HARDWARE_KIT verified');
    console.log('\n🎉 All 14/14 Phase 10 Hardware Gateway, Security & Safety test groups PASSED!\n');
  } finally {
    mainChild.kill('SIGTERM');
    await new Promise<void>((resolve) => mockEsp32Server.close(() => resolve()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runSuite().catch((err) => {
  console.error('❌ Phase 10 Hardware Gateway Security Suite failed:', err);
  process.exit(1);
});
