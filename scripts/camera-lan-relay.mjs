#!/usr/bin/env node
/**
 * EDENS AI — Local Greenhouse ESP32-CAM -> Cloud Relay Gateway
 *
 * Optional local diagnostic bridge (NOT required in production when ESP32-CAM runs
 * firmware/esp32_cam_cloud_sync/edens_cloud_upload.h direct HTTPS upload).
 *
 * Usage for local bench diagnostics:
 *   CAMERA_LAN_HOST="<camera-lan-ip>" CAMERA_UPLOAD_KEY="<your_secret>" npm run camera:relay
 */

const cameraHost = (process.env.CAMERA_LAN_HOST || process.env.HARDWARE_CAMERA_HOST || '').trim();
const cameraHttpPort = parseInt(process.env.CAMERA_HTTP_PORT || process.env.HARDWARE_CAMERA_HTTP_PORT || '80', 10);
const photoPath = (process.env.CAMERA_PHOTO_PATH || '/photo').trim();
const statusPath = (process.env.CAMERA_STATUS_PATH || '/status').trim();
const backendBase = (process.env.EDENS_BACKEND_URL || 'https://edens-ai.onrender.com').trim().replace(/\/$/, '');
const uploadKey = (process.env.CAMERA_UPLOAD_KEY || '').trim();
const intervalMs = Math.max(4000, parseInt(process.env.CAMERA_RELAY_INTERVAL_MS || '15000', 10));

if (!cameraHost) {
  console.error('[EDENS Camera Relay] ERROR: CAMERA_LAN_HOST environment variable is required for local LAN relay diagnostics.');
  process.exit(1);
}

if (!uploadKey || uploadKey === 'change_this_to_a_secure_camera_secret') {
  console.error('[EDENS Camera Relay] ERROR: CAMERA_UPLOAD_KEY environment variable is required.');
  console.error('Set CAMERA_UPLOAD_KEY to match the Render backend environment variable and re-run.');
  process.exit(1);
}

const cameraOrigin =
  cameraHttpPort === 80 ? `http://${cameraHost}` : `http://${cameraHost}:${cameraHttpPort}`;
const photoUrl = `${cameraOrigin}${photoPath.startsWith('/') ? photoPath : `/${photoPath}`}`;
const statusUrl = `${cameraOrigin}${statusPath.startsWith('/') ? statusPath : `/${statusPath}`}`;
const uploadUrl = `${backendBase}/api/camera/upload`;

console.log('==============================================================');
console.log(' EDENS AI — Local Greenhouse ESP32-CAM Relay Gateway');
console.log(` Camera LAN Photo : ${photoUrl}`);
console.log(` Camera LAN Status: ${statusUrl}`);
console.log(` Cloud Intake URL : ${uploadUrl}`);
console.log(` Sync Interval    : ${intervalMs} ms`);
console.log(' Auth Header      : X-Camera-Key (configured, value redacted)');
console.log('==============================================================');

let consecutiveFailures = 0;
let shuttingDown = false;

process.on('SIGINT', () => {
  shuttingDown = true;
  console.log('\n[EDENS Camera Relay] Shutting down cleanly.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  shuttingDown = true;
  process.exit(0);
});

function isValidJpeg(buf) {
  if (!buf || buf.length < 64) return false;
  if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return false;
  return buf.lastIndexOf(Buffer.from([0xff, 0xd9])) > 4;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function syncOnce() {
  // 1. Capture fresh JPEG from physical ESP32-CAM on private LAN
  const camRes = await fetchWithTimeout(
    photoUrl,
    { headers: { Accept: 'image/jpeg,*/*' } },
    8000
  );
  if (!camRes.ok) {
    throw new Error(`ESP32-CAM returned HTTP ${camRes.status} from ${photoUrl}`);
  }

  const arrayBuffer = await camRes.arrayBuffer();
  const jpegBuffer = Buffer.from(arrayBuffer);

  if (!isValidJpeg(jpegBuffer)) {
    throw new Error(`Received ${jpegBuffer.length} bytes from ${photoUrl}, but data is not a complete JPEG.`);
  }

  const capturedAt = new Date().toISOString();

  // 2. Push JPEG over HTTPS to EDENS AI /api/camera/upload
  const uploadRes = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Camera-Key': uploadKey,
        'X-Captured-At': capturedAt
      },
      body: jpegBuffer
    },
    15000
  );

  const payload = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    throw new Error(
      `Backend rejected upload (HTTP ${uploadRes.status}): ${payload.message || payload.error || 'Unknown error'}`
    );
  }

  consecutiveFailures = 0;
  console.log(
    `[${new Date().toISOString()}] Uploaded ${payload.imageId} (${Math.round(jpegBuffer.length / 1024)} KB) -> ${uploadUrl}`
  );
}

async function loop() {
  while (!shuttingDown) {
    try {
      await syncOnce();
      await new Promise((r) => setTimeout(r, intervalMs));
    } catch (err) {
      consecutiveFailures += 1;
      const backoffMs = Math.min(60000, 3000 * Math.pow(2, Math.min(4, consecutiveFailures - 1)));
      console.error(
        `[${new Date().toISOString()}] Relay warning (attempt #${consecutiveFailures}): ${err.message}. Retrying in ${Math.round(backoffMs / 1000)}s...`
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

loop();
