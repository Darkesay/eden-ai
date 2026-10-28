#!/usr/bin/env node
/**
 * EDENS AI — Safe Cloud & Local Gateway Diagnostic Verifier
 *
 * Performs read-only health, camera intake, and telemetry status checks against
 * either a local dev server (`http://127.0.0.1:3000`) or production (`https://edens-ai.onrender.com`).
 *
 * Zero secrets are hardcoded in this script. Optional authenticated upload checks
 * run ONLY if `--send-test-telemetry` is explicitly passed alongside `HARDWARE_API_KEY` in env.
 *
 * Usage:
 *   node firmware/EDENS_HARDWARE_KIT/diagnostics/verify_cloud_connection.mjs
 *   EDENS_BASE_URL=https://edens-ai.onrender.com node firmware/EDENS_HARDWARE_KIT/diagnostics/verify_cloud_connection.mjs
 */

const baseUrl = (process.env.EDENS_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const sendTestTelemetry = process.argv.includes('--send-test-telemetry');

function maskSecret(val) {
  if (!val || val.length < 8) return '[NOT_SET]';
  return `${val.slice(0, 4)}...[REDACTED]`;
}

async function checkJson(label, path, init = {}) {
  const url = `${baseUrl}${path}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, init);
    const ms = Date.now() - t0;
    const body = await res.json().catch(() => ({}));
    console.log(`[${res.status}] ${label} (${ms}ms) -> ${path}`);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error(`[ERR] ${label} -> ${path}: ${err.message}`);
    return { ok: false, status: 0, body: null };
  }
}

async function main() {
  console.log('==============================================================');
  console.log(' EDENS AI — Cloud & Hardware Gateway Diagnostic Check');
  console.log(` Target Base URL : ${baseUrl}`);
  console.log(` Mode            : ${sendTestTelemetry ? 'Read + Optional Test Telemetry Push' : 'STRICT READ-ONLY (0 mutations, 0 actuations)'}`);
  console.log('==============================================================\n');

  // 1. Server Health
  const health = await checkJson('Server Health', '/api/health');
  if (health.body) {
    console.log(`   geminiConfigured : ${Boolean(health.body.geminiConfigured)}`);
  }

  // 2. Camera Upload Gateway Metadata
  const camInfo = await checkJson('Camera Upload Gateway Info', '/api/camera/upload-info');
  if (camInfo.body) {
    console.log(`   authConfigured   : ${Boolean(camInfo.body.authConfigured)} (header: ${camInfo.body.authHeader})`);
    console.log(`   freshMaxSeconds  : ${camInfo.body.freshMaxSeconds}s | maxSizeMb: ${camInfo.body.maxSizeMb}MB`);
    console.log(`   totalUploads     : ${camInfo.body.totalUploadsReceived}`);
  }

  // 3. Latest Camera Frame Status
  const camLatest = await checkJson('Latest Camera Snapshot Status', '/api/camera/latest');
  if (camLatest.body) {
    console.log(`   exists           : ${Boolean(camLatest.body.exists)}`);
    console.log(`   explicitState    : ${camLatest.body.explicitState || camLatest.body.status}`);
    console.log(`   freshness        : ${camLatest.body.freshness || 'NONE'} (ageSeconds=${camLatest.body.ageSeconds ?? 'N/A'})`);
  }

  // 4. Latest Controller Telemetry Status
  const telLatest = await checkJson('Latest Controller Telemetry Status', '/api/telemetry/latest');
  if (telLatest.body) {
    console.log(`   connected        : ${Boolean(telLatest.body.connected)}`);
    console.log(`   explicitState    : ${telLatest.body.explicitState || 'UNKNOWN'}`);
    console.log(`   dataSource       : ${telLatest.body.dataSource}`);
  }

  // 5. Security Sanity Check: Verify URL query secret is rejected (401 QUERY_AUTH_DISALLOWED)
  const queryLeakCheck = await checkJson(
    'Query-Param Secret Rejection Guard',
    '/api/telemetry/upload?key=should_always_be_rejected',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temperature: 25 })
    }
  );
  console.log(
    `   querySecretGuard : ${queryLeakCheck.status === 401 ? 'PASS (HTTP 401 rejected)' : `UNEXPECTED HTTP ${queryLeakCheck.status}`}`
  );

  // 6. Optional Authenticated Telemetry Smoke Push (only when explicitly requested)
  if (sendTestTelemetry) {
    const hwKey = (process.env.HARDWARE_API_KEY || '').trim();
    console.log(`\n[Optional Push] Using HARDWARE_API_KEY=${maskSecret(hwKey)}`);
    if (!hwKey) {
      console.error('   Skipped: Set HARDWARE_API_KEY in environment to run --send-test-telemetry.');
      process.exit(1);
    }
    const pushRes = await checkJson('Authenticated Controller Telemetry Upload', '/api/telemetry/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hardware-Key': hwKey
      },
      body: JSON.stringify({
        firmwareVersion: 'EDENS-DIAGNOSTIC-CLI',
        telemetry: {
          temperature: 25.4,
          humidity: 64.0,
          soilMoisture: 52.0,
          waterLevel: null
        }
      })
    });
    console.log(`   uploadResult     : ${pushRes.ok ? 'PASS' : `FAILED (${JSON.stringify(pushRes.body)})`}`);
  }

  console.log('\nDiagnostic verification finished.');
}

main().catch((err) => {
  console.error('Diagnostic script failed:', err);
  process.exit(1);
});
