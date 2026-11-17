import { Component, type ErrorInfo, type ReactNode } from "react";
import { diagnostics, isStaleChunk } from "./diagnostics.ts";

type Props = {
  children: ReactNode;
  resetKey: string;
  onReset?: () => void;
  /** Which part of Kitab this contains, for the diagnostics. */
  area?: string;
  /** A smaller recovery panel for one part of a page; the default replaces the whole view. */
  fallback?: (reset: () => void) => ReactNode;
};

/**
 * Recoverable failure UI. It does not hide model bugs: the error is logged with its diagnostics, its message is
 * one click away, and the learner gets the recovery that can work (reset this part, or reload a stale version).
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Kitab view failed", diagnostics(error, this.props.area ?? "page"), error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isStaleChunk(error)) {
      return (
        <main id="main" className="page narrow" role="alert">
          <h1>Kitab has been updated</h1>
          <p>This page is part of a newer version of Kitab than the one open in this tab. Reload to continue. Your saved progress is unchanged.</p>
          <div className="actions">
            <button type="button" className="button primary" onClick={() => location.reload()}>Reload Kitab</button>
          </div>
        </main>
      );
    }
    if (this.props.fallback) return this.props.fallback(this.reset);
    const d = diagnostics(error, this.props.area ?? "page");
    return (
      <main id="main" className="page narrow" role="alert">
        <h1>This view hit an error</h1>
        <p>Something went wrong while showing this page. Your saved progress is unchanged.</p>
        <div className="actions">
          <button type="button" className="button primary" onClick={this.reset}>Reset this view</button>
          <a className="button" href="/">Back to Kitab</a>
        </div>
        <details>
          <summary>Details for a bug report</summary>
          <pre className="error-detail">{`${d.message}\nPage: ${d.page}\nVersion: ${d.build}`}</pre>
        </details>
      </main>
    );
  }
}
