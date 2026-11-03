import type { FormEvent } from 'react';
import { MAX_CONTEXT_NODES } from '@/lib/knowledge-dto';
import { useI18n, type I18nKey } from '@/lib/i18n';
import type { KnowledgeAnalytics } from './map-analytics';
import type { KnowledgeAskResultDTO, KnowledgeNode } from './types';

/**
 * The Knowledge Map's right-hand rail: Ask, Analytics, and the shared-foundation
 * detail. Split out of `KnowledgeMapPage` so the page keeps the graph and the
 * rail keeps the reading surfaces — each can change without the other's
 * 1,000-line context in view.
 */

function KnowledgeAskForm({
  question,
  onQuestionChange,
  onSubmit,
  focusNode,
  isFetching,
  nodeCount,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  focusNode: KnowledgeNode | null;
  isFetching: boolean;
  nodeCount: number;
}) {
  const { t } = useI18n();
  const overCap = !focusNode && nodeCount > MAX_CONTEXT_NODES;
  return (
    <form className="mt-3 space-y-3" onSubmit={onSubmit}>
      <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-200">
        {t('knowledge.ask.questionLabel')}
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder={t('knowledge.ask.placeholder')}
          maxLength={2_000}
          rows={4}
          className="mt-1 w-full resize-y rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-obsidian-border dark:bg-obsidian-surface dark:text-slate-200"
        />
      </label>
      <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2 text-[10px] text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
        {t('knowledge.ask.disclosure')}
      </div>
      <div
        className={
          overCap
            ? 'text-[10px] text-amber-700 dark:text-amber-300'
            : 'text-[10px] text-slate-500 dark:text-slate-400'
        }
      >
        {overCap
          ? t('knowledge.ask.overCap', { nodes: nodeCount, cap: MAX_CONTEXT_NODES })
          : focusNode
            ? t('knowledge.ask.focus', { id: focusNode.id })
            : t('knowledge.ask.noFocus')}
      </div>
      <button
        type="submit"
        disabled={isFetching || question.trim().length === 0}
        className="btn-secondary w-full text-xs disabled:opacity-50"
      >
        {isFetching ? t('knowledge.ask.loading') : t('knowledge.ask.submit')}
      </button>
    </form>
  );
}

function KnowledgeAskStatus({
  result,
  errorCode,
}: {
  result: KnowledgeAskResultDTO | undefined;
  errorCode: string | null;
}) {
  const { t } = useI18n();
  const errorMessage = errorCode?.includes('context-overflow')
    ? t('knowledge.ask.overflow')
    : errorCode?.includes('uncitable-answer')
      ? t('knowledge.ask.uncitable')
      : errorCode?.includes('invalid-focus-node')
        ? t('knowledge.ask.invalidFocus')
        : errorCode
          ? t('knowledge.ask.error')
          : null;
  if (result?.status === 'unavailable') {
    return (
      <div role="status" className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        {result.reason === 'invalid-config'
          ? t('knowledge.ask.invalidConfig')
          : t('knowledge.ask.unavailable')}
      </div>
    );
  }
  return errorMessage ? (
    <div role="alert" className="mt-3 text-xs text-red-700 dark:text-red-300">
      {errorMessage}
    </div>
  ) : null;
}

function KnowledgeCitation({
  citation,
  supersederIds,
  nodeById,
  onSelect,
}: {
  citation: string;
  supersederIds: string[];
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(citation)}
        data-testid={`knowledge-citation-${citation}`}
        className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[10px] text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        title={nodeById.get(citation)?.title}
      >
        {citation}
      </button>
      {supersederIds.length > 0 && (
        <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {t('knowledge.ask.superseded')}
        </span>
      )}
      {supersederIds.map((supersederId) => (
        <button
          key={supersederId}
          type="button"
          onClick={() => onSelect(supersederId)}
          className="text-[9px] text-blue-700 underline hover:text-blue-800 dark:text-blue-300"
        >
          {t('knowledge.ask.supersededBy', { id: supersederId })}
        </button>
      ))}
    </span>
  );
}

function KnowledgeAskAnswer({
  result,
  nodeById,
  onSelect,
}: {
  result: Extract<KnowledgeAskResultDTO, { status: 'ok' }>;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 space-y-3" data-testid="knowledge-ask-answer">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        {t('knowledge.ask.result')}
      </div>
      <div className="rounded-md bg-slate-50 px-2.5 py-2 text-[10px] text-slate-600 dark:bg-obsidian-surface dark:text-slate-300">
        <div data-testid="knowledge-ask-submitted-question">
          {t('knowledge.ask.submittedQuestion', { question: result.request.question })}
        </div>
        <div data-testid="knowledge-ask-submitted-focus">
          {result.request.focusNodeId
            ? t('knowledge.ask.submittedFocus', { id: result.request.focusNodeId })
            : t('knowledge.ask.submittedNoFocus')}
        </div>
      </div>
      {result.answer.segments.map((segment, index) => (
        <div
          key={`${index}:${segment.text}`}
          className="rounded-md border border-slate-200 p-2.5 dark:border-obsidian-border"
        >
          <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">
            {segment.text}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label={t('knowledge.ask.citations')}>
            {segment.citations.map((citation) => (
              <KnowledgeCitation
                key={citation}
                citation={citation}
                supersederIds={result.supersededBy[citation] ?? []}
                nodeById={nodeById}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
      {result.omittedCount > 0 && (
        <div role="status" className="text-[10px] text-amber-700 dark:text-amber-300">
          {t('knowledge.ask.omitted', { count: result.omittedCount })}
        </div>
      )}
    </div>
  );
}

export function KnowledgeAskPanel({
  question,
  onQuestionChange,
  onSubmit,
  focusNode,
  result,
  isFetching,
  errorCode,
  nodeById,
  onSelect,
  nodeCount,
}: {
  question: string;
  onQuestionChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  focusNode: KnowledgeNode | null;
  result: KnowledgeAskResultDTO | undefined;
  isFetching: boolean;
  errorCode: string | null;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
  nodeCount: number;
}) {
  const { t } = useI18n();
  return (
    <div className="card p-4 max-h-[70vh] overflow-y-auto" data-testid="knowledge-ask-panel">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        {t('knowledge.ask.title')}
      </h2>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {t('knowledge.ask.description')}
      </p>
      <KnowledgeAskForm
        question={question}
        onQuestionChange={onQuestionChange}
        onSubmit={onSubmit}
        focusNode={focusNode}
        isFetching={isFetching}
        nodeCount={nodeCount}
      />
      <KnowledgeAskStatus result={result} errorCode={errorCode} />
      {result?.status === 'ok' && (
        <KnowledgeAskAnswer result={result} nodeById={nodeById} onSelect={onSelect} />
      )}
    </div>
  );
}

export function KnowledgeAnalyticsPanel({
  analytics,
  nodeById,
  onSelect,
}: {
  analytics: KnowledgeAnalytics;
  nodeById: Map<string, KnowledgeNode>;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const percent = (value: number) => Math.round(value * 1000) / 10;
  return (
    <div className="card p-4 max-h-[70vh] overflow-y-auto" data-testid="knowledge-analytics-report">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        {t('knowledge.analytics.title')}
      </h2>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {t('knowledge.analytics.description')}
      </p>
      <p className="mt-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
        {t('knowledge.analytics.metrics', {
          nodes: analytics.metrics.nodeCount,
          edges: analytics.metrics.edgeCount,
          communities: analytics.metrics.communityCount,
          largest: percent(analytics.metrics.largestCommunityShare),
          singleton: percent(analytics.metrics.weightedSingletonShare),
        })}
      </p>

      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
          {t('knowledge.analytics.godNodes')}
        </div>
        {analytics.godNodes.map((board) => (
          <div key={board.layer} className="mb-2">
            <div className="text-[10px] font-mono text-slate-400">
              {board.layer} · p99 = {board.threshold}
            </div>
            <ul className="mt-1 space-y-1">
              {board.entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry.id)}
                    className="w-full text-left rounded border border-slate-200 dark:border-obsidian-border px-2 py-1 hover:border-fuchsia-300 dark:hover:border-fuchsia-800 transition-colors"
                  >
                    <span className="font-mono text-[10px] text-slate-700 dark:text-slate-200 break-all">
                      {entry.id}
                    </span>
                    <span className="ml-1.5 text-[10px] text-fuchsia-700 dark:text-fuchsia-300">
                      {t('knowledge.analytics.godNodeRow', {
                        degree: entry.degree,
                        inDegree: entry.inDegree,
                        outDegree: entry.outDegree,
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
          {t('knowledge.analytics.communities')}
        </div>
        <ul className="space-y-1">
          {analytics.communities.slice(0, 8).map((community) => (
            <li
              key={community.id}
              className="text-[10px] font-mono text-slate-600 dark:text-slate-300"
            >
              {t('knowledge.analytics.communityRow', {
                id: community.id,
                size: community.size,
                sample: nodeById.get(community.members[0])?.title ?? community.members[0],
              })}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5">
          {t('knowledge.analytics.anomalies')}
        </div>
        <p className="text-[10px] text-slate-400 mb-1.5">{t('knowledge.analytics.neutral')}</p>
        {analytics.anomalies.length === 0 ? (
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {t('knowledge.analytics.anomaliesEmpty')}
          </div>
        ) : (
          <ul className="space-y-1">
            {analytics.anomalies.map((mark) => (
              <li key={`${mark.src}:${mark.verb}:${mark.dst}:${mark.reason}`}>
                <button
                  type="button"
                  onClick={() => onSelect(mark.src)}
                  className="w-full text-left rounded border border-violet-200 dark:border-violet-900/60 px-2 py-1 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors"
                >
                  <div className="font-mono text-[10px] text-slate-700 dark:text-slate-200 break-all">
                    {mark.src} -[{mark.verb}]→ {mark.dst}
                  </div>
                  <div className="text-[9px] text-violet-700 dark:text-violet-300">
                    {t(`knowledge.analytics.reason.${mark.reason}` as I18nKey)} · {mark.detail}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function FoundationDetailPanel({
  memberIds,
  nodeById,
  inDegreeP99,
  onSelect,
}: {
  memberIds: string[];
  nodeById: Map<string, KnowledgeNode>;
  inDegreeP99: number;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card p-4 max-h-[70vh] overflow-y-auto" data-testid="foundation-detail-panel">
      <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
        {t('knowledge.kind.foundation')}
      </span>
      <h2 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white leading-snug">
        {t('knowledge.foundation.members', { count: memberIds.length })}
      </h2>
      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
        {t('knowledge.foundation.description')} (p99 = {inDegreeP99})
      </p>
      <ul className="mt-3 space-y-1">
        {memberIds.map((memberId) => (
          <li key={memberId}>
            <button
              type="button"
              data-testid={`foundation-member-${memberId}`}
              onClick={() => onSelect(memberId)}
              className="w-full text-left rounded-md border border-slate-200 dark:border-obsidian-border px-2 py-1.5 hover:border-violet-300 dark:hover:border-violet-800 hover:bg-violet-50/50 dark:hover:bg-violet-950/20 transition-colors"
            >
              <span className="font-mono text-[10px] text-slate-700 dark:text-slate-200 break-all">
                {nodeById.get(memberId)?.sourcePath ?? memberId}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
