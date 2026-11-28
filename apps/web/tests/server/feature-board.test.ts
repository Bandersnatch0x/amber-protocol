import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { continuityRouter } from '@server/routers/continuity';
import type { WebAdapter } from '../../../../scripts/lib/web-adapter';

const requireCli = createRequire(import.meta.url);
const { getFeatureBoard } = requireCli('../../../../scripts/lib/web-adapter.js') as WebAdapter;
let root: string;
let outside: string;

function write(relative: string, value: unknown): void {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function feature(id: string, status = 'not_started') {
  return {
    id,
    title: id,
    status,
    priority: 1,
    area: 'observability',
    user_visible_behavior: 'Read-only board',
    verification: ['Check board'],
    notes: status === 'blocked' ? ['等待裁决'] : [],
    evidence: status === 'passing' ? ['Agent 自述：完成'] : [],
  };
}

function session(id: string, featureId?: string) {
  return {
    sessionId: id,
    schemaVersion: '1.0.0-rc.1',
    createdAt: '2026-11-27T00:00:00Z',
    goal: '相同标题不能决定归属',
    route: { id: 'feature-standard', version: '1.0.0' },
    status: 'executing',
    currentStage: 'implement',
    ...(featureId ? { feature: featureId } : {}),
  };
}

function snapshot(directory: string): Record<string, string> {
  return Object.fromEntries(
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory()
        ? Object.entries(snapshot(file)).map(([name, bytes]) => [`${entry.name}/${name}`, bytes])
        : [[entry.name, fs.readFileSync(file).toString('base64')]];
    }),
  );
}

describe('Feature 交付只读快照', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-feature-board-'));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-feature-board-outside-'));
    write('feature_list.json', { features: [feature('F001')] });
  });
  afterEach(() => {
    // 先移除测试自己创建的 Junction，避免递归清理触及外部目录。
    const link = path.join(root, '.amber', 'sessions');
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('保留全部五状态和自述证据，返回明确快照时间', () => {
    const statuses = ['not_started', 'in_progress', 'blocked', 'passing', 'accepted'];
    write('feature_list.json', {
      features: statuses.map((status, i) => feature(`F00${i}`, status)),
    });
    const board = getFeatureBoard(root);
    expect(board.features.state).toBe('ok');
    expect(board.features.items.map((item: { status: string }) => item.status)).toEqual(statuses);
    expect(board.features.items[3].evidence).toEqual(['Agent 自述：完成']);
    expect(Number.isNaN(Date.parse(board.generatedAt))).toBe(false);
    expect(board.statuses).toEqual(statuses);
  });

  it('保留多 Session、未绑定和未知引用，不按标题猜绑', () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    ids.forEach((id, i) =>
      write(
        `.amber/sessions/${id}/manifest.json`,
        session(id, i < 2 ? 'F001' : i === 3 ? 'F999' : undefined),
      ),
    );
    const board = getFeatureBoard(root);
    expect(board.sessions.state).toBe('ok');
    expect(
      board.sessions.items.filter((item: { feature: string | null }) => item.feature === 'F001'),
    ).toHaveLength(2);
    expect(
      board.sessions.items.find((item: { sessionId: string }) => item.sessionId === ids[2]).feature,
    ).toBeNull();
    expect(
      board.sessions.items.find((item: { sessionId: string }) => item.sessionId === ids[3]).feature,
    ).toBe('F999');
  });

  it('区分合法空数据和缺失或损坏 Feature 来源', () => {
    write('feature_list.json', { features: [] });
    expect(getFeatureBoard(root).features).toMatchObject({ state: 'ok', items: [], errors: [] });
    fs.unlinkSync(path.join(root, 'feature_list.json'));
    expect(getFeatureBoard(root).features.state).toBe('error');
    fs.writeFileSync(path.join(root, 'feature_list.json'), '{broken');
    expect(getFeatureBoard(root).features.state).toBe('error');
    write('feature_list.json', { features: [feature('F001', 'made_up')] });
    expect(getFeatureBoard(root).features.state).toBe('error');
  });

  it('坏 Session 明确报告部分失败，其余有效记录不丢失', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    write(`.amber/sessions/${id}/manifest.json`, session(id, 'F001'));
    write('.amber/sessions/broken/manifest.json', null);
    fs.mkdirSync(path.join(root, '.amber/sessions/missing'));
    const board = getFeatureBoard(root);
    expect(board.sessions.state).toBe('partial');
    expect(board.sessions.items).toHaveLength(1);
    expect(board.sessions.errors).toHaveLength(2);
  });

  it('Session 来源缺失时显示不可读取，已有空目录才是合法空', () => {
    expect(getFeatureBoard(root).sessions).toMatchObject({ state: 'error', items: [] });
    expect(getFeatureBoard(root).sessions.errors).toHaveLength(1);
    fs.mkdirSync(path.join(root, '.amber/sessions'), { recursive: true });
    expect(getFeatureBoard(root).sessions).toEqual({ state: 'ok', items: [], errors: [] });
  });

  it('拒绝 manifest 身份与目录不一致而不是跳到另一个 Session', () => {
    write(
      '.amber/sessions/wrong-id/manifest.json',
      session('11111111-1111-4111-8111-111111111111'),
    );
    expect(getFeatureBoard(root).sessions).toMatchObject({ state: 'partial', items: [] });
  });

  it('拒绝越界 Session Junction，且不回退 legacy 状态', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    fs.mkdirSync(path.join(root, '.amber'));
    fs.writeFileSync(path.join(outside, 'secret.json'), JSON.stringify(session(id, 'F001')));
    fs.symlinkSync(outside, path.join(root, '.amber/sessions'), 'junction');
    expect(getFeatureBoard(root).sessions.state).toBe('error');
    fs.unlinkSync(path.join(root, '.amber/sessions'));
    write(`.harness/sessions/${id}/manifest.json`, session(id, 'F001'));
    expect(getFeatureBoard(root).sessions).toMatchObject({ state: 'error', items: [] });
  });

  it('拒绝越界 Feature 符号链接', () => {
    const file = path.join(root, 'feature_list.json');
    fs.renameSync(file, path.join(outside, 'feature_list.json'));
    fs.symlinkSync(path.join(outside, 'feature_list.json'), file, 'file');
    expect(getFeatureBoard(root).features.state).toBe('error');
    fs.unlinkSync(file);
  });

  it('query 只读取服务器选定仓库，拒绝客户端路径和执行参数', async () => {
    const original = process.env.AMBER_REPO_ROOT;
    process.env.AMBER_REPO_ROOT = root;
    try {
      const caller = continuityRouter.createCaller({});
      const before = snapshot(root);
      expect((await caller.governance.board()).features.items[0].id).toBe('F001');
      await caller.governance.board();
      const query = caller.governance.board as (input: unknown) => Promise<unknown>;
      await expect(query({ target: outside, execute: true })).rejects.toThrow();
      expect(snapshot(root)).toEqual(before);
    } finally {
      if (original === undefined) delete process.env.AMBER_REPO_ROOT;
      else process.env.AMBER_REPO_ROOT = original;
    }
  });

  it('重复读取完全不改变文件树和文件内容', () => {
    write(
      '.amber/sessions/11111111-1111-4111-8111-111111111111/manifest.json',
      session('11111111-1111-4111-8111-111111111111', 'F001'),
    );
    const before = snapshot(root);
    getFeatureBoard(root);
    getFeatureBoard(root);
    expect(snapshot(root)).toEqual(before);
  });
});
