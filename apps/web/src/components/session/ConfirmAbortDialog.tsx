import { useI18n } from '@/lib/i18n';

interface ConfirmAbortDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmAbortDialog({ isOpen, onConfirm, onCancel }: ConfirmAbortDialogProps) {
  const { t } = useI18n();

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="abort-dialog-title"
      aria-describedby="abort-dialog-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="mx-4 w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
        <h2 id="abort-dialog-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t('sessions.controls.abortTitle')}
        </h2>
        <p id="abort-dialog-description" className="mt-2 mb-6 text-sm text-slate-600 dark:text-slate-400">
          {t('sessions.controls.abortDetail')}
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary text-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-danger text-sm"
          >
            {t('sessions.controls.abort')}
          </button>
        </div>
      </div>
    </div>
  );
}
