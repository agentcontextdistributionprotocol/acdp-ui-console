import { AlertTriangle } from 'lucide-react';
import { C } from '@/lib/colors';

const ROW = { padding: 20, display: 'flex', alignItems: 'center', gap: 10 } as const;

/**
 * `details` is the upstream's own bytes — the thing seventeen surfaces used to
 * render as their PRIMARY message via `String(error)`. It is worth keeping and
 * worth demoting, so it goes in a disclosure rather than in the sentence.
 *
 * A native `<details>`, not a `title` tooltip. `CLAUDE.md` forbids `title` for
 * anything load-bearing, and that prohibition is written about trust surfaces —
 * a raw error body is not a verdict, so it does not bind literally. Its reasons
 * do: invisible on touch, invisible to the keyboard, unreliably announced.
 * There is a repo-local reason too — `context-error-parity.test.tsx` records
 * that this component deliberately has no structural probe, so a `title` would
 * be untestable in this repo's established style. A `<summary>` is a button in
 * the accessibility tree and is in `textContent` for @testing-library without a
 * `toBeVisible` fight, and costs no JS.
 *
 * `JsonViewer` was rejected: it takes parsed data, and `ApiError.body` is
 * frequently not JSON at all (the WAF-HTML case is exactly why the diagnostic
 * is worth showing). A console-log-only companion is right as a *companion*,
 * but an operator reading a red panel on a deployed console is not necessarily
 * in devtools. `role="alert"` is deliberately NOT added: two
 * `context-detail.tsx` banners already carry it and a third would change what
 * `context-error-parity.test.tsx` can disambiguate.
 *
 * An empty string is treated as absent, and the no-`details` branch returns the
 * exact markup this component had before the prop existed — so every existing
 * call site renders byte-for-byte what it did.
 */
/**
 * The disclosure on its own, for the surfaces that are not `ErrorPanel`.
 *
 * Three sites render their error as inline text inside a modal or above a
 * table, where `ErrorPanel`'s card chrome (20px padding, a border, an icon)
 * would be out of place — but they need the upstream's own bytes reachable
 * just as much, and on the 403 arms they need it MORE: `ADMIN_ROUTE_FORBIDDEN`
 * deliberately refuses to diagnose and points at this disclosure by name.
 *
 * Extracted rather than copied so the bound (`max-height` + `overflow` on
 * `.error-detail > pre`) and the a11y shape stay in one place. Renders nothing
 * for an absent or empty diagnostic, so a caller can pass
 * `errorDiagnostic(err)` straight through.
 */
export function ErrorDetail({ details }: { details?: string }) {
  if (!details) return null;
  return (
    <details className="error-detail">
      <summary>Technical detail</summary>
      {/*
        The `<pre>` is a scroll container (`max-height` + `overflow: auto`), so
        without `tabIndex` a keyboard-only operator can open the disclosure and
        still not reach past its first 220px. Recent Chrome and Firefox make
        overflowing scrollers focusable on their own; WebKit does not.

        `role="group"` rather than a bare `tabIndex`: a `<pre>` maps to ARIA's
        `generic`, which is name-prohibited, so `aria-label` on it alone would
        be dropped by Chromium — the same trap `sdk-matrix.tsx` documents for
        `LiveMarker`. `group` permits a name and is not a landmark.

        A text child, so React escapes it. No dangerouslySetInnerHTML.
      */}
      <pre tabIndex={0} role="group" aria-label="Technical detail">
        {details}
      </pre>
    </details>
  );
}

export function ErrorPanel({ message, details }: { message: string; details?: string }) {
  const head = (
    <>
      <AlertTriangle size={18} color={C.danger} />
      <div style={{ fontSize: 12, color: C.muted }}>{message}</div>
    </>
  );

  if (!details) return <div className="card" style={ROW}>{head}</div>;

  return (
    <div className="card" style={{ ...ROW, flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{head}</div>
      <ErrorDetail details={details} />
    </div>
  );
}
