# CHANGELOG

All notable changes from V5.5 to Phase B v1.0.0.

## [1.0.0] — 2026-06-10

### 🚀 Features

- **Phase B Framework**: New framework architecture with skills, hooks, agents, and routes
- **Security Audit**: Built-in dependency scanner, secret scanner, and permission reviewer
- **Migration Tool**: Automated V5.5 → Phase B migration with dry-run and rollback
- **Agent Profiles**: Configurable AI agent profiles with model selection and tool permissions
- **Skill System**: Extensible skill plugins with Markdown and programmatic APIs
- **Route Engine**: Workflow route definition and execution with stage-based pipelines
- **Session Management**: Execution sessions with state machine, timeline, and checkpointing
- **Hook System**: Lifecycle hooks for tool execution, git operations, and custom events
- **Rollback Utilities**: Backup management and restoration with timestamped snapshots

### 🔧 Improvements

- **Least Privilege Model**: Fine-grained tool permissions replacing broad access
- **Dry-Run Everywhere**: All mutating operations support dry-run preview
- **Validation Pipeline**: Integrated schema and cross-reference validation
- **Audit Reports**: Markdown-formatted security audit reports with remediation steps
- **Documentation**: Complete user guide, API reference, architecture docs, and tutorials

### ⚠️ Breaking Changes

- **`version` field**: Changed from `"5.5"` to `"1.0.0"`
- **`framework` field**: New required field set to `"phase-b"`
- **`deprecated_field`**: Removed — no longer supported
- **`legacy_api`**: Removed — use skills and hooks instead
- **`old_config`**: Removed — migrate to profiles
- **`legacyMode`**: Removed — all modes unified under Phase B
- **`skills` array**: Now required with at minimum an empty array
- **`profiles` object**: New required field for agent profiles

### 🗑️ Deprecated

- `compat` mode — use explicit migration instead
- Direct tool access without permission declarations
- Unstructured skill definitions outside `skills/` directory

### 📚 Documentation

- Getting Started Guide
- 4 Tutorials (First Skill, Pre-Commit Hooks, Custom Agent, Migration)
- CLI Commands Reference
- Hooks API Reference
- Skill API Reference
- Architecture Overview
- Data Flow Diagrams
- Extension Points Guide
- Troubleshooting Guide
- FAQ
- Migration Guide

### 🧪 Testing

- 50+ new test suites added
- 59 new test cases for security and migration modules
- 519 total passing tests
- 80%+ test coverage for new code

### 🙏 Contributors

- Coding Harness Team
- All beta testers who provided feedback during the Phase B alpha and RC phases
