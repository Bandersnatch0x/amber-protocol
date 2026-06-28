# Schema 定义规范

Last Reviewed: 2026-06-29

**版本**: 1.0.0  
**状态**: 冻结（Alpha 期间不允许破坏性变更）

## 核心概念关系图

```
Route (模板)
  ├─ stages[] (阶段序列)
  ├─ gates[] (检查点配置)
  └─ defaults (默认配置)

Session (实例)
  ├─ manifest.json (元数据)
  ├─ timeline.jsonl (事件流)
  ├─ checkpoints/ (状态快照)
  └─ evidence/ (证据包)

Stage (执行单元)
  ├─ pack/skill 调用
  ├─ gate 检查
  └─ checkpoint 保存

Timeline (审计日志)
  └─ events[] (仅追加)
```

## 1. Route Schema

### 用途
定义可重用的交付路径模板，包含阶段序列、门控配置、默认值。

### Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["routeId", "schemaVersion", "stages"],
  "properties": {
    "routeId": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$",
      "description": "唯一标识符，kebab-case"
    },
    "schemaVersion": {
      "type": "string",
      "const": "1.0.0",
      "description": "Schema 版本，用于兼容性检查"
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$",
      "description": "Route 自身版本，semver 格式"
    },
    "displayName": {
      "type": "string",
      "description": "人类可读名称"
    },
    "description": {
      "type": "string",
      "description": "Route 用途说明"
    },
    "trigger": {
      "type": "object",
      "properties": {
        "goalPattern": {
          "type": "string",
          "description": "Goal 匹配正则表达式"
        },
        "complexity": {
          "enum": ["simple", "medium", "complex"],
          "description": "适用的任务复杂度"
        }
      }
    },
    "stages": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/Stage"
      },
      "description": "阶段序列"
    },
    "gates": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/Gate"
      },
      "description": "门控配置"
    },
    "defaults": {
      "type": "object",
      "properties": {
        "budget": {
          "type": "integer",
          "minimum": 0,
          "description": "默认预算限制"
        },
        "timeout": {
          "type": "integer",
          "minimum": 0,
          "description": "默认超时时间（秒）"
        },
        "mode": {
          "enum": ["auto", "interactive", "checkpoint"],
          "description": "默认执行模式"
        }
      }
    }
  },
  "definitions": {
    "Stage": {
      "type": "object",
      "required": ["name", "type"],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$",
          "description": "阶段唯一名称"
        },
        "displayName": {
          "type": "string",
          "description": "人类可读名称"
        },
        "type": {
          "enum": ["pack", "skill", "command", "gate"],
          "description": "执行类型"
        },
        "target": {
          "type": "string",
          "description": "执行目标（pack id / skill path / command）"
        },
        "args": {
          "type": "object",
          "description": "执行参数"
        },
        "gateAfter": {
          "type": "string",
          "description": "阶段后的 gate id"
        },
        "optional": {
          "type": "boolean",
          "default": false,
          "description": "是否可选"
        },
        "retryable": {
          "type": "boolean",
          "default": true,
          "description": "失败时是否可重试"
        }
      }
    },
    "Gate": {
      "type": "object",
      "required": ["id", "type"],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9-]+$"
        },
        "type": {
          "enum": ["auto", "user-approval", "step-confirm"],
          "description": "门控类型"
        },
        "description": {
          "type": "string",
          "description": "提示信息"
        },
        "condition": {
          "type": "object",
          "description": "自动门控的条件（type=auto 时）"
        }
      }
    }
  }
}
```

### 示例

```json
{
  "routeId": "feature-standard",
  "schemaVersion": "1.0.0",
  "version": "1.0.0",
  "displayName": "Standard Feature Development",
  "description": "Complete feature delivery with planning, implementation, and review",
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
      "target": "npm test && npm run lint"
    },
    {
      "name": "review",
      "displayName": "Code Review",
      "type": "skill",
      "target": "code-review",
      "gateAfter": "user-approval-merge"
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
    },
    {
      "id": "user-approval-merge",
      "type": "user-approval",
      "description": "Approve changes for merge?"
    }
  ],
  "defaults": {
    "budget": 50000,
    "timeout": 3600,
    "mode": "interactive"
  }
}
```

---

## 2. Session Manifest Schema

### 用途
记录单次交付会话的元数据和状态。

### Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["sessionId", "schemaVersion", "createdAt", "route", "goal", "status"],
  "properties": {
    "sessionId": {
      "type": "string",
      "format": "uuid",
      "description": "会话唯一标识符"
    },
    "schemaVersion": {
      "type": "string",
      "const": "1.0.0",
      "description": "Schema 版本"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "创建时间（ISO 8601）"
    },
    "updatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "最后更新时间"
    },
    "route": {
      "type": "object",
      "required": ["id", "version"],
      "properties": {
        "id": {
          "type": "string",
          "description": "使用的 route id"
        },
        "version": {
          "type": "string",
          "description": "Route 版本"
        }
      }
    },
    "goal": {
      "type": "string",
      "minLength": 1,
      "description": "交付目标（用户输入）"
    },
    "status": {
      "enum": ["created", "routed", "executing", "paused", "completed", "failed", "aborted"],
      "description": "当前状态"
    },
    "currentStage": {
      "type": "string",
      "description": "当前执行的 stage name"
    },
    "completedStages": {
      "type": "array",
      "items": {"type": "string"},
      "description": "已完成的 stage names"
    },
    "budget": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer",
          "minimum": 0
        },
        "used": {
          "type": "integer",
          "minimum": 0
        }
      }
    },
    "worktree": {
      "type": "string",
      "description": "Worktree 路径（相对于项目根目录）"
    },
    "metadata": {
      "type": "object",
      "description": "额外元数据"
    }
  }
}
```

### 示例

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "schemaVersion": "1.0.0",
  "createdAt": "2026-06-10T14:30:00Z",
  "updatedAt": "2026-06-10T14:45:00Z",
  "route": {
    "id": "feature-standard",
    "version": "1.0.0"
  },
  "goal": "implement user authentication",
  "status": "executing",
  "currentStage": "implement",
  "completedStages": ["capture", "plan"],
  "budget": {
    "total": 50000,
    "used": 12345
  },
  "worktree": ".amber/worktrees/550e8400-e29b-41d4-a716-446655440000",
  "metadata": {
    "agent": "claude",
    "branch": "feature/auth"
  }
}
```

---

## 3. Timeline Event Schema

### 用途
仅追加的事件日志（JSONL 格式），记录会话中的所有操作。

### Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["timestamp", "type"],
  "properties": {
    "timestamp": {
      "type": "string",
      "format": "date-time",
      "description": "事件时间（ISO 8601，包含毫秒）"
    },
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
        "session_failed",
        "session_aborted",
        "budget_warning",
        "budget_exceeded",
        "error"
      ],
      "description": "事件类型"
    },
    "stage": {
      "type": "string",
      "description": "关联的 stage name（如果适用）"
    },
    "data": {
      "type": "object",
      "description": "事件特定数据"
    },
    "error": {
      "type": "object",
      "properties": {
        "message": {"type": "string"},
        "stack": {"type": "string"},
        "recoverable": {"type": "boolean"}
      },
      "description": "错误信息（type=error 时）"
    }
  }
}
```

### 示例（JSONL 文件）

```jsonl
{"timestamp":"2026-06-10T14:30:00.123Z","type":"session_created","data":{"sessionId":"550e8400-e29b-41d4-a716-446655440000","goal":"implement user authentication"}}
{"timestamp":"2026-06-10T14:30:01.456Z","type":"route_selected","data":{"routeId":"feature-standard","confidence":0.95}}
{"timestamp":"2026-06-10T14:30:05.789Z","type":"stage_started","stage":"capture","data":{}}
{"timestamp":"2026-06-10T14:32:00.000Z","type":"stage_completed","stage":"capture","data":{"duration":114211}}
{"timestamp":"2026-06-10T14:32:00.100Z","type":"gate_triggered","data":{"gateId":"user-approval-plan","type":"user-approval"}}
{"timestamp":"2026-06-10T14:33:15.500Z","type":"gate_passed","data":{"gateId":"user-approval-plan","approvedBy":"human"}}
{"timestamp":"2026-06-10T14:33:20.000Z","type":"checkpoint_created","stage":"capture","data":{"checkpointPath":".amber/sessions/550e8400/checkpoints/capture.json"}}
```

---

## 4. Checkpoint Schema

### 用途
保存可恢复的状态快照。

### Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["sessionId", "stage", "timestamp", "manifest"],
  "properties": {
    "sessionId": {
      "type": "string",
      "format": "uuid"
    },
    "stage": {
      "type": "string",
      "description": "Checkpoint 对应的 stage"
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "manifest": {
      "$ref": "session-manifest.schema.json",
      "description": "Manifest 快照"
    },
    "worktreeState": {
      "type": "object",
      "properties": {
        "branch": {"type": "string"},
        "commit": {"type": "string"},
        "uncommittedFiles": {
          "type": "array",
          "items": {"type": "string"}
        }
      },
      "description": "Worktree 状态"
    },
    "metadata": {
      "type": "object",
      "description": "额外元数据"
    }
  }
}
```

---

## 5. Evidence Pack Schema

### 用途
记录任务执行的证据和工件。

### Schema 定义

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["packId", "sessionId", "taskId", "type", "createdAt"],
  "properties": {
    "packId": {
      "type": "string",
      "format": "uuid"
    },
    "sessionId": {
      "type": "string",
      "format": "uuid"
    },
    "taskId": {
      "type": "string"
    },
    "type": {
      "enum": ["execution", "test", "review", "deployment"],
      "description": "证据类型"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time"
    },
    "artifacts": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/Artifact"
      }
    },
    "verified": {
      "type": "boolean",
      "default": false,
      "description": "是否已验证"
    },
    "verifiedBy": {
      "type": "string",
      "description": "验证者（human / agent）"
    },
    "verifiedAt": {
      "type": "string",
      "format": "date-time"
    }
  },
  "definitions": {
    "Artifact": {
      "type": "object",
      "required": ["type", "path"],
      "properties": {
        "type": {
          "enum": ["log", "diff", "screenshot", "report", "metric", "file"],
          "description": "工件类型"
        },
        "path": {
          "type": "string",
          "description": "相对路径"
        },
        "size": {
          "type": "integer",
          "minimum": 0,
          "description": "文件大小（字节）"
        },
        "metadata": {
          "type": "object",
          "description": "类型特定元数据"
        }
      }
    }
  }
}
```

---

## Schema 版本管理

### 版本号规则
遵循 Semver：`MAJOR.MINOR.PATCH`

- **MAJOR**: 破坏性变更（需要迁移工具）
- **MINOR**: 向后兼容的新功能（可选字段）
- **PATCH**: 向后兼容的 bug 修复

### 兼容性策略

1. **读取时检查**:
   ```javascript
   if (manifest.schemaVersion !== CURRENT_VERSION) {
     throw new Error(`Unsupported schema version ${manifest.schemaVersion}. Run 'amber migrate'.`);
   }
   ```

2. **写入时使用最新版本**:
   ```javascript
   manifest.schemaVersion = "1.0.0";
   ```

3. **迁移工具**:
   - 检测旧版本
   - 自动升级（向后兼容的变更）
   - 手动确认（破坏性变更）
   - 备份原文件

### Alpha 期间约束

**Phase B Alpha (W1-W5)**: Schema 冻结
- ✅ 允许: 添加可选字段
- ✅ 允许: 修复 bug（不影响结构）
- ✗ 禁止: 删除或重命名字段
- ✗ 禁止: 修改枚举值
- ✗ 禁止: 更改必填字段

---

## 数据存储位置

```
.amber/
├── sessions/
│   └── <session-id>/
│       ├── manifest.json          # Session Manifest
│       ├── timeline.jsonl         # Timeline Events
│       ├── checkpoints/
│       │   ├── capture.json       # Checkpoint
│       │   ├── plan.json
│       │   └── implement.json
│       └── evidence/
│           └── <pack-id>.json     # Evidence Pack
├── routes/
│   ├── feature-standard.route.json  # Route
│   ├── bugfix-quick.route.json
│   └── refactor-safe.route.json
└── schemas/
    ├── route.schema.json
    ├── session-manifest.schema.json
    ├── timeline-event.schema.json
    ├── checkpoint.schema.json
    └── evidence-pack.schema.json
```

---

## 验证工具

### CLI 验证

```bash
# 验证 route
node scripts/amber.js route validate routes/feature-standard.route.json

# 验证 session manifest
node scripts/amber.js session validate <session-id>

# 验证 timeline 完整性
node scripts/amber.js session verify-timeline <session-id>
```

### 编程式验证

```javascript
const Ajv = require('ajv');
const routeSchema = require('./schemas/route.schema.json');

const ajv = new Ajv();
const validate = ajv.compile(routeSchema);

const valid = validate(routeData);
if (!valid) {
  console.error(validate.errors);
}
```

---

## 附录：完整状态转换图

```
Session 状态机:

  created
    ↓ (route 选择)
  routed
    ↓ (开始执行)
  executing ←→ paused (budget 超限 / 用户请求)
    ↓ (所有 stage 完成)
  completed

  任意状态 → failed (错误)
  任意状态 → aborted (用户中止)
```

```
Stage 状态（隐式，通过 timeline 推断）:

  pending → running → completed
                   → failed → retrying
                           → abandoned
```

```
Gate 状态（隐式）:

  triggered → waiting → passed
                     → failed
                     → skipped (optional stage)
```
