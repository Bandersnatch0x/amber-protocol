/**
 * Timeline projection over the denoised transcript display model.
 *
 * Pure function: takes raw turns, returns render-ready entries. Reuses
 * `buildTranscriptDisplayModel` (metadata shells + R1/R6 hidden records are
 * routed to the MetadataPanel there) and `classifyTurn` for fold kinds.
 *
 * Turn separators are inserted between visible records when either:
 *  - the timestamp gap from the previous visible record exceeds 15 minutes, or
 *  - the current record is a slash-command invocation (each starts a new turn).
 *
 * Translation stays in the render layer; this model carries no i18n strings.
 */

import { classifyTurn, type DenoiseResult } from './transcript-denoise';
import {
  buildTranscriptDisplayModel,
  type TranscriptMetadataItem,
  type TranscriptTurnLike,
} from './transcripts-model';

export const TURN_SEPARATOR_GAP_MS = 15 * 60 * 1000;

export type TranscriptTimelineEntry<T extends TranscriptTurnLike = TranscriptTurnLike> =
  | { entryKind: 'turn'; key: string; turn: T; denoise: DenoiseResult; displayIndex: number }
  | { entryKind: 'turnSeparator'; key: string; timestamp?: string };

export interface TranscriptTimelineModel<T extends TranscriptTurnLike = TranscriptTurnLike> {
  entries: TranscriptTimelineEntry<T>[];
  metadata: TranscriptMetadataItem[];
  visibleTurns: T[];
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function buildTranscriptTimeline<T extends TranscriptTurnLike>(
  turns: T[],
): TranscriptTimelineModel<T> {
  const display = buildTranscriptDisplayModel(turns);
  const entries: TranscriptTimelineEntry<T>[] = [];
  let previousTimestamp: number | null = null;

  display.visibleTurns.forEach((turn, index) => {
    const denoise = classifyTurn(turn);
    const timestamp = parseTimestamp(turn.timestamp);

    const gapSeparator =
      timestamp !== null &&
      previousTimestamp !== null &&
      timestamp - previousTimestamp > TURN_SEPARATOR_GAP_MS;
    const slashSeparator = denoise.kind === 'slashCommand';

    if (index > 0 && (gapSeparator || slashSeparator)) {
      entries.push({ entryKind: 'turnSeparator', key: `sep-${index}`, timestamp: turn.timestamp });
    }

    entries.push({ entryKind: 'turn', key: `turn-${index}`, turn, denoise, displayIndex: index });

    if (timestamp !== null) {
      previousTimestamp = timestamp;
    }
  });

  return { entries, metadata: display.metadata, visibleTurns: display.visibleTurns };
}
