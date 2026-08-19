import type { I18nKey } from '@/lib/i18n';

export type TranslateFn = (key: I18nKey, params?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------
// Backend copy localization (task #27, read-only display layer).
//
// The lifecycle next-action engine (scripts/lib/core/lifecycle.js STEPS) and
// the completion next-actions (scripts/lib/web-adapter.js
// COMPLETION_ACTION_MAP / COMPLETION_ACTION_FALLBACKS) author their
// why/instruction/hint prose in English. Known strings map onto the ux.*
// i18n namespace; unknown strings degrade to the raw backend text so novel
// steps or items never render as blanks.
//
// Lookup is case-insensitive (values are normalized to lower-case before the
// exact-match lookup); dynamic strings (feature id, gate id, missing items)
// are handled by anchored pattern rules with parameterized templates.
// ---------------------------------------------------------------------------

const LIFECYCLE_WHY_KEYS: Record<string, I18nKey> = {
  'this looks like an existing project — optionally inspect with audit (read-only) before install; for multi-repo adoption reviews also run amber adoption report.':
    'ux.backend.lifecycle.why.audit',
  'amber starter files are not all present.': 'ux.backend.lifecycle.why.init',
  'amber starter files are not all present (audit done or skipped) — safe next install is init.':
    'ux.backend.lifecycle.why.initAfterAudit',
  'no feature is registered in feature_list.json.': 'ux.backend.lifecycle.why.feature',
  'the plan exists but user confirmation is still "pending".': 'ux.backend.lifecycle.why.gate',
  'no verification evidence is recorded for this feature yet.':
    'ux.backend.lifecycle.why.featureEvidence',
  'the session has no verification evidence yet.': 'ux.backend.lifecycle.why.verify',
  'the session has no approval evidence yet.': 'ux.backend.lifecycle.why.approve',
  'session-handoff.md is missing or still the init scaffold — regenerate from live state.':
    'ux.backend.lifecycle.why.handoff',
  'the session is not yet complete (evidence still missing).':
    'ux.backend.lifecycle.why.completeCheck',
  'complete-check passed but the session is not marked completed yet.':
    'ux.backend.lifecycle.why.sessionComplete',
  'the plan is ready to accept and append to the evolution log.': 'ux.backend.lifecycle.why.accept',
};

interface PatternRule {
  pattern: RegExp;
  key: I18nKey;
  params: (match: RegExpMatchArray) => Record<string, string | number>;
}

const LIFECYCLE_WHY_PATTERNS: PatternRule[] = [
  {
    pattern: /^feature (\S+) has no plan yet\.$/i,
    key: 'ux.backend.lifecycle.why.planTemplate',
    params: (match) => ({ feature: match[1] ?? '' }),
  },
  {
    pattern:
      /^the session has no approval evidence yet \(next gate: ([^;]+); (\d+) gates on route\)\.$/i,
    key: 'ux.backend.lifecycle.why.approveTemplate',
    params: (match) => ({ gate: match[1] ?? '', count: match[2] ?? '' }),
  },
  {
    pattern: /^the session is not yet complete \(missing: (.+)\)\.$/i,
    key: 'ux.backend.lifecycle.why.completeCheckTemplate',
    params: (match) => ({ missing: match[1] ?? '' }),
  },
  {
    pattern:
      /^accepted work touched (.+) paths — the knowledge write-back review is not booked yet \(book it with amber learnings --reviewed --owner <id>\)\.$/i,
    key: 'ux.backend.lifecycle.why.learningsTemplate',
    params: (match) => ({ categories: match[1] ?? '' }),
  },
];

const COMPLETION_HINT_KEYS: Record<string, I18nKey> = {
  'run verification from the console evidence runner.': 'ux.backend.completion.hint.verification',
  'approve via the gates view (/gates).': 'ux.backend.completion.hint.approval',
  'regenerate the live session-handoff.md from current repo state.':
    'ux.backend.completion.hint.handoff',
  'start a session with a goal: amber session start --goal "<goal>" --target .':
    'ux.backend.completion.hint.goal',
  'timeline events are recorded automatically as governed work happens.':
    'ux.backend.completion.hint.timeline',
  'make at least one real change (commit or working-tree edit) during the session.':
    'ux.backend.completion.hint.work',
  "resolve or close the session's open blockers before completing.":
    'ux.backend.completion.hint.openBlockers',
  'no session manifest yet — start a session: amber session start --target .':
    'ux.backend.completion.hint.manifestNotFound',
  'inspect the session manifest under the state dir; recover or restart the session.':
    'ux.backend.completion.hint.manifestCorrupt',
  'all completion checks pass — close the session.': 'ux.backend.completion.hint.sessionComplete',
};

const UNKNOWN_COMPLETION_ITEM_PATTERN = /^resolve the missing completion item: (.+)\.$/i;

// Lifecycle step labels emitted by scripts/lib/core/lifecycle.js (STEPS).
// Reuses the sessions.completion.backend.step.* namespace, which already maps
// the same labels for the completion workbench checklist.
const LIFECYCLE_LABEL_KEYS: Record<string, I18nKey> = {
  'audit existing repository (read-only advisory)': 'sessions.completion.backend.step.audit',
  'install amber': 'sessions.completion.backend.step.init',
  'register a feature': 'sessions.completion.backend.step.feature',
  'create a plan': 'sessions.completion.backend.step.plan',
  'confirm the plan': 'sessions.completion.backend.step.gate',
  'record feature verification evidence': 'sessions.completion.backend.step.featureEvidence',
  'record session verification': 'sessions.completion.backend.step.verify',
  'approve the session': 'sessions.completion.backend.step.approve',
  'regenerate session handoff': 'sessions.completion.backend.step.handoff',
  'run completion check': 'sessions.completion.backend.step.completeCheck',
  'mark session completed': 'sessions.completion.backend.step.sessionComplete',
  'accept the plan': 'sessions.completion.backend.step.accept',
  'review learning write-back': 'sessions.completion.backend.step.learnings',
};

// scripts/lib/core/governance-report.js lifecycleAction():
// expectedOutcome: `Lifecycle advances past: ${next.label}.`
const EXPECTED_OUTCOME_PREFIX = 'lifecycle advances past:';

/** Localize a lifecycle next-action why; unknown strings degrade to the original. */
export function localizeLifecycleWhy(value: string, t: TranslateFn): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const exact = LIFECYCLE_WHY_KEYS[trimmed.toLowerCase()];
  if (exact) return t(exact);
  for (const rule of LIFECYCLE_WHY_PATTERNS) {
    const match = trimmed.match(rule.pattern);
    if (match) return t(rule.key, rule.params(match));
  }
  return trimmed;
}

/**
 * Localize the governance-report expectedOutcome sentence
 * ("Lifecycle advances past: <step label>."). Unknown labels degrade to the
 * raw sentence.
 */
export function localizeExpectedOutcome(value: string, t: TranslateFn): string {
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(EXPECTED_OUTCOME_PREFIX)) return trimmed;
  const label = trimmed.slice(EXPECTED_OUTCOME_PREFIX.length).replace(/\.$/, '').trim();
  const labelKey = LIFECYCLE_LABEL_KEYS[label.toLowerCase()];
  if (!labelKey) return trimmed;
  return t('ux.backend.lifecycle.prefix', { step: t(labelKey) });
}

/** Entry point for governance/session lifecycle copy: why + expectedOutcome. */
export function localizeLifecycleCopy(value: string, t: TranslateFn): string {
  if (value.trim().toLowerCase().startsWith(EXPECTED_OUTCOME_PREFIX)) {
    return localizeExpectedOutcome(value, t);
  }
  return localizeLifecycleWhy(value, t);
}

/** Localize a completion next-action hint; unknown strings degrade to the original. */
export function localizeCompletionHint(value: string, t: TranslateFn): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const exact = COMPLETION_HINT_KEYS[trimmed.toLowerCase()];
  if (exact) return t(exact);
  const match = trimmed.match(UNKNOWN_COMPLETION_ITEM_PATTERN);
  if (match) return t('ux.backend.completion.hint.unknownTemplate', { item: match[1] ?? '' });
  return trimmed;
}
