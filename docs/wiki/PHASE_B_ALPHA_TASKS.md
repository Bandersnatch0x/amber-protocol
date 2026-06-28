> Historical Phase B Alpha task list predating the Amber Protocol rename; command and file names reflect the era.

Last Reviewed: 2026-06-29

# Phase B Alpha - 完整任务清单

**时间**: 5周（W1-W5）  
**目标**: 动态执行内核 + 只读 Web Viewer

## Week 1: UL & Schema 冻结

### 任务 1.1: 泛用语言更新
- [ ] 更新 `UBIQUITOUS_LANGUAGE.md` 添加 Phase B 术语
  - Route, Session, Stage, Gate, Checkpoint, Timeline
- [ ] 创建术语索引和关系图
- [ ] 团队评审和确认

### 任务 1.2: Route Schema 定义
- [ ] 创建 `schemas/route.schema.json`
  - routeId, version, stages[], gates[], defaults
- [ ] 编写 3 条参考 route
  - `routes/feature-standard.route.json`
  - `routes/bugfix-quick.route.json`
  - `routes/refactor-safe.route.json`
- [ ] 实现 schema 验证器
  - `scripts/lib/validate-route.js`
- [ ] 单元测试（覆盖率 >90%）

### 任务 1.3: Session Manifest Schema
- [ ] 创建 `schemas/session-manifest.schema.json`
  - sessionId, schemaVersion, route, status, budget, worktree
- [ ] 实现生成器 `scripts/lib/session-manifest.js`
- [ ] 单元测试

### 任务 1.4: Timeline Schema
- [ ] 创建 `schemas/timeline-event.schema.json`
  - timestamp, type, stage, data
- [ ] 实现 JSONL 追加写入器
  - `scripts/lib/timeline-writer.js`
- [ ] 实现读取器和解析器
- [ ] 测试（1000+ 事件性能）

**交付物**:
- ✅ 4 个 JSON Schema 文件
- ✅ 3 个参考 route 文件
- ✅ 验证器和生成器（测试覆盖率 >90%）
- ✅ 泛用语言更新文档

**验收**:
- [ ] 所有 schema 通过 JSON Schema Draft-07 验证
- [ ] 参考 route 通过验证器
- [ ] Timeline 追加写入不阻塞（异步）
- [ ] 文档团队评审通过

---

## Week 2: 路由引擎

### 任务 2.1: Route 命令组
- [ ] `route list` - 列出所有可用 route
  - 读取 `routes/*.route.json`
  - 显示 id, version, description, stages
- [ ] `route inspect <id>` - 显示 route 详情
  - 完整 JSON
  - 阶段树可视化
  - Gate 标注
- [ ] `route validate <file>` - 验证 route 文件
  - Schema 验证
  - 引用完整性检查（skill/pack 存在性）
- [ ] `route test <id> --dry-run` - 测试路由逻辑
  - 模拟执行流程
  - 输出预期阶段序列

### 任务 2.2: 路由选择器
- [ ] 实现 `scripts/lib/route-selector.js`
  - 基于 goal pattern 匹配
  - 返回最佳匹配 route + confidence
- [ ] 添加交互式选择（如果有多个匹配）
- [ ] 单元测试（10+ 匹配场景）

### 任务 2.3: 集成到 harness.js
- [ ] 添加 `route` 命令到主 CLI
  - `node scripts/amber.js route <subcommand>`
- [ ] 添加 help 文本
- [ ] 端到端测试

**交付物**:
- ✅ `route` 命令组（4 个子命令）
- ✅ 路由选择器（含测试）
- ✅ CLI 集成和文档

**验收**:
- [ ] `route list` 显示所有 3 条参考 route
- [ ] `route inspect feature-standard` 输出完整 JSON
- [ ] `route validate` 能检测出故意的错误 route
- [ ] 路由选择器对 20+ goal 测试全部通过

---

## Week 3: Session 生命周期

### 任务 3.1: Session 命令组
- [ ] `session start --goal "..." [--route <id>]`
  - 创建 `.amber/sessions/<uuid>/`
  - 写入 `manifest.json`
  - 初始化 `timeline.jsonl`
  - 状态: created
- [ ] `session status [<id>]`
  - 显示当前/指定 session 状态
  - 当前 stage, 进度, budget 使用
- [ ] `session list`
  - 列出所有 session（按时间倒序）
  - 状态筛选
- [ ] `session abort <id>`
  - 设置状态为 failed
  - 写入 abort event 到 timeline
  - 清理 worktree（可选）

### 任务 3.2: 状态机实现
- [ ] 创建 `scripts/lib/session-state-machine.js`
  - 状态转换: created → routed → executing → paused → completed
  - 非法转换拒绝
  - 每次转换写入 timeline
- [ ] 单元测试（所有合法/非法转换）

### 任务 3.3: Worktree 管理
- [ ] 实现 `scripts/lib/worktree-manager.js`
  - 创建隔离 worktree: `.amber/worktrees/<session-id>/`
  - 基于当前 branch
  - 清理逻辑（session 结束时）
- [ ] 测试（创建、隔离、清理）

### 任务 3.4: Web MVP - Dashboard
- [ ] 初始化 `harness-web/` Next.js 项目
  ```bash
  cd harness-web
  npm init -y
  npx create-next-app@latest . --typescript --app --no-tailwind
  ```
- [ ] 配置 CSS Modules
- [ ] 创建基础布局
  - `app/layout.tsx` - Sidebar + Header
  - `components/layout/Sidebar.tsx`
  - `components/layout/Header.tsx`
- [ ] Dashboard 页面 `app/page.tsx`
  - 4 个状态卡片（Sessions/Features/Routes/Health）
  - 活动流（最近 10 条事件）
  - 快速操作按钮

### 任务 3.5: Web MVP - Session 列表
- [ ] 配置 tRPC
  - `server/trpc.ts`
  - `server/routers/sessions.ts`
- [ ] Session 列表页面 `app/sessions/page.tsx`
  - 读取 `.amber/sessions/*/manifest.json`
  - 显示 id, status, goal, createdAt
  - 状态筛选
- [ ] Session 详情页面 `app/sessions/[id]/page.tsx`
  - 显示 manifest 完整信息
  - 当前 stage
  - Budget 使用情况

**交付物**:
- ✅ `session` 命令组（4 个子命令）
- ✅ Session 状态机（含测试）
- ✅ Worktree 管理器
- ✅ Web MVP（Dashboard + Session 列表/详情）

**验收**:
- [ ] `session start --goal "test"` 创建新 session
- [ ] `.amber/sessions/<uuid>/manifest.json` 存在且 schema 有效
- [ ] `session status` 显示当前 session 信息
- [ ] 故意 kill 进程，session 状态保留在 executing
- [ ] Worktree 在 `.amber/worktrees/<uuid>/` 创建成功
- [ ] Web Dashboard 显示 session 统计
- [ ] Web 可以浏览 session 列表和查看详情

---

## Week 4: Interactive 执行 + Gate 集成

### 任务 4.1: Stage 执行器
- [ ] 创建 `scripts/lib/stage-executor.js`
  - 按 route 定义顺序执行 stage
  - 每个 stage 调用对应 pack/skill
  - 执行前后写入 timeline event
- [ ] 实现 dry-run 模式
- [ ] 单元测试

### 任务 4.2: Gate 检查点
- [ ] 创建 `scripts/lib/gate-handler.js`
  - 类型: auto, user-approval, step-confirm
  - auto: 自动条件检查
  - user-approval: 提示用户确认
  - step-confirm: 每步都确认
- [ ] 实现交互式确认 UI
  - 使用 `inquirer` 或 `prompts`
- [ ] Gate 状态写入 timeline
- [ ] 单元测试（模拟用户输入）

### 任务 4.3: Budget 追踪
- [ ] 创建 `scripts/lib/budget-tracker.js`
  - 从 manifest.budget 读取限制
  - 追踪 used 值（每次操作累加）
  - 90% 警告，100% 自动 pause
- [ ] 写入 budget event 到 timeline
- [ ] 单元测试

### 任务 4.4: Interactive 模式集成
- [ ] `session start --goal "..." --mode interactive`
  - 每个 stage 前询问
  - 每个 gate 停止等待
- [ ] `session continue`
  - 从当前 stage 继续
  - 如果 paused 状态，询问是否继续
- [ ] 端到端测试

### 任务 4.5: Web MVP - Timeline 查看器
- [ ] Timeline 页面 `app/sessions/[id]/timeline/page.tsx`
  - 读取 `timeline.jsonl`
  - 按时间顺序展示事件
  - 事件类型图标（route/stage/gate/error）
  - 展开/折叠事件详情
- [ ] Timeline 组件 `components/sessions/SessionTimeline.tsx`
  - 垂直时间轴样式
  - Gate 事件高亮
  - 错误事件红色标注

**交付物**:
- ✅ Stage 执行器（含 dry-run）
- ✅ Gate 处理器（3 种类型）
- ✅ Budget 追踪器和熔断
- ✅ Interactive 模式集成
- ✅ Web Timeline 查看器

**验收**:
- [ ] `session start --mode interactive` 在每个 stage 前暂停
- [ ] 用户输入 "no" 时 session 自动 abort
- [ ] Budget 达到 90% 显示警告
- [ ] Budget 达到 100% 自动 pause 并写入 event
- [ ] Web Timeline 显示所有事件（1000+ 条性能 <2s）
- [ ] Web Gate 事件可以展开查看详细 data

---

## Week 5: Continue 加固 + 迁移工具

### 任务 5.1: Checkpoint 系统
- [ ] 创建 `scripts/lib/checkpoint-manager.js`
  - 在关键点保存 checkpoint（stage 开始/结束）
  - 路径: `.amber/sessions/<id>/checkpoints/<stage>.json`
  - 包含: stage, timestamp, manifest snapshot, worktree state
- [ ] 恢复逻辑
  - 读取最新 checkpoint
  - 恢复 worktree
  - 恢复 manifest 状态
- [ ] 单元测试

### 任务 5.2: Continue 命令加固
- [ ] `session continue [<id>]`
  - 如果无 id，查找最近的非完成 session
  - 读取最新 checkpoint
  - 从中断点恢复执行
  - 处理 paused 状态（budget 超限）
- [ ] 添加 `--from-checkpoint <name>` 选项
  - 支持从任意 checkpoint 恢复
- [ ] 端到端测试（故意中断恢复场景）

### 任务 5.3: Schema 版本兼容性
- [ ] 实现 `scripts/lib/schema-version-checker.js`
  - 读取 manifest.schemaVersion
  - 对比当前支持的版本
  - 不匹配时拒绝并提示迁移
- [ ] 单元测试（模拟旧版本 manifest）

### 任务 5.4: 迁移工具
- [ ] `harness migrate --target <project-root>`
  - 扫描所有 session manifest
  - 检测 schemaVersion
  - 自动升级到最新版本
  - 备份旧文件
- [ ] 支持 dry-run 预览
- [ ] 迁移日志

### 任务 5.5: Web MVP - Wiki + 命令参考
- [ ] Wiki 浏览器 `app/wiki/[...path]/page.tsx`
  - 读取 `docs/wiki/**/*.md`
  - Markdown 渲染（react-markdown + shiki）
  - 左侧树形导航
  - 内链跳转
- [ ] 命令参考页面 `app/commands/page.tsx`
  - 读取所有 harness 命令
  - 分组显示（route/session/pack/team）
  - 搜索过滤
  - 示例代码高亮
- [ ] 基础设置页面 `app/settings/page.tsx`
  - 主题切换（深色/浅色）
  - 保存到 localStorage

**交付物**:
- ✅ Checkpoint 系统（保存和恢复）
- ✅ Continue 命令完整实现
- ✅ Schema 版本检查器
- ✅ 迁移工具
- ✅ Web Wiki 浏览器
- ✅ Web 命令参考
- ✅ Web 基础设置

**验收**:
- [ ] `session continue` 可以从任意中断点恢复
- [ ] 故意 kill 进程 3 次，每次 continue 都能正确恢复
- [ ] Checkpoint 文件包含完整状态快照
- [ ] `harness migrate` 可以升级旧版本 manifest
- [ ] Schema 版本不匹配时明确拒绝并提示
- [ ] Web Wiki 可以浏览所有文档
- [ ] Web 命令参考可以搜索和过滤
- [ ] Web 主题切换生效并保存

---

## Milestone 1 综合验收（严格）

### 核心场景测试

#### 场景 1: 完整 Session 生命周期
```bash
# 1. 启动 session
session start --goal "implement user authentication" --mode interactive

# 预期:
# - 创建 .amber/sessions/<uuid>/
# - manifest.json schemaVersion="1.0.0", status="created"
# - timeline.jsonl 有 session_created event
# - 自动选择 route: feature-standard

# 2. 执行到第一个 gate
# 预期: 提示 "Proceed to stage: capture? [y/n]"

# 3. 用户确认后继续
# 预期: 
# - status 变为 executing
# - currentStage="capture"
# - timeline 有 stage_started event

# 4. 故意中断（Ctrl+C）
# 预期:
# - session 保留在 executing 状态
# - checkpoint 文件存在

# 5. 恢复
session continue

# 预期:
# - 从 capture stage 继续
# - 不重新执行已完成的步骤
# - timeline 有 session_resumed event
```

#### 场景 2: Budget 熔断
```bash
session start --goal "test budget" --route feature-standard --budget 1000

# 模拟高消耗操作，达到 budget 100%
# 预期:
# - 达到 90% 显示警告
# - 达到 100% 自动 pause
# - status="paused"
# - timeline 有 budget_exceeded event

session continue
# 预期: 提示 "Budget exceeded. Continue anyway? [y/n]"
```

#### 场景 3: Schema 降级检测
```bash
# 1. 手动修改 manifest.json: schemaVersion="0.9.0"

# 2. 尝试 continue
session continue

# 预期:
# - 明确拒绝: "Unsupported schema version 0.9.0"
# - 提示: "Run 'harness migrate' to upgrade"

# 3. 运行迁移
harness migrate

# 预期:
# - 检测到旧版本
# - 备份到 manifest.json.backup
# - 升级到 1.0.0
# - 输出迁移报告
```

### 性能基线测试

| 操作 | 目标 | 测试方法 |
|------|------|----------|
| `session start` | <2s | 100 次平均 |
| `session continue` | <1s | 100 次平均 |
| Timeline 追加写入 | <10ms | 1000 次 |
| Timeline 读取 1000 事件 | <500ms | 读取并解析 |
| Web Dashboard 加载 | <3s | Lighthouse |
| Web Session 列表（100 sessions）| <1s | 实测 |

### 安全契约验证

1. **写操作隔离**:
   ```bash
   # 故意在 session 外修改项目文件
   # 预期: 拒绝或警告
   ```

2. **Timeline 不可变**:
   ```bash
   # 手动修改 timeline.jsonl 中已存在的行
   # 预期: 下次读取时检测到并拒绝
   ```

3. **Schema 版本强制**:
   ```bash
   # 删除 manifest.schemaVersion
   # 预期: 读取时拒绝
   ```

### 文档完整性检查

- [ ] `UBIQUITOUS_LANGUAGE.md` 包含所有 Phase B 术语
- [ ] 每个命令都有 `--help` 输出
- [ ] README 更新包含 Phase B Alpha 使用指南
- [ ] API 文档覆盖所有 schema

### 团队验收

- [ ] 至少 2 名团队成员独立完成场景 1-3
- [ ] 至少 3 个不同项目成功运行 Alpha
- [ ] 收集反馈并记录到 `PHASE_B_ALPHA_FEEDBACK.md`

---

## 风险和缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| Schema 设计返工 | 中 | 高 | W1 冻结后严格评审，不允许破坏性变更 |
| Worktree 管理复杂 | 高 | 中 | 使用成熟的 Git worktree 命令，充分测试 |
| Web 并行开发阻塞 | 中 | 低 | CLI 先行，Web 只读取状态文件 |
| Budget 追踪不准确 | 中 | 中 | 使用保守估计，允许手动调整 |
| Continue 恢复失败 | 高 | 高 | 多层 checkpoint，至少保留最近 3 个 |

## 交付清单

### 代码
- [ ] `scripts/lib/validate-route.js`
- [ ] `scripts/lib/session-manifest.js`
- [ ] `scripts/lib/timeline-writer.js`
- [ ] `scripts/lib/route-selector.js`
- [ ] `scripts/lib/session-state-machine.js`
- [ ] `scripts/lib/worktree-manager.js`
- [ ] `scripts/lib/stage-executor.js`
- [ ] `scripts/lib/gate-handler.js`
- [ ] `scripts/lib/budget-tracker.js`
- [ ] `scripts/lib/checkpoint-manager.js`
- [ ] `scripts/lib/schema-version-checker.js`

### Schema
- [ ] `schemas/route.schema.json`
- [ ] `schemas/session-manifest.schema.json`
- [ ] `schemas/timeline-event.schema.json`
- [ ] `routes/feature-standard.route.json`
- [ ] `routes/bugfix-quick.route.json`
- [ ] `routes/refactor-safe.route.json`

### Web
- [ ] `harness-web/` 完整 Next.js 项目
- [ ] Dashboard + Session + Timeline + Wiki + Commands + Settings

### 文档
- [ ] `UBIQUITOUS_LANGUAGE.md` 更新
- [ ] `SCHEMA_SPEC.md` (新增)
- [ ] `PHASE_B_ALPHA_GUIDE.md` 用户指南
- [ ] `PHASE_B_ALPHA_FEEDBACK.md` 团队反馈

### 测试
- [ ] 单元测试覆盖率 >90% (核心模块)
- [ ] 集成测试 10+ 端到端场景
- [ ] 性能基准测试通过

## 下周预览（Beta W6）

- Pack 执行集成
- Task 契约层
- Feature 看板（Web）
- Plan 结构化视图（Web）
