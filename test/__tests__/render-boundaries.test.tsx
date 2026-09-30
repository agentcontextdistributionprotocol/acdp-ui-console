import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ErrorPage from '@/app/error';
import GlobalErrorPage from '@/app/global-error';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ApiError } from '@/lib/api/fetcher';

// ══════════════════════════════════════════════════════════════════════
// #116: `app/error.tsx`, `app/global-error.tsx` and `ErrorBoundary` used to
// render `error.message` directly, which for an `ApiError` IS the raw
// upstream body — the exact over-claim `lib/utils/api-error-messages.ts`
// exists to keep off a primary sentence everywhere else in this console.
// These three render-crash surfaces were the one place it still leaked
// through, untested, because nothing here reaches them via React Query
// (`throwOnError`: zero hits) — the reachable case is a genuine render
// `TypeError`, which `errorDiagnostic` alone would have deleted outright
// rather than demoted.
// ══════════════════════════════════════════════════════════════════════

type CrashError = Error & { digest?: string };

function upstreamError(): ApiError {
  return new ApiError(502, '{"error":{"code":"schema_violation"}}', 'control-plane', '/runs');
}

/** Splits a rendered container into its primary text and its disclosure's
 *  text, mirroring `error-copy-sweep.test.tsx`'s `readPanel` — so "the body
 *  moved to a disclosure" and "the body vanished" can never pass the same
 *  assertion. */
function readPanel(container: HTMLElement): { primary: string; diagnostic: string } {
  const det = container.querySelector('details.error-detail');
  const diagnostic = det?.textContent ?? '';
  det?.remove();
  return { primary: container.textContent ?? '', diagnostic };
}

/** A component that always throws, so `ErrorBoundary` has something to catch. */
function Boom({ error }: { error: Error }): never {
  throw error;
}

describe('app/error.tsx', () => {
  it('keeps an ApiError body out of the primary text and discloses it separately', () => {
    const { container } = render(<ErrorPage error={upstreamError() as CrashError} reset={() => {}} />);
    const { primary, diagnostic } = readPanel(container);

    expect(primary).toContain('Something went wrong');
    expect(primary).not.toContain('schema_violation');

    expect(diagnostic).toContain('502 from control-plane /runs');
    expect(diagnostic).toContain('schema_violation');
  });

  it("discloses a TypeError's own message; the primary stays the fixed lead", () => {
    const err = new TypeError('Cannot read properties of undefined') as CrashError;
    const { container } = render(<ErrorPage error={err} reset={() => {}} />);
    const { primary, diagnostic } = readPanel(container);

    expect(primary).toContain('Something went wrong');
    expect(diagnostic).toContain('TypeError: Cannot read properties');
  });

  it('calls reset on click', () => {
    const reset = vi.fn();
    render(<ErrorPage error={new TypeError('x') as CrashError} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('renders no title attribute — a disclosure, not a tooltip', () => {
    const { container } = render(<ErrorPage error={upstreamError() as CrashError} reset={() => {}} />);
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });
});

describe('app/global-error.tsx', () => {
  it('never renders a details disclosure, and keeps the upstream body out of textContent', () => {
    const { container } = render(<GlobalErrorPage error={upstreamError() as CrashError} reset={() => {}} />);
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent ?? '').not.toContain('schema_violation');
  });

  it("shows Next's digest when one is given", () => {
    const err = Object.assign(new TypeError('x'), { digest: 'abc123' }) as CrashError;
    const { container } = render(<GlobalErrorPage error={err} reset={() => {}} />);
    expect(container.textContent ?? '').toContain('abc123');
  });

  it('calls reset on click', () => {
    const reset = vi.fn();
    render(<GlobalErrorPage error={new TypeError('x') as CrashError} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBoundary', () => {
  it('keeps an ApiError body out of the primary text and discloses it separately', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Boom error={upstreamError()} />
      </ErrorBoundary>,
    );
    const { primary, diagnostic } = readPanel(container);

    expect(primary).toContain('Component failed to render');
    expect(primary).not.toContain('schema_violation');

    expect(diagnostic).toContain('502 from control-plane /runs');
    expect(diagnostic).toContain('schema_violation');
    spy.mockRestore();
  });

  it('renders no reset button and no title attribute — recorded, not fixed, this phase', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Boom error={new TypeError('Cannot read properties of undefined')} />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
    spy.mockRestore();
  });
});
