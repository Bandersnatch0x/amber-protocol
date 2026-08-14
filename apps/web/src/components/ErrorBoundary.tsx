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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg p-6 border border-red-200 dark:border-red-800">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
          {t('error.somethingWentWrong')}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {error?.message || t('error.unexpected')}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-primary text-sm"
        >
          {t('error.reload')}
        </button>
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
