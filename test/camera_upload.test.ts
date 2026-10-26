/**
 * EDENS AI - ESP32-CAM Acquisition, Storage & Vision Diagnosis Integration Test Suite
 *
 * Exercises the real production modules:
 * - src/server/cameraStorage.ts (CameraImageStore, extractAndValidateJpeg, classifyCameraFrameFreshness)
 * - src/server/cameraAcquisition.ts (registerCameraRoutes, verifyCameraUploadAuth, validateLanCameraTarget)
 * - src/server/visionDiagnosis.ts (createVisionDiagnosisHandler, validateRasterImageBytes)
 *
 * Covers:
 * 1. Initial disconnected/waiting state (GET /api/camera/latest, GET /api/camera/latest.jpg)
 * 2. Vision diagnosis when no image is available (404 NO_CAMERA_FRAME)
 * 3. X-Camera-Key authentication enforcement, missing/wrong keys, query-param rejection, unconfigured secret
 * 4. Invalid image uploads (empty, non-JPEG, truncated missing EOI, oversized 413)
 * 5. Successful raw binary & multipart JPEG uploads + byte-accurate retrieval + disk persistence
 * 6. Vision diagnosis with genuine fresh JPEG bytes + rejection of SIMULATED images
 * 7. Image freshness aging (FRESH -> CACHED -> STALE) & refusal to diagnose stale/cached frames as live (409)
 * 8. LAN gateway pull sync, physical camera disconnection handling, and cloud private-LAN guard
 */

import assert from 'node:assert';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CameraImageStore } from '../src/server/cameraStorage';
import { registerCameraRoutes } from '../src/server/cameraAcquisition';
import { createVisionDiagnosisHandler, VisionModelInput } from '../src/server/visionDiagnosis';

const TEST_KEY = 'test_secret_cam_key_2026_verified';

function createValidTestJpeg(extraMarkerByte: number = 0x11): Buffer {
  const buf = Buffer.alloc(160, extraMarkerByte);
  // SOI marker (0xFF 0xD8)
  buf[0] = 0xff;
  buf[1] = 0xd8;
  // APP0 JFIF marker (0xFF 0xE0)
  buf[2] = 0xff;
  buf[3] = 0xe0;
  buf[4] = 0x00;
  buf[5] = 0x10;
  buf.write('JFIF\0', 6, 'ascii');
  // EOI marker (0xFF 0xD9)
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
): Promise<{ status: number; headers: http.IncomingHttpHeaders; rawBuffer: Buffer; body: string; json: () => any }> {
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
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            rawBuffer,
            body: text,
            json: () => {
              try {
                return JSON.parse(text);
              } catch (_) {
                return null;
              }
            }
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

async function runTestSuite() {
  console.log('🧪 Starting EDENS AI Camera Acquisition, Freshness & Vision Diagnosis Test Suite...\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edens_cam_suite_'));
  let activeSecret = TEST_KEY;
  let simulateCloudHosted = false;
  let visionCalls: VisionModelInput[] = [];

  const imageStore = new CameraImageStore({
    storageBaseDir: tmpRoot,
    maxUploadBytes: 2 * 1024 * 1024, // 2MB limit for fast oversize verification
    freshMaxSeconds: 90,
    cachedMaxSeconds: 300,
    maxHistoryFiles: 5
  });

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  registerCameraRoutes(app, imageStore, {
    allowLoopbackLanTargets: true,
    getUploadSecret: () => activeSecret,
    isCloudHosted: () => simulateCloudHosted
  });

  app.post(
    '/api/ai/diagnose',
    createVisionDiagnosisHandler({
      imageStore,
      languages: {
        ha: { name: 'Hausa', native: 'Harshen Hausa', region: 'Northern Nigeria' },
        en: { name: 'English', native: 'Nigerian English', region: 'Nigeria' }
      },
      isAiConfigured: () => true,
      runVisionModel: async (input) => {
        visionCalls.push(input);
        return {
          modelUsed: 'gemini-2.5-flash-test-double',
          rawJsonText: JSON.stringify({
            species: 'Solanum lycopersicum (Tomato)',
            speciesLocal: 'Tumatir',
            healthStatus: 'Healthy',
            healthStatusLocal: 'Lafiya kalau',
            symptoms: 'Clean green foliage with turgid stems.',
            cause: 'Balanced greenhouse moisture and light.',
            recommendation: 'Maintain current drip irrigation schedule.',
            audioSummary: 'Shukar tumatir tana cikin koshin lafiya.'
          })
        };
      }
    })
  );

  // Express payload-too-large handler matching server.ts
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) {
      return res.status(413).json({
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Uploaded payload exceeds maximum configured camera size limit.'
      });
    }
    return res.status(500).json({ error: err?.message || 'INTERNAL_ERROR' });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addressInfo = server.address() as { port: number };
  const appPort = addressInfo.port;

  let mockCamServer: http.Server | null = null;
  let passed = 0;

  try {
    // -------------------------------------------------------------------------
    // 1. Initial disconnected state when no camera photograph exists
    // -------------------------------------------------------------------------
    {
      const latestRes = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
      assert.strictEqual(latestRes.status, 200);
      const latestJson = latestRes.json();
      assert.strictEqual(latestJson.exists, false);
      assert.strictEqual(latestJson.connectionState, 'DISCONNECTED');
      assert.strictEqual(latestJson.status, 'WAITING_FOR_UPLOAD');
      assert.strictEqual(latestJson.dataSource, 'DISCONNECTED');
      assert.strictEqual(latestJson.isLiveStream, false);

      const jpgRes = await makeHttpRequest(appPort, 'GET', '/api/camera/latest.jpg');
      assert.strictEqual(jpgRes.status, 404);
      assert.strictEqual(jpgRes.json()?.error, 'NO_FRAME_AVAILABLE');

      const infoRes = await makeHttpRequest(appPort, 'GET', '/api/camera/upload-info');
      assert.strictEqual(infoRes.status, 200);
      assert.strictEqual(infoRes.json()?.authConfigured, true);
      assert.strictEqual(infoRes.json()?.authHeader, 'X-Camera-Key');
      assert.strictEqual(infoRes.body.includes(TEST_KEY), false, 'Secret must never appear in upload-info');
      console.log('  ✅ 1. Initial disconnected state & non-leaky upload-info verified');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 2. Vision diagnosis when NO camera image is available -> 404 NO_CAMERA_FRAME
    // -------------------------------------------------------------------------
    {
      const diagNoImg = await makeHttpRequest(
        appPort,
        'POST',
        '/api/ai/diagnose',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ useLatestCameraFrame: true, requireFresh: true, languageId: 'ha' })
      );
      assert.strictEqual(diagNoImg.status, 404);
      assert.strictEqual(diagNoImg.json()?.error, 'NO_CAMERA_FRAME');
      assert.strictEqual(visionCalls.length, 0, 'Vision model must not run when no image exists');
      console.log('  ✅ 2. Vision diagnosis returns 404 NO_CAMERA_FRAME when no photograph is stored');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 3. Authentication enforcement on POST /api/camera/upload
    // -------------------------------------------------------------------------
    {
      const validJpeg = createValidTestJpeg();

      // Missing auth header
      const noAuth = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        { 'Content-Type': 'image/jpeg' },
        validJpeg
      );
      assert.strictEqual(noAuth.status, 401);
      assert.strictEqual(noAuth.json()?.error, 'UNAUTHORIZED_CAMERA');

      // Wrong X-Camera-Key
      const badAuth = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        { 'Content-Type': 'image/jpeg', 'X-Camera-Key': 'wrong_key_value' },
        validJpeg
      );
      assert.strictEqual(badAuth.status, 401);
      assert.strictEqual(badAuth.json()?.error, 'UNAUTHORIZED_CAMERA');

      // Query string secret rejected to prevent URL/log secret leakage
      const queryAuth = await makeHttpRequest(
        appPort,
        'POST',
        `/api/camera/upload?token=${encodeURIComponent(TEST_KEY)}`,
        { 'Content-Type': 'image/jpeg' },
        validJpeg
      );
      assert.strictEqual(queryAuth.status, 401);
      assert.strictEqual(queryAuth.json()?.error, 'QUERY_AUTH_DISALLOWED');

      // Server unconfigured secret -> 503
      activeSecret = '';
      const unconfigured = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        { 'Content-Type': 'image/jpeg', 'X-Camera-Key': TEST_KEY },
        validJpeg
      );
      assert.strictEqual(unconfigured.status, 503);
      assert.strictEqual(unconfigured.json()?.error, 'SERVER_MISCONFIGURED');
      activeSecret = TEST_KEY;

      console.log('  ✅ 3. X-Camera-Key authentication, query-secret rejection, and unconfigured guard verified');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 4. Invalid & oversized image uploads rejected cleanly
    // -------------------------------------------------------------------------
    {
      // Empty payload
      const emptyRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        { 'Content-Type': 'image/jpeg', 'X-Camera-Key': TEST_KEY },
        Buffer.alloc(0)
      );
      assert.strictEqual(emptyRes.status, 400);

      // Non-JPEG text payload
      const textRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        { 'Content-Type': 'text/plain', 'X-Camera-Key': TEST_KEY },
        Buffer.from('not a real camera photograph payload at all — plain text string padding here!')
      );
      assert.strictEqual(textRes.status, 400);
      assert.strictEqual(textRes.json()?.error, 'INVALID_IMAGE_FORMAT');

      // Truncated JPEG (valid SOI + APP0, but missing closing EOI 0xFF 0xD9)
      const truncated = Buffer.alloc(120, 0x22);
      truncated[0] = 0xff;
      truncated[1] = 0xd8;
      truncated[2] = 0xff;
      truncated[3] = 0xe0;
      const truncRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        { 'Content-Type': 'image/jpeg', 'X-Camera-Key': TEST_KEY },
        truncated
      );
      assert.strictEqual(truncRes.status, 400);
      assert.strictEqual(truncRes.json()?.error, 'INVALID_IMAGE_FORMAT');

      // Oversized payload (> 2MB)
      const hugeBuf = Buffer.alloc(2.4 * 1024 * 1024, 0xff);
      const hugeRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        { 'Content-Type': 'image/jpeg', 'X-Camera-Key': TEST_KEY },
        hugeBuf
      );
      assert.strictEqual(hugeRes.status, 413);
      assert.strictEqual(hugeRes.json()?.error, 'PAYLOAD_TOO_LARGE');

      console.log('  ✅ 4. Empty, non-JPEG, truncated (missing EOI), and oversized (>2MB) uploads rejected');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 5. Successful raw binary & multipart JPEG uploads + retrieval + persistence
    // -------------------------------------------------------------------------
    {
      const rawJpeg = createValidTestJpeg(0x3a);
      const uploadRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        {
          'Content-Type': 'image/jpeg',
          'X-Camera-Key': TEST_KEY,
          'X-Camera-Address': '10.87.237.36'
        },
        rawJpeg
      );
      assert.strictEqual(uploadRes.status, 200);
      const uploadJson = uploadRes.json();
      assert.strictEqual(uploadJson.success, true);
      assert.strictEqual(uploadJson.sizeBytes, rawJpeg.length);

      // Retrieve metadata (must NEVER expose internal LAN IP sent in X-Camera-Address to browser clients)
      const latestMeta = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
      assert.strictEqual(latestMeta.status, 200);
      const metaJson = latestMeta.json();
      assert.strictEqual(metaJson.exists, true);
      assert.strictEqual(metaJson.connectionState, 'CONNECTED');
      assert.strictEqual(metaJson.freshness, 'FRESH');
      assert.strictEqual(metaJson.freshnessState, 'FRESH');
      assert.strictEqual(metaJson.isFresh, true);
      assert.strictEqual(metaJson.isStale, false);
      assert.strictEqual(metaJson.isLiveStream, false);
      assert.strictEqual(metaJson.dataSource, 'REAL_HARDWARE');
      assert.strictEqual(metaJson.cameraAddress, undefined, 'Internal camera LAN address must not be exposed to browsers');
      assert.strictEqual(latestMeta.body.includes('10.87.237.36'), false, 'Private LAN IP must not leak in /api/camera/latest');

      // Retrieve binary JPEG
      const latestBin = await makeHttpRequest(appPort, 'GET', '/api/camera/latest.jpg');
      assert.strictEqual(latestBin.status, 200);
      assert.ok(String(latestBin.headers['content-type']).includes('image/jpeg'));
      assert.strictEqual(Buffer.compare(latestBin.rawBuffer, rawJpeg), 0);

      // Multipart JPEG upload
      const multipartJpeg = createValidTestJpeg(0x4b);
      const boundary = '----EdensEsp32CamBoundary';
      const multipartPayload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        ),
        multipartJpeg,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);
      const mpRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/upload',
        {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'X-Camera-Key': TEST_KEY
        },
        multipartPayload
      );
      assert.strictEqual(mpRes.status, 200);
      assert.strictEqual(mpRes.json()?.sizeBytes, multipartJpeg.length);
      assert.ok(fs.existsSync(path.join(imageStore.getUploadDir(), 'latest.jpg')));
      assert.ok(fs.existsSync(path.join(imageStore.getUploadDir(), 'metadata.json')));

      console.log('  ✅ 5. Raw & multipart JPEG uploads, byte-accurate retrieval, and disk persistence verified');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 6. Vision diagnosis with fresh camera image & rejection of SIMULATED images
    // -------------------------------------------------------------------------
    {
      // Simulated image source must be rejected with 400
      const simDiag = await makeHttpRequest(
        appPort,
        'POST',
        '/api/ai/diagnose',
        { 'Content-Type': 'application/json' },
        JSON.stringify({
          image: `data:image/jpeg;base64,${createValidTestJpeg().toString('base64')}`,
          source: 'SIMULATED',
          languageId: 'ha'
        })
      );
      assert.strictEqual(simDiag.status, 400);
      assert.strictEqual(simDiag.json()?.error, 'SIMULATED_IMAGE_REJECTED');

      // Fresh camera frame diagnosis succeeds and passes genuine JPEG bytes to model runner
      const freshDiag = await makeHttpRequest(
        appPort,
        'POST',
        '/api/ai/diagnose',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ useLatestCameraFrame: true, requireFresh: true, languageId: 'ha' })
      );
      assert.strictEqual(freshDiag.status, 200);
      const diagJson = freshDiag.json();
      assert.strictEqual(diagJson?.result?.speciesLocal, 'Tumatir');
      assert.strictEqual(diagJson?.result?.imageSource, 'ESP32_CAM_FRESH');
      assert.ok(diagJson?.result?.frameId);
      assert.strictEqual(visionCalls.length, 1);
      assert.strictEqual(visionCalls[0].mimeType, 'image/jpeg');

      // Confirm frame was marked analyzed
      const afterDiagMeta = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
      assert.strictEqual(afterDiagMeta.json()?.analyzed, true);

      console.log('  ✅ 6. Fresh ESP32-CAM vision diagnosis & SIMULATED placeholder rejection verified');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 7. Image freshness aging (FRESH -> CACHED -> STALE) & refusal to diagnose old photos as live
    // -------------------------------------------------------------------------
    {
      // Age frame to 150 seconds ago -> CACHED (not fresh, not live)
      const cachedIso = new Date(Date.now() - 150 * 1000).toISOString();
      imageStore.setLatestTimestampForTesting(cachedIso);

      const cachedMeta = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
      assert.strictEqual(cachedMeta.json()?.connectionState, 'DISCONNECTED');
      assert.strictEqual(cachedMeta.json()?.freshness, 'CACHED');
      assert.strictEqual(cachedMeta.json()?.freshnessState, 'STALE');
      assert.strictEqual(cachedMeta.json()?.dataSource, 'CACHED');
      assert.strictEqual(cachedMeta.json()?.isFresh, false);
      assert.strictEqual(cachedMeta.json()?.isLiveStream, false);

      // Vision diagnosis with requireFresh: true must refuse CACHED image with 409
      const cachedDiag = await makeHttpRequest(
        appPort,
        'POST',
        '/api/ai/diagnose',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ useLatestCameraFrame: true, requireFresh: true, languageId: 'ha' })
      );
      assert.strictEqual(cachedDiag.status, 409);
      assert.strictEqual(cachedDiag.json()?.error, 'STALE_CAMERA_FRAME');

      // Age frame to 420 seconds ago -> STALE
      const staleIso = new Date(Date.now() - 420 * 1000).toISOString();
      imageStore.setLatestTimestampForTesting(staleIso);

      const staleMeta = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
      assert.strictEqual(staleMeta.json()?.connectionState, 'DISCONNECTED');
      assert.strictEqual(staleMeta.json()?.freshness, 'STALE');
      assert.strictEqual(staleMeta.json()?.freshnessState, 'STALE');
      assert.strictEqual(staleMeta.json()?.dataSource, 'STALE');
      assert.strictEqual(staleMeta.json()?.isStale, true);
      assert.strictEqual(staleMeta.json()?.isFresh, false);
      assert.strictEqual(staleMeta.json()?.isLiveStream, false);

      const staleDiag = await makeHttpRequest(
        appPort,
        'POST',
        '/api/ai/diagnose',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ useLatestCameraFrame: true, requireFresh: true, languageId: 'ha' })
      );
      assert.strictEqual(staleDiag.status, 409);
      assert.strictEqual(staleDiag.json()?.error, 'STALE_CAMERA_FRAME');
      assert.strictEqual(visionCalls.length, 1, 'Stale/cached frames must not invoke live camera diagnosis');

      console.log('  ✅ 7. Freshness transitions (FRESH -> CACHED -> STALE) & 409 stale-frame diagnosis guard verified');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 8. Local LAN gateway pull sync, camera disconnection, & cloud private-LAN guard
    // -------------------------------------------------------------------------
    {
      const lanPhotoJpeg = createValidTestJpeg(0x6c);
      mockCamServer = http.createServer((req, res) => {
        if (req.url?.startsWith('/photo')) {
          res.writeHead(200, { 'Content-Type': 'image/jpeg' });
          res.end(lanPhotoJpeg);
          return;
        }
        if (req.url?.startsWith('/status')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ framesize: 10, quality: 12, rssi: -58 }));
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise<void>((resolve) => mockCamServer!.listen(0, '127.0.0.1', () => resolve()));
      const mockCamPort = (mockCamServer.address() as { port: number }).port;

      // LAN status probe while camera is online
      const lanOnline = await makeHttpRequest(
        appPort,
        'GET',
        `/api/camera/lan/status?host=127.0.0.1&httpPort=${mockCamPort}`
      );
      assert.strictEqual(lanOnline.status, 200);
      assert.strictEqual(lanOnline.json()?.lanReachable, true);

      // LAN sync pulls a fresh JPEG into CameraImageStore
      const syncRes = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/lan/sync',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ host: '127.0.0.1', httpPort: mockCamPort, photoPath: '/photo' })
      );
      assert.strictEqual(syncRes.status, 200);
      assert.strictEqual(syncRes.json()?.acquisitionMethod, 'LAN_GATEWAY_PULL');

      const freshAfterSync = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
      assert.strictEqual(freshAfterSync.json()?.isFresh, true);
      assert.strictEqual(freshAfterSync.json()?.acquisitionMethod, 'LAN_GATEWAY_PULL');

      // Simulate physical ESP32-CAM disconnection by closing mock camera server
      await new Promise<void>((resolve) => mockCamServer!.close(() => resolve()));
      mockCamServer = null;

      const lanOffline = await makeHttpRequest(
        appPort,
        'GET',
        `/api/camera/lan/status?host=127.0.0.1&httpPort=${mockCamPort}`
      );
      assert.strictEqual(lanOffline.status, 200);
      assert.strictEqual(lanOffline.json()?.lanReachable, false);

      const syncOffline = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/lan/sync',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ host: '127.0.0.1', httpPort: mockCamPort, photoPath: '/photo' })
      );
      assert.strictEqual(syncOffline.status, 502);
      assert.strictEqual(syncOffline.json()?.error, 'CAMERA_LAN_UNREACHABLE');

      // Simulate cloud deployment (Render) attempting to reach private LAN 10.87.237.36 directly
      simulateCloudHosted = true;
      const cloudLanAttempt = await makeHttpRequest(
        appPort,
        'POST',
        '/api/camera/lan/sync',
        { 'Content-Type': 'application/json' },
        JSON.stringify({ host: '10.87.237.36', httpPort: 80, photoPath: '/photo' })
      );
      assert.strictEqual(cloudLanAttempt.status, 503);
      assert.strictEqual(cloudLanAttempt.json()?.error, 'PRIVATE_LAN_UNREACHABLE_FROM_CLOUD');
      simulateCloudHosted = false;

      // Unauthenticated DELETE is blocked; authenticated DELETE clears cache -> DISCONNECTED
      const unauthDelete = await makeHttpRequest(appPort, 'DELETE', '/api/camera/latest');
      assert.strictEqual(unauthDelete.status, 401);

      const clearRes = await makeHttpRequest(appPort, 'DELETE', '/api/camera/latest', {
        'X-Camera-Key': TEST_KEY
      });
      assert.strictEqual(clearRes.status, 200);

      const afterClear = await makeHttpRequest(appPort, 'GET', '/api/camera/latest');
      assert.strictEqual(afterClear.json()?.exists, false);
      assert.strictEqual(afterClear.json()?.dataSource, 'DISCONNECTED');

      console.log('  ✅ 8. LAN gateway pull sync, camera disconnection handling, and cloud private-LAN guard verified');
      passed++;
    }

    // -------------------------------------------------------------------------
    // 9. Public frontend secret/LAN-IP hygiene & ESP32-CAM verified TLS module audit
    // -------------------------------------------------------------------------
    {
      const srcRoot = path.join(process.cwd(), 'src');
      const collectFiles = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const out: string[] = [];
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) out.push(...collectFiles(full));
          else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(full);
        }
        return out;
      };

      const clientFiles = collectFiles(srcRoot).filter((f) => !f.includes(`${path.sep}server${path.sep}`));
      for (const file of clientFiles) {
        const text = fs.readFileSync(file, 'utf8');
        assert.strictEqual(
          text.includes('10.87.237.36'),
          false,
          `Public client file ${path.relative(process.cwd(), file)} must not hardcode private camera LAN IP`
        );
        assert.strictEqual(
          text.includes('setInsecure('),
          false,
          `Public client file ${path.relative(process.cwd(), file)} must not recommend insecure TLS`
        );
      }

      const fwHeaderPath = path.join(process.cwd(), 'firmware', 'esp32_cam_cloud_sync', 'edens_cloud_upload.h');
      assert.ok(fs.existsSync(fwHeaderPath), 'Direct ESP32-CAM cloud upload header must exist');
      const fwCode = fs.readFileSync(fwHeaderPath, 'utf8');
      assert.ok(fwCode.includes('setCACert(EDENS_CLOUD_ROOT_CA_BUNDLE)'), 'Firmware must verify HTTPS Root CA certificate');
      assert.strictEqual(fwCode.includes('secureClient.setInsecure()'), false, 'Firmware must not disable TLS certificate verification');
      assert.ok(fwCode.includes('"X-Camera-Key"'), 'Firmware must authenticate via X-Camera-Key header');

      const gitignoreText = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8');
      assert.ok(gitignoreText.includes('camera_secrets.h'), '.gitignore must protect camera_secrets.h');

      console.log('  ✅ 9. Frontend LAN-IP/secret hygiene & verified Root CA TLS firmware module verified');
      passed++;
    }

    console.log(`\n🎉 All ${passed}/9 Camera Acquisition, Freshness, Vision Diagnosis & Security test groups passed!\n`);
  } finally {
    if (mockCamServer) {
      await new Promise<void>((resolve) => mockCamServer!.close(() => resolve()));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runTestSuite().catch((err) => {
  console.error('❌ Camera integration test suite failed:', err);
  process.exit(1);
});
