/**
 * Cross-language parity: the CLI's JSON Schemas (schemas/*.schema.json) are the
 * single source of the session artifact layout. The JS side already guards its
 * copy (tests/unit/session-timeline.test.js); this file guards the web copy.
 *
 * Direction matters: the web SessionEventSchema is deliberately a SUPERSET of
 * the CLI enum (heartbeat, task_progress, session_started are SSE-only), so we
 * assert one-way inclusion — every CLI event type must be accepted by the web
 * schema — not equality.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SessionEventSchema } from '../server/types/session-events';
import type { Session } from '../server/lib/session-reader';

const schemasDir = path.resolve(__dirname, '../../../schemas');

function readSchema(name: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(schemasDir, name), 'utf8'));
}

describe('schema parity (CLI schemas ⊆ web types)', () => {
  it('every timeline-event type from the CLI schema is accepted by the web SessionEventSchema', () => {
    const schema = readSchema('timeline-event.schema.json');
    const cliTypes: string[] = schema.properties.type.enum;
    expect(cliTypes.length).toBeGreaterThan(0);

    const rejected = cliTypes.filter((type) => {
      const result = SessionEventSchema.safeParse({
        type,
        timestamp: new Date().toISOString(),
      });
      return !result.success;
    });

    expect(rejected).toEqual([]);
  });

  it('accepts web control-plane runner ACK timeline events', () => {
    for (const type of ['runner_control_requested', 'runner_ack', 'runner_rejected', 'runner_timeout']) {
      const result = SessionEventSchema.safeParse({
        type,
        timestamp: new Date().toISOString(),
        sessionId: 'session-1',
        requestId: 'request-1',
        action: 'resume',
        requestedStatus: 'executing',
      });

      expect(result.success, `${type} should be accepted`).toBe(true);
    }
  });

  it('the Session DTO field names are a subset of the manifest schema properties', () => {
    const schema = readSchema('session-manifest.schema.json');
    const manifestProps = new Set(Object.keys(schema.properties));

    // `id` is the directory name, not a manifest property; everything else the
    // reader surfaces must exist in the schema so field names cannot drift.
    const sessionFields: Array<keyof Session> = [
      'goal',
      'status',
      'route',
      'createdAt',
      'updatedAt',
      'budget',
    ];
    const missing = sessionFields.filter((field) => !manifestProps.has(field));
    expect(missing).toEqual([]);
  });
});
