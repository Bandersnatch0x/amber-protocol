import { z } from 'zod';

export const SessionStatusSchema = z.enum(['idle', 'running', 'paused', 'completed', 'aborted']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_started'), sessionId: z.string(), timestamp: z.number() }),
  z.object({ type: z.literal('session_paused'), sessionId: z.string(), timestamp: z.number() }),
  z.object({ type: z.literal('session_resumed'), sessionId: z.string(), timestamp: z.number() }),
  z.object({ type: z.literal('session_completed'), sessionId: z.string(), timestamp: z.number() }),
  z.object({ type: z.literal('session_aborted'), sessionId: z.string(), timestamp: z.number(), reason: z.string().optional() }),
  z.object({ type: z.literal('task_progress'), sessionId: z.string(), task: z.string(), progress: z.number(), timestamp: z.number() }),
  z.object({ type: z.literal('error'), sessionId: z.string(), error: z.string(), timestamp: z.number() }),
  z.object({ type: z.literal('heartbeat'), timestamp: z.number() }),
]);

export type SessionEvent = z.infer<typeof SessionEventSchema>;
