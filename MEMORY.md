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

## Entry format

Each booked entry is a level-3 heading inside the `## Entries` region below. The
heading is the claim's first line; a provenance line records the surface it was
booked from and the first 12 hex characters of that surface's normalized hash:

```text
### <claim first line>
> provenance: MEMORY.md@<normHash first 12>
```

An entry runs from one `### ` line to the next `### ` line (or end of file). The
α budget counts the `### ` lines **inside `## Entries` only**, plus the whole
file's normalized byte size (CRLF→LF, no BOM, no trailing whitespace). This
reference example lives outside `## Entries`, so it is never counted.

After editing entries by hand, run `amber memory book` to ratify the change so
the registered surface hash matches the file again — unratified edits surface as
a doctor ratification-class warning.

## Entries

### CI dependency installs

- CI installs must use `npm ci` against the committed lockfiles, never floating `npm install`. Formatting tooling (prettier et al.) must stay version-pinned across packages, or CI and local disagree and format checks go red (root cause of the 08-19 CI red streak; fixed in 2c372dc and b43ab86).

### Amber plan closeout preconditions

- `amber review` acceptance requires the plan's Evidence Schema section to define Command/Result/Date bullets, and Acceptance Criteria to mention guardrails or phase boundary. Write both into the plan when drafting it — the checks only fail at acceptance, after the work is done.

### Sync envelope admission order

- Envelope admission is schema-first with a fixed refusal order: schema, artifact path, protocol version, tenant/repository/generation identity, then content hash. Structural identity is compared before any content read — reordering silently misclassifies tenant mismatches.

### Seam-adoption ritual

- Seam adoption lands as a four-part ritual: one adapter module owns the concern (gitExec for git, readLedgerFailClosed for ledgers, defineCommand for envelopes), red-first tests pin the adapter's shape before any consumer migrates, a guard test scans for bypasses outside the seam, and per-consumer differential snapshots taken pre-migration prove byte-compatibility. Skipping the guard or the snapshot is how a second dialect silently reappears.

### Sync repository identity resolution

- repositoryId resolves in strict order: `.amber/identity.json` override, normalized `remote.origin.url` (scheme, credentials, `.git` suffix stripped; host lowercased), then the `local-repository` default. `path.basename(cwd)` is never used — "simplifying" back to it breaks cross-machine sync without an immediate red test.
