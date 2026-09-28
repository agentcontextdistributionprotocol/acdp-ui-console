import type { CSSProperties, ReactNode } from 'react';

/**
 * A horizontal scroll container for one wide table.
 *
 * ## Why a component and not a `className`
 *
 * `.table-scroll { overflow-x: auto }` alone would fix the visual defect and
 * leave a keyboard-only operator unable to reach the hidden columns. **Five of
 * the eleven tables in this repo have no focusable descendant at all** (agents,
 * the security JWKS table, the SDK matrix, recent runs, events), so there is
 * nothing to tab to that would scroll the container into view — a
 * scroll region reachable by nobody, which is WCAG 2.1.1. `tabIndex={0}` is the
 * fix, and it is the easiest thing in the world to forget at the eleventh call
 * site. A component makes omitting it impossible.
 *
 * ## Why `role="group"`
 *
 * Not a bare `<div tabIndex={0} aria-label=…>`: an element with no role maps to
 * ARIA's `generic`, which is **name-prohibited** in ARIA 1.2, so Chromium drops
 * the `aria-label` outright and the focusable container announces as nothing.
 * This repo has already been bitten by exactly that — see the `LiveMarker`
 * docblock in `components/config/sdk-matrix.tsx`, which is why that marker
 * carries `role="img"`.
 *
 * Not `role="region"` either. `region` is a landmark, and eleven new landmarks —
 * one per table, on pages that typically hold a single table — is noise in the
 * landmark list that costs more than it gives. `group` is the synthesis: naming
 * is permitted, and it is not a landmark.
 *
 * ## The accepted cost
 *
 * A table that does NOT overflow still gets a focusable container, so it adds a
 * tab stop that scrolls nothing. The alternative is measuring
 * `scrollWidth > clientWidth` and toggling `tabIndex`, which needs a
 * `ResizeObserver` and a re-measure on every data change — real complexity, and
 * it would make focusability depend on viewport width, so the same page would
 * be keyboard-navigable differently at different sizes. One inert tab stop per
 * table is the cheaper wrong thing, and a named group is useful to a screen
 * reader regardless of whether it scrolls.
 *
 * `label` is required rather than optional. An unnamed group is the state
 * `role="group"` was chosen to avoid.
 *
 * `style` exists for one real case rather than as a general escape hatch:
 * `run-trust-panel.tsx` carried a conditional `marginBottom` on its first
 * `<table>`, and a margin on a child of an `overflow` container behaves
 * differently once that child can be wider than the container — so it belongs on
 * the wrapper. Layout that positions the table within the page is the wrapper's
 * business now; anything about the table's own interior still goes on the table.
 */
export function TableScroll({
  label,
  style,
  children,
}: {
  label: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className="table-scroll" role="group" aria-label={label} tabIndex={0} style={style}>
      {children}
    </div>
  );
}
