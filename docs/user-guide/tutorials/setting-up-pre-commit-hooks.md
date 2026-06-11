# Setting Up Pre-Commit Hooks

Pre-commit hooks ensure code quality before changes are committed to version control.

## Prerequisites

- Git repository with Amber Protocol initialized
- Node.js >= 18.17

## Step 1: Install Hook Dependencies

```bash
npm install --save-dev husky lint-staged
```

## Step 2: Configure Hooks

Create `.husky/pre-commit`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx lint-staged
```

## Step 3: Configure lint-staged

Add to `package.json`:

```json
{
  "lint-staged": {
    "*.{js,ts}": ["eslint --fix", "prettier --write"],
    "*.md": ["markdownlint --fix"],
    "skills/**/SKILL.md": ["amber-protocol skill validate"]
  }
}
```

## Step 4: Add Amber-Specific Hooks

In `settings.json`:

```json
{
  "hooks": {
    "pre-commit": {
      "security": "amber-protocol security audit",
      "validation": "amber-protocol validate",
      "tests": "npm test"
    },
    "pre-push": {
      "full-suite": "npm run test:all",
      "audit": "amber-protocol security audit --strict"
    }
  }
}
```

## Step 5: Test the Hooks

```bash
# Stage some changes
git add .

# Test pre-commit manually
amber-protocol hook run pre-commit

# Commit — hooks run automatically
git commit -m "feat: add new feature"
```

## Hook Lifecycle

```
Stage Changes → Pre-Commit → Commit → Pre-Push → Push
                      ↓                    ↓
               Security Audit        Full Test Suite
               Validation            Security Audit
               Unit Tests
```

## Troubleshooting

- **Hook not running**: Run `npx husky install`
- **Permission denied**: Run `chmod +x .husky/pre-commit`
- **Skip hooks (emergency)**: `git commit --no-verify`

---

See also: [Hooks API Reference](../api/hooks-api.md)
