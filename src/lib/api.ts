/**
 * EDENS AI — Centralized Frontend API Routing & Defensive JSON Response Handling
 *
 * Guarantees:
 * 1. Consistent API URL resolution across same-origin Express, Vercel `/api/*` rewrites,
 *    and explicit cross-origin `VITE_API_BASE_URL` deployments.
 * 2. Credentialed `HttpOnly` cookie transport (`credentials: 'include'`) without storing
 *    session tokens, passwords, or device keys in Web Storage.
 * 3. Safe HTTP status + `Content-Type` verification before parsing JSON so plain-text or
 *    HTML gateway/404 pages (e.g. Vercel `"The page could not be found"`) never leak raw
 *    `SyntaxError: Unexpected token ... is not valid JSON` or HTML markup to users.
 */

export type ApiErrorKind =
  | 'BACKEND_UNAVAILABLE'
  | 'API_ROUTE_MISCONFIGURED'
  | 'INVALID_SERVER_RESPONSE'
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_EMAIL'
  | 'RATE_LIMITED'
  | 'AUTH_OR_SESSION_FAILED'
  | 'REQUEST_FAILED';

export interface ParsedApiFailure {
  ok: false;
  status: number;
  kind: ApiErrorKind;
  errorCode: string;
  message: string;
  retryAfterSeconds?: number;
}

export interface ParsedApiSuccess<T = Record<string, any>> {
  ok: true;
  status: number;
  data: T;
  kind?: undefined;
  errorCode?: undefined;
  message?: undefined;
  retryAfterSeconds?: undefined;
}

export type ParsedApiResult<T = Record<string, any>> = ParsedApiSuccess<T> | ParsedApiFailure;

function readEnvApiBaseUrl(): string {
  const viteVal = (import.meta as any)?.env?.VITE_API_BASE_URL;
  if (typeof viteVal === 'string' && viteVal.trim()) {
    return viteVal.trim();
  }
  if (typeof process !== 'undefined' && process?.env?.VITE_API_BASE_URL) {
    return String(process.env.VITE_API_BASE_URL).trim();
  }
  return '';
}

/**
 * Normalizes a configured API base URL into a clean origin/base prefix without trailing slashes.
 * Ignores accidental placeholder values (non-http/https strings) and strips trailing `/api` suffixes
 * so `/api/api/...` cannot occur.
 */
export function normalizeApiBaseUrl(rawBaseUrl?: string): string {
  const isExplicitOverride = rawBaseUrl !== undefined;
  const candidate = (isExplicitOverride ? rawBaseUrl : readEnvApiBaseUrl()).trim();
  if (!candidate) return '';
  if (!/^https?:\/\//i.test(candidate)) return '';
  if (/REPLACE_WITH|YOUR_APP_URL|Secret value/i.test(candidate)) return '';

  let cleaned = candidate.replace(/\/+$/, '');
  if (cleaned.endsWith('/api')) {
    cleaned = cleaned.slice(0, -4);
  }

  // Guard env-configured VITE_API_BASE_URL in browsers so a static frontend URL (e.g. eden-ai.vercel.app)
  // or cross-origin override never hijacks same-origin Express servers (AI Studio *.run.app / Render / localhost).
  if (!isExplicitOverride) {
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname.toLowerCase() === 'eden-ai.vercel.app') {
        return '';
      }
      if (typeof window !== 'undefined' && window.location?.hostname) {
        const currentHost = window.location.hostname.toLowerCase();
        if (
          currentHost.endsWith('.run.app') ||
          currentHost.endsWith('.onrender.com') ||
          currentHost === 'localhost' ||
          currentHost === '127.0.0.1'
        ) {
          return '';
        }
      }
    } catch {
      return '';
    }
  }

  return cleaned;
}

/**
 * Resolves an `/api/...` path (or relative asset URL returned by the server) against the configured backend base URL.
 * Defaults to relative same-origin (`""`) so local `tsx server.ts`, monolithic Render deployments,
 * and Vercel `/api/:path*` proxy rewrites work with first-party cookies out of the box.
 */
export function resolveApiUrl(input: string, overrideBaseUrl?: string): string {
  if (!input) return input;
  if (/^https?:\/\//i.test(input) || input.startsWith('data:') || input.startsWith('blob:')) {
    return input;
  }

  const normalizedPath = input.startsWith('/') ? input : `/${input}`;
  const base = normalizeApiBaseUrl(overrideBaseUrl);
  if (!base) {
    return normalizedPath;
  }
  return `${base}${normalizedPath}`;
}

export function looksLikeHtmlOrStaticNotFound(rawBody: string, contentType: string): boolean {
  const ct = contentType.toLowerCase();
  const sample = rawBody.trim().slice(0, 512);
  if (ct.includes('text/html')) return true;
  if (/^<!doctype\s+html/i.test(sample) || /^<html[\s>]/i.test(sample)) return true;
  if (/The page could not be found/i.test(sample) || /\bNOT_FOUND\b/.test(sample)) return true;
  if (/Cannot\s+(GET|POST|PUT|PATCH|DELETE)\s+\/api\//i.test(sample)) return true;
  return false;
}

function sanitizeServerMessage(rawMessage: unknown, fallback: string): string {
  if (typeof rawMessage !== 'string') return fallback;
  const trimmed = rawMessage.trim();
  if (!trimmed) return fallback;

  // Never display raw HTML documents, stack traces, or low-level JSON parser errors to users
  if (
    /^<!doctype/i.test(trimmed) ||
    /<\/?(html|body|head|pre|script)\b/i.test(trimmed) ||
    /Unexpected token .* is not valid JSON/i.test(trimmed) ||
    /\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(trimmed)
  ) {
    return fallback;
  }

  return trimmed.slice(0, 360);
}

/**
 * Safely parses an HTTP `Response` from an EDENS AI `/api/*` endpoint.
 * Checks HTTP status and `Content-Type` before parsing JSON and maps infrastructure,
 * routing, validation, duplicate-account, rate-limit, and session errors into clear user messages.
 */
export async function parseApiJsonResponse<T = Record<string, any>>(
  res: Response,
  context: 'register' | 'login' | 'session' | 'general' = 'general'
): Promise<ParsedApiResult<T>> {
  const status = res.status;
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const retryAfterHeader = res.headers.get('retry-after');
  const parsedRetryHeader = retryAfterHeader ? parseInt(retryAfterHeader, 10) : NaN;

  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    return {
      ok: false,
      status: status || 0,
      kind: 'BACKEND_UNAVAILABLE',
      errorCode: 'RESPONSE_READ_ERROR',
      message: 'Connection to the EDENS AI server was interrupted while reading the response. Please try again.'
    };
  }

  const trimmed = rawText.trim();
  const isJsonContentType = contentType.includes('application/json') || contentType.includes('+json');

  let parsedJson: any = null;
  let jsonParseSucceeded = false;
  if (trimmed && (isJsonContentType || trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      parsedJson = JSON.parse(trimmed);
      jsonParseSucceeded = parsedJson !== null && typeof parsedJson === 'object';
    } catch {
      jsonParseSucceeded = false;
    }
  }

  // Case A: Non-JSON HTML / plain-text response (Vercel 404, Express HTML 404, SPA index.html fallback, 413 payload error, or 502/503/504 gateway page)
  if (!jsonParseSucceeded) {
    if (
      status === 413 ||
      /Request Entity Too Large|Payload Too Large|FUNCTION_PAYLOAD_TOO_LARGE/i.test(trimmed)
    ) {
      return {
        ok: false,
        status: status || 413,
        kind: 'VALIDATION_ERROR',
        errorCode: 'PAYLOAD_TOO_LARGE',
        message:
          'The selected photo or audio file is too large for the network proxy. Please snap a fresh leaf photo or upload a smaller image.'
      };
    }

    if (status === 408 || status === 524) {
      return {
        ok: false,
        status,
        kind: 'BACKEND_UNAVAILABLE',
        errorCode: `GATEWAY_HTTP_${status}`,
        message:
          'The request timed out while waiting for the EDENS AI server. Please try again in a few seconds.'
      };
    }

    if (status === 502 || status === 503 || status === 504) {
      return {
        ok: false,
        status,
        kind: 'BACKEND_UNAVAILABLE',
        errorCode: `GATEWAY_HTTP_${status}`,
        message:
          'The EDENS AI backend server is temporarily unavailable or waking up. Wait 10–20 seconds and try again.'
      };
    }

    if (status === 429) {
      const waitSec = Number.isFinite(parsedRetryHeader) && parsedRetryHeader > 0 ? parsedRetryHeader : 60;
      return {
        ok: false,
        status,
        kind: 'RATE_LIMITED',
        errorCode: 'RATE_LIMITED',
        retryAfterSeconds: waitSec,
        message: `Too many requests. Please wait ${waitSec} seconds and try again.`
      };
    }

    if (
      status === 404 ||
      status === 405 ||
      looksLikeHtmlOrStaticNotFound(trimmed, contentType)
    ) {
      const isAuthContext =
        context === 'register' || context === 'login' || context === 'session';
      return {
        ok: false,
        status,
        kind: 'API_ROUTE_MISCONFIGURED',
        errorCode: 'API_ROUTE_MISCONFIGURED',
        message: isAuthContext
          ? 'Unable to reach the EDENS AI authentication service because /api/* requests returned a static page instead of API JSON. Verify backend routing or deployment rewrites.'
          : 'Unable to reach the EDENS AI backend API because /api/* returned a static page instead of JSON. Refresh the page or verify backend routing.'
      };
    }

    return {
      ok: false,
      status,
      kind: 'INVALID_SERVER_RESPONSE',
      errorCode: 'NON_JSON_RESPONSE',
      message:
        'The server returned an invalid non-JSON response. Please refresh and try again shortly.'
    };
  }

  // Case B: Valid JSON response body
  if (res.ok) {
    return {
      ok: true,
      status,
      data: parsedJson as T
    };
  }

  // Case C: Structured JSON error response (!res.ok)
  const errorCode = String(parsedJson?.error || `HTTP_${status}`);
  const retryAfterSeconds =
    typeof parsedJson?.retryAfterSeconds === 'number' && parsedJson.retryAfterSeconds > 0
      ? Math.ceil(parsedJson.retryAfterSeconds)
      : Number.isFinite(parsedRetryHeader) && parsedRetryHeader > 0
        ? parsedRetryHeader
        : undefined;

  if (status === 429 || errorCode.includes('RATE_LIMIT')) {
    const waitHint = retryAfterSeconds ? ` Please wait ${retryAfterSeconds} seconds and try again.` : ' Please wait a minute and try again.';
    return {
      ok: false,
      status,
      kind: 'RATE_LIMITED',
      errorCode,
      retryAfterSeconds,
      message: sanitizeServerMessage(
        parsedJson?.message,
        `Too many attempts.${waitHint}`
      )
    };
  }

  if (status === 409 && (errorCode === 'EMAIL_ALREADY_REGISTERED' || context === 'register')) {
    return {
      ok: false,
      status,
      kind: 'DUPLICATE_EMAIL',
      errorCode,
      message: sanitizeServerMessage(
        parsedJson?.message,
        'An account with this email address already exists. Sign in instead.'
      )
    };
  }

  if (status === 400 || status === 422) {
    return {
      ok: false,
      status,
      kind: 'VALIDATION_ERROR',
      errorCode,
      message: sanitizeServerMessage(
        parsedJson?.message,
        context === 'register'
          ? 'Please enter a valid display name, email address, and a password of at least 8 characters.'
          : 'Please check the information entered and try again.'
      )
    };
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      status,
      kind: 'AUTH_OR_SESSION_FAILED',
      errorCode,
      message: sanitizeServerMessage(
        parsedJson?.message,
        context === 'login'
          ? 'Invalid email or password.'
          : 'Your session is invalid or has expired. Please sign in again.'
      )
    };
  }

  if (status === 404 && errorCode === 'API_ROUTE_NOT_FOUND') {
    return {
      ok: false,
      status,
      kind: 'API_ROUTE_MISCONFIGURED',
      errorCode,
      message:
        'The requested API route is not available on the server. Ensure the latest backend build is deployed.'
    };
  }

  if (status === 502 || status === 503 || status === 504 || errorCode === 'DATABASE_INIT_FAILED') {
    return {
      ok: false,
      status,
      kind: 'BACKEND_UNAVAILABLE',
      errorCode,
      message: sanitizeServerMessage(
        parsedJson?.message,
        'The EDENS AI backend service is temporarily unavailable. Please try again in a moment.'
      )
    };
  }

  return {
    ok: false,
    status,
    kind: 'REQUEST_FAILED',
    errorCode,
    message: sanitizeServerMessage(
      parsedJson?.message,
      context === 'register'
        ? 'Account registration could not be completed. Please try again.'
        : context === 'login'
          ? 'Sign in could not be completed. Please try again.'
          : `Request failed (HTTP ${status}).`
    )
  };
}

/**
 * Classifies network-level fetch exceptions (DNS failure, refused connection, offline browser, CORS block, timeout).
 */
export function classifyNetworkFailure(err: unknown): ParsedApiFailure {
  const isAbort =
    err instanceof DOMException
      ? err.name === 'AbortError'
      : Boolean((err as any)?.name === 'AbortError');

  if (isAbort) {
    return {
      ok: false,
      status: 0,
      kind: 'BACKEND_UNAVAILABLE',
      errorCode: 'REQUEST_TIMEOUT',
      message:
        'Request to the EDENS AI server timed out. If the backend is waking up from idle, wait 15 seconds and try again.'
    };
  }

  return {
    ok: false,
    status: 0,
    kind: 'BACKEND_UNAVAILABLE',
    errorCode: 'NETWORK_UNREACHABLE',
    message:
      'Cannot connect to the EDENS AI backend server. Check your internet connection or verify that the backend service is online.'
  };
}

/**
 * Convenience helper for existing callers that need a safe JSON object without throwing on HTML/plain-text bodies.
 */
export async function safeReadJson<T = Record<string, any>>(
  res: Response,
  context: 'register' | 'login' | 'session' | 'general' = 'general'
): Promise<{ ok: true; data: T } | { ok: false; kind: ApiErrorKind; errorCode: string; message: string; status: number }> {
  return parseApiJsonResponse<T>(res, context);
}

/**
 * Private module-scoped session token used ONLY as an in-memory fallback when running inside
 * cross-origin preview iframes (e.g. AI Studio preview) or browsers that block Set-Cookie.
 * Never written to localStorage, sessionStorage, cookies accessible to JS, or window globals.
 */
let ephemeralInMemorySessionToken: string | null = null;

export function setInMemorySessionToken(token: string | null | undefined): void {
  const candidate = typeof token === 'string' ? token.trim() : '';
  ephemeralInMemorySessionToken = candidate.startsWith('edsess_') ? candidate : null;
}

export function clearInMemorySessionToken(): void {
  ephemeralInMemorySessionToken = null;
}

export function isEmbeddedIframeContext(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    // Accessing window.top throws SecurityError in some cross-origin iframe sandboxes
    return true;
  }
}

export interface ApiFetchOptions extends RequestInit {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const PRODUCTION_RENDER_API_ORIGIN = 'https://edens-ai.onrender.com';

export async function detectAiStudioCookieIntercept(res: Response): Promise<boolean> {
  const url = (res.url || '').toLowerCase();
  if (url.includes('__cookie_check.html')) {
    return true;
  }
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('text/html')) {
    return false;
  }
  try {
    const sample = (await res.clone().text()).slice(0, 1024);
    return sample.includes('_aistudio-iframe.js') || sample.includes('__cookie_check');
  } catch {
    return false;
  }
}

let inflightProxyCookieRefresh: Promise<boolean> | null = null;

function refreshAiStudioProxyCookieViaHiddenFrame(): Promise<boolean> {
  if (typeof document === 'undefined' || !document.body) {
    return Promise.resolve(false);
  }
  if (inflightProxyCookieRefresh) {
    return inflightProxyCookieRefresh;
  }

  inflightProxyCookieRefresh = new Promise<boolean>((resolve) => {
    let settled = false;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.width = '0';
    iframe.height = '0';
    iframe.className = 'hidden pointer-events-none w-0 h-0 border-0';

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      inflightProxyCookieRefresh = null;
      try {
        iframe.remove();
      } catch {
        // Ignore DOM cleanup errors
      }
      resolve(ok);
    };

    const timeoutId = setTimeout(() => finish(false), 2500);
    iframe.onload = () => {
      setTimeout(() => {
        clearTimeout(timeoutId);
        finish(true);
      }, 450);
    };
    iframe.onerror = () => {
      clearTimeout(timeoutId);
      finish(false);
    };

    iframe.src = '/__cookie_check.html?return_url=%2Fapi%2Fhealth';
    document.body.appendChild(iframe);
  });

  return inflightProxyCookieRefresh;
}

async function isStaticNonJsonApiResponse(res: Response): Promise<boolean> {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json') || ct.includes('+json')) {
    return false;
  }
  if (ct.includes('text/html')) {
    return true;
  }
  if (res.status === 404 || res.status === 405) {
    try {
      const sample = (await res.clone().text()).trim().slice(0, 512);
      return looksLikeHtmlOrStaticNotFound(sample, ct);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Executes a credentialed HTTP request against the EDENS AI backend using `HttpOnly` cookies (`credentials: 'include'`),
 * with automatic private in-memory `Authorization: Bearer` fallback inside restricted cross-origin iframes.
 * Never reads or persists raw session tokens in Web Storage.
 */
export async function apiFetch(input: string, init: ApiFetchOptions = {}): Promise<Response> {
  const { baseUrl, fetchImpl = fetch, ...rest } = init;
  const headers = new Headers(rest.headers || {});

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (!headers.has('X-Edens-Auth-Mode')) {
    headers.set('X-Edens-Auth-Mode', 'cookie');
  }
  if (ephemeralInMemorySessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${ephemeralInMemorySessionToken}`);
  }
  if (rest.body && typeof rest.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const requestInit: RequestInit = {
    ...rest,
    credentials: rest.credentials ?? 'include',
    headers
  };

  const targetUrl = resolveApiUrl(input, baseUrl);
  let currentRes = await fetchImpl(targetUrl, requestInit);

  // Automatic browser-only recovery when a proxy cookie expires or a static host returns HTML/502/504 instead of API JSON
  const isDefaultBrowserFetch =
    typeof window !== 'undefined' &&
    init.fetchImpl === undefined &&
    baseUrl === undefined &&
    (input.startsWith('/api/') || input.startsWith('api/'));

  if (isDefaultBrowserFetch) {
    const normalizedPath = input.startsWith('/') ? input : `/${input}`;
    const host = (window.location?.hostname || '').toLowerCase();

    // 1. Silent AI Studio iframe proxy cookie refresh (`/__cookie_check.html`) + transparent replay
    if (await detectAiStudioCookieIntercept(currentRes)) {
      await refreshAiStudioProxyCookieViaHiddenFrame();
      try {
        const replayedRes = await fetchImpl(targetUrl, requestInit);
        if (!(await isStaticNonJsonApiResponse(replayedRes))) {
          return replayedRes;
        }
        currentRes = replayedRes;
      } catch {
        // Proceed to fallback stages below
      }
    }

    let staticMisrouted = await isStaticNonJsonApiResponse(currentRes);

    // 2. If an external base URL returned a static page, fall back to same-origin relative /api/*
    if (staticMisrouted && targetUrl !== normalizedPath) {
      try {
        const sameOriginRes = await fetchImpl(normalizedPath, requestInit);
        if (!(await isStaticNonJsonApiResponse(sameOriginRes))) {
          return sameOriginRes;
        }
        currentRes = sameOriginRes;
        staticMisrouted = true;
      } catch {
        // Proceed to fallback stages below
      }
    }

    // 3. One-time brief retry on same-origin container restart / gateway 502/504 / non-JSON 503
    const currentCt = (currentRes.headers.get('content-type') || '').toLowerCase();
    const isGatewayTransient =
      currentRes.status === 502 ||
      currentRes.status === 504 ||
      (currentRes.status === 503 && !currentCt.includes('application/json'));
    const isSameOriginServerHost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.onrender.com') ||
      host.startsWith('ais-dev-');

    if (isSameOriginServerHost && (staticMisrouted || isGatewayTransient)) {
      await new Promise((r) => setTimeout(r, 850));
      try {
        const retryRes = await fetchImpl(normalizedPath, requestInit);
        if (!(await isStaticNonJsonApiResponse(retryRes)) && retryRes.status !== 502 && retryRes.status !== 504) {
          return retryRes;
        }
        currentRes = retryRes;
        staticMisrouted = await isStaticNonJsonApiResponse(currentRes);
      } catch {
        // Proceed to cloud fallback if eligible
      }
    }

    // 4. Cloud backend fallback for Vercel, static shared previews (ais-pre-*.run.app), or unrecovered static HTML
    const isLocalLoopback = host === 'localhost' || host === '127.0.0.1';
    const isRenderOrigin = host.endsWith('.onrender.com');
    if (
      !isLocalLoopback &&
      !isRenderOrigin &&
      (staticMisrouted || currentRes.status === 502 || currentRes.status === 504)
    ) {
      const cloudUrl = `${PRODUCTION_RENDER_API_ORIGIN}${normalizedPath}`;
      try {
        return await fetchImpl(cloudUrl, requestInit);
      } catch {
        if (normalizedPath.startsWith('/api/ai/') || normalizedPath === '/api/health') {
          try {
            return await fetchImpl(cloudUrl, { ...requestInit, credentials: 'omit' });
          } catch {
            return currentRes;
          }
        }
        return currentRes;
      }
    }
  }

  return currentRes;
}
