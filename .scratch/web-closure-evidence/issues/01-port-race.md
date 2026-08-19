# 01 端口竞态根治：dev-bootstrap 单次预解析

## Objective

消除 `npm run dev` 下 server 与 vite 各自独立探测端口导致的代理漂移（API 监听 4101、vite 代理指向 4102，全站 /api/trpc 500）。采用方案 A：端口只解析一次（`server/dev-bootstrap.mts`），经 `PORT`/`API_PORT` 注入两个子进程，两侧均不再探测；显式 env 保持最高优先级逃生门。

改动落点（取证自仓库现状）：

- `apps/web/server/dev-bootstrap.mts`（`npm run dev` 唯一入口，单次 `resolveSharedDevPort()` 后注入）
- `apps/web/server/lib/api-port.ts`（新增 `resolveSharedDevPort`）
- `apps/web/package.json`（`dev` 脚本改为 `tsx server/dev-bootstrap.mts`）
- `apps/web/vite.config.mts` / `apps/web/server/index.ts`（显式 env 链，不再探测）

## Blocking edges

- blocked by：任务 #14 浏览器端到端实测报告（缺陷 #1：端口漂移）——问题输入。
- blocks（回溯标注实际依赖）：票据 02–05 的 e2e 验证（e2e webServer 依赖稳定端口语义）、票据 10 的格式门禁运行环境。

## Status: DONE

## TDD evidence

- `apps/web/tests/server/api-port.test.ts` — 17 例（parsePortEnv 3、resolveApiPort 7、resolveSharedDevPort 5、resolveApiPortSync 2；含 EACCES 跳过、真实 EADDRINUSE 占端口、候选库默认值断言）
- `apps/web/tests/server/vite-config.test.ts` — 2 例（IPv4 loopback 固定 + `API_PORT ?? PORT` 显式链原样生效）
- e2e：`apps/web/tests/e2e/health.spec.ts` — 2 例（Express `/api/health` 与 Vite dev server 可达性，端口链路冒烟）

## Browser evidence

- `.scratch/13-drift-evidence-api-4101-health.png`（缺陷现场：API 4101 直连健康）
- `.scratch/14-drift-evidence-4102-refused.png`（缺陷现场：vite 代理漂移 4102 拒绝）
- `.scratch/recheck-01-home-zh.png`（修复后首页数据正常加载，任务 #22-A 复检）

## Verification

- 任务 #15 执行时：`api-port.test.ts` 17 例 + `vite-config.test.ts` 2 例全绿；Playwright 35/35 全绿（走 4101 回退路径）；三次无 env 并发启动验证（含 4101 被占→同步收敛 4102 的关键轮次）。
- 会话收敛口径（任务 #36/#37 复验）：apps/web vitest 65 文件 / 555 例全绿；根 `npm test` 2003 例（1999 pass / 0 fail / 4 skip）；Playwright e2e 40/40；`tsc --noEmit` 0 错误；`eslint` 退出码 0。

## Notes

- 方案决策：拒绝方案 B（请求时动态代理）与方案 C（预绑定持有）——A 物理上消除"两次独立探测"，竞态窗口不存在。
- `dev-bootstrap.mts` 使用 `.mts` 后缀：concurrently v10 为 ESM-only，CJS 互操作会破坏其 rxjs 依赖。
- 偏差：执行期间清理了上一轮遗留的孤儿 dev 进程（占 4101/4102/5173），它们是旧竞态漂移的残留物。
