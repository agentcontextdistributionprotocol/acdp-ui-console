'use client';

// ══════════════════════════════════════════════════════════════════════
// React hook that drives every trust-surface verdict for a FullContext.
//
// The wasm loads lazily in the browser only; during SSR / first paint the
// verdicts are `pending` and each chip shows a neutral "checking…" state. Once
// the module is ready the hook fills in the real verdicts. All work is done in
// an effect (wasm is async + browser-only), guarded against races on unmount.
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import type { FullContext } from '@/lib/types';
import type { DidDocMap } from './resolve';
import {
  verifyContentHash,
  verifyCtxIdBinding,
  verifyLineageHeadReceipt,
  verifyProducerSignature,
  verifyRegistryReceipt,
  verifyTransparencyLog,
  verifyWitnessQuorum,
  type QuorumVerdict,
  type Verdict,
} from './verify';

export interface ContextVerdicts {
  ready: boolean;
  error?: string;
  contentHash?: Verdict;
  ctxIdBinding?: Verdict;
  producerSignature?: Verdict;
  registryReceipt?: Verdict;
  lineageHeadReceipt?: Verdict;
  transparencyLog?: Verdict;
  witnessQuorum?: QuorumVerdict;
}

/**
 * @param requestedCtxId the ctx_id the CALLER independently asked for (a search
 * hit, a URL param, a graph node) — used only for the `ctxIdBinding` check.
 * Passing `ctx.body.ctx_id` back would make that check tautologically green.
 */
export function useContextVerdicts(ctx: FullContext, docs: DidDocMap, requestedCtxId: string): ContextVerdicts {
  const [state, setState] = useState<ContextVerdicts>({ ready: false });

  // Re-run whenever the verified material, the requested id, or the available
  // DID docs change.
  const key = `${ctx.body.ctx_id}:${ctx.body.content_hash}:${requestedCtxId}`;

  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    setState({ ready: false });
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const body = ctx.body;
        const status = ctx.registry_state.status;

        const [contentHash, producerSignature, ctxIdBinding] = await Promise.all([
          verifyContentHash(body),
          verifyProducerSignature(body, docs),
          verifyCtxIdBinding(body, requestedCtxId),
        ]);

        const registryReceipt = ctx.registry_receipt
          ? await verifyRegistryReceipt(ctx.registry_receipt, body, docs)
          : undefined;
        const lineageHeadReceipt = ctx.lineage_head_receipt
          ? await verifyLineageHeadReceipt(ctx.lineage_head_receipt, body, status, docs)
          : undefined;
        const transparencyLog = ctx.log_inclusion
          ? await verifyTransparencyLog(ctx.log_inclusion, ctx.registry_receipt, docs)
          : undefined;
        const witnessQuorum =
          ctx.log_inclusion && (ctx.log_inclusion.witness_signatures?.length ?? 0) > 0
            ? await verifyWitnessQuorum(ctx.log_inclusion, docs)
            : undefined;

        if (cancelled) return;
        setState({
          ready: true,
          contentHash,
          ctxIdBinding,
          producerSignature,
          registryReceipt,
          lineageHeadReceipt,
          transparencyLog,
          witnessQuorum,
        });
      } catch (e) {
        if (cancelled) return;
        setState({ ready: true, error: (e as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, docs]);

  return state;
}
