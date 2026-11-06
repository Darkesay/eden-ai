/**
 * EDENS AI — Hardware Event & Audit System
 * Immutable audit logging and strict physical actuator safety enforcement (MONITORING_ONLY).
 */

import type { PlatformDatabase } from '../database.ts';
import { generateSecureId } from '../telemetryContract.ts';
import type { HardwareAuditEvent } from './types.ts';

export class HardwareAuditSystem {
  private readonly platformDb: PlatformDatabase;
  public static readonly ENABLE_ACTUATOR_DISPATCH: boolean = false; // Strictly locked

  constructor(platformDb: PlatformDatabase) {
    this.platformDb = platformDb;
  }

  /**
   * Records an immutable hardware event in audit_events.
   */
  public recordEvent(event: Omit<HardwareAuditEvent, 'id' | 'timestamp'>): HardwareAuditEvent {
    const id = generateSecureId('aud', 8);
    const timestamp = new Date().toISOString();

    const fullEvent: HardwareAuditEvent = {
      id,
      timestamp,
      ...event
    };

    this.platformDb.recordAuditEvent({
      greenhouseId: event.greenhouseId,
      actorUserId: event.actor.startsWith('usr_') ? event.actor : undefined,
      actorDeviceId: event.deviceId,
      eventType: event.eventType,
      summary: `[${event.severity}] ${event.eventType} on ${event.deviceId || 'fleet'}: ${JSON.stringify(event.details)}`
    });

    return fullEvent;
  }

  /**
   * Safety invariant guard: Validates that physical actuator dispatch is locked.
   * Throws or returns an error if any component attempts physical actuator commands.
   */
  public assertMonitoringOnly(command: string): { allowed: false; reason: string } {
    return {
      allowed: false,
      reason: `Physical actuator execution (${command}) is strictly prohibited: ENABLE_ACTUATOR_DISPATCH=false (MONITORING_ONLY).`
    };
  }
}
