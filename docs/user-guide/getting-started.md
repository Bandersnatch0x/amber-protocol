# Getting Started with Coding Harness (Phase B v1.0.0)

Welcome to Coding Harness! This guide will walk you through installation, first-time setup, and creating your first skill.

## Prerequisites

- **Node.js** >= 18.17
- **npm** >= 9.x
- **Git** >= 2.30 (optional, for git integration)

## Installation

```bash
# Install globally from npm
npm install -g coding-harness

# Verify installation
coding-harness --version
# => coding-harness v1.0.0 (phase-b)
```

## First-Time Setup

### 1. Initialize a Project

```bash
# Create a new project
mkdir my-agent-project
cd my-agent-project
coding-harness init
```

This scaffolds:
- `settings.json` — your project configuration
- `skills/` — directory for custom skills
- `routes/` — workflow route definitions
- `profiles/` — agent profiles

### 2. Verify Your Setup

```bash
# Run the doctor to check everything is set up correctly
coding-harness doctor
```

### 3. Your First Skill

Create `skills/hello-world/SKILL.md`:

```markdown
# Hello World Skill

Greets the user with a friendly message.

## Usage

When a user says "say hello", respond with:
"Hello! I'm your Coding Harness assistant. How can I help you build today?"
```

### 4. Create a Route

Create `routes/hello.route.json`:

```json
{
  "name": "hello-world",
  "description": "A simple greeting route",
  "goals": ["greeting", "hello"],
  "stages": [
    { "name": "greet", "action": "skill:hello-world" }
  ]
}
```

### 5. Run the Route

```bash
# Test the route (dry-run)
coding-harness route test hello-world --dry-run

# Run the route
coding-harness run hello-world
```

## Next Steps

- [Tutorials](./tutorials/) — Step-by-step guides for common workflows
- [CLI Commands](../api/cli-commands.md) — Complete command reference
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
- [FAQ](./faq.md) — Frequently asked questions

## Migrating from V5.5?

See the [Migration Guide](../release/MIGRATION_GUIDE.md) for detailed instructions.
