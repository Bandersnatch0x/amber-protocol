# Amber Protocol 快速开始

Amber Protocol is a repository-local governance and control layer for agent-assisted engineering. It provides installation, auditing, validation, and maintenance capabilities for project files that help agents understand codebases, track feature state, and hand off work cleanly.

## Installation

### Option 1: Install from npm (Recommended)

```bash
npm install -g amber-protocol
amber init --target path/to/your/project
```

### Option 2: Install from Source

```bash
git clone https://github.com/Bandersnatch0x/amber-protocol.git
cd amber-protocol
npm install

# Run commands directly
node scripts/amber.js init --target path/to/your/project
```

## Basic Usage

### Initialize a Project

Install Amber files in your repository (idempotent, skips existing files):

```bash
amber init --target path/to/repo
```

This creates:
- `AGENTS.md` - Agent instructions
- `CLAUDE.md` - Claude-specific guidance
- `.amber/` - Session and timeline storage
- `docs/wiki/` - Project context skeleton

### Audit an Existing Project

Generate a read-only adoption report for an existing project:

```bash
amber audit --target path/to/repo --summary
```

### Validate Your Setup

Check that your Amber installation is correct and usable:

```bash
amber doctor --target path/to/repo
```

### Working with Routes

List available workflow routes:

```bash
amber route list
```

Inspect a specific route:

```bash
amber route inspect feature-standard
```

### Session Management

Start a new development session:

```bash
amber session start --goal "fix login bug"
```

Check current session status:

```bash
amber session status
```

List all sessions:

```bash
amber session list
```

## Web Viewer

Amber includes a web-based viewer for monitoring sessions, routes, and gates.

### Starting the Web Viewer

```bash
cd apps/web
npm install --legacy-peer-deps
npm run dev
```

The web viewer runs at `http://localhost:3001` (backend) and `http://localhost:5173` (frontend).

### Features

**Sessions**: Browse active and completed sessions, view timeline events

**Routes**: Explore available workflow routes organized by category

**Gates**: Monitor gate status (Pending, Approved, Rejected) and decisions

**Real-time Updates**: Session status updates automatically via Server-Sent Events

**Timeline Viewer**: Virtual scrolling, event filtering, and search capabilities

### Web Viewer Controls

- **Start**: Begin a new session
- **Pause**: Temporarily pause execution
- **Resume**: Continue paused session
- **Abort**: Stop with confirmation
- **Theme Toggle**: Switch between light and dark mode (top-right)
- **Settings**: Configure auto-refresh, intervals, and notifications

## Common Commands Reference

```bash
# Adoption workflow
amber adoption report --target path/to/project --output-dir reports
amber adoption gate --reports-dir reports

# Migration from legacy .harness
amber migrate --target . --dry-run
amber migrate --target .

# Generate handoff artifacts
amber handoff --target path/to/repo

# Create/validate wiki
amber wiki --target path/to/repo --dry-run
```

## Troubleshooting

### Connection Issues (Web Viewer)

If you see "Disconnected", the SSE connection was lost. It will automatically reconnect with exponential backoff.

### No Data Showing (Web Viewer)

Ensure the Amber Protocol backend is running at `localhost:3001`. Check the browser console for errors.

### Command Not Found

If `amber` command is not found after npm installation, ensure your npm global bin directory is in your PATH:

```bash
npm config get prefix
```

Add `<prefix>/bin` to your PATH environment variable.

## Next Steps

- Read [Architecture Overview](../architecture/overview.md)
- Explore [Route Documentation](../routes/README.md)
- Learn about [Session Lifecycle](../sessions/lifecycle.md)
- Review [Agent Instructions](../../AGENTS.md)

## Feedback

For issues or feature requests, please file an issue at `https://github.com/Bandersnatch0x/amber-protocol`.

**Last Updated:** 2026-06-21
