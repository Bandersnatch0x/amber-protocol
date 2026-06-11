# Skill API

Skills extend Amber Protocol with custom capabilities. This reference covers skill creation, registration, and lifecycle.

## Skill Structure

A skill is a directory containing:

```
skills/<name>/
  SKILL.md        # Required: Skill definition and instructions
  examples.md     # Optional: Usage examples
  prompts.md      # Optional: System prompt templates
```

## SKILL.md Format

```markdown
# Skill Name

Brief description of what this skill does.

## Triggers

List of phrases or patterns that activate this skill:
- "review my code"
- "check for bugs"

## Usage

Detailed instructions for the AI on how to use this skill.

## Output Format

Expected response structure.

## Examples

### Example 1: Basic Usage
User input → Expected output
```

## Registration

Skills are registered in `settings.json`:

```json
{
  "skills": ["code-reviewer", "test-generator", "doc-writer"]
}
```

## Skill API Methods

### `skill.list()`

List all registered skills.

```js
const skills = require("amber-protocol/skills");
const list = await skills.list();
// => [{ name: "code-reviewer", path: "skills/code-reviewer/SKILL.md" }]
```

### `skill.validate(name)`

Validate a skill definition.

```js
const result = await skills.validate("code-reviewer");
// => { valid: true, warnings: [], errors: [] }
```

### `skill.load(name)`

Load a skill's full definition.

```js
const skillDef = await skills.load("code-reviewer");
// => { name, description, triggers, instructions, examples }
```

### `skill.test(name, input)`

Test a skill against input.

```js
const output = await skills.test("code-reviewer", {
  input: "review this code: const x = 1/0;"
});
// => { result: "Division by zero detected...", confidence: 0.95 }
```

### `skill.create(name, template)`

Create a new skill from a template.

```js
await skills.create("my-skill", {
  description: "My custom skill",
  triggers: ["do something"],
  template: "basic"
});
```

## Skill Templates

Built-in templates for quick skill creation:

| Template | Description |
|----------|-------------|
| `basic` | Minimal skill with trigger/response |
| `tool` | Tool-wrapping skill |
| `reviewer` | Code review skill pattern |
| `generator` | Content generation skill |

## Programmatic Skill API

Skills can also be created programmatically:

```js
// skills/my-skill/index.js
module.exports = {
  name: "my-skill",
  description: "Programmatic skill example",
  
  // Called when skill is activated
  async activate(context) {
    const { input, tools, workspace } = context;
    // Process input using available tools
    return { output: "Processed: " + input };
  },
  
  // Optional: validate skill was set up correctly
  async validate() {
    return { valid: true };
  }
};
```

## Best Practices

1. **Clear triggers**: Use specific phrases that are unlikely to cause false positives
2. **Structured output**: Define output format in SKILL.md
3. **Error handling**: Document how the skill handles errors
4. **Examples**: Always include usage examples
5. **Idempotent**: Skills should produce consistent results for the same input

---

See also: [CLI Commands](./cli-commands.md), [Extensions Guide](../architecture/extension-points.md)
