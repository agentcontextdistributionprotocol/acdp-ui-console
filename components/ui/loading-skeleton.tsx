export function LoadingSkeleton({ rows = 5, height = 40 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }} />
      ))}
    </div>
  );
}

export function LoadingPanel({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{label}</div>
      <LoadingSkeleton />
    </div>
  );
}
