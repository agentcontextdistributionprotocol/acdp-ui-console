'use client';

import { AlertTriangle } from 'lucide-react';
import { C } from '@/lib/colors';
import { ErrorDetail } from '@/components/ui/error-panel';
import { crashDiagnostic } from '@/lib/utils/api-error-messages';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page">
      <div
        className="card"
        style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}
      >
        <AlertTriangle size={32} color={C.danger} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 }}>Something went wrong</div>
        <ErrorDetail details={crashDiagnostic(error, error.digest)} />
        <button className="btn btn-primary" onClick={reset} style={{ marginTop: 8 }}>
          Try again
        </button>
      </div>
    </div>
  );
}
