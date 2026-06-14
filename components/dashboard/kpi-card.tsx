import type { ReactNode } from 'react';

export function KpiCard({
  label,
  value,
  delta,
  deltaTone = 'success',
  accent = 'var(--brand)',
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: 'success' | 'muted';
  accent?: string;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="kpi-card" style={{ ['--kpi-accent' as string]: accent }} title={hint}>
      {icon && <div className="kpi-icon">{icon}</div>}
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {delta && (
        <div className="kpi-delta" style={{ color: deltaTone === 'muted' ? 'var(--muted)' : undefined }}>
          {delta}
        </div>
      )}
      {hint && (
        <div className="kpi-delta" style={{ color: 'var(--muted)', fontSize: 10.5, fontWeight: 400 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
