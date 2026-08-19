import { describe, it, expect } from 'vitest';
import net from 'net';
import {
  parsePortEnv,
  resolveApiPort,
  resolveApiPortSync,
  resolveSharedDevPort,
  SERVER_PORT_CANDIDATES,
  E2E_API_PORT_CANDIDATES,
  type PortListener,
} from '../../server/lib/api-port';

function eaccesError(port: number): NodeJS.ErrnoException {
  const error = new Error(`listen EACCES: permission denied 127.0.0.1:${port}`);
  (error as NodeJS.ErrnoException).code = 'EACCES';
  return error;
}

/** Occupy a real ephemeral port so a real listen on it fails with EADDRINUSE. */
function occupyEphemeralPort(): Promise<{ port: number; server: net.Server }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('unexpected server address'));
        return;
      }
      resolve({ port: address.port, server });
    });
  });
}

describe('parsePortEnv', () => {
  it('returns undefined for unset or blank values', () => {
    expect(parsePortEnv(undefined)).toBeUndefined();
    expect(parsePortEnv('')).toBeUndefined();
    expect(parsePortEnv('   ')).toBeUndefined();
  });

  it('parses a valid port', () => {
    expect(parsePortEnv('3101')).toBe(3101);
    expect(parsePortEnv(' 4101 ')).toBe(4101);
  });

  it('throws on invalid values', () => {
    expect(() => parsePortEnv('abc')).toThrow(/Invalid port/);
    expect(() => parsePortEnv('0')).toThrow(/Invalid port/);
    expect(() => parsePortEnv('70000')).toThrow(/Invalid port/);
    expect(() => parsePortEnv('31.5')).toThrow(/Invalid port/);
  });
});

describe('resolveApiPort', () => {
  it('returns the explicit override without probing', async () => {
    let probed = 0;
    const listen: PortListener = async () => {
      probed += 1;
    };
    const port = await resolveApiPort({
      explicit: 4321,
      candidates: [3101, 3102],
      host: '127.0.0.1',
      listen,
      log: () => {},
    });
    expect(port).toBe(4321);
    expect(probed).toBe(0);
  });

  it('returns the first candidate when it is available, without logging', async () => {
    const logs: string[] = [];
    const port = await resolveApiPort({
      candidates: [3101, 3102],
      host: '127.0.0.1',
      listen: async () => {},
      log: (message) => logs.push(message),
    });
    expect(port).toBe(3101);
    expect(logs).toEqual([]);
  });

  it('skips candidates failing with EACCES (Hyper-V exclusion shape) and logs once', async () => {
    const logs: string[] = [];
    const attempted: number[] = [];
    const listen: PortListener = async (port) => {
      attempted.push(port);
      if (port === 3101 || port === 3102) throw eaccesError(port);
    };
    const port = await resolveApiPort({
      candidates: [3101, 3102, 3103],
      host: '127.0.0.1',
      listen,
      log: (message) => logs.push(message),
    });
    expect(port).toBe(3103);
    expect(attempted).toEqual([3101, 3102, 3103]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('3101');
    expect(logs[0]).toContain('EACCES');
    expect(logs[0]).toContain('3103');
  });

  it('throws when every candidate is unavailable', async () => {
    await expect(
      resolveApiPort({
        candidates: [3101, 3102],
        host: '127.0.0.1',
        listen: async (port) => {
          throw eaccesError(port);
        },
        log: () => {},
      }),
    ).rejects.toThrow(/no available port/);
  });

  it('throws when no candidates are provided', async () => {
    await expect(
      resolveApiPort({ candidates: [], host: '127.0.0.1', log: () => {} }),
    ).rejects.toThrow(/no candidate ports/);
  });

  it('skips a genuinely occupied port with the real listener (EADDRINUSE)', async () => {
    const { port: occupied, server } = await occupyEphemeralPort();
    try {
      const logs: string[] = [];
      const port = await resolveApiPort({
        candidates: [occupied, 0],
        host: '127.0.0.1',
        log: (message) => logs.push(message),
      });
      // Port 0 means "let the OS pick"; the resolver reports the bound port.
      expect(port).toBeGreaterThanOrEqual(1);
      expect(port).not.toBe(occupied);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('EADDRINUSE');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('candidate banks keep the documented defaults first and avoid client dev ports', () => {
    expect(SERVER_PORT_CANDIDATES[0]).toBe(3001);
    expect(E2E_API_PORT_CANDIDATES[0]).toBe(3101);
    for (const candidate of [...SERVER_PORT_CANDIDATES, ...E2E_API_PORT_CANDIDATES]) {
      expect(candidate).not.toBe(5173);
      expect(candidate).not.toBe(5273);
    }
  });
});

describe('resolveSharedDevPort', () => {
  it('returns explicit PORT verbatim without probing', async () => {
    const port = await resolveSharedDevPort({ env: { PORT: '4321' }, log: () => {} });
    expect(port).toBe(4321);
  });

  it('falls back to API_PORT when PORT is unset', async () => {
    const port = await resolveSharedDevPort({ env: { API_PORT: '4322' }, log: () => {} });
    expect(port).toBe(4322);
  });

  it('lets PORT win over API_PORT', async () => {
    const port = await resolveSharedDevPort({
      env: { PORT: '4321', API_PORT: '4322' },
      log: () => {},
    });
    expect(port).toBe(4321);
  });

  it('throws on an invalid explicit port', async () => {
    await expect(resolveSharedDevPort({ env: { PORT: 'abc' }, log: () => {} })).rejects.toThrow(
      /Invalid port/,
    );
  });

  it('probes the shared candidate bank when no explicit env is set', async () => {
    // Real probe: result must be one of the shared candidates, which is what
    // both the server and the vite proxy would then consume verbatim.
    const port = await resolveSharedDevPort({ env: {}, log: () => {} });
    expect(SERVER_PORT_CANDIDATES).toContain(port);
  });
});

describe('resolveApiPortSync', () => {
  it('returns the explicit override without spawning a probe', () => {
    expect(resolveApiPortSync({ explicit: 4101, candidates: [3101], host: '127.0.0.1' })).toBe(
      4101,
    );
  });

  it('probes real ports and skips an occupied one', async () => {
    const { port: occupied, server } = await occupyEphemeralPort();
    try {
      const logs: string[] = [];
      const port = resolveApiPortSync({
        candidates: [occupied, 0],
        host: '127.0.0.1',
        log: (message) => logs.push(message),
      });
      // Candidate 0 means "let the OS pick" for the probe server itself; it
      // reports the actually-bound port, which must be a usable port number.
      expect(port).toBeGreaterThanOrEqual(1);
      expect(port).not.toBe(occupied);
      expect(logs).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
