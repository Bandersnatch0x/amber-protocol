# Getting Started with Amber Protocol

Welcome to **Amber Protocol** — a repository-local governance kit for AI-assisted coding. This guide will help you install, configure, and start using Amber in your projects.

## What is Amber Protocol?

Amber Protocol helps engineering teams prepare, review, verify, hand off, and audit AI-assisted coding work. It provides:

- **CLI tools** for repository onboarding, auditing, and session management
- **Route engine** for goal-driven workflow selection
- **Web viewer** for visualizing sessions, routes, and gates
- **Governance surfaces** for approval records and policy boundaries

## Installation

### From npm (Recommended)

```bash
npm install -g amber-protocol
amber --version
```

### From Source

```bash
git clone https://github.com/Bandersnatch0x/amber-protocol.git
cd amber-protocol
npm install
node scripts/amber.js --version
```

## Quick Start

### 1. Initialize a Repository

Add Amber Protocol files to your project:

```bash
amber init --target path/to/your/repo
```

This creates:
- `.amber/` directory with session state
- `AGENTS.md` agent collaboration guide
- `CLAUDE.md` codebase instructions
- `feature_list.json` feature tracking

### 2. Audit an Existing Project

Generate a read-only adoption report:

```bash
amber audit --target path/to/your/repo --summary
```

### 3. Start a Session

Begin working on a feature with session tracking:

```bash
amber session start --goal "implement user authentication" --route feature-standard
```

### 4. Check Session Status

```bash
amber session status
```

### 5. Generate Handoff Report

Create a comprehensive handoff document for session continuity:

```bash
amber handoff --target .
```

## Web Viewer

The web viewer provides a visual dashboard for monitoring sessions, routes, and gates.

### Start the Web Viewer

```bash
cd apps/web
npm install --legacy-peer-deps
npm run dev
```

Visit **http://localhost:3001** (dev server) or **http://localhost:3000** (production build).

### Key Features

- **Real-time session updates** via Server-Sent Events (SSE)
- **Timeline viewer** with virtual scrolling for performance
- **Route explorer** organized by category
- **Gate monitoring** with approval/rejection tracking
- **Dark mode** with persistent theme preference

### Web Viewer Screens

- **Dashboard** - Overview of active sessions and system health
- **Sessions** - Browse active and completed sessions with detailed timelines
- **Routes** - Explore available workflow routes
- **Gates** - Monitor approval gates and decisions
- **Settings** - Configure auto-refresh, intervals, and notifications

## Common Commands

### Session Management

```bash
# Start new session
amber session start --goal "fix login bug"

# List all sessions
amber session list

# Abort session
amber session abort <session-id>

# Continue from checkpoint
amber session continue
```

### Route Operations

```bash
# List available routes
amber route list

# Inspect route definition
amber route inspect feature-standard

# Validate route file
amber route validate routes/feature-standard.route.json
```

### Repository Operations

```bash
# Create wiki skeleton
amber wiki --target . --dry-run

# Validate Amber setup
amber doctor --target .

# Generate handoff report
amber handoff --target .
```

### Adoption (Existing Projects)

```bash
# Generate adoption report
amber adoption report --target path/to/project --output-dir docs/examples/adoptions

# Gate check
amber adoption gate --reports-dir docs/examples/adoptions
```

## Directory Structure

After initialization, your repository will contain:

```
your-repo/
├── .amber/                      # Session state and metadata
│   ├── sessions/               # Active and completed sessions
│   ├── approvals/              # Approval records
│   └── gate-log.jsonl         # Gate decision log
├── AGENTS.md                   # Agent collaboration guide
├── CLAUDE.md                   # Codebase instructions
├── feature_list.json           # Feature tracking
└── docs/
    └── wiki/                   # Project context (optional)
        ├── architecture.md
        ├── runbook.md
        └── verification.md
```

## Configuration

Amber Protocol uses sensible defaults but can be customized through:

- **Route definitions** (`routes/*.route.json`) - Workflow templates
- **Workflow packs** (`workflow-packs/`) - Declarative workflows
- **Profiles** (`profiles/`) - Project-specific configurations

## Next Steps

- **Read the [CLI Reference](../CLI_REFERENCE.md)** for complete command documentation
- **Explore [Architecture](../architecture/)** to understand system design
- **Check [Quality Documentation](../quality/)** for testing and release standards
- **Review [Examples](../examples/)** for real-world usage patterns
- **Deploy the [Web Viewer](../DEPLOYMENT.md)** for production monitoring

## Troubleshooting

### Connection Issues (Web Viewer)

If you see "Disconnected", the SSE connection was lost. It will automatically reconnect with exponential backoff.

### No Data Showing

Ensure the Amber Protocol backend is running and accessible. Check the browser console for errors.

### Port Already in Use

The dev server uses port 3001. If it's occupied, set a custom port:

```bash
PORT=3002 npm run dev
```

### Installation Issues

For dependency conflicts, use the `--legacy-peer-deps` flag:

```bash
cd apps/web
npm install --legacy-peer-deps
```

## Getting Help

- **Documentation**: [docs/](../)
- **Report bugs**: [GitHub Issues](https://github.com/Bandersnatch0x/amber-protocol/issues)
- **Feature requests**: [GitHub Discussions](https://github.com/Bandersnatch0x/amber-protocol/discussions)

## Version

**Current Version**: 1.0.0-rc.1  
**Status**: Release Candidate  
**Last Updated**: 2026-06-21

---

**Amber Protocol** - Repository-local AI coding governance for engineering teams.
