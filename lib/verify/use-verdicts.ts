'use client';

// ══════════════════════════════════════════════════════════════════════
// React hook that drives every trust-surface verdict for a FullContext.
//
// The wasm loads lazily in the browser only; during SSR / first paint the
// verdicts are `pending` and each chip shows a neutral "checking…" state. Once
// the module is ready the hook fills in the real verdicts. All work is done in
// an effect (wasm is async + browser-only), guarded against races on unmount.
// ══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react';
import type { FullContext, LogInclusion } from '@/lib/types';
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

// ── The memo key ──────────────────────────────────────────────────────
//
// THE RULE: every input the effect or any of its callees dereferences must be
// in this key — with exactly one admitted exception, named here rather than
// left for a reader to discover: the WALL CLOCK. Three callees pass
// `new Date().toISOString()` for staleness windows, and `fromWasm` folds a
// `stale` result into the verdict's detail STRING, so a verdict's text is
// clock-dependent and unkeyed. Harmless while the windows are ten years and
// `max_age_secs: null`, but the rule is stated absolutely everywhere else and
// this is the one place it is not satisfied. Anything read but not keyed produces a verdict computed against
// material the component is no longer showing — a stale green chip beside the
// data that would have turned it red. The previous key was
// `ctx_id:content_hash:requestedCtxId` while the effect also read
// `registry_state.status`, `registry_receipt`, `lineage_head_receipt` and
// `log_inclusion`, which is exactly that defect: a refetch flipping `active` →
// `retracted` re-rendered the status and the retraction banner from the fresh
// context while the lineage-head-receipt chip kept the verdict computed against
// `active` (`verify.ts` binds `expected.head_status = status`), and a refetch
// that ADDED a receipt left its chip on "verifying…" forever with `ready`
// already true. Reachable via React Query's `refetchOnReconnect` (default
// `true`, not overridden in `components/providers.tsx`), an explicit
// `invalidateQueries`, or a long-mounted inspector on a live run.
//
// The key covers the whole of `ctx` that the effect can reach: the body, the
// registry status, and all three envelopes keyed as objects rather than field
// by field, so a field newly dereferenced in `verify.ts` is covered the day it
// is read instead of the day someone remembers to add a row here. `docs` is the
// effect's other input and is a dependency in its own right.
//
// HOW the key is encoded, and why it is not a delimited string. An earlier
// draft joined per-field parts with an ASCII unit separator and wrote
// `<absent>` where the registry had sent nothing. Both halves of that are
// registry-controlled data: a field value containing the separator, or the
// literal string `<absent>`, lets a response forge a row boundary and collide
// with a DIFFERENT context — two distinct contexts hashing to one key is
// exactly the stale verdict this key exists to prevent, now reachable on
// purpose. `JSON.stringify` of a structured array has no such seam: every
// string is quoted and escaped, so no value can end its own row, and `null`
// (absent) is a JSON token no string can spell. Nesting also removes the
// sentinels entirely — an absent receipt is `null`, an absent witness set is
// `null` where an empty one is `[]`, and no two of those can collide.

/**
 * The witness cosignature set, whole, in a canonical order.
 *
 * `witness_signatures` is a top-level SIBLING of `log_checkpoint`, never inside
 * the closed, signed checkpoint — so a refetch in which the registry has
 * aggregated one more cosignature changes NONE of the other inputs, the
 * checkpoint signature least of all. Without this the quorum chip would still
 * read "2-witnessed" after a third witness cosigned.
 *
 * Every field is kept, for the same reason the three envelopes are keyed whole:
 * `verifyWitnessQuorum` passes the entire array into
 * `wasm.evaluateWitnessQuorum` and separately reads `signature.key_id` to pick
 * the verification method, so an enumeration here would be narrower than what
 * the callee actually reads and would drift as `verify.ts` grows. Keying only
 * `witness_id` + `signature.value` left `witnessed_checkpoint.root_hash` — a
 * field that decides whether a cosignature verifies at all — invisible to the
 * key.
 *
 * Sorted because cosignature order is not guaranteed stable across responses
 * and an identical set in a different order must not force a re-verify. The
 * comparator is explicit and over the full serialisation: `Array#sort`'s
 * default coerces each element with `String()`, which is `"[object Object]"`
 * for every cosignature — every pair compares equal, the sort degenerates to
 * a no-op, and input order leaks straight into the key.
 */
function witnessDigest(inclusion: LogInclusion | undefined | null) {
  const cosigs = inclusion?.witness_signatures;
  if (!cosigs) return null;
  // Spread first: `sort` is in-place, and `cosigs` belongs to React Query's
  // cache. Reordering it during render would mutate the data every other
  // consumer reads.
  //
  // No count field either: it is implied by the array's own length, and a key
  // row no test can distinguish from its neighbour is the redundancy this file
  // works to avoid.
  return [...cosigs].sort((a, b) => {
    // Over the FULL serialisation, not `witness_id`: one witness may appear
    // twice (a re-cosign the registry has not yet deduplicated), and a
    // comparator that ties on those leaves their order to the input, which
    // then leaks into the key.
    const [x, y] = [JSON.stringify(a), JSON.stringify(b)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

/**
 * The `witness_id` → selected `signature.key_id` mapping, sorted.
 *
 * Closes the one input that changed a verdict without changing this key.
 * `verify.ts` picks a cosignature by FIRST MATCH on `witness_id`, and
 * `resolve.ts` uses that entry's `key_id` to synthesize the `did:key`
 * verification method. So two cosignatures sharing a `witness_id` but carrying
 * different `key_id`s produce different quorum verdicts depending purely on
 * which one comes first — and `witnessDigest` sorts, deliberately, so a pure
 * reorder is invisible to it. Byte-identical key, different verdict: the stale
 * green this file exists to prevent, through the one derivation that reads
 * array position.
 *
 * Keying the ORDER itself was rejected — a benign reorder would force a needless
 * re-verify, which is exactly why `witnessDigest` sorts. What is keyed is the
 * *derivation*: sorted, so it is invariant under every reorder that cannot
 * change which entry `find` returns, and different exactly when the selected
 * key is.
 */
function witnessKeySelection(inclusion: FullContext['log_inclusion']): string[][] | null {
  const cosigs = inclusion?.witness_signatures;
  if (!cosigs) return null;
  return [...new Set(cosigs.map((c) => c.witness_id))]
    .map((wid) => [wid, cosigs.find((c) => c.witness_id === wid)?.signature?.key_id ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Exported for tests only — and for a narrower reason than this note used to give.
 *
 * NOT because mutation classes are unreachable through the hook. An earlier
 * version claimed a receipt re-issued under the same `key_id` with a different
 * `signature.value`, a re-attributed cosignature, and a reordered set were all
 * hook-unreachable. They are not: the hook-level suite drives exactly those
 * shapes via `refetch()` plus a one-field edit, and asserts the re-verify. That
 * argument had already collapsed further than it looked when `signature` was
 * destructured out below, making the signature row hook-killable on its own.
 *
 * What genuinely cannot be observed behaviourally is the set of STRUCTURAL
 * invariants: that the signature row is disjoint from the serialised body, that
 * no row restates another, and that the encoding is an array of a known length
 * rather than a delimiter-joined string a registry could spell. Those are what
 * the export earns its keep on, and they are why it stays.
 */
export function verificationKey(ctx: FullContext, requestedCtxId: string): string {
  const { signature, ...unsigned } = ctx.body;
  const inclusion = ctx.log_inclusion;
  // `witness_signatures` is split out and digested separately (above) purely
  // for order-insensitivity; everything ELSE on `log_inclusion` — the inclusion
  // path, leaf index, tree size, log id, the whole signed checkpoint — is
  // keyed verbatim.
  // `undefined` rather than a rest-destructure: `JSON.stringify` omits
  // undefined-valued keys, so this drops the cosignatures without leaving an
  // unused binding behind.
  const inclusionRest = inclusion ? { ...inclusion, witness_signatures: undefined } : null;
  return JSON.stringify([
    // NOT `ctx.body.ctx_id` and `ctx.body.content_hash`: both live inside
    // `unsigned` below, so naming them here would be two more rows that read
    // as protection while no test can tell they have stopped protecting
    // anything — the same redundancy the signature row is destructured to
    // avoid. `requestedCtxId` is the caller's independent input and is NOT in
    // the body, which is the whole point of the `ctxIdBinding` check.
    requestedCtxId,
    // The producer signature is computed OVER `content_hash`, so the hash is
    // the signature's input and not a digest of it: re-signing identical
    // content under a rotated key changes `key_id` and `value` and changes
    // neither `ctx_id` nor `content_hash` nor anything below. Without this row
    // a green "signature valid for the resolved producer key" chip would sit
    // beside the NEW `key_id` the same component renders.
    signature ?? null,
    // Everything else in the body, and ONLY everything else — `signature` is
    // destructured out above so the row before this one is load-bearing rather
    // than a comment riding on this serialisation. (A redundant row is worse
    // than a missing one: it reads as protection and no test can tell it has
    // stopped protecting anything.)
    //
    // `verifyContentHash` recomputes the digest from the WHOLE body, so —
    // unlike every other check — its inputs cannot be enumerated field by
    // field. A second response mutating a hashed field while restating the
    // original `content_hash` would otherwise leave the green hash chip beside
    // the mutated value: the same stale-green class, through the one check with
    // an open-ended input.
    unsigned,
    ctx.registry_state.status,
    // The three envelopes are keyed WHOLE rather than by their signature.
    // Enumerating `signature.key_id`/`.value` per envelope was the first draft
    // and it was wrong: the effect's callees also dereference
    // `lineage_head_receipt.registry_did` (which SELECTS the DID document the
    // receipt is checked against — a swapped DID with an unchanged signature is
    // a different verdict from identical-looking bytes), and every non-checkpoint
    // field of `log_inclusion` is a top-level sibling of the signed checkpoint
    // in precisely the sense that justifies the witness row. Keying the object
    // is both cheaper to reason about and strictly wider than the enumeration,
    // and it cannot drift as `verify.ts` grows: a field added there is covered
    // the day it is read.
    ctx.registry_receipt ?? null,
    ctx.lineage_head_receipt ?? null,
    inclusionRest,
    witnessDigest(inclusion),
    witnessKeySelection(inclusion),
  ]);
}

/**
 * Stand-in for a context whose body `JSON.stringify` refuses (a cycle, a
 * BigInt). `verificationKey` runs during RENDER, outside the effect's
 * try/catch, so an uncaught throw there blanks the page where the hook's
 * contract is a red verdict.
 *
 * Deliberately a plain function of the context's own identity fields: pure, no
 * module state, no dependence on object identity. An earlier version minted
 * ids from a module counter memoised in a `WeakMap`, which was both an impure
 * render-phase write — `react-hooks/globals` errors on `count = count + 1`
 * written in the render body, and moving it into a helper was the only reason
 * lint stayed quiet (the rule is spelling-sensitive: inline `count++` and an
 * inline `weakMap.set(…)` both pass, the latter belonging to
 * `react-hooks/immutability` instead) — and unobservable, since `useMemo`
 * already supplies the per-object stability it claimed to add.
 *
 * The tradeoff it accepts: two unserialisable contexts sharing a `ctx_id` and
 * `content_hash` collide, and the second would not re-verify. `JSON.parse`
 * cannot produce a cycle or a BigInt, so reaching this at all means something
 * in-process mutated the context after parsing — outside the threat model this
 * key addresses, and a blank page is the worse failure.
 */
function unserialisableKey(ctx: FullContext, requestedCtxId: string): string {
  // No `'<unserialisable>'` tag row: a 3-element array cannot collide with the
  // real key's 8 whatever it holds, so the tag changed no outcome — the same
  // inert row the rest of this file works to keep out.
  return JSON.stringify([
    ctx.body?.ctx_id ?? null,
    ctx.body?.content_hash ?? null,
    requestedCtxId,
  ]);
}

/**
 * @param requestedCtxId the ctx_id the CALLER independently asked for (a search
 * hit, a URL param, a graph node) — used only for the `ctxIdBinding` check.
 * Passing `ctx.body.ctx_id` back would make that check tautologically green.
 */
export function useContextVerdicts(ctx: FullContext, docs: DidDocMap, requestedCtxId: string): ContextVerdicts {
  const [state, setState] = useState<ContextVerdicts>({ ready: false });

  // Memoised because it serialises a registry-controlled body of unbounded
  // size, and a render is not always a fetch: without this it would re-run on
  // every parent re-render (a tab switch, a hover) rather than once per
  // response. `ctx` is a fresh identity per fetch, so the deps are exactly the
  // recompute cadence we want. It is also the one place `verificationKey` can
  // throw — a body React Query parsed but `JSON.stringify` refuses (a cycle,
  // a BigInt) would throw during RENDER, outside the effect's try/catch, and
  // take the page down; the hook's contract is a red verdict, never a blank
  // screen, so it degrades to a per-render-unique key instead.
  const key = useMemo(() => {
    try {
      return verificationKey(ctx, requestedCtxId);
    } catch {
      // Must be a FUNCTION of the inputs, like the real key. `Math.random()`
      // here — rejected by `react-hooks/purity` — would differ from its own
      // previous value, re-running the whole wasm suite on every memo miss for
      // as long as such a context stayed mounted.
      return unserialisableKey(ctx, requestedCtxId);
    }
  }, [ctx, requestedCtxId]);

  // The context pinned to the key currently being verified.
  //
  // The effect needs the real `ctx`, but `ctx` is a fresh object identity on
  // every fetch, so depending on it directly would re-run the whole wasm suite
  // on every poll — which is what the key exists to prevent. Pinning it in
  // state, updated in the same render-phase branch that resets the verdicts,
  // gives the effect a dependency whose identity changes exactly when the key
  // does. That is what lets the dep array be honest instead of suppressing
  // `exhaustive-deps` and closing over a `ctx` from a previous fetch — the
  // mechanism that made the stale verdicts possible in the first place.
  //
  // It does mean a `docs`-driven re-run verifies the `ctx` pinned at the last
  // KEY change rather than the current object. That is safe only because the
  // key covers everything the effect reads: an identical key guarantees the
  // pinned object and the current one agree on every verified field, so the
  // two would produce the same verdicts. It stops being safe the moment a
  // field is read without being keyed — one more reason the envelopes are
  // keyed whole rather than field by field.
  const [material, setMaterial] = useState({ key, ctx, requestedCtxId });
  if (material.key !== key) {
    setMaterial({ key, ctx, requestedCtxId });
    // Resetting to `ready: false` here is what makes the "permanent verifying…"
    // symptom resolve: the chips go back to "checking…" the moment the material
    // changes, and are refilled by the effect below.
    setState({ ready: false });
  }

  useEffect(() => {
    let cancelled = false;
    const { ctx, requestedCtxId } = material;

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

    // Unchanged, and deliberately so: an in-flight verification whose key has
    // since changed must not write its result into the newer state. The
    // rewrite above must not quietly drop this.
    return () => {
      cancelled = true;
    };
  }, [material, docs]);

  return state;
}
