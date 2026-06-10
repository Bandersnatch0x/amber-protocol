# Announcing Coding Harness Phase B: GA Release

*June 10, 2026 — The Coding Harness Team*

---

**We're thrilled to announce that Coding Harness Phase B is now Generally Available!**

## Why Phase B Matters

AI-powered development tools have transformed how we write code. But the gap between "AI can generate code" and "AI can safely participate in a professional development workflow" has remained stubbornly wide.

Coding Harness Phase B bridges that gap.

We've rebuilt the harness from the ground up to be **safe by default**, **auditable at every step**, and **extensible by design**.

## What's New

### Security That Ships With You

Every Phase B project includes a built-in security audit system. Before you commit, the harness scans for:
- Known vulnerabilities in your dependencies
- Hardcoded secrets that should never reach version control
- Overly broad permissions that violate least-privilege principles

No configuration needed. It's on by default.

### Skills That Think Like Your Team

Create reusable AI capabilities as simple Markdown files. Share them across your team. Watch as your agents grow more capable with every skill you add.

```markdown
# Code Reviewer Skill
Triggers: "review this code", "check my changes"
```

That's it. Your AI now has a code review capability.

### Migration Without the Migraine

Moving from V5.5? One command shows you everything that will change. Another command applies it. A third command undoes it if needed.

No guessing. No lost settings. No regrets.

### Agents with Boundaries

Configure specialized agents with specific models, tools, and skills. Want a security-focused agent that can only read code? Done. Want a reviewer/worker pair? It's built in.

## The Numbers

- **519 tests** validating every feature
- **50+ test suites** covering the entire system
- **80%+ coverage** on all new code
- **0 regressions** from V5.5 migration path

## Get Started in 30 Seconds

```bash
npm install -g coding-harness
coding-harness init my-project
cd my-project
coding-harness doctor
```

## What's Next

Phase C development is already underway. Web-based project viewer. Team collaboration. Cloud integration. But for now, we're celebrating this milestone with our incredible community.

## Join Us

- ⭐ [Star us on GitHub](https://github.com/coding-harness)
- 💬 [Join our Discord](https://discord.gg/coding-harness)
- 🐛 [Report bugs](https://github.com/coding-harness/issues)
- 📖 [Read the docs](../user-guide/getting-started.md)

**Happy building!**
