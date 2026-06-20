# Route Engine Architecture

## Overview

The route engine is a goal-driven workflow selection and execution system. It matches user goals to predefined routes (JSON-defined workflows), loads route definitions, validates them, and dispatches to the appropriate workflow stages.

## Core Concepts

### Routes

Routes are JSON-defined workflows stored in `routes/*.route.json`. Each route represents a specific development workflow pattern (e.g., feature development, bug fixing, refactoring).

**Route Structure:**
- `routeId`: Unique kebab-case identifier
- `schemaVersion`: Schema version (currently `"1.0.0"`)
- `displayName`: Human-readable name
- `description`: Purpose and workflow summary
- `trigger`: Goal pattern matching configuration
  - `goalPattern`: Regex to match user goal strings
  - `complexity`: Workflow complexity (`simple|medium|complex`)
- `stages`: Sequential workflow steps
  - `name`: Stage identifier
  - `displayName`: Human-readable stage name
  - `type`: Stage type (`pack|skill|command|gate`)
  - `target`: What to execute at this stage
  - `gateAfter`: Optional gate checkpoint after this stage
- `gates`: Approval and checkpoint definitions
  - `id`: Gate identifier
  - `type`: Gate type (`auto|user-approval|step-confirm`)
  - `description`: Gate purpose

### Reference Routes

Three built-in reference routes:

1. **feature-standard** - Full feature development workflow with TDD
2. **bugfix-quick** - Rapid bug fix: reproduce → fix → verify
3. **refactor-safe** - Safe refactoring: characterize → refactor → verify

## Architecture Components

### 1. Route Loader (`scripts/lib/route-loader.js`)

**Purpose:** Single source of truth for loading and validating routes.

**Functions:**
- `loadRoutes(routesDir)`: Load all `*.route.json` files from directory
  - Returns: `{ routes: Route[], errors: string[] }`
  - Skips invalid files but continues loading others
  - Attaches `filePath` to each loaded route
- `loadRouteFile(filePath)`: Load and validate a single route file
  - Returns: `{ valid: boolean, route: Route|null, filePath: string, errors: string[] }`
  - Handles file I/O errors and JSON parse errors
  - Uses `validate-route.js` for schema validation

**Design Decisions:**
- Directory scanning happens once per command invocation
- Validation uses the existing `validate-route.js` module (Week 1)
- Invalid routes produce errors but don't block loading of valid routes
- Non-existent directory returns empty list with no errors

### 2. Route Selector (`scripts/lib/route-selector.js`)

**Purpose:** Match user goal string to the best route.

**Function:**
- `selectRoute(goal, routes)`: Match goal against route `goalPattern` regexes
  - Returns: `{ matched: Route|null, confidence: number, candidates: Route[] }`
  - Confidence: 0-100 based on match quality
  - Deterministic tie-breaking: complexity > alphabetical routeId

**Matching Algorithm:**
1. Test goal against each route's `goalPattern` regex
2. Score matches based on pattern specificity
3. If multiple matches, prefer:
   - Higher complexity routes (complex > medium > simple)
   - Alphabetically first routeId (for identical complexity)
4. Return best match + confidence score

**Design Decisions:**
- Pure function (no side effects)
- Case-insensitive matching
- Full regex support in goal patterns
- Confidence threshold: 60+ is considered a good match

### 3. Route Commands (`scripts/lib/route-commands.js`)

**Purpose:** Implement four CLI subcommands as pure functions.

**Functions:**

1. **`listRoutes(routesDir, { json })`**
   - Lists all available routes
   - Output: table or JSON array
   - Returns: `{ text: string, exitCode: number }`

2. **`inspectRoute(routeId, routesDir, { json })`**
   - Shows full route definition
   - Output: formatted route details or JSON
   - Returns: `{ text: string, exitCode: number }`

3. **`validateRouteFile(filePath, { json })`**
   - Validates a single route file
   - Output: validation result (errors/warnings)
   - Returns: `{ text: string, exitCode: number }`
   - Exit code: 1 if invalid, 0 if valid

4. **`testRoute(routeId, goal, routesDir, { dryRun })`**
   - Tests route selection for a given goal
   - Dry-run: shows what would execute without running
   - Output: matched route + confidence + execution plan
   - Returns: `{ text: string, exitCode: number }`

**Design Decisions:**
- All functions return `{ text, exitCode }` for testability
- No process.exit() or console.log() in the functions
- JSON output available for programmatic use
- Reuse `route-loader.js` for all file operations

### 4. CLI Integration (`scripts/amber.js`)

**Purpose:** Wire route commands into the main CLI.

**Integration Points:**
- `COMMANDS` array: Register `"route"` as top-level command
- Dispatch block: Read `args._[0]` for subcommand
- Usage/help: Add `commandSummary("route")` entries
- Result handling: Use existing `printResult()` helper

**CLI Usage:**
```bash
amber route list [--json]
amber route inspect <route-id> [--json]
amber route validate <file> [--json]
amber route test <route-id> --goal "<goal>" [--dry-run]
```

## Data Flow

```
User Goal String
    ↓
route-selector.js
    ↓ (match goal pattern)
Selected Route
    ↓
Route Stages
    ↓ (execute sequentially)
Stage Execution
    ↓ (gates checkpoint)
Workflow Complete
```

## File Structure

```
routes/
├── feature-standard.route.json    # Full feature workflow
├── bugfix-quick.route.json        # Bug fix workflow
└── refactor-safe.route.json       # Safe refactoring workflow

scripts/lib/
├── route-loader.js                # Load & validate routes
├── route-selector.js              # Goal-to-route matching
├── route-commands.js              # CLI subcommands
└── validate-route.js              # Schema validation (Week 1)

tests/unit/
├── route-loader.test.js           # Loader tests
├── route-selector.test.js         # Selector tests (20+ scenarios)
└── route-commands.test.js         # Command function tests

tests/integration/
└── route-commands.test.js         # CLI integration tests
```

## Schema Validation

Routes are validated against `schemas/route.schema.json` using AJV.

**Required Fields:**
- `routeId`: kebab-case `^[a-z0-9-]+$`
- `schemaVersion`: const `"1.0.0"`
- `stages`: array with at least 1 item

**Stage Requirements:**
- `name` + `type` required
- Valid types: `pack|skill|command|gate`

**Gate Requirements:**
- `id`: kebab-case
- `type`: `auto|user-approval|step-confirm`

## Testing Strategy

### Unit Tests
- Route loader: 7 tests covering file I/O, validation, directory scanning
- Route selector: 20+ scenarios covering exact matches, partial matches, tie-breaking
- Route commands: Test each subcommand function independently

### Integration Tests
- CLI dispatch via `spawnSync`
- Full command execution with real routes
- JSON output parsing and validation

### Test Conventions
- Node built-in test runner (`node --test`)
- CommonJS modules
- `describe`/`it` structure
- `node:assert` for assertions
- Fixtures under `tests/fixtures/routes/`

## Design Principles

1. **Pure functions**: Commands return data, don't perform side effects
2. **Single source of truth**: Route loader is the only module that reads route files
3. **Fail-safe**: Invalid routes produce errors but don't crash the loader
4. **Testability**: No process.exit() or console.log() in library code
5. **Reuse**: Leverage existing validator from Week 1
6. **CommonJS**: Consistent with existing codebase (no ESM)

## Error Handling

- File not found: Report error, continue with other routes
- Invalid JSON: Report parse error, mark route invalid
- Schema validation failure: Report validation errors, mark route invalid
- Missing routes directory: Return empty list (not an error)

## Future Extensions

- Dynamic route registration at runtime
- Route composition (nested/sub-routes)
- Conditional stage execution
- Parallel stage execution
- Route versioning and migration
- Custom gate implementations
- Route metrics and telemetry
