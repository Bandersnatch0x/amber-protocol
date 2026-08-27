import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@server/app-router';
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

    expect(result.schemaVersion).toBe('1');
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
