
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
          {t('sessions.controls.abortTitle')}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {t('sessions.controls.abortDetail')}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white"
          >
            {t('sessions.controls.abort')}
          </button>
        </div>
      </div>
    </div>
  );
}
