export const HOST_IDS = ['claude', 'codex', 'cursor'] as const;
export type HostId = (typeof HOST_IDS)[number];

export const SUGGESTION_STATUSES = ['open', 'snoozed', 'dismissed', 'applied', 'stale'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const OPERATION_VERBS = ['create', 'update', 'remove'] as const;
export type OperationVerb = (typeof OPERATION_VERBS)[number];

export const ARTIFACT_KINDS = ['wiki', 'agents-md', 'skill'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface SuggestionHomes {
  claudeHome?: string;
  codexHome?: string;
  cursorHome?: string;
}

export interface FrictionSignal {
  host: HostId;
  transcriptId: string;
  tool: string;
  error: string;
  excerpt: string;
  timestamp?: string;
  fingerprint: string;
}

export interface SuggestionEvidence {
  host: HostId;
  transcriptId: string;
  excerpt: string;
  timestamp?: string;
}

export interface SuggestionOperation {
  verb: OperationVerb;
  artifactKind: ArtifactKind;
  path: string;
  summary: string;
  contents?: string;
  expectedHash: string | null;
}

export interface ImprovementSuggestion {
  id: string;
  fingerprint: string;
  title: string;
  tool: string;
  evidenceCount: number;
  transcriptCount: number;
  hosts: HostId[];
  evidence: SuggestionEvidence[];
  operations: SuggestionOperation[];
  status: SuggestionStatus;
  snoozeUntil?: string;
  updatedAt?: string;
}

export interface SuggestionListResult {
  suggestions: ImprovementSuggestion[];
  scanned: { host: HostId; transcripts: number }[];
}

export type SuggestionMutationResult =
  { ok: true; suggestion: ImprovementSuggestion } | { ok: false; code: string; message: string };
