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

### Review residual observations re-verified against code

- Review residual observations must be re-verified against the committed code before acting on them: the FINAL-ACCEPT recheck reported the Apply stale-branch rollback as unwrapped, but the committed code already routed it through the fail-closed catch — the close-out delivered regression tests plus a comment, not a behavior change. Post-land review claims get the same evidence discipline as review defects.

### Authorization grants select by mutual binding

- Authorization grants must be selected by mutual binding, not by recency: a grant bound to a denied attempt can never be consumed, so a latest-unconsumed selection lets an orphaned grant permanently block every later attempt. Select the grant bound to THIS attempt (or an explicitly unbound legacy grant) and evaluate eligibility refusals against the selected grant — run contract §5 R-AD-6 is what makes the orphaned grant inert instead of blocking.

### Additive fields need the ALLOWED/REQUIRED validator split

- Additive schema fields need a closed-validator split, not a closed-set edit: validators that treat every listed field as REQUIRED break pre-runtime ledgers the moment a new optional field lands. Split each closed set into ALLOWED (unknown keys refuse) and REQUIRED (per-era fields) so old records stay readable (ADR-0012). Also: identity-freezing hashes must exclude time-variant bindings — the F052 requestHash initially picked up sessionBinding/contextAuthority nulls while re-derivation omitted them, which would have failed every legacy request.

### Code-pinned policy bumps invalidate byte-pinned goldens by design

- Code-pinned policy versions invalidate by design, and their blast radius is byte-pinned fixtures: bumping RISK_POLICY_VERSION (1→2, the four-level escalation) changes every F052 requestHash, so every golden fixture whose records bind those hashes (release transactions, runner ledgers) must be re-recorded through its documented AMBER_RECORD_* ritual — run twice, verify byte-identical, then update the pinned constants with the reason. The drift is the designed invalidation, not a regression.

### Plugin dependency ranges can be wider than bundled imports

- A plugin's declared dependency range can be wider than what its bundled code actually imports: eslint-plugin-react-hooks 7.1.1 declares zod-validation-error ^3.5.0 || ^4.0.0 yet unconditionally requires the zod-validation-error/v4 subpath — npm resolves 3.5.4 and the plugin crashes at config load with ERR_PACKAGE_PATH_NOT_EXPORTED. Fix with a package.json overrides pin, not a downgrade. Verify exact latest versions (npm view) before installing; guessed ranges age fast.
