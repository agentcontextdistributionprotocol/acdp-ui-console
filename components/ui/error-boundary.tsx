'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { C } from '@/lib/colors';
import { ErrorDetail } from '@/components/ui/error-panel';
import { crashDiagnostic } from '@/lib/utils/api-error-messages';

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
            <ErrorDetail details={crashDiagnostic(this.state.error)} />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
