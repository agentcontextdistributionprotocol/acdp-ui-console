'use client';

import dynamic from 'next/dynamic';

/**
 * Lazy wrapper around the React Flow lineage graph. @xyflow/react is heavy and
 * only needed on the run workbench and lineage pages, so keep it out of the
 * initial bundle and render it client-side only.
 */
export const LineageDag = dynamic(() => import('./lineage-dag').then((m) => m.LineageDag), {
  ssr: false,
  loading: () => (
    <div
      style={{
        flex: 1,
        minHeight: 240,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--faint)',
        fontSize: 12,
        background: 'var(--panel-2)',
      }}
    >
      Loading graph…
    </div>
  ),
});
