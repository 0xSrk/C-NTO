import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/design/primitives';

interface Props {
  children: ReactNode;
  /** Change de valeur pour réinitialiser la frontière (ex. identifiant d'onglet). */
  resetKey?: string;
}

interface State {
  error: Error | null;
  key?: string;
}

/** Isole un module : une erreur de rendu affiche un panneau de reprise au lieu d'un desk vide. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[CΛNTO] module en erreur', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
        <span className="micro" style={{ color: 'var(--ember)' }}>
          Module interrompu
        </span>
        <h2 style={{ fontSize: 16, color: 'var(--text-0)' }}>Une erreur a interrompu l’affichage de ce module.</h2>
        <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)', whiteSpace: 'pre-wrap', border: '1px solid var(--line-1)', padding: 10, background: 'var(--bg-0)' }}>{this.state.error.message}</pre>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-3)' }}>Les données du coffre ne sont pas affectées. Réessayez, ou changez d’onglet puis revenez.</p>
        <div>
          <Button variant="gold" onClick={() => this.setState({ error: null })}>
            Réessayer
          </Button>
        </div>
      </div>
    );
  }
}
