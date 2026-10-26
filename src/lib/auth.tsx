import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

const SESSION_STORAGE_KEY = 'edens_session_token';
const ACTIVE_GH_STORAGE_KEY = 'edens_active_greenhouse_id';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
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
    connectionStatus: 'CONNECTED' | 'STALE' | 'DISCONNECTED' | 'AWAITING_FIRST_CHECKIN' | 'PENDING_SETUP' | 'REVOKED';
    freshness: 'FRESH' | 'CACHED' | 'STALE' | 'NONE';
    isFresh: boolean;
    isLiveStream: false;
    lastCaptureAt: string | null;
    ageSeconds: number | null;
    lastSeenAt: string | null;
  };
  controller: {
    deviceId: string | null;
    provisioningStatus: string;
    hasCredentialIssued: boolean;
    connectionStatus: 'CONNECTED' | 'STALE' | 'DISCONNECTED' | 'AWAITING_FIRST_CHECKIN' | 'PENDING_SETUP' | 'REVOKED';
    dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE' | 'DISCONNECTED';
    lastTelemetryAt: string | null;
    ageSeconds: number | null;
    lastSeenAt: string | null;
    readings: {
      temperature: number;
      humidity: number;
      soilMoisture: number;
      sunlight: number | null;
      growLight: number | null;
      waterLevel: number | null;
      batteryVoltage: number | null;
      rain: boolean;
      rainGaugeLevel: number | null;
    } | null;
  };
}

export function getStoredSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredSessionToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota / privacy mode errors; HttpOnly cookie remains primary
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getStoredSessionToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers
  });
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  greenhouses: GreenhouseSummary[];
  activeGreenhouse: GreenhouseSummary | null;
  setActiveGreenhouseId: (id: string | null) => void;
  refreshSession: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  register: (
    displayName: string,
    email: string,
    password: string
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [greenhouses, setGreenhouses] = useState<GreenhouseSummary[]>([]);
  const [activeGreenhouseId, setActiveGhState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ACTIVE_GH_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const setActiveGreenhouseId = useCallback((id: string | null) => {
    setActiveGhState(id);
    try {
      if (id) sessionStorage.setItem(ACTIVE_GH_STORAGE_KEY, id);
      else sessionStorage.removeItem(ACTIVE_GH_STORAGE_KEY);
    } catch {}
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/me');
      if (!res.ok) {
        setUser(null);
        setGreenhouses([]);
        setStoredSessionToken(null);
        return;
      }
      const data = await res.json();
      if (data.authenticated && data.user) {
        setUser(data.user);
        const list: GreenhouseSummary[] = Array.isArray(data.greenhouses) ? data.greenhouses : [];
        setGreenhouses(list);
        if (list.length > 0) {
          setActiveGhState((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0].id));
        }
      } else {
        setUser(null);
        setGreenhouses([]);
      }
    } catch {
      setUser(null);
      setGreenhouses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          return { ok: false, message: data.message || 'Sign in failed.' };
        }
        if (data.sessionToken) {
          setStoredSessionToken(data.sessionToken);
        }
        setUser(data.user);
        await refreshSession();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, message: err?.message || 'Network error while signing in.' };
      }
    },
    [refreshSession]
  );

  const register = useCallback(
    async (
      displayName: string,
      email: string,
      password: string
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        const res = await apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ displayName, email, password })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          return { ok: false, message: data.message || 'Registration failed.' };
        }
        if (data.sessionToken) {
          setStoredSessionToken(data.sessionToken);
        }
        setUser(data.user);
        await refreshSession();
        return { ok: true };
      } catch (err: any) {
        return { ok: false, message: err?.message || 'Network error during registration.' };
      }
    },
    [refreshSession]
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setStoredSessionToken(null);
    localStorage.removeItem('botanix_auth');
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
