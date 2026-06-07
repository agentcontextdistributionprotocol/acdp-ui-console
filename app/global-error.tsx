'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: '#0d0e14', color: '#e2e4ef', fontFamily: 'monospace', padding: 40 }}>
        <h2 style={{ marginBottom: 12 }}>Application error</h2>
        <p style={{ color: '#8b90a8', marginBottom: 16 }}>{error.message}</p>
        <button
          onClick={reset}
          style={{ background: '#00e8c6', color: '#0d0e14', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
