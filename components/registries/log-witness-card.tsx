'use client';

import { ScrollText } from 'lucide-react';
import { ErrorPanel } from '@/components/ui/error-panel';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ApiError } from '@/lib/api/fetcher';
import { useLogWitness } from '@/lib/hooks/use-security';
import { C } from '@/lib/colors';
import { formatNumber, shortId, timeAgo } from '@/lib/utils/format';
import type { ReactNode } from 'react';
import type { LogWitnessCheckpoint, LogWitnessAlert } from '@/lib/types';

/**
 * "We counted", as distinct from "we never counted".
 *
 * This is the single most important line in the file. The control plane writes
 * SQL `NULL` to every quorum column when `WITNESS_QUORUM_ENABLED=false`, and an
 * older deployment omits them entirely — so absence means *quorum consumption
 * is switched off*, while `0` means *we ran the count and no trusted witness
 * attested this head*, which is the alarming case an operator most needs to
 * see. `x ?? 0` and `if (x)` both erase exactly that distinction, in the
 * direction that hides a real failure behind a reassuring blank. Hence a
 * `typeof` test, everywhere, with no shorthand. (The cursor's
 * `lastWitnessedSize` gets the same treatment for the same reason: a log with
 * a witnessed head of size 0 is a fact, not a blank.)
 */
function counted(x: number | null | undefined): x is number {
  return typeof x === 'number';
}

/** The boolean half of the same rule — `false` is a verdict, absence is not. */
function decided(x: boolean | null | undefined): x is boolean {
  return typeof x === 'boolean';
}

/**
 * Whether quorum consumption produced anything for this head at all.
 *
 * Upstream writes the five columns as a unit (all set, or all NULL), but each
 * figure below is independently gated anyway, so a partially-populated row from
 * some future shape degrades field by field instead of rendering a half-truth.
 *
 * This is NOT redundant with those inner gates: its false branch renders the
 * explicit "not reported" line. Silently dropping four rows and saying nothing
 * looks identical to a rendering bug from the operator's side — "where did the
 * numbers go?" deserves an answer, and the honest answer is that this head was
 * never counted. The wording stays at "not reported" rather than "disabled"
 * because absence cannot distinguish `WITNESS_QUORUM_ENABLED=false` from a
 * control plane too old to have the columns at all.
 */
function hasQuorumData(cp: LogWitnessCheckpoint): boolean {
  return (
    counted(cp.witnessedCount) ||
    counted(cp.freshWitnessedCount) ||
    counted(cp.historicalWitnessedCount) ||
    decided(cp.meetsQuorum) ||
    decided(cp.meetsFreshQuorum)
  );
}

/**
 * The fresh-quorum verdict — tone AND wording, together and deliberately.
 *
 * `meetsFreshQuorum: false` while `meetsQuorum: true` means the cosignatures
 * verify but are older than the staleness window. Upstream
 * (`checkpoint-witness.service.ts`) calls that a SOFT liveness signal and
 * "never a failure", so it must not read as a failure — but tone alone cannot
 * carry that: amber and red would render the identical string `not met`,
 * leaving the distinction visible only to a sighted user with colour vision and
 * invisible to a screen reader, greyscale, or a printout. So the two cases get
 * different words as well as different colours, and `meetsQuorum` is rendered
 * as its own row rather than existing solely as an input to a CSS class.
 */
function freshQuorumVerdict(cp: LogWitnessCheckpoint): { tone: 'ok' | 'warn' | 'bad'; label: string } {
  if (cp.meetsFreshQuorum === true) return { tone: 'ok', label: 'met' };
  // "stale", not "met, but …": the first word of a value must not invert the
  // field it renders, and `meetsFreshQuorum` is `false` here. Staleness IS the
  // reason it is false — §8.1 splits the fresh count out of a `witnessedCount`
  // that still passed — and the "Standing quorum" row directly below carries
  // the other half of the picture.
  if (cp.meetsQuorum === true) return { tone: 'warn', label: 'stale' };
  return { tone: 'bad', label: 'not met' };
}

/**
 * Every upstream `raiseAlert` call site puts the human-readable message in
 * `detail.error`; the rest of the jsonb blob is not a stable contract. It is an
 * object, not a string — `String(detail)` would render `[object Object]`.
 */
function alertMessage(alert: LogWitnessAlert): string | undefined {
  const error = alert.detail?.error;
  return typeof error === 'string' ? error : undefined;
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="metric-row">
      <span className="metric-name">{name}</span>
      <span style={{ color: C.text, fontSize: 11, textAlign: 'right' }}>{children}</span>
    </div>
  );
}

/**
 * Transparency-log witness state for one registry authority (RFC-ACDP-0012).
 *
 * Renders **nothing** on a 404: the control plane raises REGISTRY_NOT_FOUND
 * when it has neither a cursor nor a checkpoint for the authority, which means
 * "never witnessed", not "broken". An empty card would imply a missing answer
 * where there is simply no question yet.
 *
 * Any other non-2xx gets a deliberately generic panel. In particular it must
 * NOT reuse the revocation feed's "grant the key admin scope" copy: unlike
 * `/auth/revocations`, this endpoint carries no admin guard upstream
 * (`registries.controller.ts`), so that message would send an operator to fix
 * something that was never the cause.
 */
export function LogWitnessCard({ authority }: { authority: string }) {
  const witness = useLogWitness(authority);
  const notFound = witness.error instanceof ApiError && witness.error.status === 404;
  if (notFound) return null;

  const state = witness.data;
  const cp = state?.checkpoints[0];
  const alerted = state?.alert.alerted === true;

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScrollText size={14} color={C.muted} />
          <h2>{authority}</h2>
        </div>
        {alerted && <span className="chip bad">⚠ alert</span>}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {witness.isLoading && <LoadingSkeleton rows={3} height={28} />}
        {witness.error && !notFound && (
          <ErrorPanel message={`Could not load transparency-log witness state for ${authority}.`} />
        )}

        {state && (
          <>
            {alerted && (
              <div
                style={{
                  border: `1px solid ${C.danger}`,
                  borderRadius: 8,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: C.text,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="chip bad">{state.alert.reason ?? 'alert'}</span>
                  <span style={{ color: C.muted }}>{timeAgo(state.alert.at)}</span>
                </div>
                {alertMessage(state.alert) && (
                  <div style={{ color: C.muted }}>{alertMessage(state.alert)}</div>
                )}
              </div>
            )}

            <Row name="Log ID">
              <span className="did">{state.logId ?? '—'}</span>
            </Row>
            <Row name="Last witnessed head">
              {counted(state.lastWitnessedSize) ? formatNumber(state.lastWitnessedSize) : '—'}
            </Row>
            <Row name="Last root">
              <span className="did">{state.lastRootHash ? shortId(state.lastRootHash, 14, 6) : '—'}</span>
            </Row>
            <Row name="Last success">
              <span style={{ color: C.muted }}>{timeAgo(state.lastSuccessAt)}</span>
            </Row>
            {state.consecutiveFailures > 0 && (
              <Row name="Consecutive failures">
                <span className="chip warn">{state.consecutiveFailures}</span>
              </Row>
            )}

            {!cp && (
              <div style={{ fontSize: 11, color: C.muted, paddingTop: 4 }}>
                No checkpoint retained yet.
              </div>
            )}

            {cp && (
              <>
                <Row name="Checkpoint tree size">{formatNumber(cp.treeSize)}</Row>
                <Row name="Witnessed">
                  <span style={{ color: C.muted }}>{timeAgo(cp.witnessedAt)}</span>
                </Row>
                <Row name="Checkpoint signature">
                  <span className={cp.signatureValid ? 'chip ok' : 'chip bad'}>
                    {cp.signatureValid ? 'valid' : 'invalid'}
                  </span>
                </Row>
                {decided(cp.consistencyOk) && (
                  <Row name="Consistency">
                    <span className={cp.consistencyOk ? 'chip ok' : 'chip bad'}>
                      {cp.consistencyOk ? 'proven' : 'failed'}
                    </span>
                  </Row>
                )}

                {/*
                  The quorum half. Replaced wholesale by a "not reported" line
                  when quorum consumption produced nothing for this head —
                  never rendered as `0 witnesses`, which would assert a check
                  that was never run.
                */}
                {!hasQuorumData(cp) && (
                  <div style={{ fontSize: 11, color: C.muted, paddingTop: 4 }}>
                    Cosignature quorum not reported for this head.
                  </div>
                )}
                {hasQuorumData(cp) && (
                  <>
                    {decided(cp.meetsFreshQuorum) && (
                      <Row name="Fresh quorum">
                        <span className={`chip ${freshQuorumVerdict(cp).tone}`}>
                          {freshQuorumVerdict(cp).label}
                        </span>
                      </Row>
                    )}
                    {/*
                      Rendered as text, not only consumed as a colour input by
                      `freshQuorumVerdict` — otherwise the difference between a
                      stale pass and a real failure exists nowhere a screen
                      reader can reach it.
                    */}
                    {decided(cp.meetsQuorum) && (
                      <Row name="Standing quorum">
                        <span className={cp.meetsQuorum ? 'chip ok' : 'chip bad'}>
                          {cp.meetsQuorum ? 'met' : 'not met'}
                        </span>
                      </Row>
                    )}
                    {counted(cp.freshWitnessedCount) && (
                      <Row name="Fresh witnesses">{cp.freshWitnessedCount}</Row>
                    )}
                    {counted(cp.witnessedCount) && (
                      <Row name="Witnesses (incl. stale)">{cp.witnessedCount}</Row>
                    )}
                    {/*
                      Kept visually and semantically apart from the counts
                      above, and never added to them: upstream warns this
                      sub-count is orthogonal to `witnessedCount`/`meetsQuorum`
                      AND to two similarly named fields in other RFCs. It is an
                      observation about witness key lifecycle, never a pass.
                    */}
                    {counted(cp.historicalWitnessedCount) && (
                      <Row name="Under retired keys">
                        <span style={{ color: C.muted }}>{cp.historicalWitnessedCount}</span>
                      </Row>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
