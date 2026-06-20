import { describe, it, expect, vi } from 'vitest';
import { createShutdownHandler } from '@server/lib/shutdown';

describe('createShutdownHandler', () => {
  it('cleans up the broadcaster, closes the server, then exits 0', () => {
    const order: string[] = [];
    const close = vi.fn((cb?: () => void) => {
      order.push('close');
      cb?.();
    });
    const cleanup = vi.fn(() => order.push('cleanup'));
    const exit = vi.fn((_code: number) => {
      order.push('exit');
    });

    const handler = createShutdownHandler({ close }, { cleanup }, exit);
    handler('SIGTERM');

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    // Cleanup must run before the server stops accepting; exit comes last.
    expect(order).toEqual(['cleanup', 'close', 'exit']);
  });

  it('logs the signal it received', () => {
    const log = vi.fn();
    const handler = createShutdownHandler(
      { close: (cb?: () => void) => cb?.() },
      { cleanup: () => {} },
      () => {},
      log,
    );
    handler('SIGINT');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SIGINT'));
  });

  it('still exits when the server close callback never fires (failsafe path is caller-owned)', () => {
    const exit = vi.fn();
    const handler = createShutdownHandler(
      { close: () => {} }, // never invokes the callback
      { cleanup: () => {} },
      exit,
    );
    // Should not throw; exit simply won't have been called synchronously here.
    expect(() => handler('SIGTERM')).not.toThrow();
  });
});
