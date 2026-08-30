import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@server/app-router';
import { listGates } from '@server/lib/gate-reader';
import { listRoutes } from '@server/lib/route-reader';
import { readSessionList } from '@server/lib/session-reader';
import { listTranscripts } from '@server/lib/transcript-service';
import { knowledgeRouter } from '@server/routers/knowledge';

const ORIGINAL_AMBER_REPO_ROOT = process.env.AMBER_REPO_ROOT;

// Use the actual source repository so buildKnowledgeGraph has real data.
const SOURCE_ROOT = path.resolve(process.cwd(), '..', '..');

let scratchRoot: string;

beforeEach(() => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-web-knowledge-'));
  process.env.AMBER_REPO_ROOT = SOURCE_ROOT;
});

afterEach(() => {
  if (ORIGINAL_AMBER_REPO_ROOT === undefined) {
    delete process.env.AMBER_REPO_ROOT;
  } else {
    process.env.AMBER_REPO_ROOT = ORIGINAL_AMBER_REPO_ROOT;
  }
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

const caller = knowledgeRouter.createCaller({});
const appCaller = appRouter.createCaller({});

describe('knowledgeRouter', () => {
  it('is mounted on the app router under the knowledge key', async () => {
    const result = await appCaller.knowledge.graph();

    expect(result.schemaVersion).toBe('2');
    expect(result.toolchain.typescript).toMatch(/^\d+\.\d+\.\d+/);
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(result.nodes.length).toBeGreaterThan(0);
  });

  it('exposes zero mutation procedures', () => {
    const procedures = Object.entries(knowledgeRouter._def.procedures);
    const mutations = procedures.filter(([, proc]) => {
      const def = (proc as { _def?: { type?: string } })._def;
      return def?.type === 'mutation';
    });
    expect(mutations).toHaveLength(0);
  });

  it('resolveRepoRoot target is the source repository', async () => {
    const result = await caller.graph();

    // The live repo has 24 ADRs — verify decision-layer nodes exist.
    const adrNodes = result.nodes.filter((n) => n.kind === 'adr');
    expect(adrNodes.length).toBeGreaterThan(0);
  });

  it('returns a non-empty graph with nodes and edges', async () => {
    const result = await caller.graph();

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
    expect(Array.isArray(result.drift)).toBe(true);
    expect(Array.isArray(result.recentChanges)).toBe(true);
  });

  it('transforms parser provenance string to UI origin field on edges', async () => {
    const result = await caller.graph();

    for (const edge of result.edges) {
      expect(edge).toHaveProperty('origin');
      expect(['deterministic', 'inferred']).toContain(edge.origin);
      // 'provenance' as a string must not leak through as a string field
      expect(typeof (edge as Record<string, unknown>)['provenance']).not.toBe('string');
    }
  });

  it('returns recentChanges as empty array (T3 owns live aggregation)', async () => {
    const result = await caller.graph();

    expect(result.recentChanges).toEqual([]);
  });

  it('returns non-empty live feature history with drift pinned and dated rows ordered', async () => {
    const changes = await caller.recentChanges();

    expect(changes.length).toBeGreaterThan(0);
    expect(changes.length).toBeLessThanOrEqual(50);
    const sources = new Set(changes.map((change) => change.source));
    expect(sources).toContain('git');
    expect(sources).toContain('feature');
    expect(sources).toContain('adr');
    expect(sources).toContain('drift');
    expect(changes.filter((change) => change.source === 'feature').length).toBeGreaterThan(0);

    const firstNonDrift = changes.findIndex((change) => change.source !== 'drift');
    expect(firstNonDrift).toBeGreaterThan(0);
    expect(changes.slice(0, firstNonDrift).every((change) => change.source === 'drift')).toBe(true);
    expect(changes.slice(firstNonDrift).some((change) => change.source === 'drift')).toBe(false);

    const dated = changes.filter((change) => Number.isFinite(Date.parse(change.time)));
    for (let index = 1; index < dated.length; index += 1) {
      const previous = dated[index - 1];
      const current = dated[index];
      expect(Date.parse(previous.time)).toBeGreaterThanOrEqual(Date.parse(current.time));
      if (Date.parse(previous.time) === Date.parse(current.time)) {
        expect(previous.id.localeCompare(current.id)).toBeLessThanOrEqual(0);
      }
    }
  }, 15_000);

  it('validates every emitted jump id against the corresponding live source', async () => {
    const [changes, gates] = await Promise.all([caller.recentChanges(), listGates()]);
    const featureList = JSON.parse(
      fs.readFileSync(path.join(SOURCE_ROOT, 'feature_list.json'), 'utf8'),
    ) as {
      features: Array<{ id: string }>;
    };
    const liveIds = {
      sessions: new Set(readSessionList().map((session) => session.id)),
      gates: new Set(gates.map((gate) => gate.gateId)),
      transcripts: new Set(
        listTranscripts({ repoPath: SOURCE_ROOT }).map((transcript) => transcript.id),
      ),
      routes: new Set(listRoutes().map((route) => route.id)),
      governance: new Set(featureList.features.map((feature) => feature.id)),
    };

    for (const change of changes) {
      if (!change.linkId) continue;
      expect(change.linkTo).toBeDefined();
      expect(liveIds[change.linkTo!].has(change.linkId), `${change.linkTo}:${change.linkId}`).toBe(
        true,
      );
    }
  });

  it('includes drift findings with actualPath when a rename is detected', async () => {
    const result = await caller.graph();

    // F001 and F007 are standing real drift findings in the repo.
    if (result.drift.length > 0) {
      for (const d of result.drift) {
        expect(d).toHaveProperty('nodeId');
        expect(d).toHaveProperty('path');
        expect(d).toHaveProperty('detail');
        expect(d.kind).toBe('dead-anchor');
        if ('actualPath' in d && d.actualPath !== undefined) {
          expect(typeof d.actualPath).toBe('string');
        }
      }
    }
  });

  it('exposes body on content nodes and feature nodes with canonical text (P-1 live context)', async () => {
    const result = await caller.graph();

    const contentKinds = new Set(['adr', 'wiki', 'memory', 'architecture']);
    const contentNodes = result.nodes.filter((n) => contentKinds.has(n.kind));
    expect(contentNodes.length).toBeGreaterThan(0);
    for (const n of contentNodes) {
      expect(typeof n.body, `${n.id} body must be a string`).toBe('string');
      expect(n.body!.length, `${n.id} body must be non-empty`).toBeGreaterThan(0);
      expect(n.body!.length, `${n.id} body must be ≤2000 chars`).toBeLessThanOrEqual(2000);
    }

    // Feature nodes with non-trivial canonical text carry a body excerpt
    const featureNodes = result.nodes.filter((n) => n.kind === 'feature');
    const featureWithBody = featureNodes.filter((n) => n.body !== undefined);
    expect(featureWithBody.length).toBeGreaterThan(0);
    for (const n of featureWithBody) {
      expect(typeof n.body).toBe('string');
      expect(n.body!.length).toBeGreaterThan(0);
      expect(n.body!.length).toBeLessThanOrEqual(2000);
    }
  });

  it('artifact nodes carry body from their head revision committed text', async () => {
    const result = await caller.graph();

    const artifactNodes = result.nodes.filter((n) => n.kind === 'artifact');
    for (const n of artifactNodes) {
      if (n.body !== undefined) {
        expect(typeof n.body).toBe('string');
        expect(n.body!.length).toBeGreaterThan(0);
        expect(n.body!.length).toBeLessThanOrEqual(2000);
      }
    }
  });

  it('includes feature nodes with paths for dead-anchor marking', async () => {
    const result = await caller.graph();

    const featureNodes = result.nodes.filter((n) => n.kind === 'feature');
    expect(featureNodes.length).toBeGreaterThan(0);
    // At least some feature nodes should have paths (declared anchors)
    const withPaths = featureNodes.filter((n) => Array.isArray(n.paths) && n.paths.length > 0);
    expect(withPaths.length).toBeGreaterThan(0);
  });
});
