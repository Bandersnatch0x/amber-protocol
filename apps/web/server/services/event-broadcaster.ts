import { Response } from 'express';
import { SessionEvent } from '../types/session-events';

const MAX_CONNECTIONS_PER_SESSION = 10;
const MAX_TOTAL_CONNECTIONS = 1000;
const HEARTBEAT_INTERVAL = 45000;
const WRITE_TIMEOUT = 5000;

class EventBroadcaster {
  private connections = new Map<string, Set<Response>>();
  private totalConnections = 0;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor() {
    this.startHeartbeat();
  }

  addConnection(sessionId: string, res: Response): boolean {
    if (this.totalConnections >= MAX_TOTAL_CONNECTIONS) {
      return false;
    }

    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Set());
    }

    const sessionConns = this.connections.get(sessionId)!;
    if (sessionConns.size >= MAX_CONNECTIONS_PER_SESSION) {
      return false;
    }

    sessionConns.add(res);
    this.totalConnections++;

    res.on('close', () => this.removeConnection(sessionId, res));

    return true;
  }

  removeConnection(sessionId: string, res: Response): void {
    const sessionConns = this.connections.get(sessionId);
    if (sessionConns && sessionConns.delete(res)) {
      // Only decrement when this res was actually present. A dead socket is
      // removed by both the broadcast/heartbeat sweep and its own 'close' event;
      // gating on delete()'s result keeps removeConnection idempotent so the
      // count cannot drift below the true value (and break the total-connection
      // limit).
      this.totalConnections--;

      if (sessionConns.size === 0) {
        this.connections.delete(sessionId);
      }
    }
  }

  async broadcast(sessionId: string, event: SessionEvent): Promise<void> {
    const sessionConns = this.connections.get(sessionId);
    if (!sessionConns) return;

    const data = `data: ${JSON.stringify(event)}\n\n`;
    const deadConns: Response[] = [];

    for (const res of sessionConns) {
      try {
        await this.writeWithTimeout(res, data);
      } catch {
        deadConns.push(res);
      }
    }

    deadConns.forEach(res => this.removeConnection(sessionId, res));
  }

  private writeWithTimeout(res: Response, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Write timeout')), WRITE_TIMEOUT);

      res.write(data, (err) => {
        clearTimeout(timeout);
        err ? reject(err) : resolve();
      });
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const heartbeat: SessionEvent = { type: 'heartbeat', timestamp: Date.now() };
      const data = `data: ${JSON.stringify(heartbeat)}\n\n`;

      for (const [sessionId, conns] of this.connections) {
        const deadConns: Response[] = [];

        for (const res of conns) {
          try {
            res.write(data);
          } catch {
            deadConns.push(res);
          }
        }

        deadConns.forEach(res => this.removeConnection(sessionId, res));
      }
    }, HEARTBEAT_INTERVAL);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
  }

  cleanup(): void {
    this.stop();
    this.connections.clear();
    this.totalConnections = 0;
  }

  connectionCount(sessionId: string): number {
    return this.connections.get(sessionId)?.size ?? 0;
  }

  totalConnectionCount(): number {
    return this.totalConnections;
  }
}

export const eventBroadcaster = new EventBroadcaster();
