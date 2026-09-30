'use client';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: '#0d0e14', color: '#e2e4ef', fontFamily: 'monospace', padding: 40 }}>
        <h2 style={{ marginBottom: 12 }}>Application error</h2>
        {/* Fixed sentence, not `error.message` — for an `ApiError` that IS the
            raw upstream body (#116). No `<details>` disclosure here as the
            other two boundaries get: this file REPLACES the entire document
            (Next's own docs: "do not include your global styles" in it), so
            `app/globals.css`'s `.error-detail` bound and the `C.*` tokens
            `ErrorDetail` depends on do not exist in this tree. The digest is
            the one diagnostic worth inlining by hand, since it is already a
            short opaque id rather than an arbitrarily long body. */}
        <p style={{ color: '#8b90a8', marginBottom: 16 }}>Something went wrong at the root of the application.</p>
        {error.digest && <p style={{ color: '#5a5f78', fontSize: 12, marginBottom: 16 }}>Digest: {error.digest}</p>}
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
