# Memory

Durable project knowledge selected by humans. Add constraints, architecture decisions, and facts that should survive across sessions.

## Memory creed — capability, not ceremony

Write to memory only when the entry is:

- a durable operator preference or correction that later sessions must respect;
- a decision that reverses an earlier one, so the outdated answer stops propagating;
- anything a fresh session would otherwise get wrong twice.

Keep out of memory:

- one-off session detail — `notes.md` owns that for the current session;
- anything reconstructible from git history, `feature_list.json`, or the session timeline;
- transient task state that expires with the work it belonged to;
- mechanical facts the repository already records on its own.

Every entry must change a future decision or be deleted.
