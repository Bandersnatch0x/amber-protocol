import { describe, expect, it, afterEach } from 'vitest';
import viteConfig from '../../vite.config.mts';

const originalApiPort = process.env.API_PORT;
const originalPort = process.env.PORT;

afterEach(() => {
  if (originalApiPort === undefined) {
    delete process.env.API_PORT;
  } else {
    process.env.API_PORT = originalApiPort;
  }
  if (originalPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = originalPort;
  }
});

describe('vite dev server config', () => {
  it('pins the dev server and API proxy to IPv4 loopback', async () => {
    // Explicit API_PORT is honored verbatim (escape hatch, no probing), which
    // keeps this assertion deterministic regardless of local port exclusions.
    process.env.API_PORT = '3001';
    const config = await viteConfig({
      command: 'serve',
      mode: 'test',
      isSsrBuild: false,
      isPreview: false,
    });
    expect(config.server?.host).toBe('127.0.0.1');
    expect(config.server?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:3001',
    });
  });

  it('honors explicit PORT as the proxy target when API_PORT is unset', async () => {
    // dev-bootstrap injects both PORT and API_PORT, but a PORT-only setup must
    // still pin the proxy verbatim (escape hatch, no probing).
    delete process.env.API_PORT;
    process.env.PORT = '3002';
    const config = await viteConfig({
      command: 'serve',
      mode: 'test',
      isSsrBuild: false,
      isPreview: false,
    });
    expect(config.server?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:3002',
    });
  });
});
