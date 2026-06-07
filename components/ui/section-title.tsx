import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function SectionTitle({
  icon: Icon,
  title,
  sub,
  right,
}: {
  icon?: LucideIcon;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="section-title">
      {Icon && <Icon />}
      <h1>{title}</h1>
      {sub && <span className="sub">{sub}</span>}
      {right && <div style={{ marginLeft: 'auto' }}>{right}</div>}
    </div>
  );
}
