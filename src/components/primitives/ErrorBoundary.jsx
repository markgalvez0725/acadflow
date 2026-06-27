import React from 'react'

/**
 * App-level error boundary.
 *
 * Catches render / lifecycle errors anywhere below it - including the context
 * providers and the router - and shows a friendly, self-contained fallback
 * instead of a blank white screen.
 *
 * The fallback deliberately depends on NOTHING that could itself be broken:
 * no React context (a provider may be the thing that crashed) and no CSS
 * classes (it uses inline styles with CSS-variable fallbacks, so it renders
 * sensibly even if the design-system stylesheet failed to load).
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surface for debugging / any future error-reporting hook.
    console.error('[AcadFlow] Uncaught error:', error, info?.componentStack)
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const isDev = !!(import.meta.env && import.meta.env.DEV)

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg, #f4f6fb)',
          color: 'var(--ink, #1a1a2e)',
          fontFamily: "'Lexend', system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 460,
            background: 'var(--surface, #ffffff)',
            border: '1px solid var(--border, #e2e6ef)',
            borderRadius: 16,
            padding: 28,
            boxShadow: '0 12px 40px rgba(10,20,50,.12)',
            textAlign: 'center',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 56, height: 56, margin: '0 auto 16px',
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--red-l, #fdecec)',
              color: 'var(--red, #d93535)',
              fontSize: 30, fontWeight: 700, lineHeight: 1,
            }}
          >
            !
          </div>

          <h1 style={{ fontSize: 19, fontWeight: 700, margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink2, #5b6478)', margin: '0 0 20px' }}>
            AcadFlow ran into an unexpected error. Your data is safe - try again,
            or reload the app to recover.
          </p>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
                border: '1px solid var(--border, #e2e6ef)',
                background: 'var(--surface, #fff)', color: 'var(--ink, #1a1a2e)',
                fontSize: 14, fontWeight: 600,
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
                border: 'none',
                background: 'var(--accent, #1a4a9e)', color: '#fff',
                fontSize: 14, fontWeight: 600,
              }}
            >
              Reload app
            </button>
          </div>

          {isDev && (
            <pre
              style={{
                marginTop: 20, textAlign: 'left', fontSize: 11.5, lineHeight: 1.5,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                background: 'var(--bg2, #f0f2f8)', color: 'var(--ink2, #5b6478)',
                border: '1px solid var(--border, #e2e6ef)', borderRadius: 8,
                padding: 12, maxHeight: 200, overflow: 'auto',
              }}
            >
              {this.state.error?.stack || this.state.error?.message || String(this.state.error)}
            </pre>
          )}
        </div>
      </div>
    )
  }
}
