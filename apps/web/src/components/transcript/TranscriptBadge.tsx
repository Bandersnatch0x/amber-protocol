import { useI18n, type I18nKey } from '@/lib/i18n';

// Role-differentiated badge palette (existing Tailwind tokens + dark variants):
// user = blue, assistant = emerald, system/tool = neutral slate.
const BADGE_STYLES: Record<string, string> = {
  user: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  assistant: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  system: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  tool: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const FALLBACK_BADGE_STYLE = BADGE_STYLES.system;
const TRANSLATABLE_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

interface TranscriptBadgeProps {
  role: string;
  toolOnly: boolean;
}

export function TranscriptBadge({ role, toolOnly }: TranscriptBadgeProps) {
  const { t } = useI18n();

  const label = toolOnly
    ? t('transcripts.detail.toolCall')
    : TRANSLATABLE_ROLES.has(role)
      ? t(`transcript.role.${role}` as I18nKey)
      : role;

  // Tool-only turns carry role "assistant" in the raw transcript; the badge
  // must follow the toolOnly classification, not the raw role, so the slate
  // tool palette actually wins over the assistant emerald palette.
  const styleKey = toolOnly ? 'tool' : role;

  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[styleKey] ?? FALLBACK_BADGE_STYLE}`}
    >
      {label}
    </span>
  );
}
