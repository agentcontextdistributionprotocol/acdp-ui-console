'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Button } from '@/components/ui/button';
import { C } from '@/lib/colors';

export default function LoginPage() {
  const router = useRouter();
  const [passphrase, setPassphrase] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setError(body.error ?? `Sign-in failed (${res.status}).`);
        setSubmitting(false);
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Sign-in failed: network error.');
      setSubmitting(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420, margin: '80px auto' }}>
      <SectionTitle icon={KeyRound} title="Sign in" sub="Operator passphrase required for this console" />
      <div className="card">
        <form className="card-body config-form" onSubmit={submit}>
          <div className="form-row">
            <span className="form-label">Passphrase</span>
            <input
              className="form-input"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {error && <div style={{ fontSize: 11, color: C.danger, marginTop: 8 }}>{error}</div>}
          <div style={{ marginTop: 14 }}>
            <Button type="submit" variant="primary" disabled={submitting || passphrase.length === 0}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
