// ══════════════════════════════════════════════════════════════════════
// What the operator actually SEES for each ctx_id-binding verdict.
//
// `verify.ts` can map a could-not-check to `unavailable` correctly and the
// console can still render it wrongly — the chip's default `unavailable` status
// word is "material only", copy written for the key-not-on-hand case, and the
// `VerdictCaption` that carries the distinguishing sentence used to be gated on
// `status === 'failed'` alone. Those two defects are invisible to every
// verdict-level test, so they are asserted here on the rendered DOM, with no
// hover and no focus: a `title` tooltip is invisible on touch, invisible to the
// keyboard, and unreliably announced by screen readers.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ContextVerdicts } from '@/lib/verify/use-verdicts';
import type { Verdict } from '@/lib/verify/verify';

const useContextVerdicts = vi.fn<(...args: unknown[]) => ContextVerdicts>();
vi.mock('@/lib/verify/use-verdicts', () => ({
  useContextVerdicts: (...args: unknown[]) => useContextVerdicts(...args),
}));

// Imported after the (hoisted) mock so the component binds to it.
import { ContextDetail } from '@/components/contexts/context-detail';
import { MOCK_CONTEXTS } from '@/lib/data/mock-data';

const CTX = MOCK_CONTEXTS[0];

/** A green baseline for every surface except the one under test. */
const ok = (detail: string): Verdict => ({ status: 'verified', detail });

function renderWith(ctxIdBinding: Verdict | undefined, extra: Partial<ContextVerdicts> = {}) {
  useContextVerdicts.mockReturnValue({
    ready: true,
    contentHash: ok('content_hash recomputed from the body and matches'),
    ctxIdBinding,
    producerSignature: ok('Ed25519 signature valid for the resolved producer key'),
    ...extra,
  });
  return render(<ContextDetail ctx={CTX} requestedCtxId={CTX.body.ctx_id} />);
}

const BODY_ARM: Verdict = {
  status: 'unavailable',
  detail: 'served body does not conform to the acdp-rs Body schema — ctx_id binding not checked',
  unavailableLabel: 'body not parseable',
};

const ID_ARM: Verdict = {
  status: 'unavailable',
  detail:
    'the requested ctx_id is not a canonical ACDP id — binding not checked; the served body was not the problem',
  unavailableLabel: 'requested id malformed',
};

afterEach(() => {
  cleanup();
  useContextVerdicts.mockReset();
});

describe('ContextDetail — ctx_id binding chip', () => {
  it('an `unavailable` binding renders neither an accusation nor "material only"', () => {
    const { container } = renderWith(BODY_ARM);
    const text = container.textContent ?? '';

    // The whole point of the phase: a check that could not run must not read as
    // a finding against the registry.
    expect(text).not.toContain('ctx_id binding · verification failed');
    // …and must not borrow the key-not-on-hand copy either.
    expect(text).not.toContain('ctx_id binding · material only');
    expect(screen.getByText('ctx_id binding · body not parseable')).toBeInTheDocument();
  });

  it('an `unavailable` binding still discloses its detail inline, not only on hover', () => {
    renderWith(BODY_ARM);
    // Rendered text content — asserted without hovering or focusing anything.
    expect(screen.getByText(BODY_ARM.detail)).toBeInTheDocument();
  });

  it('the two arms are told apart in the rendered DOM, not just in the verdict', () => {
    const bodyText = renderWith(BODY_ARM).container.textContent ?? '';
    expect(bodyText).toContain('ctx_id binding · body not parseable');
    expect(bodyText).toContain('served body');
    expect(bodyText).not.toContain('requested id malformed');
    cleanup();

    const idText = renderWith(ID_ARM).container.textContent ?? '';
    expect(idText).toContain('ctx_id binding · requested id malformed');
    expect(idText).toContain('the served body was not the problem');
    expect(idText).not.toContain('body not parseable');
  });

  it('a genuine substitution finding still renders red AND keeps its caption (unregressed)', () => {
    const failed: Verdict = {
      status: 'failed',
      detail: 'served body does not match the requested ctx_id: context substitution: requested X, registry served Y',
    };
    const { container } = renderWith(failed);
    expect(container.textContent).toContain('ctx_id binding · verification failed');
    expect(screen.getByText(failed.detail)).toBeInTheDocument();
  });

  it('the `unavailable` caption is amber, matching its chip — not the dim grey of a green one', () => {
    // This caption is the ONLY place the distinguishing sentence is readable
    // without hovering, so rendering it in the same colour a green verdict's
    // caption would use defeats the reason the gate was widened to show it.
    renderWith(BODY_ARM);
    expect(screen.getByText(BODY_ARM.detail)).toHaveStyle({ color: 'var(--warning)' });
    cleanup();

    const failed: Verdict = { status: 'failed', detail: 'served body does not match the requested ctx_id' };
    renderWith(failed);
    expect(screen.getByText(failed.detail)).toHaveStyle({ color: 'var(--danger)' });
  });

  it('a verified binding renders no caption at all', () => {
    const verdict = ok('served body is bound to the requested ctx_id');
    const { container } = renderWith(verdict);
    expect(container.textContent).toContain('ctx_id binding · verified');
    // The caption is the DISAMBIGUATION surface — there is nothing to
    // disambiguate on a green verdict, and adding one under every Integrity
    // chip regardless of status is what the gate exists to avoid.
    expect(screen.queryByText(verdict.detail)).not.toBeInTheDocument();
  });

  it('a wasm-init failure does not repeat its error under the Integrity chips', () => {
    // `verdicts.ready && verdicts.error` leaves every verdict `undefined`. The
    // widened caption gate keeps its `?.status &&` guard precisely so the
    // banner above the chips is not duplicated underneath them — a bare
    // `!== 'verified'` would render it a second time right here.
    //
    // Scoped to the Integrity group on purpose. The Registry-receipt,
    // lineage-head, transparency-log and witness groups each render an
    // *ungated* VerdictCaption (context-detail.tsx:397,:436,:479,:554), so the
    // error text does appear again further down the page. That is pre-existing
    // UI-2 behavior on other surfaces, unchanged by this phase and deliberately
    // not widened into here; asserting over the whole document would make this
    // test a claim about those surfaces instead of about the gate under test.
    const error = 'acdp-wasm is browser-only and cannot run during SSR';
    useContextVerdicts.mockReturnValue({ ready: true, error });
    const { container } = render(<ContextDetail ctx={CTX} requestedCtxId={CTX.body.ctx_id} />);

    const integrityGroup = screen.getByText('Integrity').parentElement;
    expect(integrityGroup).not.toBeNull();
    expect(integrityGroup!.textContent).not.toContain(error);
    // The chips themselves still say something honest, and the banner is the
    // one place the error text belongs.
    expect(integrityGroup!.textContent).toContain('ctx_id binding · unavailable');
    expect(container.textContent).toContain('Client-side verification unavailable');
  });
});

describe('ContextDetail — every other VerdictChip is unchanged', () => {
  it('an `unavailable` verdict with no label still reads "material only"', () => {
    // `unavailableLabel` is additive and optional; the default must be exactly
    // today's copy, or this phase silently restyles five other chips.
    renderWith(ok('served body is bound to the requested ctx_id'), {
      producerSignature: {
        status: 'unavailable',
        detail: 'producer DID document not fetched — signature not checked',
      },
    });
    expect(
      screen.getByText(`sig ${CTX.body.signature!.algorithm} · material only`),
    ).toBeInTheDocument();
  });

  it('a verdict that carries its own `unavailableLabel` is honoured by a chip that does not forward the prop', () => {
    // `unavailableLabel` lives on `Verdict`, so any producer can set it, but
    // only the ctx_id-binding chip passes the prop through. Without this
    // fallback a future producer setting it on another surface would have it
    // silently dropped — no type error, no failing test — and the chip would
    // claim a missing signer key it actually has.
    renderWith(ok('served body is bound to the requested ctx_id'), {
      producerSignature: {
        status: 'unavailable',
        detail: 'signature algorithm not supported by this verifier build',
        unavailableLabel: 'algorithm unsupported',
      },
    });
    expect(
      screen.getByText(`sig ${CTX.body.signature!.algorithm} · algorithm unsupported`),
    ).toBeInTheDocument();
    expect(screen.queryByText(`sig ${CTX.body.signature!.algorithm} · material only`)).not.toBeInTheDocument();
  });

  it('a chip that passes `label` renders the field-name prefix, not the new prop', () => {
    renderWith(ok('served body is bound to the requested ctx_id'));
    // `label` (field-name prefix) and `unavailableLabel` (status word) are
    // different axes — reusing `label` for the latter would have changed these.
    expect(screen.getByText('✓ content_hash · verified')).toBeInTheDocument();
    expect(screen.getByText('✓ ctx_id binding · verified')).toBeInTheDocument();
  });
});
