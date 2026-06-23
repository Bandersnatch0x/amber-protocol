import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config.mts';

describe('vite dev server config', () => {
  it('pins the dev server and API proxy to IPv4 loopback', () => {
    expect(viteConfig.server?.host).toBe('127.0.0.1');
    expect(viteConfig.server?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:3001',
    });
  });
});
