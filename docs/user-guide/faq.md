# Frequently Asked Questions

## Installation

**Q: Can I use Coding Harness without npm?**  
A: Yes, clone the repository and use `node scripts/harness.js` directly.

**Q: What Node.js version is required?**  
A: Node.js >= 18.17. We recommend the latest LTS release.

**Q: Does Coding Harness work on Windows?**  
A: Yes, Windows 10+ is fully supported. Some git features require Git for Windows.

## Migration

**Q: Will my V5.5 skills work in Phase B?**  
A: Yes, skills are backward-compatible. The SKILL.md format is unchanged.

**Q: Can I roll back after migration?**  
A: Yes, a backup is created automatically. Use `coding-harness rollback`.

**Q: What happens to my custom settings?**  
A: All custom settings are preserved. Only deprecated fields are renamed/removed.

**Q: Do I need to migrate all team members at once?**  
A: No, migration is per-project. Team members can migrate individually.

## Performance

**Q: Why is my first run slow?**  
A: Initial startup installs dependencies and indexes skills. Subsequent runs are faster.

**Q: How can I speed up hook execution?**  
A: Skip heavy hooks during development:
```bash
coding-harness hook run pre-commit --light
```

**Q: Can I limit token usage?**  
A: Yes, configure budget in your agent profile:
```json
{ "thinking": { "budget": 4000 }, "maxTokens": 4096 }
```

## Security

**Q: How are API keys handled?**  
A: API keys should be stored in environment variables, never in settings files.

**Q: Can I audit my project for security issues?**  
A: Yes, run `coding-harness security audit` for dependency, secret, and permission scans.

**Q: What permissions model does Coding Harness use?**  
A: Least-privilege by default. Configure allowed tools and paths in `settings.json`.

**Q: Are hooks sandboxed?**  
A: Hooks run with the same permissions as the user. Review hook scripts carefully.

## Development

**Q: Can I extend Coding Harness?**  
A: Yes, via skills, custom routes, hooks, and agent profiles. See [Extension Points](../architecture/extension-points.md).

**Q: How do I contribute?**  
A: See [CONTRIBUTING.md](https://github.com/coding-harness/contrib) and [Architecture Overview](../architecture/overview.md).

**Q: Where are my sessions stored?**  
A: By default in `~/.coding-harness/sessions/`. Configure via `sessionDir` in settings.

## Troubleshooting

**Q: `coding-harness: command not found`**  
A: The npm global bin is not in PATH. Use `npx coding-harness` or fix your PATH.

**Q: My skill isn't loading**  
A: Check that SKILL.md exists in `skills/<name>/` and the skill is listed in settings.json.

**Q: Hooks aren't running**  
A: Run `npx husky install` to set up git hooks, then verify with `coding-harness doctor`.
