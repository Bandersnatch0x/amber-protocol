# Deployment Profile Declaration Contract

> Runtime contract for the deployment-profile declaration mechanism
> (#158 Stage 2; adjudicated by #269/#270/#273). A repository declares one of
> three deployment profiles — `personal-node` | `team-hub` | `organization` —
> in `.amber/profile.json`. Absence defaults to `personal-node`; a present but
> invalid declaration fails closed everywhere (validator, phase gates,
> envelope producer) and is never silently rewritten to the default. Today the
> declared value is **declarative only**: no code path branches behavior on
> it, and its single runtime consumer is the `origin.profile` provenance stamp
> on sync envelopes. This contract spans the CLI, the phase-gate evidence, the
> sync envelope producer, and the legacy `.harness` state fallback — which is
> why it is a standalone spec rather than a section of the sync envelope
> contract.

**Date:** 2026-08-28
**Authority:** `docs/architecture/distributed-governance-baseline.md`
(§Deployment profiles), ADR-0019 (D3 staging, D4 identity bootstrap),
`CONTEXT.md` (Deployment Profile, Personal Node, Team Hub, Organization
Profile, Profile Acceptance Gate).
**Implementation:** `scripts/lib/core/deployment-profile.js` (parser,
validator, writer, shared predicates), `scripts/lib/command-dispatcher.js`
(`handleDeploymentProfile`), `scripts/lib/core/phase-gates.js` (phase-2
evidence, inv-2), `scripts/lib/core/sync-remote.js` (`envelopeFromArtifact`),
`scripts/lib/state-dir-resolver.js` (state-dir seam).

## The three profiles (三档位)

The closed profile set is `DEPLOYMENT_PROFILES = ["personal-node",
"team-hub", "organization"]`; the default is `personal-node` (offline-first,
zero distributed contexts). The glossary names are **Personal Node**,
**Team Hub**, and **Organization Profile** (`CONTEXT.md`); "Organization
Control Plane" is a bounded context, never a profile name. The enum value
`organization` denotes the Organization Profile.

The runtime enum in `deployment-profile.js` is the authoritative closed set.
Two frozen copies exist by design and must change with it in the same
change: the `origin.profile` enum in `schemas/sync-envelope.schema.json` and
the fixture validator in `scripts/lib/core/fixture-family.js`. No JSON Schema
file exists for the declaration file itself.

## Declaration file shape (声明文件形制)

The declaration lives at `.amber/profile.json`:

```json
{ "deploymentProfile": "personal-node" }
```

- Only the `deploymentProfile` field is read. Additional fields are tolerated
  on read and **dropped on write**: `set` rewrites the file with exactly this
  one field.
- `set` is an unconditional overwrite. It never reads the previous file, so a
  corrupt declaration is repaired by simply setting a valid value.
- Writes create `.amber/` when missing and always land under `.amber/`, never
  under the legacy `.harness/` directory.

`readProfileFile(cwd)` resolves the declaration to
`{ deploymentProfile, source, errors }` with exactly five states:

| State | `deploymentProfile` | `source` | `errors` |
| --- | --- | --- | --- |
| file absent | `"personal-node"` (default) | `"default"` | `[]` |
| declared, enum-valid | the declared value | `"profile-file"` | `[]` |
| malformed JSON | `null` | `"profile-file"` | one parse error |
| non-object JSON (array, scalar, `null`) | `null` | `"profile-file"` | one shape error |
| unknown value | `null` | `"profile-file"` | one enum error |

**Fail-closed rule (#269).** Only *absence* defaults. A file that exists but
does not parse to one of the three profiles is an invalid declaration: it
yields `deploymentProfile: null` with a non-empty `errors` list and the
truthful `"profile-file"` source — it is never laundered into the default,
and no consumer may treat it as `personal-node`.

Two shared predicates own the judgment for every consumer:

- `isInvalidDeclaration(resolution)` — a resolution is invalid exactly when
  the parser reported errors; absence is not invalid.
- `hasDeclaredValidProfile(cwd)` — the profile is *declared* (the file
  exists) **and** *valid* (enum member). The absent-file default does not
  satisfy it.

## Resolution and the legacy `.harness` fallback (读取与目录级回退)

Declaration reads go through the state-dir seam
(`scripts/lib/state-dir-resolver.js`), whose fallback is **directory-granular,
not file-granular**:

1. If `.amber/` exists, every read resolves under `.amber/` — a
   `.harness/profile.json` is ignored entirely, even when
   `.amber/profile.json` does not exist (a once-per-process warning notes
   that `.harness` is being ignored).
2. If only `.harness/` exists, reads resolve under `.harness/` (a
   once-per-process warning recommends `amber migrate state`).
3. If neither exists, reads resolve under `.amber/` and find nothing (the
   absent-file default applies).

Consequence: the moment anything creates the `.amber/` directory, a legacy
`.harness/profile.json` becomes invisible until consolidated with
`amber migrate state`. Writes never target `.harness/`.

## CLI surface (命令面)

`amber profile deployment <show|set|validate|resolve> --target <repo>` is the
one supported declaration surface. The parent `profile` command sits in the
deprecated command tier for its **legacy `inspect` action only**; the
`deployment` subcommand is not deprecated, carries no deprecation warning,
and has no `amber governance` equivalent — `amber governance` cannot set a
deployment profile (UNDOC-9 adjudication, #273).

Output rendering: without `--json`, the payload prints bare on stdout
(pretty-printed JSON for the three read subcommands; a sentence for `set`)
and diagnostics print on stderr as `WARNING:`/`ERROR:` lines. With `--json`,
the standard CLI envelope prints on stdout and the payload is nested as a
JSON **string** in the envelope's `text` field (consumers parse
`JSON.parse(envelope.text)`).

| Subcommand | Semantics | Payload | Exit code |
| --- | --- | --- | --- |
| `show` | Full projection: declaration plus resolved identity (ADR-0019 D4 hybrid bootstrap) | `{ deploymentProfile, identity, source, profileSource, identitySource, errors }` — `source` is `"invalid"` when the declaration is invalid, otherwise equal to `profileSource` (`"default"` \| `"profile-file"`) | `0`; `1` when the declaration is invalid |
| `set --profile <p>` | Validate `<p>` against the enum, then unconditionally overwrite the declaration file | Text `Deployment profile set to <p>.` on success | `0`; `1` with an error and **no file write** when `--profile` is missing or not one of the three profiles |
| `validate` | Declaration validity only | `{ valid, deploymentProfile }` (errors ride the envelope) | `0` iff valid — note the absent-file default **is** valid |
| `resolve` | Effective profile with provenance | `{ deploymentProfile, source, errors }` | `0`; `1` when the declaration is invalid |

`validate` answers "is the declaration usable?" (absence is usable — it
defaults); the phase gates answer the stricter "is a valid profile
*declared*?" (absence fails). Both readings come from the same parser.

## Declarative today — no behavior branches (今日纯声明)

**Declaring `team-hub` or `organization` today is a purely declarative
no-op.** No code path branches behavior on the declared value; the sync
surface, projections, audit, and every other capability behave identically
under all three profiles. The exhaustive touchpoint set for profile values
is: the profile module itself (enum/default/read/write/validate/show), the
CLI surface above, fixture validation (`fixture-family.js`), the phase-2
evidence and inv-2 checks, the `origin.profile` envelope stamp
(`sync-remote.js`), demo fixtures, and the two schema enums
(`sync-envelope.schema.json` `origin.profile`;
`structural-identity.schema.json` carries identity scalars, not profile
branches). Every touchpoint is an enum check, a default, a provenance label,
or an evidence-existence check — none is a capability switch.

The baseline's "Team Hub adds Sync Runtime" describes **delivery staging**
(ADR-0019 D3: Personal Node is Stage 2, Team Hub is Stage 3, Organization is
Stage 4), not a runtime capability switch: the repository-local sync
preparation surface is available under every declared profile. What changing
the declaration *does* change is the provenance every future envelope
carries and whether the phase-2 gate evidence is satisfiable.

## Integration points (集成点)

- **Sync envelope production** (`docs/specs/sync-envelope-contract.md`):
  `envelopeFromArtifact` stamps `origin.profile` from the resolved
  declaration. An absent declaration stamps the `personal-node` default; an
  **invalid** declaration refuses the pack (`envelopeFromArtifact` throws,
  `packEnvelope` reports the error) so a broken declaration can never enter
  the tamper-evident provenance chain under a false label (#269). This is
  the declared value's only runtime consumer.
- **Phase gates** (`phase-gates.js`): the phase-2 evidence item
  `valid deployment profile declared` and the invariant `inv-2`
  (`valid deployment profile declared`) both read
  `hasDeclaredValidProfile(cwd)` — the same parser the validator uses (#270),
  so a declaration the validator rejects can satisfy no gate. Any of the
  three enum-valid profiles satisfies them; the absent-file default does
  not.
- **Profile Acceptance Gate** (`CONTEXT.md`): the deterministic evidence
  gate for *promoting* a profile is defined as tracer-scenario vocabulary
  and is **not implemented**; `profile deployment set` has no gate beyond
  enum validation. This is consistent while the declaration is declarative
  only. The day any capability branches behavior on the declared value,
  `set` stops being a label change and must acquire the promotion gate.

## Invariants (不变量)

1. **Closed enum.** Only `personal-node`, `team-hub`, `organization` are
   ever admitted — by the writer, the validator, the gates, and the envelope
   schema.
2. **Absence defaults, invalidity never does.** Only a missing file resolves
   to the `personal-node` default; a present-but-invalid declaration fails
   closed with `deploymentProfile: null`, a truthful `"profile-file"`
   source, and non-empty `errors`.
3. **One parser, one predicate.** Every consumer — validator, phase-2
   evidence, inv-2, envelope producer — reads through `readProfileFile` /
   `hasDeclaredValidProfile` / `isInvalidDeclaration`; a declaration the
   validator rejects can satisfy no gate and stamp no envelope.
4. **Writes are canonical.** The declaration is written only under
   `.amber/`; reads honor the directory-granular legacy `.harness` fallback
   described above.
5. **Declarative only.** The declared value changes no runtime behavior
   today; its single runtime consumer is the `origin.profile` provenance
   stamp. Any future behavior branch on the value requires gating `set`
   (Profile Acceptance Gate) in the same change.

## Machine surfaces (机器表面)

- Parser, writer, validator, shared predicates:
  `scripts/lib/core/deployment-profile.js` (`DEPLOYMENT_PROFILES`,
  `DEFAULT_PROFILE`, `PROFILE_FILE`, `PROFILE_SOURCE_DEFAULT`,
  `PROFILE_SOURCE_FILE`, `readProfileFile`, `writeProfileFile`,
  `resolveDeploymentProfile`, `validateDeploymentProfile`,
  `showDeploymentProfile`, `isInvalidDeclaration`, `hasDeclaredValidProfile`)
- CLI wiring: `scripts/lib/command-dispatcher.js`
  (`handleDeploymentProfile`); command help and tier:
  `scripts/lib/command-registry.js`
- State-dir seam (`.harness` fallback): `scripts/lib/state-dir-resolver.js`
- Phase-gate consumers: `scripts/lib/core/phase-gates.js`
- Envelope producer consumer: `scripts/lib/core/sync-remote.js`
- Enum copies that must move together: `schemas/sync-envelope.schema.json`
  (`origin.profile`), `scripts/lib/core/fixture-family.js`
- On-disk state: `.amber/profile.json` (canonical), `.harness/profile.json`
  (legacy, read-only fallback)
- Tests: `tests/unit/deployment-profile.test.js`,
  `tests/unit/phase-gates.test.js`, `tests/amber-cli-profile.test.js`,
  `tests/amber-cli-phase-gates.test.js`

**Mandatory-update rule:** any change to the profile enum, the declaration
file shape, the five resolution states, the CLI subcommand semantics or exit
codes, the fallback granularity, or the set of runtime consumers of the
declared value must update this contract in the same change.
