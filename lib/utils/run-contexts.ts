import type { CpRun } from '@/lib/types';

/**
 * The ctx_ids a run reported publishing, from the completion notification the
 * playground sends the control plane (`run.result.contexts`). Self-reported:
 * nothing here was observed at a registry. Anything that is not an array of
 * non-empty strings is treated as no report at all.
 */
export function reportedRunContexts(run: Pick<CpRun, 'result'>): string[] {
  const contexts = run.result?.contexts;
  if (!Array.isArray(contexts)) return [];
  return contexts.filter((c): c is string => typeof c === 'string' && c.length > 0);
}

/**
 * #197. The control plane's `contextsCount` and `/runs/:id/lineage` are built
 * only from registry-forwarded events, so a stack whose registries forward no
 * webhooks reports 0 for a run that did publish. Rendering that 0 is a false
 * claim about the run. When nothing was observed but the run itself reported
 * contexts, this returns the label to show INSTEAD of the 0 (or of "No lineage
 * yet"); otherwise `null`, and the observed figure stands.
 *
 * Deliberately a label, not a substitute graph or count: the self-reported
 * contexts are never drawn as lineage, because nothing about them was observed.
 */
export function unobservedContextsLabel(observedCount: number, run: Pick<CpRun, 'result'>): string | null {
  if (observedCount > 0) return null;
  const n = reportedRunContexts(run).length;
  if (n === 0) return null;
  return `${n} context${n === 1 ? '' : 's'} reported by the run; none observed via registry events`;
}
