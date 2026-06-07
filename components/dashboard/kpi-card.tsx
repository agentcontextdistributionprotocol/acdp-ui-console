import type { ReactNode } from 'react';

export function KpiCard({
  label,
  value,
  delta,
  deltaTone = 'success',
  accent = 'var(--brand)',
  icon,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: 'success' | 'muted';
  accent?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="kpi-card" style={{ ['--kpi-accent' as string]: accent }}>
      {icon && <div className="kpi-icon">{icon}</div>}
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {delta && (
        <div className="kpi-delta" style={{ color: deltaTone === 'muted' ? 'var(--muted)' : undefined }}>
          {delta}
        </div>
      )}
    </div>
  );
}
