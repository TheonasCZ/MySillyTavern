import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches uncaught render errors anywhere in the child tree and shows a
 * fallback UI instead of a blank white screen. The fallback includes the
 * error message and a "Reload" button that restarts the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] uncaught render error:", error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "2rem",
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <pre
            style={{
              maxWidth: "36rem",
              padding: "1rem",
              borderRadius: "var(--radius-md, 8px)",
              backgroundColor: "var(--color-surface-2)",
              color: "var(--color-text-faint)",
              fontSize: "0.8125rem",
              lineHeight: 1.5,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1.25rem",
              borderRadius: "var(--radius-md, 8px)",
              border: "none",
              backgroundColor: "var(--color-accent)",
              color: "var(--color-accent-contrast)",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
