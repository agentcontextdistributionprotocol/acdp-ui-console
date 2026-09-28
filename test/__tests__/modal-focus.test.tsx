// ══════════════════════════════════════════════════════════════════════
// `Modal`'s focus management, and the dependency that used to break it.
//
// The defect: `onClose` was a dependency of the effect that installs the
// keydown listener and moves focus into the dialog. Every caller passes an
// inline arrow, so its identity changes on EVERY render of the owning
// component — and each of those renders therefore tore the effect down and
// re-ran it. The teardown calls `previouslyFocused?.focus?.()`, which moves
// focus OUT of an open dialog; the re-run moves it to the dialog's FIRST
// focusable, which is the header "Close dialog" button.
//
// So a keyboard or screen-reader operator had focus yanked off whatever control
// they had tabbed to, on a dialog that was never re-opened.
//
// The effect's real dependency is `open`. `onClose` is read through a ref so
// Escape still calls the current callback.
//
// The trigger is the OWNER re-rendering, not the dialog re-rendering, and the
// difference matters enough that an earlier version of this header got it
// wrong: it reported four focus moves across a confirm click and its error
// arrival in the witness-ack dialog. That scenario records ZERO, with the bug
// and without — `onClose` there is minted by `LogWitnessAlerts`, and a mutation
// state change re-renders only the dialog, leaving the prop's identity
// untouched. The witness-ack case that DOES reproduce it is a worklist refetch,
// and it is pinned against the real component in `log-witness-alerts.test.tsx`
// rather than described here. What this file holds is the synthetic minimum:
// an owner that re-renders and nothing else.
// ══════════════════════════════════════════════════════════════════════
import { describe, expect, it, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { Modal } from '@/components/ui/modal';

afterEach(cleanup);

/**
 * Counts every focus change on the document, with the element that received it.
 *
 * A count alone would not distinguish "focus moved twice and came back" from
 * "focus never moved", so the elements are recorded too.
 */
function watchFocus(): { moves: string[] } {
  const moves: string[] = [];
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target as HTMLElement;
      moves.push(el.getAttribute('aria-label') ?? el.tagName.toLowerCase());
    },
    { capture: true },
  );
  return { moves };
}

/**
 * A dialog whose owner re-renders WITHOUT closing it, passing a fresh inline
 * arrow each time — which is what every call site in this repo does.
 */
function Harness() {
  const [, setTick] = useState(0);
  return (
    <>
      <button onClick={() => setTick((t) => t + 1)}>re-render</button>
      <Modal open onClose={() => {}} title="Test dialog" footer={<button>Footer action</button>}>
        <button>Body action</button>
      </Modal>
    </>
  );
}

describe('Modal — focus is not disturbed by the owner re-rendering', () => {
  it('a re-render that does not close the dialog moves focus not at all', async () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      // Let the mount-time focus land first; that move is legitimate.
      await act(async () => {
        vi.advanceTimersByTime(10);
      });

      // THE OPERATOR TABS AWAY FROM THE FIRST CONTROL, and this line is the
      // whole test. A first draft asserted from wherever mount-time focus
      // landed — which is the header "Close dialog" button, the very element
      // the broken effect re-focuses. Restoring the bug moved focus from
      // "Close dialog" to "Close dialog", fired no `focusin` at all, and the
      // test stayed green: it was pinned to the one position where the defect
      // is invisible. The harm was always to an operator who had moved ON from
      // the first focusable, so that is where this starts.
      const bodyAction = screen.getByText('Body action');
      bodyAction.focus();
      expect(document.activeElement).toBe(bodyAction);

      const watch = watchFocus();
      // Three re-renders of the OWNER, dialog still open throughout.
      for (let i = 0; i < 3; i++) {
        fireEvent.click(screen.getByText('re-render'));
        await act(async () => {
          vi.advanceTimersByTime(10);
        });
      }

      // With `onClose` in the dep list this records exactly:
      //
      //   ["Close dialog", "Body action", "Close dialog", "Body action", "Close dialog"]
      //
      // FIVE, not six. The count is written down because it was written down
      // wrong before — as six, "three teardown-restores and three re-focuses",
      // which is what the mechanism suggests rather than what the run produces.
      // The first teardown restores to `document.body`, and jsdom fires no
      // `focusin` for that, so the alternation starts one short. A guard's
      // comment that reports a number nobody measured is how the guard gets
      // trusted past what it actually shows.
      expect(watch.moves, `focus moved to: ${watch.moves.join(', ')}`).toEqual([]);
      // And it really is still where the operator put it.
      expect(document.activeElement).toBe(bodyAction);
    } finally {
      vi.useRealTimers();
    }
  });

  it('DISCRIMINATES: opening the dialog DOES move focus into it', async () => {
    // The half that stops the test above from passing on a Modal whose focus
    // management is simply gone. Mount-time focus is the behaviour being
    // preserved, not the one being removed.
    vi.useFakeTimers();
    try {
      const watch = watchFocus();
      render(<Harness />);
      await act(async () => {
        vi.advanceTimersByTime(10);
      });
      expect(watch.moves).toContain('Close dialog');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape still calls the CURRENT onClose after the owner re-renders', async () => {
    // The property the ref has to preserve. Reading `onClose` from a closure
    // captured at the last effect run would call a stale callback — which is
    // the bug the dependency array was there to avoid, and the reason it cannot
    // simply be deleted.
    const calls: number[] = [];
    function EscHarness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>re-render</button>
          <Modal open onClose={() => calls.push(tick)} title="Esc dialog">
            <span>body</span>
          </Modal>
        </>
      );
    }
    render(<EscHarness />);
    fireEvent.click(screen.getByText('re-render'));
    fireEvent.click(screen.getByText('re-render'));
    fireEvent.keyDown(window, { key: 'Escape' });
    // 2, not 0: the callback invoked is the one from the LATEST render.
    expect(calls).toEqual([2]);
  });
});
