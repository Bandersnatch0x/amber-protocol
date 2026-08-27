# F053: Release Prepare, Deploy & Rollback

**Status:** Proposed  
**Depends on:** F052  
**Program:** [Amber Governed Capabilities](../roadmaps/amber-governed-capabilities-program.md)  
**GitHub mirror:** [#213](https://github.com/Bandersnatch0x/amber-protocol/issues/213)

## Problem Statement

Amber can govern repository work but cannot yet bind a verified Change, Review, environment Policy,
deployment operation, and rollback into one release decision. Without a closed release contract,
AI findings can be mistaken for code-owner approval, production controls can be modified by the
change author, and deployment or rollback claims can lack real executor Evidence.

## Solution

Add release preparation, authorization, deployment, and rollback as separate governed Actions.
Preparation binds one exact Change and Evidence set to an environment, release Policy, registered
Runner capability, short-lived credential boundary, and rehearsed rollback. Staging and Production
authorization require named humans and environment Gates. Execution produces real deployment or
rollback receipts; AI cannot approve its own change or push main directly.

## User Stories

1. As a release manager, I want a release candidate bound to one Change and commit hash, so that authorization cannot drift to another build.
2. As a reviewer, I want logic, security, and Spec/Plan compliance findings recorded separately, so that AI review supplements rather than replaces code ownership.
3. As a code owner, I want my verified Approval required where Policy names me, so that an Agent cannot self-approve.
4. As a staging owner, I want deployment limited to an allowlisted capability and exact environment, so that credentials cannot be reused elsewhere.
5. As a release manager, I want branch protection and release Gate Evidence checked, so that Amber cannot bypass repository controls.
6. As a release manager, I want production controls outside Agent-editable scope, so that the change cannot weaken its own Gate.
7. As an operator, I want rollback rehearsed before production eligibility, so that recovery is demonstrated rather than promised.
8. As an operator, I want deployment and rollback authorization separated from execution, so that a Runner cannot approve itself.
9. As an auditor, I want the real executor, operation, credentials boundary, timestamps, status, and outputs in a receipt, so that release history is verifiable.
10. As an auditor, I want a failed or partial deployment explicitly aborted, so that absence of Evidence never means success.
11. As a recovery operator, I want the authorized rollback bound to the same release, so that recovery cannot target an unrelated version.
12. As a security owner, I want direct main push, force push, and standing production credentials refused, so that production authority remains bounded.
13. As an MCP consumer, I want deploy and rollback Actions returned as approval-required only, so that MCP never performs production mutation.
14. As a maintainer, I want release Policies and runbooks versioned, so that changes invalidate stale authorization.

## Implementation Decisions

- Release preparation is a governance-write Action and never deploys. It binds Change, Artifact
  revisions, commit, Evidence, Review findings, environment, Policy, capability, credentials class,
  and rollback plan.
- Staging authorization requires named environment approval and a rollback rehearsal receipt.
- Production authorization requires branch protection, code-owner and release-manager Decisions,
  release and environment Gate success, immutable runbook or deployment capability, and current
  credential eligibility.
- AI findings are Evidence or Findings, not human Approval. The submitter and Evidence producer
  cannot satisfy required code-owner or release-manager approval.
- Deployment and rollback are separate target-write transactions executed only by a registered
  Runner under F052.
- Short-lived credentials are scoped to release, environment, capability, and time. No receipt,
  error, or log exposes credential values.
- A deployment receipt records exact inputs, executor, capability, environment, operation result,
  output digest or Handle, and settlement. Non-zero or incomplete outcomes abort.
- Rollback is rehearsed before Production and creates its own authorization and executor receipt.
- Amber never executes direct main push or force push. Existing local Git transport authority is not
  widened by this Feature.

## Testing Decisions

- The highest seam is release prepare → Gate and authorization → registered deployment fixture →
  deploy or rollback receipt.
- Tests assert public release records, Decisions, target environment fixture state, receipts,
  settlement, stable errors, and absence of forbidden Git or credential effects.
- Exact fixtures cover release candidate, authorization, deployment, rollback, and error contracts.
- Semantic fixtures cover Development/Staging/Production differences, separation of duties, branch
  protection, code owners, rollback rehearsal, short-lived credentials, and no self-approval.
- Integrity fixtures cover changed commit or Evidence hashes, stale runbook or Policy, concurrent
  authorization use, partial deployment, rollback mismatch, and tampered receipts.
- Prior art is the sync transport confinement, phase promotion and rollback, session approval,
  governed Runner, deployment profile, Evidence, and MCP safety suites.

## Out of Scope

- Arbitrary production commands, direct main push, force push, autonomous release, or standing credentials.
- Creating PRs or notifications; F056 covers registered external effects.
- Break-glass; F057 defines emergency authorization.

## Further Notes

Production capability remains disabled until the dedicated execution ADR required by F052 is
accepted and all release fixtures pass.
