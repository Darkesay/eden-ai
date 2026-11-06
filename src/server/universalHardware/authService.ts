/**
 * EDENS AI — Device Authentication & Authorization Service
 * Cryptographic device token issuance, rotation, instant revocation, and tenancy enforcement.
 */

import crypto from 'node:crypto';
import type { DeviceRecord, PlatformDatabase } from '../database.ts';
import { generateSecureId } from '../telemetryContract.ts';

export interface DeviceAuthResult {
  ok: boolean;
  statusCode: number;
  errorCode?: string;
  message?: string;
  device?: DeviceRecord;
}

export class DeviceAuthenticationService {
  private readonly platformDb: PlatformDatabase;

  constructor(platformDb: PlatformDatabase) {
    this.platformDb = platformDb;
  }

  /**
   * Generates a cryptographically random device key with prefix.
   */
  public generateDeviceKey(deviceType: 'esp32_controller' | 'esp32_cam' | 'environmental_node'): {
    rawKey: string;
    keyPrefix: string;
    keyHash: string;
  } {
    const prefix = deviceType === 'esp32_cam' ? 'edcam_' : 'edctrl_';
    const randomHex = crypto.randomBytes(24).toString('hex');
    const rawKey = `${prefix}${randomHex}`;
    const keyPrefix = rawKey.slice(0, 10);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    return { rawKey, keyPrefix, keyHash };
  }

  /**
   * Authenticates a device token provided via HTTP headers.
   * Invariant: Never allows credentials in URL query parameters.
   */
  public authenticateDevice(params: {
    rawKey: string;
    expectedType?: 'esp32_controller' | 'esp32_cam';
    claimedGreenhouseId?: string;
    claimedDeviceId?: string;
    remoteIp?: string;
  }): DeviceAuthResult {
    const trimmed = String(params.rawKey || '').trim();
    if (!trimmed) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'MISSING_DEVICE_CREDENTIAL',
        message: 'Missing device authentication credential in X-Hardware-Key or Authorization header.'
      };
    }

    const authRes = this.platformDb.authenticateDeviceKey({
      rawKey: trimmed,
      expectedType: params.expectedType,
      claimedGreenhouseId: params.claimedGreenhouseId,
      claimedDeviceId: params.claimedDeviceId
    });

    if ('errorCode' in authRes) {
      this.platformDb.recordDeviceError({
        greenhouseId: params.claimedGreenhouseId || null,
        deviceId: params.claimedDeviceId || null,
        expectedType: params.expectedType,
        category: 'AUTH',
        errorCode: authRes.errorCode,
        message: authRes.message,
        ipAddress: params.remoteIp || null
      });

      return {
        ok: false,
        statusCode: authRes.statusCode,
        errorCode: authRes.errorCode,
        message: authRes.message
      };
    }

    return {
      ok: true,
      statusCode: 200,
      device: authRes.device
    };
  }

  /**
   * Rotates credentials for a device, instantly revoking the old key.
   */
  public rotateDeviceCredentials(deviceId: string, greenhouseId: string): {
    ok: boolean;
    rawKey?: string;
    keyPrefix?: string;
    message?: string;
  } {
    const driver = this.platformDb.getDriver();
    const dev = driver.queryOne<any>('SELECT * FROM devices WHERE id = ? AND greenhouse_id = ?', [
      deviceId,
      greenhouseId
    ]);

    if (!dev) {
      return { ok: false, message: 'Device not found in greenhouse.' };
    }

    const { rawKey, keyPrefix, keyHash } = this.generateDeviceKey(dev.device_type);
    const nowIso = new Date().toISOString();

    driver.run(
      `UPDATE devices
       SET credential_hash = ?,
           credential_prefix = ?,
           provisioning_status = 'active',
           revoked_at = NULL,
           updated_at = ?
       WHERE id = ?`,
      [keyHash, keyPrefix, nowIso, deviceId]
    );

    this.platformDb.recordAuditEvent({
      greenhouseId,
      actorUserId: 'system',
      actorDeviceId: deviceId,
      eventType: 'CREDENTIALS_ROTATED',
      summary: `Rotated credentials for device ${deviceId}. Prior credential invalidated immediately.`
    });

    return { ok: true, rawKey, keyPrefix };
  }

  /**
   * Immediately revokes a device credential, closing any active session.
   */
  public revokeDevice(deviceId: string, greenhouseId: string, reason?: string): boolean {
    const driver = this.platformDb.getDriver();
    const nowIso = new Date().toISOString();

    const res = driver.run(
      `UPDATE devices
       SET revoked_at = ?,
           provisioning_status = 'revoked',
           credential_hash = NULL,
           updated_at = ?
       WHERE id = ? AND greenhouse_id = ?`,
      [nowIso, nowIso, deviceId, greenhouseId]
    );

    if (res.changes > 0) {
      this.platformDb.recordAuditEvent({
        greenhouseId,
        actorUserId: 'system',
        actorDeviceId: deviceId,
        eventType: 'DEVICE_REVOKED',
        summary: `Device ${deviceId} revoked: ${reason || 'Operator manual revocation'}`
      });
      return true;
    }

    return false;
  }
}
