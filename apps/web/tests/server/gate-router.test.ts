import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gateRouter } from '@server/routers/gate';
import * as gateReader from '@server/lib/gate-reader';

vi.mock('@server/lib/gate-reader', () => ({
  listGates: vi.fn(),
  getGate: vi.fn(),
  approveGate: vi.fn(),
  rejectGate: vi.fn(),
}));

const listGates = gateReader.listGates as ReturnType<typeof vi.fn>;
const getGate = gateReader.getGate as ReturnType<typeof vi.fn>;
const approveGate = gateReader.approveGate as ReturnType<typeof vi.fn>;
const rejectGate = gateReader.rejectGate as ReturnType<typeof vi.fn>;

const caller = gateRouter.createCaller({});

describe('gateRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('forwards filters to listGates', async () => {
      const gates = [{ id: 'gate-1' }];
      listGates.mockResolvedValue(gates);

      const result = await caller.list({ sessionId: 'session-1', status: 'pending' });

      expect(result).toBe(gates);
      expect(listGates).toHaveBeenCalledWith({ sessionId: 'session-1', status: 'pending' });
    });

    it('passes an empty object when input is omitted', async () => {
      listGates.mockResolvedValue([]);

      await caller.list();

      expect(listGates).toHaveBeenCalledWith({});
    });
  });

  describe('byId', () => {
    it('forwards sessionId and gateId to getGate', async () => {
      const gate = { id: 'gate-1' };
      getGate.mockResolvedValue(gate);

      const result = await caller.byId({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(result).toBe(gate);
      expect(getGate).toHaveBeenCalledWith('session-1', 'gate-1');
    });
  });

  describe('approve', () => {
    it('delegates to approveGate and returns success', async () => {
      approveGate.mockResolvedValue(undefined);

      const result = await caller.approve({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'looks good',
      });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', 'looks good');
      expect(result).toEqual({ success: true });
    });
  });

  describe('reject', () => {
    it('delegates to rejectGate and returns success', async () => {
      rejectGate.mockResolvedValue(undefined);

      const result = await caller.reject({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'needs work',
      });

      expect(rejectGate).toHaveBeenCalledWith('session-1', 'gate-1', 'needs work');
      expect(result).toEqual({ success: true });
    });
  });
});
