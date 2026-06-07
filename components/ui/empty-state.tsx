import { Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { C } from '@/lib/colors';

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={28} color={C.faint} />
      <div style={{ fontSize: 13, color: C.muted }}>{title}</div>
      {description && <div style={{ fontSize: 11, maxWidth: 360 }}>{description}</div>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}
