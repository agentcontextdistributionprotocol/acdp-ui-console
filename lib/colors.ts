/**
 * Single source of truth for design tokens consumed by inline-styled
 * components. Values are CSS variables defined in app/globals.css — the only
 * place where raw hex colours live.
 */
export const C = {
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  panel2: 'var(--panel-2)',
  panel3: 'var(--panel-3)',
  border: 'var(--border)',
  border2: 'var(--border-2)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  faint: 'var(--faint)',
  brand: 'var(--brand)',
  brandDim: 'var(--brand-dim)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  purple: 'var(--purple)',
} as const;

/** Map a StepEventType (or any prefix) to its accent colour. */
export function eventTypeColor(type: string): string {
  // Lifecycle transitions (RFC-ACDP-0013) — checked before publish/retrieve so
  // 'context_republished' never falls into the publish bucket.
  if (type.startsWith('acdp.retract') || type.includes('retracted')) return C.danger;
  if (type.startsWith('acdp.republish') || type.includes('republished')) return C.warning;
  if (type.startsWith('acdp.publish')) return C.brand;
  if (type.startsWith('acdp.retrieve')) return C.info;
  if (type.startsWith('acdp.search')) return C.purple;
  if (type.startsWith('acdp.verify')) return C.success;
  if (type.startsWith('auth')) return C.warning;
  if (type.startsWith('policy')) return '#f97316';
  if (type.startsWith('llm')) return '#84cc16';
  if (type.startsWith('agent')) return C.muted;
  if (type === 'run.complete') return C.success;
  if (type === 'run.error') return C.danger;
  if (type === 'run.started') return C.muted;
  if (type.startsWith('webhook')) return C.purple;
  if (type.startsWith('scenario')) return C.muted;
  return C.faint;
}

/** Map a run status — or an ACDP context status — to a badge class suffix. */
export function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'complete':
    case 'completed':
    case 'active':
      return 'badge-complete';
    case 'running':
    case 'starting':
    case 'expired':
      return 'badge-running';
    case 'failed':
    case 'error':
      return 'badge-failed';
    // Canonical retracted style (RFC-ACDP-0013): danger-leaning, distinct from
    // 'failed' via the dashed border in .badge-retracted.
    case 'retracted':
      return 'badge-retracted';
    case 'cancelled':
    case 'superseded':
      return 'badge-neutral';
    default:
      return 'badge-neutral';
  }
}

/**
 * Canonical chip class for an ACDP context status (open vocabulary — unknown
 * values fall back to the neutral chip).
 */
export function statusChipClass(status: string | null | undefined): string {
  switch (status) {
    case 'active':
      return 'chip ok';
    case 'retracted':
      return 'chip bad';
    case 'expired':
      return 'chip warn';
    default:
      return 'chip';
  }
}

/** Map a registry_mode to a chip class suffix. */
export function modeChipClass(mode: string | null | undefined): string {
  if (mode === 'dual') return 'chip mode-dual';
  if (mode === 'cross_org') return 'chip mode-cross';
  return 'chip';
}
