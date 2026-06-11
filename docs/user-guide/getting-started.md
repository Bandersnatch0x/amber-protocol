# Getting Started with Amber Protocol (Phase B v1.0.0)

Welcome to Amber Protocol! This guide will walk you through installation, first-time setup, and creating your first skill.

## Prerequisites

- **Node.js** >= 18.17
- **npm** >= 9.x
- **Git** >= 2.30 (optional, for git integration)

## Installation

```bash
# Install globally from npm
npm install -g amber-protocol

# Verify installation
amber-protocol --version
# => amber-protocol v1.0.0 (phase-b)
```

## First-Time Setup

### 1. Initialize a Project

```bash
# Create a new project
mkdir my-agent-project
cd my-agent-project
amber-protocol init
```

This scaffolds:
- `settings.json` — your project configuration
- `skills/` — directory for custom skills
- `routes/` — workflow route definitions
- `profiles/` — agent profiles

### 2. Verify Your Setup

```bash
# Run the doctor to check everything is set up correctly
amber-protocol doctor
```

### 3. Your First Skill

Create `skills/hello-world/SKILL.md`:

```markdown
# Hello World Skill

Greets the user with a friendly message.

## Usage

When a user says "say hello", respond with:
"Hello! I'm your Amber Protocol assistant. How can I help you build today?"
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
amber-protocol route test hello-world --dry-run

# Run the route
amber-protocol run hello-world
```

## Next Steps

- [Tutorials](./tutorials/) — Step-by-step guides for common workflows
- [CLI Commands](../api/cli-commands.md) — Complete command reference
- [Troubleshooting](./troubleshooting.md) — Common issues and fixes
- [FAQ](./faq.md) — Frequently asked questions

