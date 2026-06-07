import { AlertTriangle } from 'lucide-react';
import { C } from '@/lib/colors';

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
      <AlertTriangle size={18} color={C.danger} />
      <div style={{ fontSize: 12, color: C.muted }}>{message}</div>
    </div>
  );
}
