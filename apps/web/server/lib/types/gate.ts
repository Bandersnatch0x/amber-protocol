export type GateStatus = 'pending' | 'approved' | 'rejected';

// Audit-identity constants for web gate decisions (ADR-0007 amendment (c)).
// Shared by the server router/reader and the gates UI via the `@server` alias,
// so client-side validation mirrors the server-side whitelist exactly.
export const REVIEWER_MAX_LENGTH = 64;

/** Whitelist charset for reviewer identifiers: letters, digits, and `. _ @ : -`. */
export const REVIEWER_PATTERN = /^[\p{L}\p{N}._@:-]{1,64}$/u;

/** Explicit anonymous marker for web decisions submitted without a reviewer. */
export const WEB_ANONYMOUS_REVIEWER = 'web:anonymous';

export interface Gate {
  gateId: string;
  sessionId: string;
  type: string;
  stage: string;
  description: string;
  status: GateStatus;
  triggeredAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason?: string;
}

export interface GateFilters {
  sessionId?: string;
  status?: GateStatus;
}

export interface GateDecision {
  decision: 'approved' | 'rejected';
  reason?: string;
  resolvedAt: string;
  resolvedBy: string;
}
