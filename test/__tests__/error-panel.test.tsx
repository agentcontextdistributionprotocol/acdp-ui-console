// ══════════════════════════════════════════════════════════════════════
// `ErrorPanel` grows a place to put the upstream's raw bytes.
//
// Seventeen surfaces rendered `String(error)` as their PRIMARY message, which
// showed an operator `ApiError: {"error":{"code":"schema_violation"}}` where a
// sentence belonged. Deleting the body outright would trade one problem for
// another — the upstream's own message is often the only thing that says what
// actually went wrong — so it is demoted into a disclosure instead.
//
// The disclosure is a native `<details>`, NOT a `title`. `CLAUDE.md` forbids a
// tooltip for anything load-bearing: invisible on touch, invisible to the
// keyboard, unreliably announced. This file asserts the absence of `[title]`
// directly so a future "simplify it to a tooltip" fails loudly.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorPanel } from '@/components/ui/error-panel';

describe('ErrorPanel', () => {
  it('renders just the message when there is no diagnostic', () => {
    const { container } = render(<ErrorPanel message="Could not load the run list." />);
    expect(screen.getByText('Could not load the run list.')).toBeInTheDocument();
    expect(container.querySelector('details')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('treats an empty-string diagnostic as absent', () => {
    // A disclosure that opens onto nothing is worse than no disclosure.
    const { container } = render(<ErrorPanel message="Could not load." details="" />);
    expect(container.querySelector('details')).toBeNull();
  });

  it('renders the diagnostic inside a details/summary when given one', () => {
    const details = '502 from control-plane /runs — {"error":{"code":"schema_violation"}}';
    const { container } = render(<ErrorPanel message="Could not load the run list." details={details} />);
    const el = container.querySelector('details');
    expect(el).not.toBeNull();
    expect(el!.querySelector('summary')!.textContent).toBe('Technical detail');
    expect(el!.querySelector('pre')!.textContent).toBe(details);
  });

  it('keeps the message as the primary text and the raw body out of it', () => {
    const raw = '{"error":{"code":"schema_violation","message":"bad"}}';
    const { container } = render(<ErrorPanel message="Could not load the run list." details={raw} />);
    // The pair: the sentence is present AND the raw bytes are not part of it.
    const primary = screen.getByText('Could not load the run list.');
    expect(primary.textContent).not.toContain('schema_violation');
    // …while still being reachable in the disclosure.
    expect(container.querySelector('details pre')!.textContent).toContain('schema_violation');
  });

  // The rule this component exists to respect.
  it('puts the diagnostic in NO title attribute', () => {
    const { container } = render(
      <ErrorPanel message="Could not load." details="502 from control-plane /runs — boom" />,
    );
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('exposes the summary as a focusable control', () => {
    const { container } = render(<ErrorPanel message="x" details="y" />);
    const summary = container.querySelector('summary')!;
    summary.focus();
    expect(document.activeElement).toBe(summary);
  });

  // jsdom performs no layout, so the bound on an untruncated body can only be
  // asserted structurally: the class carrying max-height/overflow-wrap is
  // applied, and the body is not silently cut short on the way in.
  it('does not truncate a long body, and scopes it to the bounded class', () => {
    const body = 'x'.repeat(40_000);
    const { container } = render(<ErrorPanel message="Could not load." details={body} />);
    expect(container.querySelector('details')!.className).toBe('error-detail');
    expect(container.querySelector('pre')!.textContent).toHaveLength(40_000);
  });

  // The no-details render must stay EXACTLY what it was before the prop
  // existed, because nineteen call sites pass no `details` and none of them
  // was touched. An extra wrapper div or a changed flex direction there is
  // invisible to every other assertion in this file — verification caught that
  // precise regression passing all eight of them.
  it('renders byte-identical markup to the pre-details component when given none', () => {
    const { container } = render(<ErrorPanel message="Could not load the run list." />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('card');
    // The original four declarations, in order, and nothing else.
    expect(root.getAttribute('style')).toBe(
      'padding: 20px; display: flex; align-items: center; gap: 10px;',
    );
    // Icon + message, as direct children — no intermediate wrapper.
    expect(root.children).toHaveLength(2);
    expect(root.children[0].tagName.toLowerCase()).toBe('svg');
    expect(root.children[1].textContent).toBe('Could not load the run list.');
  });

  // jsdom applies no stylesheets, so nothing else in this file would notice the
  // CSS being deleted — and that CSS is the ONLY bound on an untruncated body,
  // since the diagnostic is deliberately not character-capped. Read the
  // stylesheet directly, in the style `use-verdicts.test.ts` established.
  it('bounds the diagnostic in the stylesheet, since nothing bounds it in code', () => {
    const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');
    const rule = css.match(/\.error-detail > pre \{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    // Height is capped and the overflow is reachable…
    expect(rule).toMatch(/max-height:\s*\d+px/);
    expect(rule).toMatch(/overflow:\s*auto/);
    // …and one unbroken 40 000-character line cannot widen the card, which
    // would re-create the table-overflow defect inside the fix for this one.
    // `anywhere`, not `break-word`: only `anywhere` collapses min-content width.
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule).toMatch(/white-space:\s*pre-wrap/);
  });

  it('makes the scrollable body keyboard-reachable with a permitted name', () => {
    const { container } = render(<ErrorPanel message="x" details={'y'.repeat(5000)} />);
    const pre = container.querySelector('pre')!;
    expect(pre.getAttribute('tabindex')).toBe('0');
    // A bare <pre> maps to ARIA `generic`, which is name-prohibited — Chromium
    // drops `aria-label` there. A role that permits naming is required.
    expect(pre.getAttribute('role')).toBe('group');
    expect(pre.getAttribute('aria-label')).toBeTruthy();
  });

  it('escapes markup in the body rather than rendering it', () => {
    const { container } = render(
      <ErrorPanel message="Could not load." details={'<img src=x onerror="boom">'} />,
    );
    expect(container.querySelector('pre')!.querySelector('img')).toBeNull();
    expect(container.querySelector('pre')!.textContent).toContain('<img src=x');
  });
});
