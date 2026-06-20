import { describe, it, expect, beforeEach, vi } from 'vitest';
import { transcriptRouter } from '@server/routers/transcript';
import * as transcriptService from '@server/lib/transcript-service';

vi.mock('@server/lib/transcript-service', () => ({
  listTranscripts: vi.fn(),
  readTranscript: vi.fn(),
  saveDigest: vi.fn(),
  proposeRegressions: vi.fn(),
}));

const listTranscripts = transcriptService.listTranscripts as ReturnType<typeof vi.fn>;
const readTranscript = transcriptService.readTranscript as ReturnType<typeof vi.fn>;
const saveDigest = transcriptService.saveDigest as ReturnType<typeof vi.fn>;
const proposeRegressions = transcriptService.proposeRegressions as ReturnType<typeof vi.fn>;

const caller = transcriptRouter.createCaller({});

describe('transcriptRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('passes through the service result', async () => {
      const summaries = [{ id: 'exec-1' }];
      listTranscripts.mockReturnValue(summaries);

      const result = await caller.list();

      expect(result).toBe(summaries);
      expect(listTranscripts).toHaveBeenCalledOnce();
    });
  });

  describe('read', () => {
    it('returns the detail when found and forwards the limit', async () => {
      const detail = { id: 'exec-1', entries: [] };
      readTranscript.mockReturnValue(detail);

      const result = await caller.read({ id: 'exec-1', limit: 10 });

      expect(result).toBe(detail);
      expect(readTranscript).toHaveBeenCalledWith('exec-1', { limit: 10 });
    });

    it('throws Transcript not found when the service returns null', async () => {
      readTranscript.mockReturnValue(null);

      await expect(caller.read({ id: 'missing' })).rejects.toThrow('Transcript not found');
    });
  });

  describe('save', () => {
    it('returns the save result when successful', async () => {
      const saveResult = { path: '.amber/lens/exec-1.json' };
      saveDigest.mockReturnValue(saveResult);

      const result = await caller.save({ id: 'exec-1' });

      expect(result).toBe(saveResult);
      expect(saveDigest).toHaveBeenCalledWith('exec-1');
    });

    it('throws Transcript not found when the service returns null', async () => {
      saveDigest.mockReturnValue(null);

      await expect(caller.save({ id: 'missing' })).rejects.toThrow('Transcript not found');
    });
  });

  describe('proposeRegressions', () => {
    it('passes through the service result', async () => {
      const evidence = { proposed: 2 };
      proposeRegressions.mockReturnValue(evidence);

      const result = await caller.proposeRegressions({ id: 'exec-1' });

      expect(result).toBe(evidence);
      expect(proposeRegressions).toHaveBeenCalledWith('exec-1');
    });
  });
});
