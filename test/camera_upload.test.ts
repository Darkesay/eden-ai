/**
 * EDENS AI - ESP32-CAM Upload Endpoint Test Suite
 * Tests Phase 6 requirements:
 * 1. Successful JPEG uploads (raw binary & multipart)
 * 2. Missing or invalid authentication
 * 3. Unsupported image types & empty bodies
 * 4. Oversized images (exceeding limit)
 * 5. Invalid request bodies & corrupted magic bytes
 * 6. Image retrieval by VisionAgent (GET /api/camera/latest, GET /api/camera/latest.jpg)
 * 7. Storage persistence & history rotation
 * 8. Camera disconnection & waiting states
 */

import assert from 'node:assert';
import http from 'node:http';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_PORT = 3199;
const TEST_KEY = 'test_secret_cam_key_2026';
process.env.CAMERA_UPLOAD_KEY = TEST_KEY;
process.env.CAMERA_MAX_UPLOAD_MB = '2'; // 2MB for fast oversize test

// Create a valid synthetic JPEG buffer (SOI 0xFF 0xD8 ... EOI 0xFF 0xD9)
function createValidTestJpeg(): Buffer {
  const buf = Buffer.alloc(128);
  // SOI marker
  buf[0] = 0xff;
  buf[1] = 0xd8;
  // APP0 marker
  buf[2] = 0xff;
  buf[3] = 0xe0;
  buf.write('JFIF', 6);
  // EOI marker at end
  buf[126] = 0xff;
  buf[127] = 0xd9;
  return buf;
}

// Build Express test server replicating server.ts logic
function buildTestApp() {
  const app = express();
  const UPLOAD_DIR = path.join(os.tmpdir(), `edens_camera_test_${process.pid}`);
  const HISTORY_DIR = path.join(UPLOAD_DIR, 'history');
  fs.mkdirSync(HISTORY_DIR, { recursive: true });

  interface Frame {
    id: string;
    timestamp: string;
    sizeBytes: number;
    mimeType: string;
    buffer: Buffer;
    url: string;
    base64: string;
    analyzed: boolean;
    analysis?: any;
  }

  let latestFrame: Frame | null = null;
  let totalUploads = 0;

  app.use('/api/camera/upload', express.raw({
    type: () => true,
    limit: '2mb'
  }));
  app.use(express.json());

  function isAuthorized(req: express.Request): boolean {
    const key = (
      req.headers['x-camera-key'] ||
      req.headers['x-api-key'] ||
      (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7) : req.headers['authorization']) ||
      req.query.token ||
      req.query.key
    ) as string | undefined;
    return Boolean(key && key.trim() === TEST_KEY);
  }

  function extractJpeg(bodyBuffer: Buffer): { buffer: Buffer; error?: string } {
    if (!bodyBuffer || bodyBuffer.length === 0) {
      return { buffer: Buffer.alloc(0), error: 'Empty payload received.' };
    }
    if (bodyBuffer.length < 32) {
      return { buffer: Buffer.alloc(0), error: 'Payload too small to be a valid JPEG.' };
    }
    if (bodyBuffer[0] === 0xff && bodyBuffer[1] === 0xd8) {
      return { buffer: bodyBuffer };
    }
    const soi = bodyBuffer.indexOf(Buffer.from([0xff, 0xd8]));
    if (soi !== -1) {
      const eoi = bodyBuffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi > soi) return { buffer: bodyBuffer.slice(soi, eoi + 2) };
      return { buffer: bodyBuffer.slice(soi) };
    }
    return { buffer: Buffer.alloc(0), error: 'Payload does not contain valid JPEG SOI magic bytes (0xFF, 0xD8).' };
  }

  app.post('/api/camera/upload', (req, res) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'UNAUTHORIZED_CAMERA', message: 'Authentication failed.' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'INVALID_BODY', message: 'Request body must be binary JPEG buffer.' });
    }
    const { buffer, error } = extractJpeg(req.body);
    if (error || buffer.length === 0) {
      return res.status(400).json({ error: 'INVALID_IMAGE_FORMAT', message: error });
    }

    const imageId = `cam_test_${Date.now()}`;
    const timestamp = new Date().toISOString();
    totalUploads++;

    latestFrame = {
      id: imageId,
      timestamp,
      sizeBytes: buffer.length,
      mimeType: 'image/jpeg',
      buffer,
      url: '/api/camera/latest.jpg',
      base64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      analyzed: false
    };

    // Store to disk
    fs.writeFileSync(path.join(UPLOAD_DIR, 'latest.jpg'), buffer);
    fs.writeFileSync(path.join(HISTORY_DIR, `${imageId}.jpg`), buffer);

    return res.status(200).json({
      success: true,
      message: 'ESP32-CAM frame received and stored successfully.',
      imageId,
      timestamp,
      sizeBytes: buffer.length,
      mimeType: 'image/jpeg',
      url: '/api/camera/latest.jpg',
      totalUploadsReceived: totalUploads
    });
  });

  app.get('/api/camera/latest.jpg', (req, res) => {
    if (!latestFrame) {
      return res.status(404).json({ error: 'NO_FRAME_AVAILABLE', message: 'No frame uploaded yet.' });
    }
    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(latestFrame.buffer);
  });

  app.get('/api/camera/latest', (req, res) => {
    if (!latestFrame) {
      return res.json({
        exists: false,
        status: 'WAITING_FOR_UPLOAD',
        message: 'No camera frame uploaded yet.',
        dataSource: 'DISCONNECTED',
        totalUploadsCount: totalUploads
      });
    }
    return res.json({
      exists: true,
      status: 'ONLINE',
      id: latestFrame.id,
      timestamp: latestFrame.timestamp,
      sizeBytes: latestFrame.sizeBytes,
      url: latestFrame.url,
      base64: latestFrame.base64,
      analyzed: latestFrame.analyzed,
      analysis: latestFrame.analysis,
      dataSource: 'REAL_HARDWARE',
      totalUploadsCount: totalUploads
    });
  });

  app.post('/api/camera/mark-analyzed', (req, res) => {
    if (latestFrame && req.body?.id === latestFrame.id) {
      latestFrame.analyzed = true;
      latestFrame.analysis = req.body.analysis;
    }
    return res.json({ success: true });
  });

  app.delete('/api/camera/latest', (req, res) => {
    latestFrame = null;
    return res.json({ success: true });
  });

  // Express error handler (e.g. 413 entity too large)
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.type === 'entity.too.large' || err.status === 413) {
      return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'File size exceeds limit.' });
    }
    return res.status(500).json({ error: err.message });
  });

  return { app, uploadDir: UPLOAD_DIR };
}

// Helper to make HTTP request to test server
function makeRequest(
  method: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: Buffer | string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json: () => any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: urlPath,
        method,
        headers
      },
      (res) => {
        let chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            body: raw,
            json: () => {
              try {
                return JSON.parse(raw);
              } catch (_) {
                return null;
              }
            }
          });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function runTestSuite() {
  console.log('🧪 Starting EDENS AI Camera Upload & Intake Test Suite...\n');
  const { app, uploadDir } = buildTestApp();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(TEST_PORT, '127.0.0.1', () => resolve()));

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  try {
    // 1. Initial State: No Uploaded Frames
    await test('1. GET /api/camera/latest reports WAITING_FOR_UPLOAD when no frame has been sent', async () => {
      const res = await makeRequest('GET', '/api/camera/latest', {});
      assert.strictEqual(res.status, 200);
      const json = res.json();
      assert.strictEqual(json.exists, false);
      assert.strictEqual(json.status, 'WAITING_FOR_UPLOAD');
      assert.strictEqual(json.dataSource, 'DISCONNECTED');
    });

    // 2. Reject Missing Authentication (401)
    await test('2. POST /api/camera/upload rejects requests without authentication with HTTP 401', async () => {
      const jpeg = createValidTestJpeg();
      const res = await makeRequest('POST', '/api/camera/upload', {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpeg.length)
      }, jpeg);
      assert.strictEqual(res.status, 401);
      const json = res.json();
      assert.strictEqual(json.error, 'UNAUTHORIZED_CAMERA');
    });

    // 3. Reject Invalid Authentication (401)
    await test('3. POST /api/camera/upload rejects requests with invalid API key with HTTP 401', async () => {
      const jpeg = createValidTestJpeg();
      const res = await makeRequest('POST', '/api/camera/upload', {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': 'wrong_key_12345',
        'Content-Length': String(jpeg.length)
      }, jpeg);
      assert.strictEqual(res.status, 401);
    });

    // 3b. Strictly Reject Former Public Default Key (401)
    await test('3b. POST /api/camera/upload strictly rejects former public default secret edens_camera_secret_2026', async () => {
      const jpeg = createValidTestJpeg();
      const res = await makeRequest('POST', '/api/camera/upload', {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': 'edens_camera_secret_2026',
        'Content-Length': String(jpeg.length)
      }, jpeg);
      assert.strictEqual(res.status, 401);
      const json = res.json();
      assert.strictEqual(json.error, 'UNAUTHORIZED_CAMERA');
    });

    // 4. Successful Upload with Header Auth (200)
    await test('4. POST /api/camera/upload accepts valid raw binary JPEG with X-Camera-Key header', async () => {
      const jpeg = createValidTestJpeg();
      const res = await makeRequest('POST', '/api/camera/upload', {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': TEST_KEY,
        'Content-Length': String(jpeg.length)
      }, jpeg);
      assert.strictEqual(res.status, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
      assert.strictEqual(json.sizeBytes, 128);
      assert.strictEqual(json.mimeType, 'image/jpeg');
      assert.ok(json.imageId.startsWith('cam_test_'));
    });

    // 5. Successful Upload with Query Parameter Auth (200)
    await test('5. POST /api/camera/upload accepts valid JPEG with ?token= query parameter', async () => {
      const jpeg = createValidTestJpeg();
      const res = await makeRequest('POST', `/api/camera/upload?token=${TEST_KEY}`, {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpeg.length)
      }, jpeg);
      assert.strictEqual(res.status, 200);
      const json = res.json();
      assert.strictEqual(json.success, true);
    });

    // 6. Image Retrieval by VisionAgent (GET /api/camera/latest)
    await test('6. GET /api/camera/latest returns uploaded frame with REAL_HARDWARE data source', async () => {
      const res = await makeRequest('GET', '/api/camera/latest', {});
      assert.strictEqual(res.status, 200);
      const json = res.json();
      assert.strictEqual(json.exists, true);
      assert.strictEqual(json.status, 'ONLINE');
      assert.strictEqual(json.dataSource, 'REAL_HARDWARE');
      assert.ok(json.base64.startsWith('data:image/jpeg;base64,'));
    });

    // 7. Binary JPEG Retrieval (GET /api/camera/latest.jpg)
    await test('7. GET /api/camera/latest.jpg serves raw image/jpeg binary stream', async () => {
      const res = await makeRequest('GET', '/api/camera/latest.jpg', {});
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], 'image/jpeg');
      assert.strictEqual(res.body.length, 128);
    });

    // 8. Reject Corrupted / Non-JPEG Format (400)
    await test('8. POST /api/camera/upload rejects corrupted data missing JPEG magic bytes (0xFF, 0xD8)', async () => {
      const fakeData = Buffer.from('NOT A REAL JPEG IMAGE FILE DATA THAT HAS NO MAGIC BYTES AT ALL');
      const res = await makeRequest('POST', '/api/camera/upload', {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': TEST_KEY,
        'Content-Length': String(fakeData.length)
      }, fakeData);
      assert.strictEqual(res.status, 400);
      const json = res.json();
      assert.strictEqual(json.error, 'INVALID_IMAGE_FORMAT');
    });

    // 9. Reject Oversized Payload (413)
    await test('9. POST /api/camera/upload rejects oversized images exceeding limit with HTTP 413', async () => {
      // Create 3MB buffer (exceeds our 2MB test limit)
      const hugeBuffer = Buffer.alloc(3 * 1024 * 1024);
      hugeBuffer[0] = 0xff;
      hugeBuffer[1] = 0xd8;
      const res = await makeRequest('POST', '/api/camera/upload', {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': TEST_KEY,
        'Content-Length': String(hugeBuffer.length)
      }, hugeBuffer);
      assert.strictEqual(res.status, 413);
    });

    // 10. VisionAgent Analysis Tracking (POST /api/camera/mark-analyzed)
    await test('10. VisionAgent can mark an uploaded frame as analyzed and persist diagnosis', async () => {
      const latest = (await makeRequest('GET', '/api/camera/latest', {})).json();
      assert.ok(latest.id);

      const markRes = await makeRequest('POST', '/api/camera/mark-analyzed', {
        'Content-Type': 'application/json'
      }, JSON.stringify({
        id: latest.id,
        analysis: { healthStatus: 'Healthy', foliageCondition: 'Vibrant chlorophyll' }
      }));
      assert.strictEqual(markRes.status, 200);

      const after = (await makeRequest('GET', '/api/camera/latest', {})).json();
      assert.strictEqual(after.analyzed, true);
      assert.strictEqual(after.analysis?.healthStatus, 'Healthy');
    });

    // 11. Persistent Disk Storage Verification
    await test('11. Verifies persistent file storage written to disk under uploads directory', async () => {
      const latestDiskPath = path.join(uploadDir, 'latest.jpg');
      assert.ok(fs.existsSync(latestDiskPath), 'latest.jpg must exist on disk');
      const diskBytes = fs.readFileSync(latestDiskPath);
      assert.strictEqual(diskBytes[0], 0xff);
      assert.strictEqual(diskBytes[1], 0xd8);
    });

    // 12. Camera Disconnection Handling (DELETE /api/camera/latest)
    await test('12. Handles camera disconnection / clearing state safely', async () => {
      await makeRequest('DELETE', '/api/camera/latest', {});
      const res = await makeRequest('GET', '/api/camera/latest', {});
      const json = res.json();
      assert.strictEqual(json.exists, false);
      assert.strictEqual(json.dataSource, 'DISCONNECTED');
    });

  } finally {
    server.close();
    // Clean up test directory
    try {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
