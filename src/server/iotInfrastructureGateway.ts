import type http from 'node:http';
import net from 'node:net';
import express from 'express';
import { Aedes, type Client as AedesClient } from 'aedes';
import { WebSocketServer, WebSocket, createWebSocketStream } from 'ws';
import type { GreenhouseCameraStoreRegistry } from './cameraAcquisition.ts';
import type { AuthenticatedUser, DeviceRecord, PlatformDatabase } from './database.ts';
import { extractClientIp, extractSessionToken, getPublicOrigin } from './greenhouseRoutes.ts';
import {
  SlidingWindowRateLimiter,
  hasDisallowedQuerySecret,
  redactSecretsFromText
} from './telemetryContract.ts';
import {
  UniversalDeviceAdapter,
  generateEspHomeDeviceYaml
} from './universalDeviceAdapter.ts';

interface AuthenticatedAedesClient extends AedesClient {
  edensDevice?: DeviceRecord;
  remoteIp?: string;
}

interface UiSocketSession {
  ws: WebSocket;
  userId: string;
  greenhouseId: string;
}

function authenticateAnyDeviceKey(
  platformDb: PlatformDatabase,
  rawKey: string,
  claimedDeviceId?: string,
  claimedGreenhouseId?: string
):
  | { ok: true; device: DeviceRecord }
  | { ok: false; statusCode: number; errorCode: string; message: string } {
  const trimmed = String(rawKey || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      statusCode: 401,
      errorCode: 'MISSING_DEVICE_CREDENTIAL',
      message: 'Missing hardware authentication credential.'
    };
  }

  // Try controller key first, then camera key if prefix suggests camera or controller returned WRONG_DEVICE_TYPE
  const preferredType = trimmed.startsWith('edcam_') ? 'esp32_cam' : 'esp32_controller';
  const primary = platformDb.authenticateDeviceKey({
    rawKey: trimmed,
    expectedType: preferredType,
    claimedGreenhouseId,
    claimedDeviceId
  });
  if (!('errorCode' in primary)) return primary;

  if (primary.errorCode === 'WRONG_DEVICE_TYPE') {
    const fallbackType = preferredType === 'esp32_cam' ? 'esp32_controller' : 'esp32_cam';
    return platformDb.authenticateDeviceKey({
      rawKey: trimmed,
      expectedType: fallbackType,
      claimedGreenhouseId,
      claimedDeviceId
    });
  }

  return primary;
}

function isTopicAuthorizedForDevice(topic: string, device: DeviceRecord): boolean {
  const cleanTopic = String(topic || '').trim();
  if (!cleanTopic) return false;

  // 1. Canonical EDENS multi-tenant namespace:
  //    edens/v1/greenhouses/<greenhouseId>/devices/<deviceId>/...
  const canonicalPrefix = `edens/v1/greenhouses/${device.greenhouseId}/devices/${device.id}/`;
  if (cleanTopic.startsWith(canonicalPrefix) || cleanTopic === canonicalPrefix.slice(0, -1)) {
    return true;
  }

  // 2. Home Assistant / ESPHome Auto-Discovery namespace scoped strictly to this deviceId:
  //    homeassistant/<component>/<deviceId>/<objectId>/config
  if (/^homeassistant\/[a-z_]+\/([^/]+)\/[^/]+\/config$/i.test(cleanTopic)) {
    const parts = cleanTopic.split('/');
    if (parts[2] === device.id) {
      return true;
    }
  }

  // 3. ThingsBoard CE v4.3.1.8 (Apache-2.0) per-session device topic compatibility:
  //    v1/devices/me/telemetry or v1/devices/me/attributes
  if (
    cleanTopic === 'v1/devices/me/telemetry' ||
    cleanTopic === 'v1/devices/me/attributes' ||
    cleanTopic.startsWith('v1/devices/me/rpc/response/')
  ) {
    return true;
  }

  return false;
}

export interface IotInfrastructureRuntime {
  universalAdapter: UniversalDeviceAdapter;
  attachToHttpServer: (httpServer: http.Server) => Promise<void>;
  shutdown: () => Promise<void>;
  getStats: () => {
    mqttConnectedDevices: number;
    deviceWsConnections: number;
    uiWsSubscribers: number;
    tcpBrokerBoundPort: number | null;
  };
}

export function registerUniversalIotInfrastructure(
  app: express.Express,
  deps: {
    platformDb: PlatformDatabase;
    cameraRegistry: GreenhouseCameraStoreRegistry;
  }
): IotInfrastructureRuntime {
  const { platformDb, cameraRegistry } = deps;

  const universalAdapter = new UniversalDeviceAdapter({
    platformDb,
    getCameraStore: (ghId) => cameraRegistry.getStore(ghId)
  });

  const deviceAuthLimiter = new SlidingWindowRateLimiter({ maxRequests: 60, windowMs: 60_000 });
  const ingestLimiter = new SlidingWindowRateLimiter({ maxRequests: 240, windowMs: 60_000 });

  // 1. Embedded Multi-Tenant Aedes MQTT Broker
  const aedes = new Aedes({
    id: 'edens-ai-iot-gateway',
    heartbeatInterval: 30_000,
    connectTimeout: 15_000,
    maxClientsIdLength: 128
  });

  aedes.authenticate = (client, username, passwordBuf, callback) => {
    const authClient = client as AuthenticatedAedesClient;
    const remoteIp = authClient.remoteIp || 'mqtt_peer';

    const rl = deviceAuthLimiter.check(`mqtt_auth:${remoteIp}`);
    if (!rl.allowed) {
      const err: any = new Error('Too many authentication attempts');
      err.returnCode = 5;
      return callback(err, false);
    }

    const rawSecret = passwordBuf
      ? passwordBuf.toString('utf8').trim()
      : username && (username.startsWith('edctrl_') || username.startsWith('edcam_'))
        ? String(username).trim()
        : '';

    const claimedDeviceId =
      username && !username.startsWith('edctrl_') && !username.startsWith('edcam_') && username !== 'device'
        ? String(username).trim()
        : undefined;

    platformDb
      .init()
      .then(() => {
        const authRes = authenticateAnyDeviceKey(platformDb, rawSecret, claimedDeviceId);
        if ('errorCode' in authRes) {
          platformDb.recordDeviceError({
            deviceId: claimedDeviceId || undefined,
            category: 'AUTH',
            errorCode: authRes.errorCode,
            message: `MQTT CONNECT rejected: ${authRes.message}`,
            ipAddress: remoteIp
          });
          const err: any = new Error(authRes.message);
          err.returnCode = 4; // CONNACK: Bad user name or password
          return callback(err, false);
        }

        authClient.edensDevice = authRes.device;
        universalAdapter.recordConnectionTransition({
          deviceId: authRes.device.id,
          greenhouseId: authRes.device.greenhouseId,
          protocol: 'mqtt',
          newState: 'online',
          reason: 'MQTT authenticated session established',
          remoteAddr: remoteIp
        });
        return callback(null, true);
      })
      .catch(() => {
        const err: any = new Error('Internal authentication failure');
        err.returnCode = 3; // Server unavailable
        return callback(err, false);
      });
  };

  aedes.authorizePublish = (client, packet, callback) => {
    if (!client) return callback(null); // Internal broker publish
    const dev = (client as AuthenticatedAedesClient).edensDevice;
    if (!dev) {
      return callback(new Error('Unauthenticated MQTT client'));
    }

    // Re-check revocation on every publish so revoked keys cannot keep streaming on an existing socket
    const freshRow = platformDb
      .getDriver()
      .queryOne<{ revoked_at: string | null; provisioning_status: string }>(
        'SELECT revoked_at, provisioning_status FROM devices WHERE id = ?',
        [dev.id]
      );
    if (!freshRow || freshRow.revoked_at || freshRow.provisioning_status === 'revoked') {
      client.close();
      return callback(new Error('Device credential has been revoked'));
    }

    if (!isTopicAuthorizedForDevice(packet.topic, dev)) {
      return callback(
        new Error(`MQTT ACL violation: device ${dev.id} is not permitted to publish to "${packet.topic}"`)
      );
    }

    return callback(null);
  };

  aedes.authorizeSubscribe = (client, sub, callback) => {
    if (!client) return callback(null, sub);
    const dev = (client as AuthenticatedAedesClient).edensDevice;
    if (!dev) {
      return callback(new Error('Unauthenticated MQTT client'));
    }
    if (!isTopicAuthorizedForDevice(sub.topic.replace(/\/#$/, '/status'), dev)) {
      return callback(
        new Error(`MQTT ACL violation: device ${dev.id} cannot subscribe to "${sub.topic}"`)
      );
    }
    return callback(null, sub);
  };

  aedes.on('publish', (packet, client) => {
    if (!client || packet.topic.startsWith('$SYS/')) return;
    const authClient = client as AuthenticatedAedesClient;
    const dev = authClient.edensDevice;
    if (!dev) return;

    const payloadText = Buffer.isBuffer(packet.payload)
      ? packet.payload.toString('utf8').trim()
      : String(packet.payload || '').trim();

    // Handle LWT / Birth status topic
    if (packet.topic.endsWith('/status')) {
      const lower = payloadText.toLowerCase();
      if (lower === 'offline' || lower === 'disconnected') {
        universalAdapter.recordConnectionTransition({
          deviceId: dev.id,
          greenhouseId: dev.greenhouseId,
          protocol: 'mqtt',
          newState: 'offline',
          reason: 'MQTT LWT / offline status received',
          remoteAddr: authClient.remoteIp || null
        });
      } else if (lower === 'online' || lower === 'connected') {
        platformDb.recordDeviceCheckIn({
          deviceId: dev.id,
          greenhouseId: dev.greenhouseId,
          ipAddress: authClient.remoteIp,
          checkInKind: dev.deviceType === 'esp32_cam' ? 'camera_upload' : 'telemetry_upload'
        });
      }
      return;
    }

    const protocolKind = packet.topic.startsWith('v1/devices/me/') ? 'thingsboard_v1' : 'mqtt';
    universalAdapter.ingestDevicePayload({
      protocol: protocolKind,
      device: dev,
      rawPayload: packet.payload,
      topicOrPath: packet.topic,
      remoteAddr: authClient.remoteIp || 'mqtt_peer'
    });
  });

  aedes.on('clientDisconnect', (client) => {
    const authClient = client as AuthenticatedAedesClient;
    if (authClient.edensDevice) {
      universalAdapter.recordConnectionTransition({
        deviceId: authClient.edensDevice.id,
        greenhouseId: authClient.edensDevice.greenhouseId,
        protocol: 'mqtt',
        newState: 'offline',
        reason: 'MQTT socket closed',
        remoteAddr: authClient.remoteIp || null
      });
    }
  });

  // 2. WebSocket Servers (No-Server mode routed cleanly via HTTP `upgrade`)
  const mqttWss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => {
      if (protocols.has('mqtt')) return 'mqtt';
      if (protocols.has('mqttv3.1')) return 'mqttv3.1';
      return false;
    }
  });
  const deviceWss = new WebSocketServer({ noServer: true });
  const uiWss = new WebSocketServer({ noServer: true });

  const uiSubscribers = new Set<UiSocketSession>();
  let activeDeviceWsCount = 0;
  let tcpMqttServer: net.Server | null = null;
  let tcpBrokerBoundPort: number | null = null;

  mqttWss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const duplex = createWebSocketStream(ws);
    duplex.on('error', () => {
      // Handled by aedes stream lifecycle
    });
    const remoteIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'mqtt_ws';
    const client = aedes.handle(duplex as any) as AuthenticatedAedesClient;
    if (client) {
      client.remoteIp = remoteIp;
    }
  });

  deviceWss.on('connection', (ws: WebSocket, req: http.IncomingMessage, device: DeviceRecord) => {
    activeDeviceWsCount += 1;
    const remoteIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      'device_ws';

    universalAdapter.recordConnectionTransition({
      deviceId: device.id,
      greenhouseId: device.greenhouseId,
      protocol: 'websocket',
      newState: 'online',
      reason: 'Authenticated Device WebSocket connected',
      remoteAddr: remoteIp
    });

    ws.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        ws.send(JSON.stringify({ ok: false, error: 'INVALID_JSON' }));
        return;
      }

      const res = universalAdapter.ingestDevicePayload({
        protocol: 'websocket',
        device,
        rawPayload: parsed,
        topicOrPath: '/api/iot/device-ws',
        remoteAddr: remoteIp
      });
      ws.send(
        JSON.stringify({
          ok: res.ok,
          readingId: res.readingId || null,
          errorCode: res.errorCode || null,
          receivedCount: res.telemetryRecords.length,
          timestamp: new Date().toISOString()
        })
      );
    });

    ws.on('close', () => {
      activeDeviceWsCount = Math.max(0, activeDeviceWsCount - 1);
      universalAdapter.recordConnectionTransition({
        deviceId: device.id,
        greenhouseId: device.greenhouseId,
        protocol: 'websocket',
        newState: 'offline',
        reason: 'Device WebSocket closed',
        remoteAddr: remoteIp
      });
    });
  });

  uiWss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, session: { userId: string; greenhouseId: string }) => {
    const sub: UiSocketSession = {
      ws,
      userId: session.userId,
      greenhouseId: session.greenhouseId
    };
    uiSubscribers.add(sub);

    // Send initial authoritative state (Real-Time Server-as-Source-of-Truth pattern)
    const initPayload = {
      event: 'iot:init',
      greenhouseId: session.greenhouseId,
      timestamp: new Date().toISOString(),
      devices: universalAdapter.listStandardDevicesForGreenhouse(session.greenhouseId),
      telemetry: universalAdapter.listRecentStandardTelemetry(session.greenhouseId)
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(initPayload));
    }

    ws.on('close', () => {
      uiSubscribers.delete(sub);
    });
    ws.on('error', () => {
      uiSubscribers.delete(sub);
    });
  });

  // Broadcast normalized events to subscribed UI clients for the matching greenhouse room
  universalAdapter.onNormalizedEvent((evt) => {
    const serialized = JSON.stringify({
      event: evt.type,
      greenhouseId: evt.greenhouseId,
      deviceId: evt.deviceId,
      payload: evt.payload,
      timestamp: new Date().toISOString()
    });
    for (const sub of uiSubscribers) {
      if (sub.greenhouseId === evt.greenhouseId && sub.ws.readyState === WebSocket.OPEN) {
        sub.ws.send(serialized);
      }
    }
  });

  // ------------------------------------------------------------------
  // 3. REST ENDPOINTS: AUTH HELPERS & THINGSBOARD / ESPHOME / FLEET APIs
  // ------------------------------------------------------------------

  const ensureAuth = (req: express.Request, res: express.Response): AuthenticatedUser | null => {
    const token = extractSessionToken(req);
    const user = token ? platformDb.getUserBySessionToken(token) : null;
    if (!user) {
      res.status(401).json({
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Sign in to access EDENS AI Universal IoT Infrastructure.'
      });
      return null;
    }
    return user;
  };

  app.get('/api/iot/platform-status', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    return res.json({
      success: true,
      selectedArchitecture: {
        strategy: 'Strategy C — EDENS AI Universal Device Adapter around ESPHome + Embedded Multi-Tenant MQTT/WS Gateway',
        edgePlatform: {
          name: 'ESPHome',
          repository: 'https://github.com/esphome/esphome',
          verifiedVersion: '2026.10.2',
          license: 'MIT (Python CLI/Schemas) + GPL-3.0 (Firmware C++ Runtime — network-isolated)'
        },
        embeddedGateway: {
          mqttBroker: 'Aedes MQTT v3.1.1 / v5.0 (MIT)',
          mqttOverWsPath: '/api/iot/mqtt-ws',
          deviceWsPath: '/api/iot/device-ws',
          uiRealtimeWsPath: '/api/iot/ws',
          tcpBrokerPort: tcpBrokerBoundPort
        },
        thingsBoardCompatibility: {
          supportedApiVersion: 'v4.3.1.8 LTS (Apache-2.0)',
          buslWarning: 'ThingsBoard v4.4.0+ (BUSL-1.1) is intentionally not embedded to avoid the 100-device commercial restriction.',
          telemetryEndpoint: '/api/v1/:deviceToken/telemetry'
        }
      },
      protocols: universalAdapter.listSupportedProtocols(),
      physicalActuatorMode: 'MONITORING_ONLY_DISABLED',
      stats: {
        mqttConnectedDevices: aedes.connectedClients,
        deviceWsConnections: activeDeviceWsCount,
        uiWsSubscribers: uiSubscribers.size
      }
    });
  });

  app.get('/api/greenhouses/:greenhouseId/iot/devices', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    const ghId = req.params.greenhouseId;
    const gh = platformDb.getGreenhouseForUser(ghId, user.id);
    if (!gh) {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have access to this greenhouse.'
      });
    }

    const devices = universalAdapter.listStandardDevicesForGreenhouse(ghId);
    const activeDevices = devices.filter((d) => !d.replaced_by_device_id);

    return res.json({
      success: true,
      greenhouseId: ghId,
      physicalActuatorControlEnabled: false,
      summary: {
        totalDevices: activeDevices.length,
        connectedCount: activeDevices.filter((d) => d.connection_state === 'online').length,
        staleCount: activeDevices.filter((d) => d.connection_state === 'stale').length,
        reconnectingCount: activeDevices.filter((d) => d.connection_state === 'reconnecting').length,
        disconnectedCount: activeDevices.filter((d) =>
          ['offline', 'unprovisioned', 'revoked'].includes(d.connection_state)
        ).length,
        realHardwareDataActive: activeDevices.some((d) => d.data_provenance_label === 'REAL HARDWARE DATA')
      },
      devices
    });
  });

  app.get('/api/greenhouses/:greenhouseId/iot/telemetry', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    const ghId = req.params.greenhouseId;
    const gh = platformDb.getGreenhouseForUser(ghId, user.id);
    if (!gh) {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have access to this greenhouse.'
      });
    }

    const zoneId = typeof req.query.zoneId === 'string' && req.query.zoneId.trim() ? req.query.zoneId.trim() : null;
    const sourceParam = typeof req.query.source === 'string' ? req.query.source.trim() : '';
    const sourceFilter =
      sourceParam === 'real_hardware' || sourceParam === 'simulated' ? sourceParam : undefined;

    const telemetry = universalAdapter.listRecentStandardTelemetry(ghId, {
      zoneId,
      sourceFilter
    });

    return res.json({
      success: true,
      greenhouseId: ghId,
      zoneId,
      strictProvenanceSeparation: true,
      count: telemetry.length,
      telemetry
    });
  });

  app.get('/api/greenhouses/:greenhouseId/iot/devices/:deviceId/history', async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    const ghId = req.params.greenhouseId;
    const gh = platformDb.getGreenhouseForUser(ghId, user.id);
    if (!gh) {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'You do not have access to this greenhouse.'
      });
    }

    const stdDev = universalAdapter.getStandardDeviceModel(ghId, req.params.deviceId);
    if (!stdDev) {
      return res.status(404).json({
        error: 'DEVICE_NOT_FOUND',
        message: 'Device not found in this greenhouse.'
      });
    }

    const history = universalAdapter.getDeviceConnectionHistory(ghId, req.params.deviceId);
    return res.json({
      success: true,
      device: stdDev,
      ...history
    });
  });

  app.post('/api/greenhouses/:greenhouseId/iot/discover-esphome', express.json({ limit: '64kb' }), async (req, res) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    if (user.isGuest) {
      return res.status(403).json({
        error: 'GUEST_HARDWARE_CONTROL_FORBIDDEN',
        message: 'Guest accounts cannot run hardware discovery or bind physical devices.'
      });
    }

    const ghId = req.params.greenhouseId;
    const role = platformDb.getMemberRole(ghId, user.id);
    if (role !== 'owner' && role !== 'operator') {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'Only greenhouse owners or operators may run ESPHome hardware discovery.'
      });
    }

    const deviceId = String(req.body?.deviceId || '').trim();
    const baseUrl = String(req.body?.baseUrl || '').trim();
    if (!deviceId || !baseUrl) {
      return res.status(400).json({
        error: 'MISSING_DISCOVERY_PARAMETERS',
        message: 'Provide both deviceId and baseUrl (e.g., http://192.168.1.50).'
      });
    }

    const discovered = await universalAdapter.discoverEspHomeDeviceOverHttp({
      greenhouseId: ghId,
      deviceId,
      baseUrl,
      sensorIds: Array.isArray(req.body?.sensorIds) ? req.body.sensorIds.map(String) : undefined,
      bearerOrBasicAuth: typeof req.body?.authorization === 'string' ? req.body.authorization : undefined
    });

    if ('errorCode' in discovered) {
      return res.status(discovered.statusCode).json({
        ok: false,
        error: discovered.errorCode,
        message: discovered.message
      });
    }

    return res.json({
      ok: true,
      discoveredEntitiesCount: discovered.discoveredEntitiesCount,
      device: discovered.device,
      telemetryRecords: discovered.telemetryRecords
    });
  });

  const handleGetEspHomeConfig = async (req: express.Request, res: express.Response) => {
    await platformDb.init();
    const user = ensureAuth(req, res);
    if (!user) return;

    if (user.isGuest) {
      return res.status(403).json({
        error: 'GUEST_HARDWARE_CONTROL_FORBIDDEN',
        message: 'Guest accounts cannot generate hardware firmware configurations.'
      });
    }

    const ghId = req.params.greenhouseId;
    const role = platformDb.getMemberRole(ghId, user.id);
    if (role !== 'owner' && role !== 'operator') {
      return res.status(403).json({
        error: 'FORBIDDEN_GREENHOUSE',
        message: 'Only greenhouse owners or operators may generate ESPHome device configurations.'
      });
    }

    const stdDev = universalAdapter.getStandardDeviceModel(ghId, req.params.deviceId);
    if (!stdDev) {
      return res.status(404).json({
        error: 'DEVICE_NOT_FOUND',
        message: 'Device not found in this greenhouse.'
      });
    }

    const origin = getPublicOrigin(req);
    const parsedOrigin = new URL(origin);
    const isHttps = parsedOrigin.protocol === 'https:';
    const mqttPort = tcpBrokerBoundPort || (isHttps ? 8883 : 1883);

    const yaml = generateEspHomeDeviceYaml({
      greenhouseId: ghId,
      zoneId: stdDev.zone_id,
      deviceId: stdDev.device_id,
      deviceLabel: stdDev.label,
      deviceType: stdDev.device_type === 'greenhouse_camera' ? 'esp32_cam' : 'esp32_controller',
      mqttHost: parsedOrigin.hostname,
      mqttPort,
      useMqttWsTls: isHttps
    });

    return res.json({
      success: true,
      esphomeVersion: '2026.10.2',
      deviceId: stdDev.device_id,
      filename: `edens-esphome-${stdDev.device_id}.yaml`,
      mqttWsUrl: `${isHttps ? 'wss' : 'ws'}://${parsedOrigin.host}/api/iot/mqtt-ws`,
      canonicalTopicPrefix: `edens/v1/greenhouses/${ghId}/devices/${stdDev.device_id}`,
      yaml
    });
  };

  app.get('/api/greenhouses/:greenhouseId/devices/:deviceId/esphome-config', handleGetEspHomeConfig);
  app.get('/api/greenhouses/:greenhouseId/iot/devices/:deviceId/esphome-yaml', handleGetEspHomeConfig);

  // ThingsBoard CE v4.3.1.8 (Apache-2.0) Compatible Device Ingestion Endpoints
  const handleThingsBoardHttpIngest = async (req: express.Request, res: express.Response) => {
    await platformDb.init();
    const clientIp = extractClientIp(req);

    if (hasDisallowedQuerySecret(req.query as Record<string, unknown>)) {
      return res.status(401).json({
        error: 'QUERY_AUTH_DISALLOWED',
        message: 'Query-string credentials are forbidden.'
      });
    }

    const rl = ingestLimiter.check(`tb_http:${clientIp}`);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSeconds));
      return res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Rate limit exceeded for telemetry ingestion.'
      });
    }

    const rawToken = String(req.params.deviceToken || '').trim();
    const authRes = authenticateAnyDeviceKey(platformDb, rawToken);
    if ('errorCode' in authRes) {
      return res.status(authRes.statusCode).json({
        error: authRes.errorCode,
        message: authRes.message
      });
    }

    const ingested = universalAdapter.ingestDevicePayload({
      protocol: 'thingsboard_v1',
      device: authRes.device,
      rawPayload: req.body,
      topicOrPath: req.path,
      remoteAddr: clientIp
    });

    if (!ingested.ok) {
      return res.status(ingested.statusCode).json({
        error: ingested.errorCode,
        message: ingested.message
      });
    }

    return res.status(200).json({
      success: true,
      protocol: 'thingsboard_v1',
      deviceId: authRes.device.id,
      readingId: ingested.readingId || null,
      normalizedCount: ingested.telemetryRecords.length
    });
  };

  app.post('/api/v1/:deviceToken/telemetry', express.json({ limit: '64kb' }), handleThingsBoardHttpIngest);
  app.post('/api/v1/:deviceToken/attributes', express.json({ limit: '64kb' }), handleThingsBoardHttpIngest);

  // ------------------------------------------------------------------
  // 4. HTTP SERVER UPGRADE ROUTER & OPTIONAL RAW TCP MQTT LISTENER
  // ------------------------------------------------------------------

  const attachToHttpServer = async (httpServer: http.Server): Promise<void> => {
    if ((aedes as any).closed) {
      await (aedes as any).listen();
    }

    httpServer.on('upgrade', async (req, socket, head) => {
      try {
        const rawUrl = req.url || '/';
        const parsed = new URL(rawUrl, 'http://localhost');
        const pathname = parsed.pathname;

        // Only intercept our `/api/iot/*` WebSocket routes; leave any other upgrade paths untouched
        if (
          pathname !== '/api/iot/mqtt-ws' &&
          pathname !== '/api/iot/device-ws' &&
          pathname !== '/api/iot/ws'
        ) {
          return;
        }

        await platformDb.init();

        const queryObj = Object.fromEntries(parsed.searchParams.entries());

        if (pathname === '/api/iot/mqtt-ws') {
          if (hasDisallowedQuerySecret(queryObj)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          mqttWss.handleUpgrade(req, socket, head, (ws) => {
            mqttWss.emit('connection', ws, req);
          });
          return;
        }

        if (pathname === '/api/iot/device-ws') {
          if (hasDisallowedQuerySecret(queryObj)) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          const rawKey = String(req.headers['x-hardware-key'] || '').trim();
          const claimedGh = typeof req.headers['x-greenhouse-id'] === 'string' ? req.headers['x-greenhouse-id'].trim() : undefined;
          const claimedDev = typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'].trim() : undefined;
          const auth = authenticateAnyDeviceKey(platformDb, rawKey, claimedDev, claimedGh);
          if ('errorCode' in auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          deviceWss.handleUpgrade(req, socket, head, (ws) => {
            deviceWss.emit('connection', ws, req, auth.device);
          });
          return;
        }

        if (pathname === '/api/iot/ws') {
          const fakeExpressReq = { headers: req.headers } as express.Request;
          const sessionToken = extractSessionToken(fakeExpressReq);
          const user = sessionToken ? platformDb.getUserBySessionToken(sessionToken) : null;
          const greenhouseId = String(parsed.searchParams.get('greenhouseId') || '').trim();
          if (!user || !greenhouseId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          const gh = platformDb.getGreenhouseForUser(greenhouseId, user.id);
          if (!gh) {
            socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
          }
          uiWss.handleUpgrade(req, socket, head, (ws) => {
            uiWss.emit('connection', ws, req, { userId: user.id, greenhouseId });
          });
        }
      } catch (err: any) {
        console.warn('[EDENS IoT WS Upgrade Error]:', redactSecretsFromText(err?.message || String(err)));
        socket.destroy();
      }
    });

    // Optional Raw TCP MQTT Broker Listener (for local LAN ESP32 / ESPHome nodes when MQTT_TCP_PORT is set)
    const rawTcpPort = parseInt(process.env.MQTT_TCP_PORT || '0', 10);
    if (Number.isInteger(rawTcpPort) && rawTcpPort >= 0 && process.env.MQTT_TCP_PORT !== undefined && process.env.MQTT_TCP_PORT !== '') {
      tcpMqttServer = net.createServer((stream) => {
        const client = aedes.handle(stream as any) as AuthenticatedAedesClient;
        if (client) {
          client.remoteIp = stream.remoteAddress || 'mqtt_tcp';
        }
      });
      await new Promise<void>((resolve, reject) => {
        tcpMqttServer!.once('error', reject);
        tcpMqttServer!.listen(rawTcpPort, '127.0.0.1', () => {
          const addr = tcpMqttServer!.address();
          if (addr && typeof addr === 'object') {
            tcpBrokerBoundPort = addr.port;
          }
          resolve();
        });
      });
    }
  };

  const shutdown = async (): Promise<void> => {
    for (const sub of uiSubscribers) {
      try {
        sub.ws.terminate();
      } catch {
        // ignore
      }
    }
    uiSubscribers.clear();
    for (const wss of [mqttWss, deviceWss, uiWss]) {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
      }
    }
    if (tcpMqttServer) {
      await new Promise<void>((resolve) => tcpMqttServer!.close(() => resolve()));
      tcpMqttServer = null;
    }
    await new Promise<void>((resolve) => aedes.close(() => resolve()));
  };

  return {
    universalAdapter,
    attachToHttpServer,
    shutdown,
    getStats: () => ({
      mqttConnectedDevices: aedes.connectedClients,
      deviceWsConnections: activeDeviceWsCount,
      uiWsSubscribers: uiSubscribers.size,
      tcpBrokerBoundPort
    })
  };
}
