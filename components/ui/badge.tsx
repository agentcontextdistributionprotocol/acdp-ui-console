import type { ReactNode } from 'react';
import { statusBadgeClass } from '@/lib/colors';

export function Badge({ children, variant = 'neutral' }: { children: ReactNode; variant?: string }) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

const STATUS_ICON: Record<string, string> = {
  complete: '●',
  completed: '●',
  running: '◌',
  starting: '◌',
  failed: '✗',
  error: '✗',
  cancelled: '–',
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = status ?? 'unknown';
  const cls = statusBadgeClass(key);
  const icon = STATUS_ICON[key] ?? '○';
  const label = key === 'completed' ? 'complete' : key;
  return (
    <span className={`badge ${cls}`}>
      <span className={key === 'running' || key === 'starting' ? 'pulse' : ''}>{icon}</span>
      {label}
    </span>
  );
}
