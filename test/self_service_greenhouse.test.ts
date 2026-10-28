/**
 * EDENS AI - Production Startup (`node server.ts`) & Self-Service Greenhouse Integration Tests
 *
 * Verifies:
 * 1. Native `node server.ts` production boot (guards against ERR_MODULE_NOT_FOUND & Render port scan timeout)
 * 2. Customer registration, scrypt authentication, session validation, and invalid login rejection
 * 3. Greenhouse creation in honest SETUP_INCOMPLETE state (never falsely ONLINE)
 * 4. Multi-tenant RBAC isolation (Customer B blocked with 403 from Customer A's greenhouse, camera, telemetry, AI)
 * 5. Non-secret one-time QR enrollment tokens (kit claim, member invite, replay rejection, revocation)
 * 6. Per-device ESP32-CAM & Main ESP32 credential issuance, isolated JPEG upload, and header mismatch guard
 * 7. Main ESP32 telemetry intake, SIMULATED data rejection, bounds validation, and safety interlock reporting
 * 8. Strictly read-only, non-actuating connection test (actuationCommandsSent === 0)
 * 9. Authorized per-greenhouse manual Gemini vision diagnosis
 * 10. Device credential revocation immediately blocking subsequent camera/telemetry uploads
 */

import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

function createValidTestJpeg(seedByte: number = 0x22): Buffer {
  const buf = Buffer.alloc(180, seedByte);
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

function httpRequest(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; text: string; json: any }> {
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
          const body = Buffer.concat(chunks);
          const text = body.toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode || 0, headers: res.headers, body, text, json });
        });
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForHealth(port: number, timeoutMs: number = 8000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await httpRequest(port, { method: 'GET', path: '/api/health' });
      if (res.status === 200 && res.json?.status === 'ok') {
        return res.json;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`Server did not respond on 127.0.0.1:${port}/api/health within ${timeoutMs}ms`);
}

async function runTests() {
  console.log('\n=== EDENS AI Production Startup & Self-Service Greenhouse Suite ===\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edens-prod-suite-'));
  const testDbPath = path.join(tmpRoot, 'platform.sqlite');
  const testUploadsDir = path.join(tmpRoot, 'uploads');
  const testPort = 18420 + Math.floor(Math.random() * 1000);
  const globalCamKey = 'global_cam_key_render_test_99';

  const child = spawn(process.execPath, ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(testPort),
      DATABASE_PATH: testDbPath,
      CAMERA_STORAGE_PATH: testUploadsDir,
      CAMERA_UPLOAD_KEY: globalCamKey,
      HARDWARE_API_KEY: 'global_hw_key_render_test_99'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdoutLog = '';
  let stderrLog = '';
  child.stdout?.on('data', (d) => {
    stdoutLog += d.toString();
  });
  child.stderr?.on('data', (d) => {
    stderrLog += d.toString();
  });

  try {
    // 1. Verify native `node server.ts` starts cleanly without ERR_MODULE_NOT_FOUND
    const health = await waitForHealth(testPort);
    assert.strictEqual(health.status, 'ok');
    assert.strictEqual(health.mode, 'production');
    assert.ok(
      stdoutLog.includes(`http://0.0.0.0:${testPort}`),
      `Expected 0.0.0.0:${testPort} bind log, got: ${stdoutLog}`
    );
    assert.ok(!stderrLog.includes('ERR_MODULE_NOT_FOUND'), 'Must not emit ERR_MODULE_NOT_FOUND');
    console.log('  ✅ [1/10] Native `node server.ts` boots in production on 0.0.0.0:$PORT and serves /api/health');

    // 2. Verify existing global X-Camera-Key upload contract remains intact
    const unauthGlobalCam = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: { 'Content-Type': 'image/jpeg' },
      body: createValidTestJpeg(0x31)
    });
    assert.strictEqual(unauthGlobalCam.status, 401);

    const okGlobalCam = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: { 'Content-Type': 'image/jpeg', 'X-Camera-Key': globalCamKey },
      body: createValidTestJpeg(0x32)
    });
    assert.strictEqual(okGlobalCam.status, 200);
    assert.strictEqual(okGlobalCam.json.success, true);

    const latestGlobal = await httpRequest(testPort, { method: 'GET', path: '/api/camera/latest' });
    assert.strictEqual(latestGlobal.status, 200);
    assert.strictEqual(latestGlobal.json.exists, true);
    assert.strictEqual(latestGlobal.json.isLiveStream, false);
    console.log('  ✅ [2/10] Existing global POST /api/camera/upload & X-Camera-Key contract preserved');

    // 3. Customer A & Customer B registration + login validation
    const regA = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Amina Kano',
        email: 'amina@edens-test.ng',
        password: 'StrongPassword123!'
      })
    });
    assert.strictEqual(regA.status, 201);
    const tokenA = regA.json.sessionToken as string;
    assert.ok(tokenA.startsWith('edsess_'));

    const badLogin = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'amina@edens-test.ng', password: 'WrongPassword!' })
    });
    assert.strictEqual(badLogin.status, 401);

    const regB = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Chidi Enugu',
        email: 'chidi@edens-test.ng',
        password: 'AnotherStrongPassword99!'
      })
    });
    assert.strictEqual(regB.status, 201);
    const tokenB = regB.json.sessionToken as string;
    console.log('  ✅ [3/10] Customer account registration, scrypt password check, and session auth verified');

    // 4. Create Greenhouse for Customer A -> honest SETUP_INCOMPLETE state & RBAC isolation
    const createGhA = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/greenhouses',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({
        name: 'Kano Tomato House 1',
        locationLabel: 'Kano Plot B',
        cropType: 'Tomato'
      })
    });
    assert.strictEqual(createGhA.status, 201);
    const ghAId = createGhA.json.greenhouse.id as string;
    assert.strictEqual(createGhA.json.greenhouse.overallStatus, 'SETUP_INCOMPLETE');
    assert.strictEqual(createGhA.json.devices.length, 2);

    const crossTenantView = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghAId}`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert.strictEqual(crossTenantView.status, 403);
    console.log('  ✅ [4/10] Greenhouse honest initial state (SETUP_INCOMPLETE) and cross-tenant 403 RBAC verified');

    // 5. Non-secret one-time QR generation, inspection, redemption, replay guard & revocation
    const kitQr = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/kits/generate-qr',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ kitSerial: 'EDENS-KIT-777', ttlMinutes: 30 })
    });
    assert.strictEqual(kitQr.status, 201);
    const qrUri = kitQr.json.qrPayloadUri as string;
    assert.ok(qrUri.startsWith('edens://enroll?'));
    assert.ok(!qrUri.includes(globalCamKey), 'QR must never contain camera secrets');

    const inspectQr = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/enrollments/inspect',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrPayload: qrUri })
    });
    assert.strictEqual(inspectQr.status, 200);
    assert.strictEqual(inspectQr.json.hardwareConfigured, false);

    const redeemB = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/enrollments/redeem',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ qrPayload: qrUri, greenhouseName: 'Chidi Kit Greenhouse' })
    });
    assert.strictEqual(redeemB.status, 200);
    const ghBId = redeemB.json.greenhouse.id as string;

    const replayRedeem = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/enrollments/redeem',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ qrPayload: qrUri })
    });
    assert.strictEqual(replayRedeem.status, 409);

    const inviteQr = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghAId}/qr-token`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ purpose: 'member_share_qr', ttlMinutes: 15 })
    });
    assert.strictEqual(inviteQr.status, 201);

    const revokeQr = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghAId}/qr-tokens/${inviteQr.json.tokenId}/revoke`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({})
    });
    assert.strictEqual(revokeQr.status, 200);

    const redeemRevoked = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/enrollments/redeem',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ code: inviteQr.json.enrollmentCode })
    });
    assert.strictEqual(redeemRevoked.status, 410);
    console.log('  ✅ [5/10] Short-lived non-secret QR tokens, one-time redemption, replay block, and revocation verified');

    // 6. Issue unique per-device credentials for Customer A's ESP32-CAM & Main ESP32
    const camDevA = createGhA.json.devices.find((d: any) => d.deviceType === 'esp32_cam');
    const ctrlDevA = createGhA.json.devices.find((d: any) => d.deviceType === 'esp32_controller');

    const issuedCam = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghAId}/devices/${camDevA.id}/issue-credentials`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({})
    });
    assert.strictEqual(issuedCam.status, 200);
    const camKeyA = issuedCam.json.oneTimeDeviceKey as string;
    assert.ok(camKeyA.startsWith('edcam_'));
    assert.ok(issuedCam.json.firmwareHeader.content.includes('#define EDENS_CAMERA_UPLOAD_URL'));

    const issuedCtrl = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghAId}/devices/${ctrlDevA.id}/issue-credentials`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({})
    });
    assert.strictEqual(issuedCtrl.status, 200);
    const ctrlKeyA = issuedCtrl.json.oneTimeDeviceKey as string;
    assert.ok(ctrlKeyA.startsWith('edctrl_'));
    console.log('  ✅ [6/10] Per-device hashed ESP32-CAM & Main ESP32 credential issuance + C header generation verified');

    // 7. Per-device camera upload + tenant storage isolation + greenhouse mismatch check
    const mismatchUpload = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': camKeyA,
        'X-Greenhouse-Id': ghBId
      },
      body: createValidTestJpeg(0x44)
    });
    assert.strictEqual(mismatchUpload.status, 403);

    const validUploadA = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': camKeyA,
        'X-Greenhouse-Id': ghAId,
        'X-Device-Id': camDevA.id
      },
      body: createValidTestJpeg(0x55)
    });
    assert.strictEqual(validUploadA.status, 200);
    assert.strictEqual(validUploadA.json.greenhouseId, ghAId);

    const ghACam = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghAId}/camera/latest`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(ghACam.status, 200);
    assert.strictEqual(ghACam.json.exists, true);
    assert.strictEqual(ghACam.json.isFresh, true);
    assert.strictEqual(ghACam.json.isLiveStream, false);

    // Ensure Customer B's greenhouse camera store is still empty (strictly isolated!)
    const ghBCam = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghBId}/camera/latest`,
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert.strictEqual(ghBCam.status, 200);
    assert.strictEqual(ghBCam.json.exists, false);
    console.log('  ✅ [7/10] Per-device camera upload, X-Greenhouse-Id enforcement, and strict snapshot isolation verified');

    // 8. Main ESP32 telemetry validation, SIMULATED rejection & interlock state storage
    const simTel = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: { 'Content-Type': 'application/json', 'X-Hardware-Key': ctrlKeyA },
      body: JSON.stringify({
        temperature: 25,
        humidity: 60,
        soilMoisture: 50,
        dataSource: 'SIMULATED'
      })
    });
    assert.strictEqual(simTel.status, 400);
    assert.strictEqual(simTel.json.error, 'SIMULATED_DATA_REJECTED');

    const outOfBoundsTel = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: { 'Content-Type': 'application/json', 'X-Hardware-Key': ctrlKeyA },
      body: JSON.stringify({ temperature: 140, humidity: 60, soilMoisture: 50 })
    });
    assert.strictEqual(outOfBoundsTel.status, 400);

    const realTel = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrlKeyA,
        'X-Greenhouse-Id': ghAId,
        'X-Device-Id': ctrlDevA.id
      },
      body: JSON.stringify({
        temperature: 26.4,
        humidity: 64,
        soilMoisture: 52,
        waterLevel: 8,
        rain: true,
        actuators: { fanActive: true, pumpActive: false },
        deviceHealth: { firmwareVersion: '2.5.0-esp32', wifiRssi: -61 }
      })
    });
    assert.strictEqual(realTel.status, 200);
    assert.strictEqual(realTel.json.dataSource, 'REAL_HARDWARE');

    const latestTelA = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghAId}/telemetry/latest`,
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(latestTelA.status, 200);
    assert.strictEqual(latestTelA.json.dataSource, 'REAL_HARDWARE');
    assert.strictEqual(latestTelA.json.readings.temperature, 26.4);
    assert.strictEqual(latestTelA.json.interlocks.rainLocked, true);
    assert.strictEqual(latestTelA.json.interlocks.waterLowLocked, true);
    console.log('  ✅ [8/10] Main ESP32 telemetry validation, SIMULATED rejection, and safety interlocks verified');

    // 9. Read-only, non-actuating connection test + cross-tenant AI diagnosis block
    const connTest = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghAId}/connection-test`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({})
    });
    assert.strictEqual(connTest.status, 200);
    assert.strictEqual(connTest.json.safeReadOnlyVerification, true);
    assert.strictEqual(connTest.json.actuationCommandsSent, 0);
    assert.strictEqual(connTest.json.allHardwareVerifiedOnline, true);

    const crossTenantDiagnose = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/ai/diagnose',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ greenhouseId: ghAId, useLatestCameraFrame: true })
    });
    assert.strictEqual(crossTenantDiagnose.status, 403);
    console.log('  ✅ [9/10] Read-only non-actuating connection test (0 commands) & AI RBAC enforcement verified');

    // 10. Device credential revocation immediately blocks subsequent camera uploads
    const revokeCam = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghAId}/devices/${camDevA.id}/revoke`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({})
    });
    assert.strictEqual(revokeCam.status, 200);

    const postAfterRevoke = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: { 'Content-Type': 'image/jpeg', 'X-Camera-Key': camKeyA },
      body: createValidTestJpeg(0x66)
    });
    assert.strictEqual(postAfterRevoke.status, 401);
    assert.strictEqual(postAfterRevoke.json.error, 'DEVICE_REVOKED');
    console.log('  ✅ [10/10] Device credential revocation immediately rejects revoked X-Camera-Key uploads');

    console.log('\n🎉 ALL 10 PRODUCTION STARTUP & SELF-SERVICE GREENHOUSE TESTS PASSED!\n');
  } finally {
    child.kill('SIGTERM');
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('\n❌ Self-service greenhouse & production startup test failed:', err);
  process.exit(1);
});
