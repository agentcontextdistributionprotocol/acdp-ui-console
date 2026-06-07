'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { C } from '@/lib/colors';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertTriangle size={18} color={C.danger} />
          <div>
            <div style={{ fontSize: 13, color: C.text }}>Component failed to render</div>
            <div style={{ fontSize: 11, color: C.muted }}>{this.state.error.message}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
