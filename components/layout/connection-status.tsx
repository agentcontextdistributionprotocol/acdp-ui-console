'use client';

import { useHealth } from '@/lib/hooks/use-health';
import type { ProxyService } from '@/lib/types';

export function ConnectionStatus({ label, service }: { label: string; service: ProxyService }) {
  const view = useHealth(service);
  const ok = view.kind === 'healthy';
  // A red dot during the FIRST probe was the smaller half of the same defect as
  // the tooltip: `ok = data?.ok ?? false` made "no answer yet" and "answered
  // badly" render identically, so every page load flashed four failures. `warn`
  // is the honest third state, and it is the only one of the three that is not
  // a verdict.
  const dot = ok ? 'ok pulse' : view.kind === 'checking' ? 'warn' : 'err';
  return (
    // No `title`. The pill used to carry `${label}: ${state}` there and NOTHING
    // else — so `degraded` versus `unreachable`, the one distinction this pill
    // exists to draw, was invisible on touch, unreachable by keyboard, and
    // announced inconsistently by screen readers. `CLAUDE.md` forbids exactly
    // this for a trust surface; the repo's own test file was asserting on the
    // tooltip, which is how it survived.
    <div className={`pill${ok ? ' active-pill' : ''}`}>
      <span className={`dot ${dot}`} />
      {label}
      {/* Only when it is NOT healthy, and this is a measurement rather than a
          preference. The topbar is tight at phone width: `--sidebar-w` drops to
          56px at ≤760px and `.topbar` takes 20px of padding each side plus a
          12px gap, leaving ~292px, and the four labels plus the refresh button
          already fill it. (This commit also gives `.topbar-pills` a
          `flex-wrap`, so the row can spill onto a second line rather than
          overlapping the content below it — but wrapping every pill by default
          is a worse answer than not printing a word nobody needs.) A word on all four does not fit; a
          word on the ones that are failing does — and the
          healthy state already has an unambiguous visual (`active-pill` plus a
          pulsing green dot), so the word would add ink and no information.

          `checking…` DOES render, for the same reason `health-checks.tsx` shows
          it: a claim about reachability that cannot yet be made must not be
          made, and a silent grey pill during the first probe looks like a
          verdict. */}
      {!ok && (
        <span className={`pill-detail${view.kind === 'failing' ? ' bad' : ''}`}>{view.word}</span>
      )}
    </div>
  );
}
