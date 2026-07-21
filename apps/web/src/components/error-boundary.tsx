import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Interface error', {
      message: error.message,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error" role="alert">
          <h1>Une erreur est survenue</h1>
          <p>L’interface n’a pas pu être affichée. Rechargez la page pour réessayer.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
