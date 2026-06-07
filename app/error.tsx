'use client';

import { AlertTriangle } from 'lucide-react';
import { C } from '@/lib/colors';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page">
      <div
        className="card"
        style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}
      >
        <AlertTriangle size={32} color={C.danger} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 12, color: C.muted, maxWidth: 480 }}>{error.message || 'An unexpected error occurred.'}</div>
        <button className="btn btn-primary" onClick={reset} style={{ marginTop: 8 }}>
          Try again
        </button>
      </div>
    </div>
  );
}
