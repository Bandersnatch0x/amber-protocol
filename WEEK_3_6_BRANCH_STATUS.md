# Week 3-6 分支状态评审

## 执行摘要

**结论: 这些分支已过时,需要大规模重构才能合并**

- ❌ 所有4个分支基于30小时前的代码
- ❌ 使用旧命名 (`harness.js` → 已重命名为 `amber.js`)
- ❌ 使用旧API (`harness-core.js` → 已重构为模块化)
- ❌ 缺少 Phase 2/3/4 的治理/维护/执行边界
- ⚠️ Week 3 在其基础上测试有7个失败
- ⚠️ 预计与当前master有重大合并冲突

## 分支详情

### Week 3: Session Lifecycle
- **提交**: b7ac9c1 (30小时前)
- **内容**: 会话状态机、worktree管理器、session命令
- **新增文件**:
  - `scripts/lib/session-commands.js` (243行)
  - `scripts/lib/session-state-machine.js` (73行)
  - `scripts/lib/worktree-manager.js` (111行)
  - `scripts/lib/session-manifest.js` (37行)
- **问题**: 
  - 修改 `scripts/harness.js` (已不存在,现在是 `amber.js`)
  - 修改 `scripts/lib/harness-core.js` (已重构)
  - 测试失败: 7个

### Week 4: Interactive Execution
- **提交**: 55184d8 (29小时前)
- **内容**: 阶段执行器、gate处理、预算跟踪、执行引擎
- **新增文件**:
  - `scripts/lib/execution-engine.js` (113行)
  - `scripts/lib/stage-executor.js` (70行)
  - `scripts/lib/gate-handler.js` (64行)
  - `scripts/lib/budget-tracker.js` (66行)
- **问题**: 同Week 3,且依赖Week 3的session-commands

### Week 5: Checkpoint/Continue
- **提交**: d9a12ac (28小时前)
- **内容**: 检查点系统、schema版本检查、迁移工具、恢复
- **新增文件**:
  - `scripts/lib/checkpoint-manager.js` (94行)
  - `scripts/lib/schema-version-checker.js` (24行)
  - `scripts/lib/migrate-command.js` (82行) ⚠️ 与现有冲突
- **问题**: 依赖Week 3+4,migrate命令已存在

### Week 6: Web Viewer
- **提交**: 8dcc34f (28小时前)
- **内容**: 仅1行修复 (timeline-writer require)
- **问题**: 修复的文件基于Week 3版本

## 代码质量评估

**积极方面:**
- ✅ 模块划分清晰 (session/execution/checkpoint分离)
- ✅ 测试覆盖看起来完整 (unit + integration)
- ✅ 有状态机设计 (session-state-machine.js)
- ✅ 有worktree隔离 (worktree-manager.js)

**问题:**
- ❌ API命名冲突 (`migrate-command.js` 已存在)
- ❌ 文件位置冲突 (`session-commands.js` 已存在于master)
- ❌ 依赖链脆弱 (Week 4依赖Week 3,Week 5依赖Week 3+4)
- ❌ 缺少与Phase 2/3/4的集成点

## 合并成本估算

### 选项A: 直接合并 (不推荐)
- **工作量**: 3-5天
- **风险**: 高
- **步骤**:
  1. 重命名所有 harness → amber
  2. 重构 harness-core 调用为模块化
  3. 解决 migrate/session-commands 命名冲突
  4. 修复 7+ 测试失败
  5. 与 Phase 2/3/4 治理集成
  6. 全面回归测试

### 选项B: 选择性移植 (推荐)
- **工作量**: 2-3天
- **风险**: 中
- **步骤**:
  1. 从Week 3提取核心逻辑:
     - `session-state-machine.js` → 重写为适配当前API
     - `worktree-manager.js` → 集成到现有worktree逻辑
  2. 从Week 4提取:
     - `stage-executor.js` → 重写
     - `gate-handler.js` → 集成到governance
  3. 从Week 5提取:
     - `checkpoint-manager.js` → 重写
  4. 抛弃Week 6 (仅1行修复,不值得)

### 选项C: 重新实现 (最干净)
- **工作量**: 3-4天
- **风险**: 低
- **优势**:
  - 基于当前稳定master
  - 完全兼容Phase 2/3/4
  - 使用Amber命名
  - 无技术债务
- **步骤**:
  1. 参考Week 3-5的**设计**
  2. 用当前API从零实现
  3. 逐步测试
  4. 干净集成

## 与当前master的差异

**Master已有 (Week 3-5缺失):**
- ✅ Amber Protocol重命名 (Phase 1)
- ✅ Governance surfaces (Phase 2)
- ✅ Maintenance automation (Phase 3)
- ✅ Execution boundaries (Phase 4)
- ✅ 493个测试全部通过
- ✅ 模块化core架构

**Week 3-5有 (Master缺失):**
- 🔵 Session状态机
- 🔵 Worktree管理器
- 🔵 Interactive执行引擎
- 🔵 Checkpoint/Continue系统
- 🔵 Budget跟踪

## 决策矩阵

| 标准 | 选项A直接合并 | 选项B移植 | 选项C重实现 |
|------|--------------|----------|------------|
| 时间成本 | 3-5天 | 2-3天 | 3-4天 |
| 技术债务 | 高 | 中 | 低 |
| 测试覆盖 | 需大量修复 | 需重写 | 从零开始 |
| 与Phase2/3/4集成 | 困难 | 中等 | 简单 |
| 风险 | 高 | 中 | 低 |
| 代码质量 | 混乱 | 可控 | 优秀 |

## 建议

### 立即行动 (今天)

**抛弃这4个分支,采用选项C: 基于当前master重新实现**

**理由:**
1. Week 3-5分支已经与master严重分叉
2. 直接合并会引入大量冲突和技术债务
3. 重新实现可以利用Phase 2/3/4的治理基础设施
4. 当前master稳定且测试全过 (493/493)
5. Week 3-5的**设计思路**仍然有效,只是实现过时

### 实施步骤

**Week 3: Session Lifecycle (Day 1-2)**
1. 基于当前master创建新分支 `feat/session-lifecycle-v2`
2. 参考旧Week 3的状态机设计
3. 使用 `scripts/lib/core/` 模块化架构
4. 集成 governance evidence (Phase 2)
5. 使用 execution boundaries (Phase 4)
6. 完整测试后合并

**Week 4: Interactive Execution (Day 3-4)**
1. 在Week 3 v2基础上添加交互执行
2. 使用 gate-handler 集成 governance policy
3. Budget跟踪集成到执行边界
4. 完整测试后合并

**Week 5: Checkpoint/Continue (Day 5-6)**
1. 在Week 4基础上添加检查点
2. 与 maintenance automation (Phase 3) 集成
3. 完整测试后合并

### 保留的资源

从旧分支中提取的**设计文档和测试用例**:
- `tests/unit/session-state-machine.test.js` → 提取状态转换逻辑
- `tests/integration/kill-recovery.test.js` → 提取恢复场景
- `scripts/lib/session-state-machine.js` → 提取状态机图

## 结论

**Week 3-6分支是有价值的原型,但实现已过时。**

**最佳路径**: 
1. ✅ 保留设计思路和测试场景
2. ❌ 抛弃具体实现代码
3. 🔄 基于当前稳定master重新实现
4. 📈 利用Phase 2/3/4的治理基础设施

**预计交付**: 6天完成Week 3-5的v2实现,质量更高,债务更少。
