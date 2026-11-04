/**
 * EDENS AI — Phase 2 Automated Verification Suite
 * Plug-and-Play Hardware Provisioning, Multi-Zone & 1-to-N Multi-Device Lifecycle,
 * Credential Rotation, Atomic Faulty Board Replacement, Guest Lockout & Firmware Security
 */

import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

function createValidTestJpeg(seedByte: number = 0x33): Buffer {
  const buf = Buffer.alloc(192, seedByte);
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

function stripCppComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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

async function waitForHealth(port: number, timeoutMs: number = 9000): Promise<any> {
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

async function runPhase2Verification() {
  console.log('\n=== EDENS AI Phase 2: Plug-and-Play Provisioning & Multi-Device Lifecycle Suite ===\n');

  // ---------------------------------------------------------------------------
  // 1. Static Firmware Security & Plug-and-Play Architecture Audit
  // ---------------------------------------------------------------------------
  const pnpHeaderPath = path.resolve(process.cwd(), 'firmware/EDENS_HARDWARE_KIT/edens_pnp_provisioning.h');
  const ctrlHeaderPath = path.resolve(
    process.cwd(),
    'firmware/EDENS_HARDWARE_KIT/esp32_controller_adapter/edens_controller_sync.h'
  );
  const camHeaderPath = path.resolve(process.cwd(), 'firmware/esp32_cam_cloud_sync/edens_cloud_upload.h');

  assert.ok(fs.existsSync(pnpHeaderPath), 'edens_pnp_provisioning.h must exist');
  const pnpCode = stripCppComments(fs.readFileSync(pnpHeaderPath, 'utf8'));
  const ctrlCode = stripCppComments(fs.readFileSync(ctrlHeaderPath, 'utf8'));
  const camCode = stripCppComments(fs.readFileSync(camHeaderPath, 'utf8'));

  assert.ok(pnpCode.includes('Preferences'), 'Provisioning module must persist credentials in ESP32 NVS Preferences');
  assert.ok(pnpCode.includes('EDENS-SETUP-'), 'Provisioning module must expose EDENS-SETUP-XXXX SoftAP');
  assert.ok(pnpCode.includes('/api/devices/bootstrap'), 'Provisioning module must exchange token via /api/devices/bootstrap');
  assert.ok(pnpCode.includes('setCACert('), 'Provisioning bootstrap must enforce Root CA X.509 verification');
  assert.strictEqual(pnpCode.includes('setInsecure('), false, 'Provisioning module must NEVER call setInsecure()');
  assert.strictEqual(ctrlCode.includes('setInsecure('), false, 'Controller sync must NEVER call setInsecure()');
  assert.strictEqual(camCode.includes('setInsecure('), false, 'Camera upload must NEVER call setInsecure()');
  assert.ok(ctrlCode.includes('edensEnforceLocalSafetyInterlocks'), 'Controller sync must preserve local hardware interlocks');
  assert.ok(camCode.includes('X-Firmware-Version'), 'ESP32-CAM uploader must report X-Firmware-Version header');
  console.log('✓ 1. Firmware NVS + SoftAP + Verified-TLS Bootstrap & Safety Interlocks verified');

  // ---------------------------------------------------------------------------
  // 2. Boot Isolated Production Server Instance
  // ---------------------------------------------------------------------------
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edens-phase2-suite-'));
  const testDbPath = path.join(tmpRoot, 'phase2.sqlite');
  const testUploadsDir = path.join(tmpRoot, 'uploads');
  const testPort = 19500 + Math.floor(Math.random() * 900);

  const child = spawn(process.execPath, ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(testPort),
      DATABASE_PATH: testDbPath,
      CAMERA_STORAGE_PATH: testUploadsDir,
      CAMERA_UPLOAD_KEY: 'global_cam_phase2_secret_key_88',
      HARDWARE_API_KEY: 'global_hw_phase2_secret_key_99'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderrLog = '';
  child.stderr?.on('data', (d) => {
    stderrLog += d.toString();
  });

  try {
    await waitForHealth(testPort);

    // Register Farmer A & Farmer B
    const regA = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Chidi Okafor',
        email: 'chidi@edens-phase2.ng',
        password: 'StrongFarmerPassword!2026'
      })
    });
    assert.strictEqual(regA.status, 201);
    const tokenA = regA.json.sessionToken as string;
    const authA = { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' };

    const regB = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/register',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Zainab Bello',
        email: 'zainab@edens-phase2.ng',
        password: 'StrongFarmerPassword!2026'
      })
    });
    assert.strictEqual(regB.status, 201);
    const tokenB = regB.json.sessionToken as string;
    const authB = { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' };

    // -------------------------------------------------------------------------
    // 3. Create Greenhouse & Multi-Zone Management
    // -------------------------------------------------------------------------
    const createGh = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/greenhouses',
      headers: authA,
      body: JSON.stringify({
        name: 'Enugu Commercial Tunnel',
        locationLabel: 'Nsukka Sector 2',
        cropType: 'Tomato',
        wifiProvisioningMethod: 'softap_portal_pending'
      })
    });
    assert.strictEqual(createGh.status, 201);
    const ghId = createGh.json.greenhouse.id as string;
    assert.strictEqual(createGh.json.devices.length, 2);

    const listZonesInitial = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}/zones`,
      headers: authA
    });
    assert.strictEqual(listZonesInitial.status, 200);
    assert.strictEqual(listZonesInitial.json.zones.length, 1, 'Default Main Growing Zone must be provisioned');
    const mainZoneId = listZonesInitial.json.zones[0].id as string;

    const addZoneRes = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/zones`,
      headers: authA,
      body: JSON.stringify({
        name: 'Nursery Bay B',
        cropType: 'Bell Pepper',
        cropVariety: 'California Wonder',
        growthStage: 'seedling',
        areaSqMeters: 48
      })
    });
    assert.strictEqual(addZoneRes.status, 201);
    const nurseryZoneId = addZoneRes.json.zone.id as string;

    const patchZoneRes = await httpRequest(testPort, {
      method: 'PATCH',
      path: `/api/greenhouses/${ghId}/zones/${nurseryZoneId}`,
      headers: authA,
      body: JSON.stringify({ growthStage: 'vegetative' })
    });
    assert.strictEqual(patchZoneRes.status, 200);
    assert.strictEqual(patchZoneRes.json.zone.growthStage, 'vegetative');

    // Cross-zone / invalid zoneId validation
    const badZoneDev = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices`,
      headers: authA,
      body: JSON.stringify({
        deviceType: 'esp32_controller',
        label: 'Invalid Zone Board',
        zoneId: 'zone_nonexistent_999',
        createAdditionalSlot: true
      })
    });
    assert.strictEqual(badZoneDev.status, 400);
    assert.strictEqual(badZoneDev.json.error, 'INVALID_ZONE_ID');
    console.log('✓ 2. Multi-Zone CRUD (Main Growing Zone + Nursery Bay B) & zone validation passed');

    // -------------------------------------------------------------------------
    // 4. Plug-and-Play Targeted Bootstrap Token & SoftAP Cloud Exchange
    // -------------------------------------------------------------------------
    const mainCtrl = createGh.json.devices.find((d: any) => d.deviceType === 'esp32_controller');
    const mainCam = createGh.json.devices.find((d: any) => d.deviceType === 'esp32_cam');
    assert.ok(mainCtrl && mainCam);

    const bootTokenCtrlRes = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices/${mainCtrl.id}/bootstrap-token`,
      headers: authA,
      body: JSON.stringify({ ttlMinutes: 30 })
    });
    assert.strictEqual(bootTokenCtrlRes.status, 201);
    const ctrlBootstrapCode = bootTokenCtrlRes.json.enrollmentCode as string;
    assert.ok(ctrlBootstrapCode.startsWith('enr_'));
    assert.ok(bootTokenCtrlRes.json.qrDataUrl.startsWith('data:image/png;base64,'));
    assert.strictEqual(
      bootTokenCtrlRes.json.enrollmentUri.includes('edctrl_'),
      false,
      'Enrollment URI must NEVER contain plaintext device keys'
    );

    // Wrong deviceType must be rejected without burning the token
    const wrongTypeBootstrap = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/devices/bootstrap',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bootstrapToken: ctrlBootstrapCode,
        deviceType: 'esp32_cam',
        firmwareVersion: 'EDENS-ESP32-CAM-v2.6-pnp'
      })
    });
    assert.strictEqual(wrongTypeBootstrap.status, 400);
    assert.strictEqual(wrongTypeBootstrap.json.error, 'WRONG_DEVICE_TYPE_FOR_TOKEN');

    // Valid Plug-and-Play bootstrap from Main ESP32 Controller
    const okCtrlBootstrap = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/devices/bootstrap',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bootstrapToken: ctrlBootstrapCode,
        deviceType: 'esp32_controller',
        firmwareVersion: 'EDENS-ESP32-CTRL-v2.6-pnp',
        hardwareIdentityUid: 'ESP32-A1B2C3D4E5F6',
        macAddress: '24:6F:28:AA:11:01',
        serialNumber: 'SN-CTRL-001',
        capabilities: [
          { capabilityType: 'sensor', capabilityKey: 'temperature', unit: 'C' },
          { capabilityType: 'sensor', capabilityKey: 'soil_moisture', unit: '%' },
          {
            capabilityType: 'actuator',
            capabilityKey: 'pump',
            safetyLimits: { maxContinuousSec: 120, minWaterPct: 10 }
          }
        ]
      })
    });
    assert.strictEqual(okCtrlBootstrap.status, 200);
    assert.strictEqual(okCtrlBootstrap.json.deviceId, mainCtrl.id);
    assert.strictEqual(okCtrlBootstrap.json.greenhouseId, ghId);
    const ctrl1Key = okCtrlBootstrap.json.deviceKey as string;
    assert.ok(ctrl1Key.startsWith('edctrl_'));

    // Replaying consumed bootstrap token must fail with 409
    const replayBootstrap = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/devices/bootstrap',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bootstrapToken: ctrlBootstrapCode,
        deviceType: 'esp32_controller'
      })
    });
    assert.strictEqual(replayBootstrap.status, 409);
    assert.strictEqual(replayBootstrap.json.error, 'QR_TOKEN_ALREADY_USED');
    console.log('✓ 3. Plug-and-Play SoftAP Bootstrap exchange, wrong-type guard & replay rejection passed');

    // -------------------------------------------------------------------------
    // 5. 1-to-N Multi-Device Registration & Zone-Isolated Telemetry Routing
    // -------------------------------------------------------------------------
    const addNurseryCtrl = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices`,
      headers: authA,
      body: JSON.stringify({
        deviceType: 'esp32_controller',
        label: 'Nursery Bay B Controller',
        zoneId: nurseryZoneId,
        createAdditionalSlot: true
      })
    });
    assert.strictEqual(addNurseryCtrl.status, 201);
    const nurseryCtrlId = addNurseryCtrl.json.device.id as string;
    assert.notStrictEqual(nurseryCtrlId, mainCtrl.id, '1-to-N registration must create distinct device ID');

    const nurseryBootTokenRes = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices/${nurseryCtrlId}/bootstrap-token`,
      headers: authA,
      body: JSON.stringify({ ttlMinutes: 30 })
    });
    assert.strictEqual(nurseryBootTokenRes.status, 201);

    const nurseryCtrlBoot = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/devices/bootstrap',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bootstrapToken: nurseryBootTokenRes.json.enrollmentCode,
        deviceType: 'esp32_controller',
        firmwareVersion: 'EDENS-ESP32-CTRL-v2.6-pnp',
        hardwareIdentityUid: 'ESP32-NURSERY-0002',
        macAddress: '24:6F:28:AA:11:02'
      })
    });
    assert.strictEqual(nurseryCtrlBoot.status, 200);
    assert.strictEqual(nurseryCtrlBoot.json.deviceId, nurseryCtrlId);
    assert.strictEqual(nurseryCtrlBoot.json.zoneId, nurseryZoneId);
    const ctrl2Key = nurseryCtrlBoot.json.deviceKey as string;

    // Bootstrap ESP32-CAM in Main Zone and upload JPEG with X-Firmware-Version
    const camBootTokenRes = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices/${mainCam.id}/bootstrap-token`,
      headers: authA,
      body: JSON.stringify({ ttlMinutes: 30 })
    });
    const camBoot = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/devices/bootstrap',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bootstrapToken: camBootTokenRes.json.enrollmentCode,
        deviceType: 'esp32_cam',
        firmwareVersion: 'EDENS-ESP32-CAM-v2.6-pnp',
        hardwareIdentityUid: 'ESP32-CAM-9901',
        capabilities: [{ capabilityType: 'camera', capabilityKey: 'rgb_snapshot', unit: 'jpeg' }]
      })
    });
    assert.strictEqual(camBoot.status, 200);
    const cam1Key = camBoot.json.deviceKey as string;
    assert.ok(cam1Key.startsWith('edcam_'));

    const camUpload = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/camera/upload',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': cam1Key,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': mainCam.id,
        'X-Firmware-Version': 'EDENS-ESP32-CAM-v2.6-pnp'
      },
      body: createValidTestJpeg(0x41)
    });
    assert.strictEqual(camUpload.status, 200);

    // Upload distinct telemetry from Main Zone Controller (23.2°C) and Nursery Controller (28.6°C)
    const upMain = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrl1Key,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': mainCtrl.id
      },
      body: JSON.stringify({
        firmwareVersion: 'EDENS-ESP32-CTRL-v2.6-pnp',
        telemetry: { temperature: 23.2, humidity: 64, soilMoisture: 54, waterLevel: 82, rain: false }
      })
    });
    assert.strictEqual(upMain.status, 200);
    assert.strictEqual(upMain.json.zoneId, mainZoneId);

    const upNursery = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrl2Key,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': nurseryCtrlId
      },
      body: JSON.stringify({
        firmwareVersion: 'EDENS-ESP32-CTRL-v2.6-pnp',
        telemetry: { temperature: 28.6, humidity: 71, soilMoisture: 60, waterLevel: 79, rain: false }
      })
    });
    assert.strictEqual(upNursery.status, 200);
    assert.strictEqual(upNursery.json.zoneId, nurseryZoneId);

    // Query zone-filtered & device-filtered telemetry
    const telMainZone = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}/telemetry/latest?zoneId=${mainZoneId}`,
      headers: authA
    });
    assert.strictEqual(telMainZone.status, 200);
    assert.strictEqual(telMainZone.json.readings.temperature, 23.2);

    const telNurseryZone = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}/telemetry/latest?zoneId=${nurseryZoneId}`,
      headers: authA
    });
    assert.strictEqual(telNurseryZone.status, 200);
    assert.strictEqual(telNurseryZone.json.readings.temperature, 28.6);

    const connCheck = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/connection-test`,
      headers: authA,
      body: JSON.stringify({})
    });
    assert.strictEqual(connCheck.status, 200);
    assert.strictEqual(connCheck.json.actuationCommandsSent, 0, 'Connection test must send 0 actuation commands');
    assert.strictEqual(connCheck.json.allHardwareVerifiedOnline, true);
    assert.strictEqual(connCheck.json.deviceChecks.length, 3);
    console.log('✓ 4. 1-to-N multi-device registration, per-zone telemetry isolation & safe connection check passed');

    // -------------------------------------------------------------------------
    // 6. Credential Rotation & Diagnostics + OTA Target Readiness
    // -------------------------------------------------------------------------
    const diagRes = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}/devices/${mainCtrl.id}/diagnostics`,
      headers: authA
    });
    assert.strictEqual(diagRes.status, 200);
    assert.strictEqual(diagRes.json.device.hardwareIdentityUid, 'ESP32-A1B2C3D4E5F6');
    assert.strictEqual(diagRes.json.capabilities.length, 3);
    assert.ok(diagRes.json.firmwareHistory.length >= 1);

    const stageOta = await httpRequest(testPort, {
      method: 'PATCH',
      path: `/api/greenhouses/${ghId}/devices/${mainCtrl.id}/firmware-target`,
      headers: authA,
      body: JSON.stringify({ targetFirmwareVersion: 'EDENS-ESP32-CTRL-v2.7-ota' })
    });
    assert.strictEqual(stageOta.status, 200);
    assert.strictEqual(stageOta.json.otaStatus, 'staged');

    const rotateRes = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices/${mainCtrl.id}/issue-credentials`,
      headers: authA,
      body: JSON.stringify({})
    });
    assert.strictEqual(rotateRes.status, 200);
    const rotatedCtrl1Key = rotateRes.json.oneTimeDeviceKey as string;
    assert.notStrictEqual(rotatedCtrl1Key, ctrl1Key);
    assert.ok(rotateRes.json.device.credentialRotatedAt, 'credentialRotatedAt must be recorded');

    // Old key must immediately fail with 401
    const oldKeyAttempt = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': ctrl1Key,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': mainCtrl.id
      },
      body: JSON.stringify({ telemetry: { temperature: 24.0, humidity: 60, soilMoisture: 50 } })
    });
    assert.strictEqual(oldKeyAttempt.status, 401);

    // Rotated key must succeed immediately
    const rotatedKeyAttempt = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': rotatedCtrl1Key,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': mainCtrl.id
      },
      body: JSON.stringify({ telemetry: { temperature: 24.1, humidity: 61, soilMoisture: 52 } })
    });
    assert.strictEqual(rotatedKeyAttempt.status, 200);
    console.log('✓ 5. Credential rotation, immediate old-key invalidation, capabilities & OTA staging passed');

    // -------------------------------------------------------------------------
    // 7. Atomic Faulty Hardware Replacement (Preserving Historical Telemetry)
    // -------------------------------------------------------------------------
    const replaceRes = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${ghId}/devices/${mainCtrl.id}/replace`,
      headers: authA,
      body: JSON.stringify({
        newLabel: 'Main Zone ESP32 Controller (Gen 2 Replacement)',
        reason: 'Voltage spike damaged I2C bus',
        issueBootstrapToken: true
      })
    });
    assert.strictEqual(replaceRes.status, 201);
    assert.strictEqual(
      replaceRes.json.preservedTelemetryCount,
      2,
      `Expected 2 preserved telemetry readings for mainCtrl, got ${replaceRes.json.preservedTelemetryCount}`
    );
    const replacementDevice = replaceRes.json.replacementDevice;
    assert.strictEqual(replacementDevice.zoneId, mainZoneId);
    assert.strictEqual(replaceRes.json.retiredDevice.replacedByDeviceId, replacementDevice.id);
    assert.ok(replaceRes.json.bootstrapToken?.enrollmentCode?.startsWith('enr_'));

    // Retired board's key must be blocked immediately
    const retiredUploadAttempt = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': rotatedCtrl1Key,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': mainCtrl.id
      },
      body: JSON.stringify({ telemetry: { temperature: 25.0, humidity: 60, soilMoisture: 50 } })
    });
    assert.strictEqual(retiredUploadAttempt.status, 401);

    // Bootstrap the replacement controller and confirm Main Zone telemetry updates cleanly
    const replacementBoot = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/devices/bootstrap',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bootstrapToken: replaceRes.json.bootstrapToken.enrollmentCode,
        deviceType: 'esp32_controller',
        firmwareVersion: 'EDENS-ESP32-CTRL-v2.6-pnp',
        hardwareIdentityUid: 'ESP32-REPLACEMENT-777'
      })
    });
    assert.strictEqual(replacementBoot.status, 200);
    assert.strictEqual(replacementBoot.json.deviceId, replacementDevice.id);

    const replacementUpload = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/telemetry/upload',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': replacementBoot.json.deviceKey,
        'X-Greenhouse-Id': ghId,
        'X-Device-Id': replacementDevice.id
      },
      body: JSON.stringify({ telemetry: { temperature: 23.8, humidity: 63, soilMoisture: 55 } })
    });
    assert.strictEqual(replacementUpload.status, 200);

    // Confirm capabilities were copied to replacement controller
    const replacementDiag = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}/devices/${replacementDevice.id}/diagnostics`,
      headers: authA
    });
    assert.strictEqual(replacementDiag.status, 200);
    assert.strictEqual(replacementDiag.json.capabilities.length, 3);
    console.log('✓ 6. Atomic faulty board replacement, history preservation & replacement bootstrap passed');

    // -------------------------------------------------------------------------
    // 8. Guest Account Strict Hardware Lockout & Cross-Tenant RBAC
    // -------------------------------------------------------------------------
    const guestLogin = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/guest',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(guestLogin.status, 201);
    assert.strictEqual(guestLogin.json.user.isGuest, true);
    const guestAuth = {
      Authorization: `Bearer ${guestLogin.json.sessionToken}`,
      'Content-Type': 'application/json'
    };

    const guestGh = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/greenhouses',
      headers: guestAuth,
      body: JSON.stringify({ name: 'Guest Sandbox Tunnel', cropType: 'Lettuce' })
    });
    assert.strictEqual(guestGh.status, 201);
    const guestGhId = guestGh.json.greenhouse.id as string;
    const guestCtrlId = guestGh.json.devices[0].id as string;

    const guestBootBlocked = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${guestGhId}/devices/${guestCtrlId}/bootstrap-token`,
      headers: guestAuth,
      body: JSON.stringify({})
    });
    assert.strictEqual(guestBootBlocked.status, 403);
    assert.strictEqual(guestBootBlocked.json.error, 'GUEST_HARDWARE_CONTROL_FORBIDDEN');

    const guestKeyBlocked = await httpRequest(testPort, {
      method: 'POST',
      path: `/api/greenhouses/${guestGhId}/devices/${guestCtrlId}/issue-credentials`,
      headers: guestAuth,
      body: JSON.stringify({})
    });
    assert.strictEqual(guestKeyBlocked.status, 403);
    assert.strictEqual(guestKeyBlocked.json.error, 'GUEST_HARDWARE_CONTROL_FORBIDDEN');

    const guestKitBlocked = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/kits/generate-qr',
      headers: guestAuth,
      body: JSON.stringify({ kitSerial: 'GUEST-KIT-1' })
    });
    assert.strictEqual(guestKitBlocked.status, 403);
    assert.strictEqual(guestKitBlocked.json.error, 'GUEST_HARDWARE_CONTROL_FORBIDDEN');

    const guestActuationBlocked = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/hardware',
      headers: guestAuth,
      body: JSON.stringify({ action: 'override', params: { device: 'pump', state: 'on', duration: 15 } })
    });
    assert.strictEqual(guestActuationBlocked.status, 403);

    // Cross-tenant Farmer B isolation check
    const crossTenantZones = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}/zones`,
      headers: authB
    });
    assert.strictEqual(crossTenantZones.status, 403);

    const crossTenantDiag = await httpRequest(testPort, {
      method: 'GET',
      path: `/api/greenhouses/${ghId}/devices/${replacementDevice.id}/diagnostics`,
      headers: authB
    });
    assert.strictEqual(crossTenantDiag.status, 403);
    console.log('✓ 7. Guest account hardware lockout (403 GUEST_HARDWARE_CONTROL_FORBIDDEN) & cross-tenant RBAC passed');

    console.log('\nALL PHASE 2 PROVISIONING & MULTI-DEVICE LIFECYCLE TESTS PASSED (0 Physical Actuations Sent).\n');
  } catch (err) {
    console.error('\nPhase 2 test failure stderr output:\n', stderrLog);
    throw err;
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 250));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runPhase2Verification().catch((err) => {
  console.error(err);
  process.exit(1);
});
