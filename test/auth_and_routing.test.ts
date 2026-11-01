/**
 * EDENS AI — Authentication, Session Persistence, CORS & Production API Routing Test Suite
 *
 * Covers:
 * 1. Deployment routing configs (`vercel.json`, `render.yaml`) & zero frontend secret exposure
 * 2. Frontend-to-backend URL resolution (`resolveApiUrl`, `normalizeApiBaseUrl`) & CORS allowlist
 * 3. Successful account registration (HttpOnly cookie issuance, no raw sessionToken in browser JSON)
 * 4. Duplicate email registration rejection (409 -> DUPLICATE_EMAIL)
 * 5. Invalid registration data rejection (400 -> VALIDATION_ERROR)
 * 6. Successful login & fresh session issuance (200)
 * 7. Login with invalid or missing credentials (401 / 400)
 * 8. Cookie-only session persistence across `/api/auth/me`, `/api/greenhouses`, and logout revocation
 * 9. Missing backend & non-JSON error handling (exact Vercel `"The page could not be found"` 404,
 *    Express HTML 404, SPA `<!doctype html>` 200 fallback, 502 Bad Gateway HTML, malformed JSON,
 *    network failure, and Express `/api/*` JSON 404 guard)
 * 10. Rate limiting (`429 RATE_LIMITED` + `Retry-After`) & redacted server diagnostic logs
 */

import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  apiFetch,
  clearInMemorySessionToken,
  normalizeApiBaseUrl,
  parseApiJsonResponse,
  resolveApiUrl
} from '../src/lib/api.ts';
import { executeAuthAction } from '../src/lib/auth.tsx';

function httpRequest(
  port: number,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
  }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: any }> {
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
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
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

function extractCookiePair(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader || '';
  return raw.split(';')[0]?.trim() || '';
}

async function runTests() {
  console.log('\n=== EDENS AI Authentication & Production API Routing Suite ===\n');

  // 1. Deployment config & frontend zero-secret checks
  const vercelRaw = fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8');
  const vercelConfig = JSON.parse(vercelRaw);
  assert.strictEqual(vercelConfig.framework, 'vite', 'vercel.json must specify Vite framework');
  assert.strictEqual(vercelConfig.buildCommand, 'npm run build', 'vercel.json must run npm run build');
  assert.strictEqual(vercelConfig.outputDirectory, 'dist', 'vercel.json must serve dist/');
  assert.ok(Array.isArray(vercelConfig.rewrites), 'vercel.json must define rewrites');
  const apiRewrite = vercelConfig.rewrites.find((r: any) => r.source === '/api/:path*');
  assert.ok(apiRewrite, 'vercel.json must rewrite /api/:path*');
  assert.strictEqual(
    apiRewrite.destination,
    'https://edens-ai.onrender.com/api/:path*',
    'vercel.json must proxy /api/:path* to the verified Render backend'
  );
  const spaRewrite = vercelConfig.rewrites.find((r: any) => r.destination === '/index.html');
  assert.ok(spaRewrite, 'vercel.json must include SPA fallback rewrite to /index.html');
  assert.ok(
    spaRewrite.source.includes('(?!api/)'),
    'SPA fallback in vercel.json must exclude /api/ paths'
  );

  const renderRaw = fs.readFileSync(path.join(process.cwd(), 'render.yaml'), 'utf8');
  assert.ok(renderRaw.includes('startCommand: npm run start'), 'render.yaml must start Express server');
  assert.ok(renderRaw.includes('healthCheckPath: /api/health'), 'render.yaml must check /api/health');
  assert.ok(renderRaw.includes('22.18.0'), 'render.yaml must specify Node >= 22.18.0 for native TypeScript');

  const authTsxContent = fs.readFileSync(path.join(process.cwd(), 'src/lib/auth.tsx'), 'utf8');
  const apiTsContent = fs.readFileSync(path.join(process.cwd(), 'src/lib/api.ts'), 'utf8');
  assert.ok(
    !authTsxContent.includes('sessionStorage.setItem(SESSION_STORAGE_KEY') &&
      !authTsxContent.includes('localStorage.setItem(') &&
      !apiTsContent.includes('localStorage.setItem(') &&
      !apiTsContent.includes('sessionStorage.setItem('),
    'Frontend auth and API layer must never persist raw session tokens in sessionStorage or localStorage'
  );
  console.log('  ✅ [1/10] vercel.json (vite -> dist), render.yaml (Node 22.18.0), and zero Web Storage token exposure verified');

  // 2. Frontend API URL resolution (`resolveApiUrl` & `normalizeApiBaseUrl`)
  assert.strictEqual(resolveApiUrl('/api/auth/register', ''), '/api/auth/register');
  assert.strictEqual(
    resolveApiUrl('/api/auth/register', 'https://edens-ai.onrender.com/'),
    'https://edens-ai.onrender.com/api/auth/register'
  );
  assert.strictEqual(
    resolveApiUrl('/api/auth/register', 'https://edens-ai.onrender.com/api/'),
    'https://edens-ai.onrender.com/api/auth/register',
    'Accidental trailing /api in VITE_API_BASE_URL must not produce /api/api/auth/register'
  );
  assert.strictEqual(normalizeApiBaseUrl('https://edens-ai.onrender.com/api'), 'https://edens-ai.onrender.com');
  assert.strictEqual(
    resolveApiUrl('/api/auth/login', 'Secret value'),
    '/api/auth/login',
    'Accidental non-URL placeholder in VITE_API_BASE_URL must safely fall back to relative /api/*'
  );
  assert.strictEqual(normalizeApiBaseUrl('REPLACE_WITH_API_URL'), '');
  console.log('  ✅ [2/10] Frontend-to-backend URL resolution (same-origin, cross-origin, /api dedupe, placeholder guard) verified');

  // Spawn real production `node server.ts` instance
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'edens-auth-routing-'));
  const testDbPath = path.join(tmpRoot, 'platform.sqlite');
  const testUploadsDir = path.join(tmpRoot, 'uploads');
  const testPort = 19500 + Math.floor(Math.random() * 900);
  const baseOrigin = `http://127.0.0.1:${testPort}`;

  const child = spawn(process.execPath, ['server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(testPort),
      DATABASE_PATH: testDbPath,
      CAMERA_STORAGE_PATH: testUploadsDir,
      CORS_ALLOWED_ORIGINS: 'https://eden-ai.vercel.app,https://edens-ai.onrender.com'
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
    const health = await waitForHealth(testPort);
    assert.strictEqual(health.status, 'ok');
    assert.strictEqual(health.authEndpointsReady, true);

    const initialSessionCheck = await httpRequest(testPort, {
      method: 'GET',
      path: '/api/auth/session'
    });
    assert.strictEqual(initialSessionCheck.status, 200);
    assert.strictEqual(initialSessionCheck.json?.authenticated, false);
    assert.strictEqual(initialSessionCheck.json?.hasRegisteredUsers, false);

    // Verify SPA /login route serves HTML when dist/index.html is built, and core camera/telemetry/AI routes return JSON
    if (fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'))) {
      const loginPageRes = await httpRequest(testPort, { method: 'GET', path: '/login' });
      assert.strictEqual(loginPageRes.status, 200);
      assert.ok(String(loginPageRes.headers['content-type'] || '').includes('text/html'));
      assert.ok(loginPageRes.text.includes('edens_theme'), 'Pre-paint theme script must be present in /login HTML');
    }

    const camLatestRes = await httpRequest(testPort, { method: 'GET', path: '/api/camera/latest' });
    assert.strictEqual(camLatestRes.status, 200);
    assert.ok(String(camLatestRes.headers['content-type'] || '').includes('application/json'));

    const hwTelemetryRes = await httpRequest(testPort, { method: 'GET', path: '/api/telemetry/latest' });
    assert.strictEqual(hwTelemetryRes.status, 200);
    assert.ok(String(hwTelemetryRes.headers['content-type'] || '').includes('application/json'));

    const aiStatusRes = await httpRequest(testPort, { method: 'GET', path: '/api/ai/status' });
    assert.strictEqual(aiStatusRes.status, 200);
    assert.ok(String(aiStatusRes.headers['content-type'] || '').includes('application/json'));

    // 3. CORS preflight & credentialed origin validation
    const allowedPreflight = await httpRequest(testPort, {
      method: 'OPTIONS',
      path: '/api/auth/register',
      headers: {
        Origin: 'https://eden-ai.vercel.app',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-edens-auth-mode'
      }
    });
    assert.strictEqual(allowedPreflight.status, 204);
    assert.strictEqual(
      allowedPreflight.headers['access-control-allow-origin'],
      'https://eden-ai.vercel.app'
    );
    assert.strictEqual(allowedPreflight.headers['access-control-allow-credentials'], 'true');

    const blockedPreflight = await httpRequest(testPort, {
      method: 'OPTIONS',
      path: '/api/auth/register',
      headers: {
        Origin: 'https://attacker.evil.example',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.strictEqual(blockedPreflight.status, 403);
    assert.strictEqual(blockedPreflight.json?.error, 'CORS_ORIGIN_FORBIDDEN');
    assert.strictEqual(blockedPreflight.headers['access-control-allow-origin'], undefined);
    console.log('  ✅ [3/10] Credentialed CORS allowlist (Vercel allowed, unknown origin 403 blocked) verified');

    // 4. Successful account registration via cookie-only browser mode + HTTPS proxy header check
    const secretPassword = 'UltraSecretFarmerPassword!2026';
    const regHttp = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/register',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://eden-ai.vercel.app',
        'X-Forwarded-Proto': 'https, https',
        'X-Edens-Auth-Mode': 'cookie'
      },
      body: JSON.stringify({
        displayName: 'Fatima Zaria',
        email: 'fatima@edens-farm.ng',
        password: secretPassword
      })
    });
    assert.strictEqual(regHttp.status, 201);
    assert.strictEqual(regHttp.json.success, true);
    assert.strictEqual(regHttp.json.user.email, 'fatima@edens-farm.ng');
    assert.strictEqual(
      regHttp.json.sessionToken,
      undefined,
      'Cookie-mode browser registration must omit raw sessionToken from JSON body'
    );
    const setCookieRaw = Array.isArray(regHttp.headers['set-cookie'])
      ? regHttp.headers['set-cookie'][0]
      : regHttp.headers['set-cookie'] || '';
    assert.ok(setCookieRaw.includes('edens_session=edsess_'), 'Must issue edens_session cookie');
    assert.ok(setCookieRaw.includes('HttpOnly'), 'Session cookie must be HttpOnly');
    assert.ok(
      setCookieRaw.includes('SameSite=None; Secure; Partitioned'),
      `HTTPS proxied request must set SameSite=None; Secure; Partitioned, got: ${setCookieRaw}`
    );
    assert.ok(!stdoutLog.includes(secretPassword), 'Server logs must never contain plaintext passwords');
    assert.ok(!stdoutLog.includes('edsess_'), 'Server logs must never contain raw session tokens');

    // Also test frontend executeAuthAction('register') directly routed via baseUrl
    const frontendReg = await executeAuthAction(
      'register',
      {
        displayName: 'Tunde Ibadan',
        email: 'tunde@edens-farm.ng',
        password: 'TundeSecurePassword88!'
      },
      { baseUrl: baseOrigin }
    );
    assert.strictEqual(frontendReg.ok, true);
    if (frontendReg.ok) {
      assert.strictEqual(frontendReg.user.email, 'tunde@edens-farm.ng');
    }
    console.log('  ✅ [4/10] Successful account registration, HttpOnly Partitioned cookie, and log redaction verified');

    // 5. Duplicate email registration -> 409 DUPLICATE_EMAIL
    const dupReg = await executeAuthAction(
      'register',
      {
        displayName: 'Fatima Duplicate',
        email: 'FATIMA@EDENS-FARM.NG',
        password: 'AnotherValidPassword99!'
      },
      { baseUrl: baseOrigin }
    );
    assert.strictEqual(dupReg.ok, false);
    if (!dupReg.ok) {
      assert.strictEqual(dupReg.kind, 'DUPLICATE_EMAIL');
      assert.strictEqual(dupReg.errorCode, 'EMAIL_ALREADY_REGISTERED');
      assert.ok(dupReg.message.toLowerCase().includes('already exists'));
    }
    console.log('  ✅ [5/10] Duplicate email registration cleanly mapped to DUPLICATE_EMAIL (409)');

    // 6. Registration with invalid data -> 400 VALIDATION_ERROR
    const badEmailReg = await executeAuthAction(
      'register',
      { displayName: 'Grower', email: 'invalid-email', password: 'ValidPassword123!' },
      { baseUrl: baseOrigin }
    );
    assert.strictEqual(badEmailReg.ok, false);
    if (!badEmailReg.ok) {
      assert.strictEqual(badEmailReg.kind, 'VALIDATION_ERROR');
      assert.strictEqual(badEmailReg.errorCode, 'INVALID_EMAIL');
    }

    const shortPassReg = await executeAuthAction(
      'register',
      { displayName: 'Grower', email: 'newuser@edens-farm.ng', password: '123' },
      { baseUrl: baseOrigin }
    );
    assert.strictEqual(shortPassReg.ok, false);
    if (!shortPassReg.ok) {
      assert.strictEqual(shortPassReg.kind, 'VALIDATION_ERROR');
      assert.strictEqual(shortPassReg.errorCode, 'WEAK_PASSWORD');
    }
    console.log('  ✅ [6/10] Invalid registration email and weak password rejected with VALIDATION_ERROR (400)');

    // 7. Successful login & invalid credentials handling
    const okLogin = await executeAuthAction(
      'login',
      { email: 'fatima@edens-farm.ng', password: secretPassword },
      { baseUrl: baseOrigin }
    );
    assert.strictEqual(okLogin.ok, true);

    const wrongPassLogin = await executeAuthAction(
      'login',
      { email: 'fatima@edens-farm.ng', password: 'WrongPassword999!' },
      { baseUrl: baseOrigin }
    );
    assert.strictEqual(wrongPassLogin.ok, false);
    if (!wrongPassLogin.ok) {
      assert.strictEqual(wrongPassLogin.kind, 'AUTH_OR_SESSION_FAILED');
      assert.strictEqual(wrongPassLogin.errorCode, 'INVALID_CREDENTIALS');
    }

    const emptyPassLogin = await executeAuthAction(
      'login',
      { email: 'fatima@edens-farm.ng', password: '' },
      { baseUrl: baseOrigin }
    );
    assert.strictEqual(emptyPassLogin.ok, false);
    if (!emptyPassLogin.ok) {
      assert.strictEqual(emptyPassLogin.kind, 'VALIDATION_ERROR');
      assert.strictEqual(emptyPassLogin.errorCode, 'MISSING_CREDENTIALS');
    }
    console.log('  ✅ [7/10] Successful login, invalid password (401), and empty credentials (400) verified');

    // 8. Cookie session persistence across requests + logout revocation
    const cookiePair = extractCookiePair(regHttp.headers['set-cookie']);
    assert.ok(cookiePair.startsWith('edens_session='), 'Expected edens_session cookie pair');

    const meBefore = await httpRequest(testPort, {
      method: 'GET',
      path: '/api/auth/me',
      headers: { Cookie: cookiePair }
    });
    assert.strictEqual(meBefore.status, 200);
    assert.strictEqual(meBefore.json.authenticated, true);
    assert.strictEqual(meBefore.json.user.email, 'fatima@edens-farm.ng');

    const createGhViaCookie = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/greenhouses',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookiePair
      },
      body: JSON.stringify({
        name: 'Zaria Pepper House',
        locationLabel: 'Kaduna State',
        cropType: 'Bell Pepper'
      })
    });
    assert.strictEqual(createGhViaCookie.status, 201);

    const meWithGh = await httpRequest(testPort, {
      method: 'GET',
      path: '/api/auth/me',
      headers: { Cookie: cookiePair }
    });
    assert.strictEqual(meWithGh.status, 200);
    assert.strictEqual(meWithGh.json.greenhouses.length, 1);
    assert.strictEqual(meWithGh.json.greenhouses[0].name, 'Zaria Pepper House');

    const logoutRes = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/logout',
      headers: { Cookie: cookiePair }
    });
    assert.strictEqual(logoutRes.status, 200);

    const meAfterLogout = await httpRequest(testPort, {
      method: 'GET',
      path: '/api/auth/me',
      headers: { Cookie: cookiePair }
    });
    assert.strictEqual(meAfterLogout.status, 401);
    assert.strictEqual(meAfterLogout.json.authenticated, false);

    // 8b. Embedded preview iframe / cookie-blocked fallback (HTTPS Origin without X-Forwarded-Proto + in-memory Bearer)
    const cloudRunLogin = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/auth/login',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://ais-dev-preview.europe-west2.run.app',
        Host: 'ais-dev-preview.europe-west2.run.app',
        'X-Edens-Auth-Mode': 'cookie'
      },
      body: JSON.stringify({ email: 'fatima@edens-farm.ng', password: secretPassword })
    });
    assert.strictEqual(cloudRunLogin.status, 200);
    const cloudRunSetCookie = Array.isArray(cloudRunLogin.headers['set-cookie'])
      ? cloudRunLogin.headers['set-cookie'][0]
      : cloudRunLogin.headers['set-cookie'] || '';
    assert.ok(
      cloudRunSetCookie.includes('SameSite=None; Secure; Partitioned'),
      `HTTPS Origin behind TLS-terminating proxy must set SameSite=None; Secure; Partitioned, got: ${cloudRunSetCookie}`
    );

    const embeddedLogin = await executeAuthAction(
      'login',
      { email: 'fatima@edens-farm.ng', password: secretPassword },
      { baseUrl: baseOrigin, authMode: 'memory' }
    );
    assert.strictEqual(embeddedLogin.ok, true);

    const sessionViaMemory = await apiFetch('/api/auth/session', { baseUrl: baseOrigin });
    assert.strictEqual(sessionViaMemory.status, 200);
    const sessionViaMemoryJson = await sessionViaMemory.json();
    assert.strictEqual(sessionViaMemoryJson.authenticated, true);
    assert.strictEqual(sessionViaMemoryJson.hasRegisteredUsers, true);
    assert.strictEqual(sessionViaMemoryJson.user.email, 'fatima@edens-farm.ng');

    clearInMemorySessionToken();
    const sessionAfterClear = await apiFetch('/api/auth/session', { baseUrl: baseOrigin });
    const sessionAfterClearJson = await sessionAfterClear.json();
    assert.strictEqual(sessionAfterClearJson.authenticated, false);

    console.log('  ✅ [8/10] Cookie-only session persistence, Cloud Run HTTPS Partitioned cookie, and embedded iframe fallback verified');

    // 9. Non-JSON, HTML, missing backend, and unknown /api/* route guards
    // 9a. Exact Vercel static 404 plain-text response that caused `Unexpected token 'T', "The page c"...`
    const vercel404Auth = await executeAuthAction(
      'register',
      { displayName: 'Ada', email: 'ada@farm.ng', password: 'StrongPassword123!' },
      {
        fetchImpl: async () =>
          new Response('The page could not be found\n\nNOT_FOUND\n\nlhr1::j2grg-1793286742557', {
            status: 404,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
      }
    );
    assert.strictEqual(vercel404Auth.ok, false);
    if (!vercel404Auth.ok) {
      assert.strictEqual(vercel404Auth.kind, 'API_ROUTE_MISCONFIGURED');
      assert.ok(!vercel404Auth.message.includes('Unexpected token'), 'Must never leak SyntaxError');
      assert.ok(!vercel404Auth.message.includes('lhr1::'), 'Must never leak raw Vercel edge text');
    }

    // 9b. Stale Express HTML 404 (`<!DOCTYPE html>...Cannot POST /api/auth/register`)
    const html404Auth = await executeAuthAction(
      'register',
      { displayName: 'Ada', email: 'ada@farm.ng', password: 'StrongPassword123!' },
      {
        fetchImpl: async () =>
          new Response(
            '<!DOCTYPE html><html lang="en"><body><pre>Cannot POST /api/auth/register</pre></body></html>',
            { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
      }
    );
    assert.strictEqual(html404Auth.ok, false);
    if (!html404Auth.ok) {
      assert.strictEqual(html404Auth.kind, 'API_ROUTE_MISCONFIGURED');
      assert.ok(!html404Auth.message.includes('<!DOCTYPE'), 'Must never display raw HTML');
    }

    // 9c. SPA index.html 200 fallback accidentally returned for /api/*
    const spa200Fallback = await parseApiJsonResponse(
      new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      }),
      'register'
    );
    assert.strictEqual(spa200Fallback.ok, false);
    if (!spa200Fallback.ok) {
      assert.strictEqual(spa200Fallback.kind, 'API_ROUTE_MISCONFIGURED');
    }

    // 9d. Render / Cloudflare 502 Bad Gateway HTML
    const gateway502 = await executeAuthAction(
      'login',
      { email: 'ada@farm.ng', password: 'StrongPassword123!' },
      {
        fetchImpl: async () =>
          new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
            status: 502,
            headers: { 'Content-Type': 'text/html' }
          })
      }
    );
    assert.strictEqual(gateway502.ok, false);
    if (!gateway502.ok) {
      assert.strictEqual(gateway502.kind, 'BACKEND_UNAVAILABLE');
    }

    // 9e. Truncated / corrupt JSON body
    const corruptJson = await executeAuthAction(
      'login',
      { email: 'ada@farm.ng', password: 'StrongPassword123!' },
      {
        fetchImpl: async () =>
          new Response('{"success": true, "user": ', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
      }
    );
    assert.strictEqual(corruptJson.ok, false);
    if (!corruptJson.ok) {
      assert.strictEqual(corruptJson.kind, 'INVALID_SERVER_RESPONSE');
    }

    // 9f. Network unreachable (`TypeError: fetch failed`)
    const offlineAuth = await executeAuthAction(
      'register',
      { displayName: 'Ada', email: 'ada@farm.ng', password: 'StrongPassword123!' },
      {
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        }
      }
    );
    assert.strictEqual(offlineAuth.ok, false);
    if (!offlineAuth.ok) {
      assert.strictEqual(offlineAuth.kind, 'BACKEND_UNAVAILABLE');
      assert.strictEqual(offlineAuth.errorCode, 'NETWORK_UNREACHABLE');
    }

    // 9g. Live Express server returns structured JSON 404 (never HTML) for unknown /api/* routes
    const unknownApiRes = await httpRequest(testPort, {
      method: 'POST',
      path: '/api/does-not-exist',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.strictEqual(unknownApiRes.status, 404);
    assert.ok(
      String(unknownApiRes.headers['content-type'] || '').includes('application/json'),
      'Unknown /api/* routes on Express must return application/json, never text/html'
    );
    assert.strictEqual(unknownApiRes.json?.error, 'API_ROUTE_NOT_FOUND');
    console.log(
      '  ✅ [9/10] Non-JSON Vercel 404, HTML 404, SPA 200 HTML, 502 Gateway, corrupt JSON, network error, and Express JSON /api 404 verified'
    );

    // 10. Rate limiting (`429 RATE_LIMITED` + `Retry-After`)
    let hitRateLimit = false;
    for (let i = 0; i < 30; i++) {
      const attempt = await executeAuthAction(
        'login',
        { email: 'ratelimit@edens-farm.ng', password: 'WrongPassword123!' },
        {
          baseUrl: baseOrigin,
          fetchImpl: (url, init) =>
            fetch(url, {
              ...init,
              headers: {
                ...(init?.headers as Record<string, string>),
                'X-Forwarded-For': '203.0.113.77'
              }
            })
        }
      );
      if (!attempt.ok && attempt.kind === 'RATE_LIMITED') {
        hitRateLimit = true;
        assert.ok(
          typeof attempt.retryAfterSeconds === 'number' && attempt.retryAfterSeconds > 0,
          'Rate-limited response must expose retryAfterSeconds'
        );
        break;
      }
    }
    assert.strictEqual(hitRateLimit, true, 'Expected auth rate limiter to trigger 429 after burst');
    console.log('  ✅ [10/10] Auth rate limiting (429 + Retry-After) verified');

    console.log('\n🎉 ALL 10 AUTHENTICATION & PRODUCTION ROUTING CHECKS PASSED!\n');
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('\n❌ AUTH & ROUTING TEST SUITE FAILED:', err);
  process.exit(1);
});
