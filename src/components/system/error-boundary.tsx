import { Component, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  resetQueryCache?: boolean;
};

type State = {
  hasError: boolean;
  message: string;
};

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Something went wrong.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-svh items-center justify-center p-6">
          <div className="max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
            <h1 className="text-xl font-semibold">Shop Timecard hit an error</h1>
            <p className="mt-2 text-sm text-muted-foreground">{this.state.message}</p>
            <button
              type="button"
              className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
