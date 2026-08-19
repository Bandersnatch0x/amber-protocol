import { Component, ReactNode } from 'react';
import { logError } from '@/lib/error-logger';
import { useI18n } from '@/lib/i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

function DefaultErrorFallback({ error }: { error?: Error }) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-lg p-6 border border-red-200 dark:border-red-800">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
          {t('error.somethingWentWrong')}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{t('error.description')}</p>
        <div className="flex flex-wrap gap-3">
          <button onClick={() => window.location.reload()} className="btn-primary text-sm">
            {t('error.reload')}
          </button>
          {/* Plain anchor on purpose: the router state itself may be what
              crashed, so the escape hatch must not depend on it. */}
          <a href="/" className="btn-secondary text-sm">
            {t('error.backHome')}
          </a>
        </div>
        {error?.message && (
          <details className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/60">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300">
              {t('error.details')}
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-500 dark:text-slate-400">
              {error.message}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logError(error, { component: 'ErrorBoundary', errorInfo });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return <DefaultErrorFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}
