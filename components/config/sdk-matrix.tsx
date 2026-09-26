'use client';

import type { CSSProperties } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { pingHealth } from '@/lib/api/client';
import { usePreferencesStore } from '@/lib/stores/preferences-store';
import { SDK_MATRIX_ROW_SERVICE, buildSdkMatrixRows } from '@/lib/utils/sdk-matrix';
import { C } from '@/lib/colors';

/**
 * The one marker meaning "this version was read from the service itself".
 *
 * A component, not two copies of a span, because the table cell and the legend
 * below it must render the SAME thing — a legend whose exemplar has drifted
 * from the marker it explains is worse than no legend, and nothing else would
 * catch that drift.
 *
 * `role="img"` is load-bearing, not decoration. A bare `<span>` maps to ARIA's
 * `generic` role, which is name-prohibited in ARIA 1.2 — Chromium DROPS an
 * `aria-label` there and axe flags it as `aria-prohibited-attr`, so the marker
 * would have had no reliable accessible name at all. `img` permits naming, so
 * the whole chip announces as one unit with the sentence below. The visible
 * `✓ live` text stays regardless, so the meaning never rests on colour alone.
 */
const LIVE_MARKER_LABEL = 'live: confirmed against the running service';

function LiveMarker({ style }: { style?: CSSProperties }) {
  return (
    <span className="chip live" role="img" aria-label={LIVE_MARKER_LABEL} style={style}>
      ✓ live
    </span>
  );
}

export function SdkMatrix() {
  const demoMode = usePreferencesStore((s) => s.demoMode);
  const services = Object.values(SDK_MATRIX_ROW_SERVICE);

  const healths = useQueries({
    queries: services.map((service) => ({
      queryKey: ['health', service, demoMode],
      queryFn: () => pingHealth(service, demoMode),
      refetchInterval: 20_000,
      retry: false,
    })),
  });
  const healthByService = new Map(services.map((s, i) => [s, healths[i].data]));
  const rows = buildSdkMatrixRows(demoMode, healthByService);

  return (
    <Card>
      <CardHeader title="SDK Matrix" sub={demoMode ? 'demo' : 'live status'} />
      <table className="data-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Version</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.component}>
              <td>{row.component}</td>
              <td className="did">
                {/* Polarity is inverted from the original: the MARKER goes on
                    the live-verified version, not on the reference one. After
                    Phase 8 the table is mostly reference in every mode, so
                    marking the common case put ink on almost every row and
                    said nothing; the rare, notable state is the one worth
                    pointing at.

                    No `title`. It was invisible on touch, invisible to
                    keyboard focus, and inconsistently announced — so the
                    explanation was unreachable for most of the people who
                    needed it. The legend below the table carries it instead:
                    the meaning is identical for every marked row, so a legend
                    states it once, in the reading order, with no interaction. */}
                {row.version}
                {row.versionIsLive && <LiveMarker style={{ marginLeft: 6 }} />}
              </td>
              <td>
                {row.status === 'reference' ? (
                  <Badge variant="neutral">◇ reference</Badge>
                ) : row.status === 'unknown' ? (
                  <Badge variant="neutral">— unknown</Badge>
                ) : row.status === 'ok' ? (
                  <Badge variant="complete">● ok</Badge>
                ) : (
                  <Badge variant="failed">✗ down</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Reads correctly with zero marked rows, which is the demo steady state
          after Phase 8 and also real mode with every service still loading —
          it describes what the marker means, not that any row has one. */}
      <p style={{ margin: '10px 12px 12px', fontSize: 11, color: C.muted }}>
        <LiveMarker style={{ marginRight: 6 }} />
        marks a version read from that service&rsquo;s own <code>/healthz</code> on the last check.
        Unmarked versions are reference data from this console, not confirmed against anything running.
      </p>
    </Card>
  );
}
