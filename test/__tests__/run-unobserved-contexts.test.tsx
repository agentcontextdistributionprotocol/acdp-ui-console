// #197: the control plane's `contextsCount` and `/runs/:id/lineage` are built
// only from registry-forwarded events. In a stack whose registries forward no
// webhooks (acdp-playground's default `make up-full`), a run that published
// still reads 0 there, and the console rendered that 0, plus "No lineage yet",
// as a fact about the run. Owner decision: label it as "N contexts reported by
// the run; none observed via registry events", and never draw the
// self-reported list as a graph.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { CpRun, LineageGraph } from '@/lib/types';
import { reportedRunContexts, unobservedContextsLabel } from '@/lib/utils/run-contexts';

const lineageDagSpy = vi.fn();
vi.mock('@/components/runs/lineage-dag-lazy', () => ({
  LineageDag: (props: { graph: LineageGraph }) => {
    lineageDagSpy(props);
    return <div data-testid="lineage-dag">{props.graph.nodes.length} drawn nodes</div>;
  },
}));
vi.mock('@/components/runs/context-inspector', () => ({ ContextInspector: () => null }));
vi.mock('@/lib/hooks/use-live-run', () => ({
  useLiveRun: () => ({ events: [], status: 'complete', lineage: null }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { RunWorkbench } = await import('@/components/runs/run-workbench');
const { RunsTable } = await import('@/components/runs/runs-table');
const { RecentRunsTable } = await import('@/components/dashboard/recent-runs-table');

const REPORTED = [
  'acdp://registry-a.playground.local/11111111-1111-4111-8111-111111111111',
  'acdp://registry-b.playground.local/22222222-2222-4222-8222-222222222222',
];
const LABEL_2 = '2 contexts reported by the run; none observed via registry events';

function run(over: Partial<CpRun> = {}): CpRun {
  return {
    runId: 'run-197',
    tenantId: 'default',
    scenarioId: 's5_cross_registry',
    status: 'completed',
    startedAt: '2026-11-07T16:41:29.886Z',
    completedAt: '2026-11-07T16:41:29.971Z',
    contextsCount: 0,
    registries: [],
    result: { contexts: REPORTED },
    ...over,
  };
}

const EMPTY: LineageGraph = { nodes: [], edges: [] };
const OBSERVED: LineageGraph = {
  nodes: [
    {
      ctx_id: REPORTED[0],
      agent_id: 'did:key:z6Mk',
      title: 'observed',
      context_type: 'data_snapshot',
      registry_authority: 'registry-a.playground.local',
      step: 1,
    },
  ],
  edges: [],
};

afterEach(() => {
  cleanup();
  lineageDagSpy.mockClear();
});

describe('unobservedContextsLabel', () => {
  it('labels an unobserved run that reported contexts, with singular grammar for one', () => {
    expect(unobservedContextsLabel(0, run())).toBe(LABEL_2);
    expect(unobservedContextsLabel(0, run({ result: { contexts: [REPORTED[0]] } }))).toBe(
      '1 context reported by the run; none observed via registry events',
    );
  });

  it('is null whenever something was observed: the observed figure stands', () => {
    expect(unobservedContextsLabel(1, run())).toBeNull();
  });

  it('is null when the run reported nothing, so a genuine 0 still reads 0', () => {
    expect(unobservedContextsLabel(0, run({ result: null }))).toBeNull();
    expect(unobservedContextsLabel(0, run({ result: undefined }))).toBeNull();
    expect(unobservedContextsLabel(0, run({ result: { contexts: [] } }))).toBeNull();
  });

  it('ignores a malformed report rather than counting it', () => {
    expect(reportedRunContexts(run({ result: { contexts: 'acdp://x/y' } }))).toEqual([]);
    expect(reportedRunContexts(run({ result: { contexts: [42, '', null, REPORTED[0]] } }))).toEqual([REPORTED[0]]);
  });
});

describe('RunWorkbench', () => {
  it('replaces "0 contexts" and "No lineage yet" with the label, and draws no graph', () => {
    render(<RunWorkbench run={run()} scenarioName="Cross Registry" fallbackLineage={EMPTY} />);
    expect(screen.getAllByText(LABEL_2)).toHaveLength(2); // summary + DAG panel
    expect(screen.queryByText(/^0 contexts$/)).toBeNull();
    expect(screen.queryByText(/0 contexts · 0 edges/)).toBeNull();
    expect(screen.queryByText('No lineage yet')).toBeNull();
    // Owner decision: the self-reported list is never drawn as lineage.
    expect(screen.queryByTestId('lineage-dag')).toBeNull();
    expect(lineageDagSpy).not.toHaveBeenCalled();
  });

  it('an observed graph renders exactly as before, with no label', () => {
    render(<RunWorkbench run={run()} scenarioName="Cross Registry" fallbackLineage={OBSERVED} />);
    expect(screen.queryByText(LABEL_2)).toBeNull();
    expect(screen.getByText('1 context')).toBeInTheDocument();
    expect(screen.getByTestId('lineage-dag')).toHaveTextContent('1 drawn nodes');
  });

  it('a run that reported nothing keeps its honest 0 and the ordinary empty graph', () => {
    render(<RunWorkbench run={run({ result: null })} scenarioName="Cross Registry" fallbackLineage={EMPTY} />);
    expect(screen.getByText('0 contexts')).toBeInTheDocument();
    expect(screen.getByTestId('lineage-dag')).toHaveTextContent('0 drawn nodes');
  });
});

describe.each([
  ['RunsTable (/runs)', RunsTable],
  ['RecentRunsTable (dashboard)', RecentRunsTable],
])('%s contexts column', (_name, Table) => {
  const colIndex = (container: HTMLElement) =>
    [...container.querySelectorAll('thead th')].findIndex((th) => th.textContent === 'Contexts');

  it('shows the label instead of 0 for a reported-but-unobserved run', () => {
    const { container } = render(<Table runs={[run()]} scenarioName={(id) => id} />);
    const td = container.querySelectorAll('tbody tr td')[colIndex(container)];
    expect(td.textContent).toBe(LABEL_2);
  });

  it('keeps the observed count, and a genuine 0', () => {
    const { container } = render(
      <Table runs={[run({ contextsCount: 3 }), run({ runId: 'run-0', result: null })]} scenarioName={(id) => id} />,
    );
    const i = colIndex(container);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].querySelectorAll('td')[i].textContent).toBe('3');
    expect(rows[1].querySelectorAll('td')[i].textContent).toBe('0');
  });
});
