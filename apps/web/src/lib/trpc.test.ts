import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTRPCClient } from './trpc';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Feature 看板读取边界', () => {
  it('十秒后终止停滞的看板读取，不终止既有摘要请求', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Read timed out', 'TimeoutError')), delay);
      return controller.signal;
    });
    const requests: Array<{ url: string; signal?: AbortSignal | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, signal: init?.signal });
        if (url.includes('continuity.governance.board')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          });
        }
        return Promise.resolve(
          new Response(JSON.stringify([{ result: { data: { json: { decision: 'ready' } } } }]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    const client = getTRPCClient();
    const outcome = client.continuity.governance.board.query().then(
      () => 'unexpected success',
      (error: Error) => error.message,
    );
    const summary = client.continuity.governance.summary.query({}).then(
      (value) => value,
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(1);
    const request = requests.find((item) => item.url.includes('continuity.governance.board'));
    expect(request?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(9_998);
    expect(request?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(request?.signal?.aborted).toBe(true);
    await expect(summary).resolves.toEqual({ decision: 'ready' });
    await expect(outcome).resolves.toContain('timed out');
    expect(
      requests.find((item) => item.url.includes('continuity.governance.summary'))?.signal?.aborted,
    ).not.toBe(true);
  });
});
