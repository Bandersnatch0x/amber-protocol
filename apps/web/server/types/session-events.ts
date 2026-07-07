import { z } from 'zod';

// Mirrors the CLI session state machine (scripts/lib/session-state-machine.js)
// plus the legacy 'idle'/'running' values the web UI already used. The CLI
// writes 'created'/'routed'/'executing'/'failed' to manifests, so the schema
// must accept them or session reads fail validation.
export const SessionStatusSchema = z.enum([
  'idle',
  'running',
  'created',
  'routed',
  'executing',
  'paused',
  'completed',
  'failed',
  'aborted',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

const SessionEventBaseSchema = z.object({
  timestamp: z.union([z.number(), z.string()]),
  data: z.record(z.unknown()).optional(),
});

// sessionId is optional on every variant: events read back from timeline.jsonl
// (via normalizeEvent, which flattens `data` onto the top level) do not always
// carry it, and the SSE stream emits raw events where it lives under `data`.
// Keeping it optional lets one schema validate both paths without dropping
// events.
export const SessionEventSchema = z.discriminatedUnion('type', [
  SessionEventBaseSchema.extend({ type: z.literal('session_created'), sessionId: z.string().optional(), goal: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_started'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_paused'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_resumed'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_completed'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_aborted'), sessionId: z.string().optional(), reason: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_failed'), sessionId: z.string().optional() }),
  // State-machine transition events. data carries { fromState, toState }.
  SessionEventBaseSchema.extend({ type: z.literal('route_selected'), sessionId: z.string().optional() }),
  // Stage lifecycle. data carries { stage, displayName, command, result }.
  SessionEventBaseSchema.extend({ type: z.literal('stage_started'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('stage_completed'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('stage_failed'), sessionId: z.string().optional() }),
  // Gate lifecycle. data carries { gateId, approvedBy } / { gateId, type }.
  SessionEventBaseSchema.extend({ type: z.literal('gate_triggered'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('gate_passed'), sessionId: z.string().optional(), gateId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('gate_failed'), sessionId: z.string().optional(), gateId: z.string().optional(), reason: z.string().optional() }),
  // Budget signals. data carries { used, total, percentage }.
  SessionEventBaseSchema.extend({ type: z.literal('budget_warning'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('budget_exceeded'), sessionId: z.string().optional() }),
  // Checkpoint / verification lifecycle from the CLI timeline schema.
  SessionEventBaseSchema.extend({ type: z.literal('checkpoint_created'), sessionId: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('verification_failed'), sessionId: z.string().optional() }),
  // Web control-plane lifecycle for durable runner handshakes. These are a web
  // superset over the CLI timeline schema so the UI can show where a control
  // request stopped: requested, acknowledged, rejected, or timed out.
  SessionEventBaseSchema.extend({
    type: z.literal('runner_control_requested'),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    action: z.string().optional(),
    requestedStatus: SessionStatusSchema.optional(),
    source: z.string().optional(),
  }),
  SessionEventBaseSchema.extend({
    type: z.literal('runner_ack'),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    action: z.string().optional(),
    requestedStatus: SessionStatusSchema.optional(),
    runnerStatus: z.string().optional(),
    source: z.string().optional(),
    message: z.string().optional(),
  }),
  SessionEventBaseSchema.extend({
    type: z.literal('runner_rejected'),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    action: z.string().optional(),
    requestedStatus: SessionStatusSchema.optional(),
    runnerStatus: z.string().optional(),
    source: z.string().optional(),
    message: z.string().optional(),
  }),
  SessionEventBaseSchema.extend({
    type: z.literal('runner_timeout'),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
    action: z.string().optional(),
    requestedStatus: SessionStatusSchema.optional(),
    runnerStatus: z.string().optional(),
    source: z.string().optional(),
    message: z.string().optional(),
  }),
  SessionEventBaseSchema.extend({ type: z.literal('task_progress'), sessionId: z.string().optional(), task: z.string(), progress: z.number() }),
  // The CLI schema's error payload is an optional object ({ message, stack,
  // recoverable }); the SSE path historically emitted a plain string. Accept
  // both so a CLI-valid error event never fails web validation.
  SessionEventBaseSchema.extend({
    type: z.literal('error'),
    sessionId: z.string().optional(),
    error: z.union([z.string(), z.record(z.unknown())]).optional(),
  }),
  SessionEventBaseSchema.extend({ type: z.literal('heartbeat') }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;
