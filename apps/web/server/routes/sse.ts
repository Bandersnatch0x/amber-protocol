import { Request, Response } from 'express';
import { eventBroadcaster } from '../services/event-broadcaster';
import { eventStore } from '../services/event-store';
import { readSessionById } from '../lib/session-reader';

export function handleSSE(req: Request, res: Response): void {
  const { sessionId } = req.params;

  // Verify session exists
  const session = readSessionById(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  // Check connection limit
  const added = eventBroadcaster.addConnection(sessionId, res);
  if (!added) {
    res.status(503).json({ error: 'Connection limit reached' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send historical events
  const since = req.query.since ? parseInt(req.query.since as string) : undefined;
  const historicalEvents = eventStore.getEvents(sessionId, since);

  for (const event of historicalEvents) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  res.flushHeaders();
}
