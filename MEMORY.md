# Memory

Durable project knowledge selected by humans. Add constraints, architecture decisions, and facts that should survive across sessions.

## CI dependency installs

- CI installs must use `npm ci` against the committed lockfiles, never floating `npm install`. Formatting tooling (prettier et al.) must stay version-pinned across packages, or CI and local disagree and format checks go red (root cause of the 08-19 CI red streak; fixed in 2c372dc and b43ab86).
