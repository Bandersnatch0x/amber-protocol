# Building a Custom Agent

Learn how to create a custom agent profile with specialized capabilities.

## Step 1: Understand Agent Profiles

Agents in Coding Harness are defined by:
- **Model**: The LLM provider and model (e.g., `claude-sonnet-4`)
- **Skills**: Which skills the agent has access to
- **Tools**: Permitted tools (read, write, execute, etc.)
- **Routes**: Workflow routes the agent can execute

## Step 2: Create an Agent Profile

Create `profiles/code-reviewer.profile.json`:

```json
{
  "name": "code-reviewer",
  "description": "Specialized code review agent",
  "model": "claude-sonnet-4",
  "skills": ["code-reviewer"],
  "tools": ["read", "search"],
  "thinking": {
    "enabled": true,
    "budget": 8000
  },
  "routes": ["feature-standard"]
}
```

## Step 3: Define Agent-Specific Settings

Add to `settings.json`:

```json
{
  "agents": {
    "reviewer": {
      "profile": "code-reviewer",
      "maxTokens": 4096,
      "temperature": 0.3,
      "persona": "You are a meticulous code reviewer focused on correctness and security."
    }
  }
}
```

## Step 4: Test the Agent

```bash
# Run review agent on a code change
coding-harness agent run reviewer --input "src/utils.js" --task "review for security issues"

# Interactive session
coding-harness session start --agent reviewer --route feature-standard
```

## Step 5: Create Multi-Agent Workflow

Create `routes/review-workflow.route.json`:

```json
{
  "name": "code-review-workflow",
  "stages": [
    {
      "name": "analyze",
      "agent": "reviewer",
      "action": "review changed files"
    },
    {
      "name": "report",
      "action": "generate review report"
    }
  ]
}
```

## Agent Configuration Reference

| Field | Description | Default |
|-------|-------------|---------|
| `model` | LLM model identifier | `claude-sonnet-4` |
| `skills` | Skill names to load | `[]` |
| `tools` | Allowed tool list | `["read"]` |
| `thinking.enabled` | Enable extended thinking | `true` |
| `thinking.budget` | Token budget for thinking | `4000` |
| `temperature` | Model creativity (0-1) | `0.7` |
| `maxTokens` | Response token limit | `8192` |

---

See also: [Architecture Overview](../../architecture/overview.md)
