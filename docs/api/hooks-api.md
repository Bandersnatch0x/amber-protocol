# Hooks API

Hooks enable custom automation at lifecycle events. Amber Protocol supports several hook points.

## Hook Lifecycle

```
┌─────────────────────────────────────────────────┐
│  PreToolUse  →  Tool Execution  →  PostToolUse  │
│       ↓                              ↓          │
│  Validate input               Transform output  │
└─────────────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  PreCommit  →  Git Commit  →  PostCommit │
└──────────────────────────────────────────┘

┌────────────────────────────────────────┐
│  PrePush  →  Git Push  →  PostPush     │
└────────────────────────────────────────┘
```

## Configuration

Hooks are configured in `settings.json`:

```json
{
  "hooks": {
    "pre-commit": {
      "command": "npm test",
      "timeout": 30000,
      "required": true
    },
    "pre-push": {
      "command": "npm run test:all",
      "parallel": false
    }
  }
}
```

## Hook Types

### PreToolUse

Runs before any tool is invoked. Can block or modify tool calls.

```json
{
  "hooks": {
    "pre-tool-use": {
      "validate": "scripts/validate-tool.js",
      "blockList": ["dangerous-tool"],
      "allowList": ["read", "search", "write"]
    }
  }
}
```

### PostToolUse

Runs after tool execution. Can validate or transform output.

```json
{
  "hooks": {
    "post-tool-use": {
      "audit": "scripts/audit-output.js",
      "maxOutputSize": 1048576
    }
  }
}
```

### PreCommit

Runs before git commit.

```json
{
  "hooks": {
    "pre-commit": {
      "lint": "npm run lint",
      "test": "npm test -- --passWithNoTests",
      "audit": "amber-protocol security audit --quick"
    }
  }
}
```

### PrePush

Runs before git push.

```json
{
  "hooks": {
    "pre-push": {
      "security": "amber-protocol security audit --strict",
      "integration": "npm run test:integration",
      "timeout": 120000
    }
  }
}
```

## Hook Properties

| Property | Type | Description |
|----------|------|-------------|
| `command` | string | Shell command to execute |
| `timeout` | number | Max execution time (ms) |
| `required` | boolean | Fail if hook fails |
| `parallel` | boolean | Run hooks in parallel |
| `allowList` | string[] | Only allow these items |
| `blockList` | string[] | Block these items |
| `env` | object | Environment variables to pass |

## Writing Custom Hooks

Custom hooks are JavaScript/TypeScript files that export a function:

```js
// scripts/custom-hook.js
module.exports = async function(context) {
  // context.tool — the tool being invoked
  // context.args — tool arguments
  // context.workspace — project root path
  
  if (context.tool === "write" && context.args.path.includes("node_modules")) {
    return { allowed: false, reason: "Cannot write to node_modules" };
  }
  
  return { allowed: true };
};
```

## Hook Context Object

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | Tool name |
| `args` | object | Tool arguments |
| `workspace` | string | Project root path |
| `session` | object | Current session info |
| `env` | object | Environment variables |

---

See also: [CLI Commands](./cli-commands.md), [Extension Points](../architecture/extension-points.md)
