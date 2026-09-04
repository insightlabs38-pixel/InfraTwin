'use client';

import React from 'react';

interface State { error: Error | null }

export class AppErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error) { console.error('[InfraTwin UI] unexpected render failure', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-recovery" role="alert"><div className="fatal-recovery-card"><span className="section-kicker">Workspace recovery</span><h1>The interface hit an unexpected error.</h1><p>InfraTwin has stopped this UI session rather than presenting potentially stale engineering evidence. Your browser-local draft may still be available after reload.</p><div className="inline-actions"><button className="primary" onClick={() => window.location.reload()}>Reload workspace</button><button onClick={() => this.setState({ error: null })}>Retry interface</button></div><details><summary>Technical detail</summary><pre>{this.state.error.message}</pre></details></div></main>;
  }
}
