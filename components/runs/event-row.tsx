'use client';

import {
  Boxes,
  ArrowDownToLine,
  Search,
  ShieldCheck,
  KeyRound,
  Sparkles,
  User,
  Play,
  CheckCircle2,
  XCircle,
  FileText,
  Webhook,
  StickyNote,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { eventTypeColor } from '@/lib/colors';
import { formatCtxId, formatAgentDid, shortAuthority } from '@/lib/utils/acdp';
import { timeAgo } from '@/lib/utils/format';
import type { StepEvent } from '@/lib/types';

const ICONS: Record<string, LucideIcon> = {
  'agent.started': User,
  'llm.thinking': Sparkles,
  'acdp.publish': Boxes,
  'acdp.retrieve': ArrowDownToLine,
  'acdp.search': Search,
  'acdp.verify': ShieldCheck,
  'auth.token': KeyRound,
  'auth.revoke': KeyRound,
  'policy.check': ShieldCheck,
  'scenario.note': StickyNote,
  'run.started': Play,
  'run.complete': CheckCircle2,
  'run.error': XCircle,
  'webhook.received': Webhook,
};

function detailFor(ev: StepEvent): string {
  if (ev.error) return ev.error;
  if (ev.title) return ev.title;
  if (ev.preview) return ev.preview;
  if (ev.agent_id) return formatAgentDid(ev.agent_id);
  if (ev.ctx_id) return formatCtxId(ev.ctx_id);
  return ev.type;
}

export function EventRow({ event, onSelectCtx }: { event: StepEvent; onSelectCtx?: (ctxId: string) => void }) {
  const color = eventTypeColor(event.type);
  const Icon = ICONS[event.type] ?? FileText;
  const meta: string[] = [];
  if (event.registry_authority) meta.push(shortAuthority(event.registry_authority));
  if (event.contexts_produced) meta.push(`+${event.contexts_produced} ctx`);
  if (event.derived_from && event.derived_from.length > 0)
    meta.push(`← derives from ${formatCtxId(event.derived_from[0])}`);

  return (
    <div
      className="event-row anim-in"
      style={{ ['--ev-color' as string]: color }}
      onClick={() => event.ctx_id && onSelectCtx?.(event.ctx_id)}
    >
      <div className="ev-icon">
        <Icon size={13} />
      </div>
      <div className="ev-body">
        <div className="ev-type">{event.type}</div>
        <div className="ev-detail">{detailFor(event)}</div>
        {(meta.length > 0 || event.ctx_id) && (
          <div className="ev-meta">
            {event.ctx_id && <span style={{ color }}>{formatCtxId(event.ctx_id)}</span>}
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        )}
      </div>
      <div className="ev-ts">{timeAgo(event.ts)}</div>
    </div>
  );
}
