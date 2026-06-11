# Extension Points

Amber Protocol Phase B is designed for extensibility. This guide covers all supported extension points.

## Extension Architecture

```
┌──────────────────────────────────────────────────┐
│                 Extension Points                   │
│                                                    │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌─────────┐ │
│  │ Skills │  │ Hooks  │  │ Routes │  │ Profiles│ │
│  └───┬────┘  └───┬────┘  └───┬────┘  └────┬────┘ │
│      │           │           │            │       │
│      ▼           ▼           ▼            ▼       │
│  ┌─────────────────────────────────────────────┐ │
│  │           Plugin Registry                    │ │
│  └─────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

## 1. Skill Plugins

Create custom skills to add capabilities:

### File-Based Skills

```
skills/<name>/
  SKILL.md       # Markdown definition
  examples.md    # Usage examples
```

See [Skill API](../api/skill-api.md) for details.

### Programmatic Skills

```js
// skills/<name>/index.js
module.exports = {
  name: "my-plugin",
  version: "1.0.0",
  
  async activate(context) {
    return { success: true };
  }
};
```

## 2. Custom Hooks

Register custom hooks in `settings.json`:

```json
{
  "hooks": {
    "custom-event": {
      "script": "scripts/custom-hook.js",
      "timeout": 5000
    }
  }
}
```

Hooks receive a context object and can block, allow, or modify events.

## 3. Custom Routes

Define workflow routes:

```json
{
  "name": "deploy-pipeline",
  "goals": ["deploy", "release"],
  "stages": [
    { "name": "test", "command": "npm test" },
    { "name": "build", "command": "npm run build" },
    { "name": "deploy", "command": "scripts/deploy.sh" }
  ]
}
```

## 4. Agent Profiles

Create specialized agent configurations:

```json
{
  "name": "security-auditor",
  "model": "claude-sonnet-4",
  "skills": ["security-scanner"],
  "tools": ["read", "search", "execute"],
  "thinking": { "enabled": true, "budget": 16000 }
}
```

## 5. MCP Server Integration

Connect external tools via MCP:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "custom-tools",
        "command": "node mcp-server.js",
        "env": { "API_KEY": "${API_KEY}" }
      }
    ]
  }
}
```

## 6. Validation Rules

Add custom validation to the doctor:

```json
{
  "validation": {
    "rules": [
      { "name": "custom-check", "script": "scripts/validate.js" }
    ]
  }
}
```

## 7. Team Presets

Share configurations across teams:

```json
// team-presets/my-team.team-preset.json
{
  "name": "my-team",
  "skills": ["code-reviewer", "test-generator"],
  "routes": ["feature-standard"],
  "profiles": ["default"]
}
```

## Extension Lifecycle

```
Register → Validate → Load → Activate → Execute → Deactivate
```

## Best Practices

1. **Namespacing**: Use unique names for skills and hooks
2. **Error Handling**: Extensions should never crash the toolkit
3. **Idempotency**: Safe to load/activate multiple times
4. **Versioning**: Include version in plugin metadata
5. **Documentation**: Always include a README or SKILL.md

---

See also: [Architecture Overview](./overview.md), [Data Flow](./data-flow.md)
