# Memory

Durable project knowledge selected by humans. Add constraints, architecture decisions, and facts that should survive across sessions.

## CI dependency installs

- CI installs must use `npm ci` against the committed lockfiles, never floating `npm install`. Formatting tooling (prettier et al.) must stay version-pinned across packages, or CI and local disagree and format checks go red (root cause of the 08-19 CI red streak; fixed in 2c372dc and b43ab86).

## Amber plan closeout preconditions

- `amber review` acceptance requires the plan's Evidence Schema section to define Command/Result/Date bullets, and Acceptance Criteria to mention guardrails or phase boundary. Write both into the plan when drafting it — the checks only fail at acceptance, after the work is done.

## Sync envelope admission order

- Envelope admission is schema-first with a fixed refusal order: schema, artifact path, protocol version, tenant/repository/generation identity, then content hash. Structural identity is compared before any content read — reordering silently misclassifies tenant mismatches.

## Sync repository identity resolution

- repositoryId resolves in strict order: `.amber/identity.json` override, normalized `remote.origin.url` (scheme, credentials, `.git` suffix stripped; host lowercased), then the `local-repository` default. `path.basename(cwd)` is never used — "simplifying" back to it breaks cross-machine sync without an immediate red test.
