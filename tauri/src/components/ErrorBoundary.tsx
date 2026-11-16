import { Component, type ReactNode } from 'react';
import { t } from '../i18n';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message || String(error) };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen app-bg flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-card p-8 text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/40 text-red-500 grid place-items-center text-xl">
              !
            </div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('error.renderError')}</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 break-words">
              {this.state.message}
            </p>
            <button
              onClick={this.handleReload}
              className="mt-5 inline-flex items-center justify-center h-10 px-4 rounded-xl bg-accent text-accent-contrast font-medium text-sm shadow-soft hover:brightness-110 transition-all"
            >
              {t('error.reload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
