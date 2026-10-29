import { useState, useEffect, useCallback } from 'react';
import { hardwareService } from './hardwareService';
import { apiFetch, parseApiJsonResponse, resolveApiUrl } from './api.ts';
import { store } from './store';

export type CameraTransportMethod = 'auto' | 'cloud_upload' | 'lan_gateway' | 'lan_direct';

export type CameraConnectionStatus =
  | 'CONNECTING'
  | 'LIVE_STREAM'
  | 'CONNECTED_FRESH'
  | 'STALE'
  | 'RECONNECTING'
  | 'DISCONNECTED'
  | 'ERROR';

export type CanonicalConnectionBadge = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';
export type CanonicalFreshnessBadge = 'FRESH' | 'STALE' | null;

export interface CameraAddressConfig {
  host: string;
  httpPort: number;
  streamPort: number;
  photoPath: string;
  statusPath: string;
  streamPath: string;
  method: CameraTransportMethod;
  pollIntervalMs: number;
}

export interface LatestCameraSnapshot {
  id: string;
  timestamp: string;
  capturedAt: string;
  ageSeconds: number;
  freshness: 'FRESH' | 'CACHED' | 'STALE';
  isFresh: boolean;
  isStale: boolean;
  sizeBytes: number;
  url: string;
  base64?: string;
  acquisitionMethod: 'ESP32_CAM_UPLOAD' | 'LAN_GATEWAY_PULL';
  analyzed?: boolean;
  dataSource: 'REAL_HARDWARE' | 'CACHED' | 'STALE';
}

export interface CameraManagerSnapshot {
  config: CameraAddressConfig;
  status: CameraConnectionStatus;
  connectionBadge: CanonicalConnectionBadge;
  freshnessBadge: CanonicalFreshnessBadge;
  activeMethodLabel: string;
  statusHeadline: string;
  statusDetail: string;
  latestFrame: LatestCameraSnapshot | null;
  displayAgeSeconds: number | null;
  lastImageTimestamp: string | null;
  liveStreamCandidateUrl: string | null;
  isLiveStreamVerified: boolean;
  isHttpsPrivateLanBlocked: boolean;
  authConfigured: boolean;
  cloudHosted: boolean;
  lanReachable: boolean;
  totalUploadsCount: number;
  freshMaxSeconds: number;
  reconnectAttempt: number;
  nextRetryInSeconds: number | null;
  errorMessage: string | null;
  isRefreshing: boolean;
}

const STORAGE_KEY = 'edens_camera_manager_config_v2';

export const DEFAULT_CAMERA_ADDRESS_CONFIG: CameraAddressConfig = {
  host: '',
  httpPort: 80,
  streamPort: 81,
  photoPath: '/photo',
  statusPath: '/status',
  streamPath: '/stream',
  method: 'cloud_upload',
  pollIntervalMs: 5000
};

export function isPrivateLanAddress(host: string): boolean {
  const clean = host.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
  if (!clean) return false;
  if (clean.endsWith('.local')) return true;
  const parts = clean.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function formatFrameAge(ageSeconds: number | null): string {
  if (ageSeconds === null || !Number.isFinite(ageSeconds) || ageSeconds < 0) {
    return 'N/A';
  }
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`;
  }
  const mins = Math.floor(ageSeconds / 60);
  const secs = ageSeconds % 60;
  if (mins < 60) {
    return `${mins}m ${String(secs).padStart(2, '0')}s ago`;
  }
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m ago`;
}

function sanitizeHostInput(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (!trimmed || trimmed.includes('placeholder-ip')) {
    return '';
  }
  try {
    const u = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `http://${trimmed}`);
    return u.hostname;
  } catch (_) {
    return trimmed.replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  }
}

function deriveBadges(
  status: CameraConnectionStatus,
  latestFrame: LatestCameraSnapshot | null
): { connectionBadge: CanonicalConnectionBadge; freshnessBadge: CanonicalFreshnessBadge } {
  if (status === 'RECONNECTING' || status === 'CONNECTING') {
    return {
      connectionBadge: 'RECONNECTING',
      freshnessBadge: latestFrame ? (latestFrame.isFresh ? 'FRESH' : 'STALE') : null
    };
  }
  if (status === 'LIVE_STREAM') {
    return {
      connectionBadge: 'CONNECTED',
      freshnessBadge: 'FRESH'
    };
  }
  if (status === 'CONNECTED_FRESH' && latestFrame?.isFresh) {
    return {
      connectionBadge: 'CONNECTED',
      freshnessBadge: 'FRESH'
    };
  }
  if (latestFrame) {
    return {
      connectionBadge: 'DISCONNECTED',
      freshnessBadge: latestFrame.isFresh ? 'FRESH' : 'STALE'
    };
  }
  return {
    connectionBadge: 'DISCONNECTED',
    freshnessBadge: null
  };
}

class CameraConnectionManager {
  private config: CameraAddressConfig;
  private listeners = new Set<() => void>();
  private subscriberCount = 0;

  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private secondTicker: ReturnType<typeof setInterval> | null = null;
  private inFlightPromise: Promise<LatestCameraSnapshot | null> | null = null;

  private state: Omit<
    CameraManagerSnapshot,
    'config' | 'displayAgeSeconds' | 'connectionBadge' | 'freshnessBadge'
  > = {
    status: 'CONNECTING',
    activeMethodLabel: 'Cloud Camera Feed',
    statusHeadline: 'Checking greenhouse camera feed...',
    statusDetail: 'Synchronizing latest ESP32-CAM snapshot from EDENS AI cloud.',
    latestFrame: null,
    lastImageTimestamp: null,
    liveStreamCandidateUrl: null,
    isLiveStreamVerified: false,
    isHttpsPrivateLanBlocked: false,
    authConfigured: true,
    cloudHosted: true,
    lanReachable: false,
    totalUploadsCount: 0,
    freshMaxSeconds: 90,
    reconnectAttempt: 0,
    nextRetryInSeconds: null,
    errorMessage: null,
    isRefreshing: false
  };

  private nextRetryAtMs: number | null = null;

  constructor() {
    this.config = this.loadInitialConfig();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleNetworkOnline);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private loadInitialConfig(): CameraAddressConfig {
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          host: sanitizeHostInput(parsed.host || ''),
          httpPort: Number(parsed.httpPort) || 80,
          streamPort: Number(parsed.streamPort) || 81,
          photoPath: parsed.photoPath || '/photo',
          statusPath: parsed.statusPath || '/status',
          streamPath: parsed.streamPath || '/stream',
          method: ['auto', 'cloud_upload', 'lan_gateway', 'lan_direct'].includes(parsed.method)
            ? parsed.method
            : 'cloud_upload',
          pollIntervalMs: Math.max(3000, Number(parsed.pollIntervalMs) || 5000)
        };
      }
    } catch (_) {}

    const hwConfig = hardwareService.getConfig();
    const initialHost = sanitizeHostInput(hwConfig.cameraHost || '');

    return {
      ...DEFAULT_CAMERA_ADDRESS_CONFIG,
      host: initialHost,
      streamPort: hwConfig.cameraPort || 81,
      photoPath: hwConfig.cameraCapturePath || '/photo',
      statusPath: hwConfig.cameraStatusPath || '/status',
      streamPath: hwConfig.cameraStreamPath || '/stream'
    };
  }

  public updateConfig(partial: Partial<CameraAddressConfig>): void {
    const nextHost = partial.host !== undefined ? sanitizeHostInput(partial.host) : this.config.host;
    const nextHttpPort =
      partial.httpPort !== undefined
        ? Math.max(1, Math.min(65535, Number(partial.httpPort) || 80))
        : this.config.httpPort;
    const nextStreamPort =
      partial.streamPort !== undefined
        ? Math.max(1, Math.min(65535, Number(partial.streamPort) || 81))
        : this.config.streamPort;
    const normalizePath = (p: string | undefined, def: string) => {
      if (!p) return def;
      const t = p.trim();
      return t.startsWith('/') ? t : `/${t}`;
    };

    this.config = {
      ...this.config,
      ...partial,
      host: nextHost,
      httpPort: nextHttpPort,
      streamPort: nextStreamPort,
      photoPath:
        partial.photoPath !== undefined ? normalizePath(partial.photoPath, '/photo') : this.config.photoPath,
      statusPath:
        partial.statusPath !== undefined ? normalizePath(partial.statusPath, '/status') : this.config.statusPath,
      streamPath:
        partial.streamPath !== undefined ? normalizePath(partial.streamPath, '/stream') : this.config.streamPath,
      pollIntervalMs: Math.max(3000, Number(partial.pollIntervalMs ?? this.config.pollIntervalMs) || 5000)
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    } catch (_) {}

    const currentHw = hardwareService.getConfig();
    if (
      currentHw.cameraHost !== this.config.host ||
      currentHw.cameraPort !== this.config.streamPort ||
      currentHw.cameraCapturePath !== this.config.photoPath
    ) {
      hardwareService.updateConfig({
        cameraHost: this.config.host,
        cameraPort: this.config.streamPort,
        cameraCapturePath: this.config.photoPath,
        cameraStatusPath: this.config.statusPath,
        cameraStreamPath: this.config.streamPath
      });
    }

    this.state.isLiveStreamVerified = false;
    this.state.reconnectAttempt = 0;
    this.state.errorMessage = null;
    this.state.status = 'CONNECTING';
    this.notify();
    void this.refreshNow(false);
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.subscriberCount += 1;
    if (this.subscriberCount === 1) {
      this.startLifecycle();
    }
    return () => {
      this.listeners.delete(listener);
      this.subscriberCount = Math.max(0, this.subscriberCount - 1);
      if (this.subscriberCount === 0) {
        this.stopLifecycle();
      }
    };
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  private handleNetworkOnline = (): void => {
    if (this.subscriberCount > 0) {
      this.state.reconnectAttempt = 0;
      void this.refreshNow(false);
    }
  };

  private handleVisibilityChange = (): void => {
    if (this.subscriberCount > 0 && document.visibilityState === 'visible') {
      void this.refreshNow(false);
    }
  };

  private startLifecycle(): void {
    void this.refreshNow(false);
    if (!this.secondTicker) {
      this.secondTicker = setInterval(() => {
        this.tickAgesAndCountdown();
      }, 1000);
    }
  }

  private stopLifecycle(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.secondTicker) {
      clearInterval(this.secondTicker);
      this.secondTicker = null;
    }
  }

  private computeLiveAgeSeconds(): number | null {
    if (!this.state.lastImageTimestamp) return null;
    const ms = new Date(this.state.lastImageTimestamp).getTime();
    if (!Number.isFinite(ms)) return null;
    return Math.max(0, Math.round((Date.now() - ms) / 1000));
  }

  /**
   * Real-time 1s age & retry ticker.
   * Automatically downgrades a snapshot from FRESH to STALE the moment it exceeds
   * freshMaxSeconds so an older photograph is never presented as live.
   */
  private tickAgesAndCountdown(): void {
    let changed = false;

    if (this.nextRetryAtMs !== null) {
      const rem = Math.max(0, Math.ceil((this.nextRetryAtMs - Date.now()) / 1000));
      if (rem !== this.state.nextRetryInSeconds) {
        this.state.nextRetryInSeconds = rem;
        changed = true;
      }
    }

    const liveAge = this.computeLiveAgeSeconds();
    if (liveAge !== null && this.state.latestFrame) {
      const freshLimit = this.state.freshMaxSeconds || 90;
      const nowFresh = liveAge <= freshLimit;
      if (this.state.latestFrame.isFresh !== nowFresh) {
        this.state.latestFrame = {
          ...this.state.latestFrame,
          ageSeconds: liveAge,
          isFresh: nowFresh,
          isStale: !nowFresh,
          freshness: nowFresh ? 'FRESH' : liveAge <= 300 ? 'CACHED' : 'STALE',
          dataSource: nowFresh ? 'REAL_HARDWARE' : liveAge <= 300 ? 'CACHED' : 'STALE'
        };

        if (!nowFresh && this.state.status === 'CONNECTED_FRESH' && !this.state.isLiveStreamVerified) {
          this.state.status = 'STALE';
          this.state.statusHeadline = 'Stale Snapshot · Camera Idle or Disconnected';
          this.state.statusDetail = `Last greenhouse photograph arrived ${formatFrameAge(liveAge)}. Waiting for a fresh ESP32-CAM upload.`;
          store.setValue('cameraUploadActive', false);
        }
        changed = true;
      } else if (this.listeners.size > 0) {
        changed = true;
      }
    }

    if (changed) {
      this.notify();
    }
  }

  public notifyStreamLoaded(): void {
    if (!this.state.liveStreamCandidateUrl) return;
    this.state.isLiveStreamVerified = true;
    this.state.reconnectAttempt = 0;
    this.state.errorMessage = null;
    this.state.status = 'LIVE_STREAM';
    this.state.statusHeadline = 'Connected · Live Stream';
    this.state.statusDetail = 'Receiving continuous MJPEG camera stream on local network.';
    store.setValue('cameraStreamOnline', true);
    this.notify();
  }

  public notifyStreamError(): void {
    if (!this.state.liveStreamCandidateUrl) return;
    this.state.isLiveStreamVerified = false;
    this.state.liveStreamCandidateUrl = null;
    store.setValue('cameraStreamOnline', false);

    if (this.state.latestFrame?.isFresh) {
      this.state.status = 'CONNECTED_FRESH';
      this.state.statusHeadline = 'Connected · Fresh Cloud Snapshot';
      this.state.statusDetail = 'Displaying auto-refreshing JPEG snapshots from EDENS AI cloud.';
    } else {
      this.scheduleReconnect('Camera stream unavailable. Reconnecting to cloud camera feed...');
    }
    this.notify();
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    if (this.subscriberCount <= 0) return;
    this.nextRetryAtMs = null;
    this.state.nextRetryInSeconds = null;
    this.pollTimer = setTimeout(() => {
      void this.refreshNow(false);
    }, delayMs);
  }

  private scheduleReconnect(reason: string): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    this.state.reconnectAttempt += 1;
    const backoffSeconds = Math.min(24, 3 * Math.pow(2, Math.min(3, this.state.reconnectAttempt - 1)));
    this.nextRetryAtMs = Date.now() + backoffSeconds * 1000;
    this.state.nextRetryInSeconds = backoffSeconds;
    this.state.status = 'RECONNECTING';
    this.state.statusHeadline = `Reconnecting (Attempt #${this.state.reconnectAttempt})`;
    this.state.statusDetail = reason;
    this.state.errorMessage = reason;

    if (this.subscriberCount > 0) {
      this.pollTimer = setTimeout(() => {
        void this.refreshNow(false);
      }, backoffSeconds * 1000);
    }
  }

  public getSnapshot(): CameraManagerSnapshot {
    const badges = deriveBadges(this.state.status, this.state.latestFrame);
    return {
      ...this.state,
      ...badges,
      config: { ...this.config },
      displayAgeSeconds: this.computeLiveAgeSeconds()
    };
  }

  public reconnectNow(): Promise<LatestCameraSnapshot | null> {
    this.state.reconnectAttempt = 0;
    this.state.errorMessage = null;
    this.state.status = 'CONNECTING';
    this.notify();
    return this.refreshNow(false);
  }

  public async refreshNow(forceLanSync: boolean = false): Promise<LatestCameraSnapshot | null> {
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = this.performRefresh(forceLanSync).finally(() => {
      this.inFlightPromise = null;
    });
    return this.inFlightPromise;
  }

  private async performRefresh(forceLanSync: boolean): Promise<LatestCameraSnapshot | null> {
    this.state.isRefreshing = true;
    this.notify();

    const isHttpsOrigin =
      typeof window !== 'undefined' && window.location.protocol === 'https:';
    const hasConfiguredHost = Boolean(this.config.host);
    const hostIsPrivateLan = hasConfiguredHost && isPrivateLanAddress(this.config.host);
    const httpsPrivateLanBlocked = isHttpsOrigin && hostIsPrivateLan;
    this.state.isHttpsPrivateLanBlocked = httpsPrivateLanBlocked;

    if (hasConfiguredHost && /\s/.test(this.config.host)) {
      this.state.isRefreshing = false;
      this.state.status = 'ERROR';
      this.state.errorMessage = 'Invalid camera hostname configured.';
      this.state.statusHeadline = 'Camera Configuration Error';
      this.state.statusDetail = this.state.errorMessage;
      this.notify();
      return null;
    }

    if (this.config.method === 'lan_direct' && httpsPrivateLanBlocked) {
      this.state.isRefreshing = false;
      this.state.status = 'ERROR';
      this.state.activeMethodLabel = 'Cloud Camera Feed';
      this.state.errorMessage =
        'Browsers block plain HTTP requests to private LAN devices from an HTTPS page. Use Cloud Camera Feed mode.';
      this.state.statusHeadline = 'HTTPS Mixed-Content Restriction';
      this.state.statusDetail = this.state.errorMessage;
      this.notify();
      return null;
    }

    try {
      const infoRes = await apiFetch('/api/camera/upload-info', { cache: 'no-store' });
      const parsedInfo = await parseApiJsonResponse<any>(infoRes);
      if (!parsedInfo.ok) {
        throw new Error(parsedInfo.message || `Camera service returned HTTP ${infoRes.status}`);
      }
      const info = parsedInfo.data;
      const cloudHosted = Boolean(info.cloudHosted) || isHttpsOrigin;
      const authConfigured = Boolean(info.authConfigured);
      const freshMaxSeconds = Number(info.freshMaxSeconds) || 90;

      this.state.cloudHosted = cloudHosted;
      this.state.authConfigured = authConfigured;
      this.state.freshMaxSeconds = freshMaxSeconds;

      let lanReachable = false;
      let candidateStreamUrl: string | null = null;
      let methodLabel = 'Cloud Camera Feed';

      const shouldAttemptLanGateway =
        hasConfiguredHost &&
        (this.config.method === 'lan_gateway' ||
          (this.config.method === 'auto' && !cloudHosted));

      if (shouldAttemptLanGateway) {
        try {
          const statusQuery = new URLSearchParams({
            host: this.config.host,
            httpPort: String(this.config.httpPort),
            streamPort: String(this.config.streamPort),
            statusPath: this.config.statusPath,
            streamPath: this.config.streamPath
          });
          const lanStatusRes = await apiFetch(`/api/camera/lan/status?${statusQuery.toString()}`, {
            cache: 'no-store'
          });
          const parsedLan = await parseApiJsonResponse<any>(lanStatusRes);
          if (parsedLan.ok) {
            const lanData = parsedLan.data;
            lanReachable = Boolean(lanData.lanReachable);
            if (lanReachable) {
              methodLabel = 'Local Gateway Camera Feed';
              candidateStreamUrl = lanData.proxyStreamUrl
                ? resolveApiUrl(lanData.proxyStreamUrl)
                : null;
              await apiFetch('/api/camera/lan/sync', {
                method: 'POST',
                body: JSON.stringify({
                  host: this.config.host,
                  httpPort: this.config.httpPort,
                  streamPort: this.config.streamPort,
                  photoPath: this.config.photoPath
                })
              });
            } else if (this.config.method === 'lan_gateway') {
              const errReason =
                lanData.message || lanData.error || 'Local network camera is currently unreachable.';
              this.state.isRefreshing = false;
              this.state.lanReachable = false;
              this.state.activeMethodLabel = 'Local Gateway Camera Feed';
              this.scheduleReconnect(errReason);
              this.notify();
              return null;
            }
          }
        } catch (lanErr: any) {
          if (this.config.method === 'lan_gateway') {
            this.state.isRefreshing = false;
            this.scheduleReconnect(lanErr?.message || 'Local camera sync failed.');
            this.notify();
            return null;
          }
        }
      } else if (this.config.method === 'lan_direct' && hasConfiguredHost && !isHttpsOrigin) {
        methodLabel = 'Local Browser Camera Feed';
        const streamOrigin =
          this.config.streamPort === 80
            ? `http://${this.config.host}`
            : `http://${this.config.host}:${this.config.streamPort}`;
        candidateStreamUrl = `${streamOrigin}${this.config.streamPath}`;

        if (forceLanSync) {
          await apiFetch('/api/camera/lan/sync', {
            method: 'POST',
            body: JSON.stringify({
              host: this.config.host,
              httpPort: this.config.httpPort,
              photoPath: this.config.photoPath
            })
          }).catch(() => {});
        }
      }

      this.state.lanReachable = lanReachable;
      this.state.activeMethodLabel = methodLabel;
      if (candidateStreamUrl !== this.state.liveStreamCandidateUrl) {
        this.state.liveStreamCandidateUrl = candidateStreamUrl;
        if (!candidateStreamUrl) {
          this.state.isLiveStreamVerified = false;
        }
      }

      // Retrieve latest validated JPEG snapshot from EDENS AI backend
      const latestRes = await apiFetch('/api/camera/latest', { cache: 'no-store' });
      const parsedLatest = await parseApiJsonResponse<any>(latestRes);
      if (!parsedLatest.ok) {
        throw new Error(parsedLatest.message || `Camera feed endpoint returned HTTP ${latestRes.status}`);
      }
      const latestJson = parsedLatest.data;
      this.state.totalUploadsCount = Number(latestJson.totalUploadsCount) || 0;

      if (latestJson.exists && latestJson.id && latestJson.timestamp) {
        const isFresh = Boolean(
          latestJson.isFresh ?? Number(latestJson.ageSeconds) <= freshMaxSeconds
        );
        const rawFrameUrl =
          latestJson.url || `/api/camera/latest.jpg?frame=${encodeURIComponent(latestJson.id)}`;
        const snapshot: LatestCameraSnapshot = {
          id: latestJson.id,
          timestamp: latestJson.timestamp,
          capturedAt: latestJson.capturedAt || latestJson.timestamp,
          ageSeconds: Number(latestJson.ageSeconds) || 0,
          freshness: latestJson.freshness || (isFresh ? 'FRESH' : 'STALE'),
          isFresh,
          isStale: !isFresh,
          sizeBytes: Number(latestJson.sizeBytes) || 0,
          url: resolveApiUrl(rawFrameUrl),
          base64: latestJson.base64,
          acquisitionMethod:
            latestJson.acquisitionMethod === 'LAN_GATEWAY_PULL'
              ? 'LAN_GATEWAY_PULL'
              : 'ESP32_CAM_UPLOAD',
          analyzed: Boolean(latestJson.analyzed),
          dataSource: latestJson.dataSource || (isFresh ? 'REAL_HARDWARE' : 'STALE')
        };

        this.state.latestFrame = snapshot;
        this.state.lastImageTimestamp = snapshot.timestamp;
        this.state.reconnectAttempt = 0;
        this.state.errorMessage = null;

        store.setValue('cameraUploadActive', snapshot.isFresh);

        if (this.state.isLiveStreamVerified && this.state.liveStreamCandidateUrl) {
          this.state.status = 'LIVE_STREAM';
          this.state.statusHeadline = 'Connected · Live Stream';
          this.state.statusDetail = 'Receiving continuous MJPEG camera stream.';
        } else if (snapshot.isFresh) {
          this.state.status = 'CONNECTED_FRESH';
          this.state.statusHeadline = 'Connected · Fresh Snapshot';
          this.state.statusDetail =
            'Authenticated ESP32-CAM JPEG snapshot received (periodic snapshot preview, not a continuous video stream).';
        } else {
          this.state.status = 'STALE';
          this.state.statusHeadline = 'Stale Snapshot · Camera Disconnected or Idle';
          this.state.statusDetail = `Showing older greenhouse photograph captured ${formatFrameAge(snapshot.ageSeconds)}. No fresh ESP32-CAM upload in the last ${freshMaxSeconds}s.`;
        }

        this.state.isRefreshing = false;
        this.scheduleNextPoll(this.config.pollIntervalMs);
        this.notify();
        return snapshot;
      }

      // No camera photograph stored on server yet
      this.state.latestFrame = null;
      this.state.lastImageTimestamp = null;
      this.state.reconnectAttempt = 0;
      store.setValue('cameraUploadActive', false);

      if (!authConfigured) {
        this.state.status = 'ERROR';
        this.state.errorMessage =
          'Server camera authentication (CAMERA_UPLOAD_KEY) is not configured yet.';
        this.state.statusHeadline = 'Camera Auth Unconfigured';
        this.state.statusDetail = this.state.errorMessage;
      } else if (this.state.isLiveStreamVerified && this.state.liveStreamCandidateUrl) {
        this.state.status = 'LIVE_STREAM';
        this.state.statusHeadline = 'Connected · Live Stream';
        this.state.statusDetail = 'Receiving continuous MJPEG camera stream.';
      } else {
        this.state.status = 'DISCONNECTED';
        this.state.errorMessage = null;
        this.state.statusHeadline = 'Disconnected · Awaiting Camera Upload';
        this.state.statusDetail =
          'No greenhouse camera photograph has arrived on the cloud server yet. The preview updates automatically as soon as the ESP32-CAM uploads a frame.';
      }

      this.state.isRefreshing = false;
      this.scheduleNextPoll(this.config.pollIntervalMs);
      this.notify();
      return null;
    } catch (err: any) {
      this.state.isRefreshing = false;
      this.scheduleReconnect(
        err?.message || 'Temporary interruption reaching EDENS AI camera service. Reconnecting...'
      );
      this.notify();
      return null;
    }
  }
}

export const cameraConnectionManager = new CameraConnectionManager();

export function useCameraConnection() {
  const [snapshot, setSnapshot] = useState<CameraManagerSnapshot>(() =>
    cameraConnectionManager.getSnapshot()
  );

  useEffect(() => {
    const unsub = cameraConnectionManager.subscribe(() => {
      setSnapshot(cameraConnectionManager.getSnapshot());
    });
    return unsub;
  }, []);

  const updateConfig = useCallback((partial: Partial<CameraAddressConfig>) => {
    cameraConnectionManager.updateConfig(partial);
  }, []);

  const refreshNow = useCallback((forceLanSync: boolean = false) => {
    return cameraConnectionManager.refreshNow(forceLanSync);
  }, []);

  const reconnectNow = useCallback(() => {
    return cameraConnectionManager.reconnectNow();
  }, []);

  const notifyStreamLoaded = useCallback(() => {
    cameraConnectionManager.notifyStreamLoaded();
  }, []);

  const notifyStreamError = useCallback(() => {
    cameraConnectionManager.notifyStreamError();
  }, []);

  return {
    ...snapshot,
    updateConfig,
    refreshNow,
    reconnectNow,
    notifyStreamLoaded,
    notifyStreamError
  };
}
