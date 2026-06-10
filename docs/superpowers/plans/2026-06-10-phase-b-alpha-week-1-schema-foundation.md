# Phase B Alpha 完整实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**: 构建动态执行内核（Route/Session/Stage/Gate/Checkpoint）+ 只读 Web Viewer

**架构**: CLI 执行引擎使用 Node.js，基于 JSON Schema 的数据模型，JSONL 事件流，Git worktree 隔离。Web Viewer 使用 Next.js 14 + tRPC + CSS Modules。

**技术栈**: Node.js 20+, JSON Schema Draft-07, Next.js 14, TypeScript, tRPC, CSS Modules, chokidar

**时间**: 5周（W1-W5）

---

## 文件结构规划

### Week 1: Schema 和验证器
```
schemas/
  route.schema.json                 # Route 定义规范
  session-manifest.schema.json      # Session 元数据规范
  timeline-event.schema.json        # Timeline 事件规范
routes/
  feature-standard.route.json       # 标准功能开发路由
  bugfix-quick.route.json           # 快速 bug 修复路由
  refactor-safe.route.json          # 安全重构路由
scripts/lib/
  validate-route.js                 # Route 验证器
  session-manifest.js               # Session manifest 生成器
  timeline-writer.js                # Timeline JSONL 写入器
  timeline-reader.js                # Timeline 读取器
tests/unit/
  validate-route.test.js
  session-manifest.test.js
  timeline-writer.test.js
```

### Week 2: 路由引擎
```
scripts/lib/
  route-selector.js                 # 路由选择器（goal 匹配）
  route-commands.js                 # route 命令实现
scripts/
  harness.js                        # 主 CLI（添加 route 命令）
tests/unit/
  route-selector.test.js
tests/integration/
  route-commands.test.js
```

### Week 3: Session 生命周期
```
scripts/lib/
  session-state-machine.js          # 状态机
  worktree-manager.js               # Worktree 管理
  session-commands.js               # session 命令实现
.harness/sessions/                  # Session 数据目录
tests/unit/
  session-state-machine.test.js
  worktree-manager.test.js
```

### Week 4: Interactive 执行
```
scripts/lib/
  stage-executor.js                 # Stage 执行器
  gate-handler.js                   # Gate 处理器
  budget-tracker.js                 # Budget 追踪
tests/unit/
  stage-executor.test.js
  gate-handler.test.js
  budget-tracker.test.js
```

### Week 5: Checkpoint 和 Continue
```
scripts/lib/
  checkpoint-manager.js             # Checkpoint 管理
  schema-version-checker.js         # Schema 版本检查
  migrate-command.js                # 迁移工具
tests/unit/
  checkpoint-manager.test.js
  schema-version-checker.test.js
```

### Web Viewer (W3-W5 并行)
```
harness-web/
  app/
    layout.tsx
    page.tsx                        # Dashboard
    sessions/
      page.tsx                      # Session 列表
      [id]/page.tsx                 # Session 详情
      [id]/timeline/page.tsx        # Timeline 查看器
    wiki/[...path]/page.tsx         # Wiki 浏览器
    commands/page.tsx               # 命令参考
    settings/page.tsx               # 设置
  components/
    layout/
      Sidebar.tsx
      Header.tsx
    sessions/
      SessionCard.tsx
      SessionTimeline.tsx
  server/
    trpc.ts
    routers/
      sessions.ts
```

---

## Week 1: Schema Foundation

### Task 1: Route Schema

**Files:**
- Create: `schemas/route.schema.json`
- Create: `routes/feature-standard.route.json`
- Create: `scripts/lib/validate-route.js`
- Create: `tests/unit/validate-route.test.js`

- [ ] **Step 1: 创建 Route Schema 文件**

```bash
mkdir -p schemas routes scripts/lib tests/unit
```

创建 `schemas/route.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["routeId", "schemaVersion", "stages"],
  "properties": {
    "routeId": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$"
    },
    "schemaVersion": {
      "type": "string",
      "const": "1.0.0"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "displayName": {"type": "string"},
    "description": {"type": "string"},
    "trigger": {
      "type": "object",
      "properties": {
        "goalPattern": {"type": "string"},
        "complexity": {"enum": ["simple", "medium", "complex"]}
      }
    },
    "stages": {
      "type": "array",
      "minItems": 1,
      "items": {"$ref": "#/definitions/Stage"}
    },
    "gates": {
      "type": "array",
      "items": {"$ref": "#/definitions/Gate"}
    }
  },
  "definitions": {
    "Stage": {
      "type": "object",
      "required": ["name", "type"],
      "properties": {
        "name": {"type": "string", "pattern": "^[a-z0-9-]+$"},
        "displayName": {"type": "string"},
        "type": {"enum": ["pack", "skill", "command", "gate"]},
        "target": {"type": "string"},
        "gateAfter": {"type": "string"},
        "optional": {"type": "boolean", "default": false}
      }
    },
    "Gate": {
      "type": "object",
      "required": ["id", "type"],
      "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9-]+$"},
        "type": {"enum": ["auto", "user-approval", "step-confirm"]},
        "description": {"type": "string"}
      }
    }
  }
}
```

- [ ] **Step 2: 创建参考 Route**

创建 `routes/feature-standard.route.json`:

```json
{
  "routeId": "feature-standard",
  "schemaVersion": "1.0.0",
  "version": "1.0.0",
  "displayName": "Standard Feature Development",
  "description": "Complete feature delivery with planning and review",
  "trigger": {
    "goalPattern": "^(add|implement|create|build)\\s+.*feature",
    "complexity": "medium"
  },
  "stages": [
    {
      "name": "capture",
      "displayName": "Capture Requirements",
      "type": "skill",
      "target": "requirement-clarification",
      "gateAfter": "user-approval-plan"
    },
    {
      "name": "plan",
      "displayName": "Create Plan",
      "type": "pack",
      "target": "feature-planning",
      "gateAfter": "user-approval-implement"
    },
    {
      "name": "implement",
      "displayName": "Implement Feature",
      "type": "pack",
      "target": "tdd-implementation"
    },
    {
      "name": "verify",
      "displayName": "Run Verification",
      "type": "command",
      "target": "npm test"
    }
  ],
  "gates": [
    {
      "id": "user-approval-plan",
      "type": "user-approval",
      "description": "Approve plan before implementation?"
    },
    {
      "id": "user-approval-implement",
      "type": "user-approval",
      "description": "Proceed with implementation?"
    }
  ]
}
```

- [ ] **Step 3: 编写验证器的失败测试**

创建 `tests/unit/validate-route.test.js`:

```javascript
const assert = require('assert');
const validateRoute = require('../../scripts/lib/validate-route');
const fs = require('fs');

describe('validateRoute', () => {
  it('should reject route without routeId', () => {
    const route = {schemaVersion: "1.0.0", stages: []};
    const result = validateRoute(route);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('routeId')));
  });

  it('should reject route with invalid schemaVersion', () => {
    const route = {
      routeId: "test",
      schemaVersion: "0.9.0",
      stages: [{name: "test", type: "command"}]
    };
    const result = validateRoute(route);
    assert.strictEqual(result.valid, false);
  });

  it('should accept valid route', () => {
    const routeData = fs.readFileSync('routes/feature-standard.route.json', 'utf8');
    const route = JSON.parse(routeData);
    const result = validateRoute(route);
    assert.strictEqual(result.valid, true);
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

```bash
npm test tests/unit/validate-route.test.js
```

预期输出: `FAIL` - `validateRoute is not defined`

- [ ] **Step 5: 实现验证器**

创建 `scripts/lib/validate-route.js`:

```javascript
const Ajv = require('ajv');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../../schemas/route.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv();
const validate = ajv.compile(schema);

function validateRoute(routeData) {
  const valid = validate(routeData);
  
  if (!valid) {
    return {
      valid: false,
      errors: validate.errors.map(e => `${e.instancePath} ${e.message}`)
    };
  }
  
  return {valid: true, errors: []};
}

module.exports = validateRoute;
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test tests/unit/validate-route.test.js
```

预期输出: `PASS` - 3 tests passed

- [ ] **Step 7: 提交**

```bash
git add schemas/ routes/ scripts/lib/validate-route.js tests/unit/validate-route.test.js
git commit -m "feat: add route schema and validator"
```

---

### Task 2: Session Manifest Schema

**Files:**
- Create: `schemas/session-manifest.schema.json`
- Create: `scripts/lib/session-manifest.js`
- Create: `tests/unit/session-manifest.test.js`

- [ ] **Step 1: 创建 Session Manifest Schema**

创建 `schemas/session-manifest.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["sessionId", "schemaVersion", "createdAt", "route", "goal", "status"],
  "properties": {
    "sessionId": {"type": "string", "format": "uuid"},
    "schemaVersion": {"type": "string", "const": "1.0.0"},
    "createdAt": {"type": "string", "format": "date-time"},
    "updatedAt": {"type": "string", "format": "date-time"},
    "route": {
      "type": "object",
      "required": ["id", "version"],
      "properties": {
        "id": {"type": "string"},
        "version": {"type": "string"}
      }
    },
    "goal": {"type": "string", "minLength": 1},
    "status": {
      "enum": ["created", "routed", "executing", "paused", "completed", "failed", "aborted"]
    },
    "currentStage": {"type": "string"},
    "completedStages": {
      "type": "array",
      "items": {"type": "string"}
    },
    "budget": {
      "type": "object",
      "properties": {
        "total": {"type": "integer", "minimum": 0},
        "used": {"type": "integer", "minimum": 0}
      }
    },
    "worktree": {"type": "string"}
  }
}
```

- [ ] **Step 2: 编写生成器的失败测试**

创建 `tests/unit/session-manifest.test.js`:

```javascript
const assert = require('assert');
const {createManifest, validateManifest} = require('../../scripts/lib/session-manifest');

describe('session-manifest', () => {
  it('should create valid manifest', () => {
    const manifest = createManifest({
      route: {id: 'feature-standard', version: '1.0.0'},
      goal: 'test feature'
    });
    
    assert.ok(manifest.sessionId);
    assert.strictEqual(manifest.schemaVersion, '1.0.0');
    assert.strictEqual(manifest.status, 'created');
    assert.ok(manifest.createdAt);
  });

  it('should validate manifest', () => {
    const manifest = createManifest({
      route: {id: 'test', version: '1.0.0'},
      goal: 'test'
    });
    
    const result = validateManifest(manifest);
    assert.strictEqual(result.valid, true);
  });

  it('should reject invalid status', () => {
    const manifest = {
      sessionId: '123',
      schemaVersion: '1.0.0',
      createdAt: new Date().toISOString(),
      route: {id: 'test', version: '1.0.0'},
      goal: 'test',
      status: 'invalid'
    };
    
    const result = validateManifest(manifest);
    assert.strictEqual(result.valid, false);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test tests/unit/session-manifest.test.js
```

预期: `FAIL` - module not found

- [ ] **Step 4: 实现生成器和验证器**

创建 `scripts/lib/session-manifest.js`:

```javascript
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const {v4: uuidv4} = require('uuid');
const fs = require('fs');
const path = require('path');

const schemaPath = path.join(__dirname, '../../schemas/session-manifest.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);

function createManifest({route, goal, budget}) {
  return {
    sessionId: uuidv4(),
    schemaVersion: '1.0.0',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    route,
    goal,
    status: 'created',
    completedStages: [],
    ...(budget && {budget: {total: budget, used: 0}})
  };
}

function validateManifest(manifest) {
  const valid = validate(manifest);
  
  if (!valid) {
    return {
      valid: false,
      errors: validate.errors.map(e => `${e.instancePath} ${e.message}`)
    };
  }
  
  return {valid: true, errors: []};
}

module.exports = {createManifest, validateManifest};
```

- [ ] **Step 5: 安装依赖**

```bash
npm install ajv ajv-formats uuid
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npm test tests/unit/session-manifest.test.js
```

预期: `PASS` - 3 tests

- [ ] **Step 7: 提交**

```bash
git add schemas/session-manifest.schema.json scripts/lib/session-manifest.js tests/unit/session-manifest.test.js package.json package-lock.json
git commit -m "feat: add session manifest schema and generator"
```

---

### Task 3: Timeline Writer

**Files:**
- Create: `schemas/timeline-event.schema.json`
- Create: `scripts/lib/timeline-writer.js`
- Create: `tests/unit/timeline-writer.test.js`

- [ ] **Step 1: 创建 Timeline Event Schema**

创建 `schemas/timeline-event.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["timestamp", "type"],
  "properties": {
    "timestamp": {"type": "string", "format": "date-time"},
    "type": {
      "enum": [
        "session_created",
        "route_selected",
        "stage_started",
        "stage_completed",
        "stage_failed",
        "gate_triggered",
        "gate_passed",
        "gate_failed",
        "checkpoint_created",
        "session_paused",
        "session_resumed",
        "session_completed",
        "budget_warning",
        "budget_exceeded",
        "error"
      ]
    },
    "stage": {"type": "string"},
    "data": {"type": "object"}
  }
}
```

- [ ] **Step 2: 编写 Timeline Writer 失败测试**

创建 `tests/unit/timeline-writer.test.js`:

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {TimelineWriter} = require('../../scripts/lib/timeline-writer');

describe('TimelineWriter', () => {
  const testDir = path.join(__dirname, '../fixtures/timeline-test');
  const timelinePath = path.join(testDir, 'timeline.jsonl');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, {recursive: true});
    }
    fs.mkdirSync(testDir, {recursive: true});
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, {recursive: true});
    }
  });

  it('should append event to timeline', async () => {
    const writer = new TimelineWriter(timelinePath);
    await writer.append({type: 'session_created', data: {sessionId: '123'}});
    await writer.close();

    const content = fs.readFileSync(timelinePath, 'utf8');
    const lines = content.trim().split('\n');
    assert.strictEqual(lines.length, 1);

    const event = JSON.parse(lines[0]);
    assert.strictEqual(event.type, 'session_created');
    assert.ok(event.timestamp);
  });

  it('should append multiple events', async () => {
    const writer = new TimelineWriter(timelinePath);
    await writer.append({type: 'session_created', data: {}});
    await writer.append({type: 'stage_started', stage: 'capture', data: {}});
    await writer.close();

    const content = fs.readFileSync(timelinePath, 'utf8');
    const lines = content.trim().split('\n');
    assert.strictEqual(lines.length, 2);
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
npm test tests/unit/timeline-writer.test.js
```

预期: `FAIL`

- [ ] **Step 4: 实现 Timeline Writer**

创建 `scripts/lib/timeline-writer.js`:

```javascript
const fs = require('fs');
const path = require('path');

class TimelineWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.stream = null;
  }

  async append(event) {
    if (!this.stream) {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, {recursive: true});
      }
      this.stream = fs.createWriteStream(this.filePath, {flags: 'a'});
    }

    const fullEvent = {
      timestamp: new Date().toISOString(),
      ...event
    };

    return new Promise((resolve, reject) => {
      this.stream.write(JSON.stringify(fullEvent) + '\n', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async close() {
    if (this.stream) {
      return new Promise((resolve) => {
        this.stream.end(() => resolve());
      });
    }
  }
}

module.exports = {TimelineWriter};
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npm test tests/unit/timeline-writer.test.js
```

预期: `PASS`

- [ ] **Step 6: 提交**

```bash
git add schemas/timeline-event.schema.json scripts/lib/timeline-writer.js tests/unit/timeline-writer.test.js
git commit -m "feat: add timeline writer with JSONL support"
```

---

## Week 1 综合验收

- [ ] **验收 1: 所有 Schema 验证**

```bash
npm install -g ajv-cli
ajv validate -s schemas/route.schema.json -d routes/feature-standard.route.json
ajv validate -s schemas/session-manifest.schema.json
ajv validate -s schemas/timeline-event.schema.json
```

预期: 所有验证通过

- [ ] **验收 2: 单元测试覆盖率**

```bash
npm test -- --coverage
```

预期: >90% 覆盖率

- [ ] **验收 3: 参考 Route 验证**

```bash
node -e "const v = require('./scripts/lib/validate-route'); const fs = require('fs'); const r = JSON.parse(fs.readFileSync('routes/feature-standard.route.json')); console.log(v(r));"
```

预期: `{valid: true, errors: []}`

---

由于完整的 5 周计划会非常长（预计 3000+ 行），我建议：

**选项 1**: 继续完成 Week 2-5 的详细步骤（需要约 30 分钟）
**选项 2**: 我创建 Week 1 的完整可执行计划（已完成上述部分），然后为 Week 2-5 创建独立的计划文档
**选项 3**: 基于上述 Week 1 模板，你的团队可以扩展 Week 2-5

你希望我：
1. 继续完成 Week 2-5 的完整步骤
2. 保存 Week 1 计划并为其他周创建独立文档
3. 其他方式？
