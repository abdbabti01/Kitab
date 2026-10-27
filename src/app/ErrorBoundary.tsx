import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Recoverable failure UI. It does not hide model bugs: the error is logged
 * and shown, and the learner can reset the current view.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string; onReset?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Kitab view failed", error, info.componentStack);
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="page narrow" role="alert">
        <h1>This view hit an error</h1>
        <p>Something went wrong while showing this lesson. Your saved progress is unchanged.</p>
        <pre className="error-detail">{this.state.error.message}</pre>
        <div className="actions">
          <button type="button" className="button primary" onClick={() => { this.props.onReset?.(); this.setState({ error: null }); }}>Reset this view</button>
          <a className="button" href="/">Back to Kitab</a>
        </div>
      </main>
    );
  }
}
