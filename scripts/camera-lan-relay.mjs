#!/usr/bin/env node
/**
 * EDENS AI — Local Greenhouse ESP32-CAM -> Cloud Relay Gateway
 *
 * Bridges an existing HTTP ESP32-CAM on a private farm Wi-Fi LAN (e.g. http://10.87.237.36/photo)
 * to EDENS AI Cloud (POST /api/camera/upload with X-Camera-Key) without requiring any firmware
 * changes on the camera board.
 *
 * Usage examples:
 *   CAMERA_PHOTO_URL="http://10.87.237.36/photo" CAMERA_STATUS_URL="http://10.87.237.36/status" CAMERA_UPLOAD_KEY="<your_secret>" npm run camera:relay
 *   CAMERA_LAN_HOST="10.87.237.36" CAMERA_UPLOAD_KEY="<your_secret>" npm run camera:relay
 *   CAMERA_PHOTO_URL="http://10.87.237.36/photo" CAMERA_UPLOAD_KEY="<your_secret>" node scripts/camera-lan-relay.mjs --once
 */

const runOnce = process.argv.includes('--once') || process.env.CAMERA_RELAY_ONCE === '1';
const rawPhotoUrlEnv = (process.env.CAMERA_PHOTO_URL || '').trim();
const rawStatusUrlEnv = (process.env.CAMERA_STATUS_URL || '').trim();
const cameraHost = (process.env.CAMERA_LAN_HOST || process.env.HARDWARE_CAMERA_HOST || '').trim();
const cameraHttpPort = parseInt(process.env.CAMERA_HTTP_PORT || process.env.HARDWARE_CAMERA_HTTP_PORT || '80', 10);
const photoPath = (process.env.CAMERA_PHOTO_PATH || '/photo').trim();
const statusPath = (process.env.CAMERA_STATUS_PATH || '/status').trim();
const backendBase = (
  process.env.EDENS_BACKEND_URL ||
  process.env.CLOUD_API_BASE_URL ||
  'https://edens-ai.onrender.com'
)
  .trim()
  .replace(/\/$/, '');
const uploadKey = (process.env.CAMERA_UPLOAD_KEY || '').trim();
const greenhouseId = (process.env.GREENHOUSE_ID || '').trim();
const deviceId = (process.env.CAMERA_DEVICE_ID || '').trim();
const intervalMs = Math.max(4000, parseInt(process.env.CAMERA_RELAY_INTERVAL_MS || '15000', 10));

function isPrivateOrLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (h === '127.0.0.1' || h === 'localhost' || h.endsWith('.local')) return true;
  const parts = h.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function resolveValidatedLanUrl(fullUrl, fallbackOrigin, fallbackPath, label) {
  const candidate = fullUrl || `${fallbackOrigin}${fallbackPath.startsWith('/') ? fallbackPath : `/${fallbackPath}`}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    console.error(`[EDENS Camera Relay] ERROR: Invalid ${label} "${candidate}".`);
    process.exit(1);
  }
  if (parsed.protocol !== 'http:' || parsed.username || parsed.password) {
    console.error(`[EDENS Camera Relay] ERROR: ${label} must use plain http:// without embedded credentials.`);
    process.exit(1);
  }
  if (!isPrivateOrLocalHost(parsed.hostname)) {
    console.error(
      `[EDENS Camera Relay] ERROR: ${label} host "${parsed.hostname}" is not a private LAN IPv4 (10.x, 172.16-31.x, 192.168.x), .local mDNS, or loopback address.`
    );
    process.exit(1);
  }
  return parsed.toString();
}

if (!rawPhotoUrlEnv && !cameraHost) {
  console.error(
    '[EDENS Camera Relay] ERROR: Provide CAMERA_PHOTO_URL="http://10.87.237.36/photo" or CAMERA_LAN_HOST="10.87.237.36".'
  );
  process.exit(1);
}

if (!uploadKey || uploadKey === 'change_this_to_a_secure_camera_secret') {
  console.error('[EDENS Camera Relay] ERROR: CAMERA_UPLOAD_KEY environment variable is required.');
  console.error('Set CAMERA_UPLOAD_KEY to your device X-Camera-Key (edcam_...) or server CAMERA_UPLOAD_KEY and re-run.');
  process.exit(1);
}

const cameraOrigin = cameraHost
  ? cameraHttpPort === 80
    ? `http://${cameraHost}`
    : `http://${cameraHost}:${cameraHttpPort}`
  : rawPhotoUrlEnv
    ? new URL(rawPhotoUrlEnv).origin
    : '';

const photoUrl = resolveValidatedLanUrl(rawPhotoUrlEnv, cameraOrigin, photoPath, 'CAMERA_PHOTO_URL');
const statusUrl =
  rawStatusUrlEnv || cameraOrigin
    ? resolveValidatedLanUrl(rawStatusUrlEnv, cameraOrigin, statusPath, 'CAMERA_STATUS_URL')
    : '';
const uploadUrl = `${backendBase}/api/camera/upload`;

console.log('==============================================================');
console.log(' EDENS AI — Local Greenhouse ESP32-CAM Bridge Gateway');
console.log(` Camera LAN Photo : ${photoUrl}`);
if (statusUrl) {
  console.log(` Camera LAN Status: ${statusUrl}`);
}
console.log(` Cloud Intake URL : ${uploadUrl}`);
console.log(` Mode             : ${runOnce ? 'Single-shot verification (--once)' : `Continuous (${intervalMs} ms)`}`);
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
  if (statusUrl) {
    try {
      const stRes = await fetchWithTimeout(statusUrl, { headers: { Accept: 'application/json,*/*' } }, 3500);
      if (!stRes.ok) {
        console.warn(`[EDENS Camera Relay] Note: ${statusUrl} returned HTTP ${stRes.status}; proceeding to /photo capture.`);
      }
    } catch (stErr) {
      console.warn(`[EDENS Camera Relay] Note: ${statusUrl} unreachable (${stErr.message}); proceeding to /photo capture.`);
    }
  }

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
  const headers = {
    'Content-Type': 'image/jpeg',
    'X-Camera-Key': uploadKey,
    'X-Captured-At': capturedAt
  };
  if (greenhouseId) headers['X-Greenhouse-Id'] = greenhouseId;
  if (deviceId) headers['X-Device-Id'] = deviceId;

  // 2. Push JPEG over HTTPS/HTTP to EDENS AI /api/camera/upload
  const uploadRes = await fetchWithTimeout(
    uploadUrl,
    {
      method: 'POST',
      headers,
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
    `[${new Date().toISOString()}] Uploaded ${payload.imageId} (${Math.max(1, Math.round(jpegBuffer.length / 1024))} KB) -> ${uploadUrl}`
  );
}

async function main() {
  if (runOnce) {
    try {
      await syncOnce();
      // Let the event loop drain instead of force-exiting: process.exit() while
      // undici's sockets are still tearing down trips a libuv assertion on
      // Windows (uv/async.c "handle->flags & UV_HANDLE_CLOSING"). The unref'd
      // fallback timer still guarantees termination if a pooled keep-alive
      // socket would otherwise hold the loop open.
      process.exitCode = 0;
      setTimeout(() => process.exit(0), 500).unref();
    } catch (err) {
      console.error(`[EDENS Camera Relay] Single-shot relay failed: ${err.message}`);
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 500).unref();
    }
    return;
  }

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

main();
