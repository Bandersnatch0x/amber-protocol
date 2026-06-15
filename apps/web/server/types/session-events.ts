import { z } from 'zod';

export const SessionStatusSchema = z.enum(['idle', 'running', 'paused', 'completed', 'aborted']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

const SessionEventBaseSchema = z.object({
  timestamp: z.union([z.number(), z.string()]),
  data: z.record(z.unknown()).optional(),
});

export const SessionEventSchema = z.discriminatedUnion('type', [
  SessionEventBaseSchema.extend({ type: z.literal('session_created'), sessionId: z.string().optional(), goal: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_started'), sessionId: z.string() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_paused'), sessionId: z.string() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_resumed'), sessionId: z.string() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_completed'), sessionId: z.string() }),
  SessionEventBaseSchema.extend({ type: z.literal('session_aborted'), sessionId: z.string(), reason: z.string().optional() }),
  SessionEventBaseSchema.extend({ type: z.literal('task_progress'), sessionId: z.string(), task: z.string(), progress: z.number() }),
  SessionEventBaseSchema.extend({ type: z.literal('error'), sessionId: z.string(), error: z.string() }),
  SessionEventBaseSchema.extend({ type: z.literal('heartbeat') }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;
