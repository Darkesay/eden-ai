import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type ApiErrorKind,
  type ApiFetchOptions,
  apiFetch as coreApiFetch,
  classifyNetworkFailure,
  clearInMemorySessionToken,
  isEmbeddedIframeContext,
  parseApiJsonResponse,
  resolveApiUrl,
  setInMemorySessionToken
} from './api.ts';

export { resolveApiUrl };

const LEGACY_SESSION_STORAGE_KEY = 'edens_session_token';
const ACTIVE_GH_STORAGE_KEY = 'edens_active_greenhouse_id';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export type ExplicitDeviceConnectionState =
  | 'CONFIGURATION_REQUIRED'
  | 'WAITING_FOR_FIRST_CONNECTION'
  | 'ONLINE'
  | 'STALE'
  | 'OFFLINE'
  | 'AUTHENTICATION_ERROR'
  | 'CONNECTION_ERROR';

export interface DeviceErrorInfo {
  category: 'auth' | 'connection';
  code: string;
  message: string;
  timestamp: string;
}

export interface GreenhouseSummary {
  id: string;
  name: string;
  locationLabel: string;
  cropType: string;
  ownerUserId: string;
  role: 'owner' | 'operator' | 'viewer';
  wifiProvisioningMethod: 'guided_secrets_header' | 'softap_portal_pending';
  wifiProvisioningState: 'unconfigured' | 'credentials_staged' | 'pending_firmware_ap' | 'verified_online';
  wifiSsidHint: string | null;
  overallStatus: 'ONLINE' | 'PARTIAL' | 'STALE' | 'OFFLINE' | 'SETUP_INCOMPLETE';
  createdAt: string;
  updatedAt: string;
  camera: {
    deviceId: string | null;
    provisioningStatus: string;
    hasCredentialIssued: boolean;
    explicitState?: ExplicitDeviceConnectionState;
    connectionStatus: 'CONNECTED' | 'STALE' | 'DISCONNECTED' | 'AWAITING_FIRST_CHECKIN' | 'PENDING_SETUP' | 'REVOKED';
    freshness: 'FRESH' | 'CACHED' | 'STALE' | 'NONE';
    isFresh: boolean;
    isLiveStream: false;
    lastCaptureAt: string | null;
    lastUploadAt?: string | null;
    ageSeconds: number | null;
    lastSeenAt: string | null;
    lastError?: DeviceErrorInfo | null;
  };
  controller: {
    deviceId: string | null;
    provisioningStatus: string;
    hasCredentialIssued: boolean;
    explicitState?: ExplicitDeviceConnectionState;
    connectionStatus: 'CONNECTED' | 'STALE' | 'DISCONNECTED' | 'AWAITING_FIRST_CHECKIN' | 'PENDING_SETUP' | 'REVOKED';
    dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED';
    lastTelemetryAt: string | null;
    lastUploadAt?: string | null;
    ageSeconds: number | null;
    lastSeenAt: string | null;
    lastError?: DeviceErrorInfo | null;
    readings: {
      temperature: number | null;
      humidity: number | null;
      soilMoisture: number | null;
      sunlight: number | null;
      growLight: number | null;
      waterLevel: number | null;
      batteryVoltage: number | null;
      rain: boolean | null;
      rainGaugeLevel: number | null;
    } | null;
  };
}

export type AuthActionResult =
  | {
      ok: true;
      user: AuthUser;
      kind?: undefined;
      errorCode?: undefined;
      message?: undefined;
      retryAfterSeconds?: undefined;
    }
  | {
      ok: false;
      kind: ApiErrorKind;
      errorCode: string;
      message: string;
      retryAfterSeconds?: number;
    };

function clearLegacyWebStorageTokens(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    }
  } catch {}
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('botanix_auth');
      localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    }
  } catch {}
}

export async function apiFetch(input: string, init: ApiFetchOptions = {}): Promise<Response> {
  return coreApiFetch(input, init);
}

/**
 * Shared authentication client executor used by AuthProvider and verified by integration tests.
 * Validates HTTP status + Content-Type, never calls `res.json()` blindly, and never stores raw
 * session tokens in Web Storage.
 */
export async function executeAuthAction(
  mode: 'login' | 'register',
  payload: { displayName?: string; email: string; password: string },
  options: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    authMode?: 'cookie' | 'memory';
  } = {}
): Promise<AuthActionResult> {
  const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
  const effectiveAuthMode =
    options.authMode ?? (isEmbeddedIframeContext() ? 'memory' : 'cookie');
  const body =
    mode === 'register'
      ? {
          displayName: String(payload.displayName || '').trim(),
          email: String(payload.email || '').trim(),
          password: payload.password
        }
      : {
          email: String(payload.email || '').trim(),
          password: payload.password
        };

  let res: Response;
  try {
    res = await coreApiFetch(endpoint, {
      method: 'POST',
      headers: {
        'X-Edens-Auth-Mode': effectiveAuthMode === 'memory' ? 'embedded' : 'cookie'
      },
      body: JSON.stringify(body),
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl
    });
  } catch (err) {
    const netFailure = classifyNetworkFailure(err);
    return {
      ok: false,
      kind: netFailure.kind,
      errorCode: netFailure.errorCode,
      message: netFailure.message
    };
  }

  const parsed = await parseApiJsonResponse<{
    success?: boolean;
    user?: AuthUser;
    sessionToken?: string;
    expiresAt?: string;
    message?: string;
    error?: string;
  }>(res, mode);

  if (!parsed.ok) {
    return {
      ok: false,
      kind: parsed.kind,
      errorCode: parsed.errorCode,
      message: parsed.message,
      retryAfterSeconds: parsed.retryAfterSeconds
    };
  }

  if (!parsed.data?.success || !parsed.data?.user?.id || !parsed.data?.user?.email) {
    return {
      ok: false,
      kind: 'INVALID_SERVER_RESPONSE',
      errorCode: 'MALFORMED_AUTH_PAYLOAD',
      message: 'The server returned an incomplete authentication payload. Please try again.'
    };
  }

  if (effectiveAuthMode === 'memory' && typeof parsed.data.sessionToken === 'string') {
    setInMemorySessionToken(parsed.data.sessionToken);
  }

  return {
    ok: true,
    user: parsed.data.user
  };
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  hasRegisteredUsers: boolean | null;
  greenhouses: GreenhouseSummary[];
  activeGreenhouse: GreenhouseSummary | null;
  setActiveGreenhouseId: (id: string | null) => void;
  refreshSession: () => Promise<boolean>;
  login: (email: string, password: string) => Promise<AuthActionResult>;
  register: (displayName: string, email: string, password: string) => Promise<AuthActionResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRegisteredUsers, setHasRegisteredUsers] = useState<boolean | null>(null);
  const [greenhouses, setGreenhouses] = useState<GreenhouseSummary[]>([]);
  const [activeGreenhouseId, setActiveGhState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ACTIVE_GH_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    clearLegacyWebStorageTokens();
  }, []);

  const setActiveGreenhouseId = useCallback((id: string | null) => {
    setActiveGhState(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_GH_STORAGE_KEY, id);
      else sessionStorage.removeItem(ACTIVE_GH_STORAGE_KEY);
    } catch {}
  }, []);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await coreApiFetch('/api/auth/session');
      if (!res.ok) {
        clearInMemorySessionToken();
        setUser(null);
        setGreenhouses([]);
        return false;
      }
      const parsed = await parseApiJsonResponse<{
        authenticated?: boolean;
        hasRegisteredUsers?: boolean;
        user?: AuthUser;
        greenhouses?: GreenhouseSummary[];
      }>(res, 'session');

      if (parsed.ok && typeof parsed.data?.hasRegisteredUsers === 'boolean') {
        setHasRegisteredUsers(parsed.data.hasRegisteredUsers);
      }

      if (parsed.ok && parsed.data?.authenticated && parsed.data?.user) {
        setUser(parsed.data.user);
        const list: GreenhouseSummary[] = Array.isArray(parsed.data.greenhouses)
          ? parsed.data.greenhouses
          : [];
        setGreenhouses(list);
        if (list.length > 0) {
          setActiveGhState((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0].id));
        }
        return true;
      }

      clearInMemorySessionToken();
      setUser(null);
      setGreenhouses([]);
      return false;
    } catch {
      setUser(null);
      setGreenhouses([]);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      const result = await executeAuthAction('login', { email, password });
      if (!result.ok) {
        return result;
      }

      let sessionConfirmed = await refreshSession();
      if (!sessionConfirmed && !isEmbeddedIframeContext()) {
        // Browser blocked Set-Cookie on a top-level page (e.g. strict cookie blocker or cross-origin ITP);
        // fall back seamlessly to private JS module memory (never localStorage or sessionStorage).
        const memFallback = await executeAuthAction(
          'login',
          { email, password },
          { authMode: 'memory' }
        );
        if (memFallback.ok) {
          sessionConfirmed = await refreshSession();
        }
      }

      if (!sessionConfirmed) {
        return {
          ok: false,
          kind: 'AUTH_OR_SESSION_FAILED',
          errorCode: 'SESSION_COOKIE_BLOCKED',
          message:
            'Sign-in succeeded, but your browser blocked session storage. Enable cookies for this site and try again.'
        };
      }

      return result;
    },
    [refreshSession]
  );

  const register = useCallback(
    async (displayName: string, email: string, password: string): Promise<AuthActionResult> => {
      const result = await executeAuthAction('register', { displayName, email, password });
      if (!result.ok) {
        return result;
      }

      let sessionConfirmed = await refreshSession();
      if (!sessionConfirmed && !isEmbeddedIframeContext()) {
        const memFallback = await executeAuthAction(
          'login',
          { email, password },
          { authMode: 'memory' }
        );
        if (memFallback.ok) {
          sessionConfirmed = await refreshSession();
        }
      }

      if (!sessionConfirmed) {
        return {
          ok: false,
          kind: 'AUTH_OR_SESSION_FAILED',
          errorCode: 'SESSION_COOKIE_BLOCKED',
          message:
            'Your account was created, but your browser blocked the session cookie. Sign in again with cookies enabled.'
        };
      }

      return result;
    },
    [refreshSession]
  );

  const logout = useCallback(async () => {
    try {
      await coreApiFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    clearInMemorySessionToken();
    clearLegacyWebStorageTokens();
    setUser(null);
    setGreenhouses([]);
    setActiveGreenhouseId(null);
  }, [setActiveGreenhouseId]);

  const activeGreenhouse =
    greenhouses.find((g) => g.id === activeGreenhouseId) || greenhouses[0] || null;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        hasRegisteredUsers,
        greenhouses,
        activeGreenhouse,
        setActiveGreenhouseId,
        refreshSession,
        login,
        register,
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
