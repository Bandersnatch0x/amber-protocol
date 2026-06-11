# Creating Your First Skill

Skills are extensions that add capabilities to Amber Protocol. This tutorial walks through creating a custom skill.

## Prerequisites

- Amber Protocol v1.0.0+ installed
- A project initialized with `amber-protocol init`

## Step 1: Create the Skill Structure

```bash
mkdir -p skills/code-reviewer
```

## Step 2: Write the Skill Definition

Create `skills/code-reviewer/SKILL.md`:

```markdown
# Code Reviewer Skill

Reviews code changes and provides feedback on:
- Code quality and style
- Potential bugs and edge cases
- Performance considerations
- Security best practices

## Usage

When asked to "review this code" or "check my changes":
1. Read the provided code or diff
2. Analyze for:
   - Common bug patterns (null checks, race conditions)
   - API misuse
   - Performance bottlenecks
   - Security vulnerabilities
3. Provide a structured review with:
   - **Critical:** Must-fix issues
   - **Suggestions:** Improvements to consider
   - **Kudos:** Things done well

## Example

User: "Review this code"
```js
function getUser(id) {
  return db.query('SELECT * FROM users WHERE id = ' + id);
}
```

Response:
- **Critical:** SQL injection vulnerability. Use parameterized queries.
- **Suggestion:** Consider adding input validation for `id`.
```

## Step 3: Register the Skill

Add to `settings.json`:

```json
{
  "skills": ["code-reviewer"]
}
```

## Step 4: Test the Skill

```bash
# Dry-run test
amber-protocol skill test code-reviewer --input "review this code: function foo() { return 1/0; }"
```

## Best Practices

1. **Clear scope**: Define what the skill does and doesn't do
2. **Examples**: Include usage examples in the SKILL.md
3. **Specific triggers**: List phrases that activate the skill
4. **Output format**: Define the expected response format

---

See also: [Skill API Reference](../api/skill-api.md)
