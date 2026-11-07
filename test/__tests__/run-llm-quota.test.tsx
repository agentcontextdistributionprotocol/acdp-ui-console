// Public live mode, phase 2e: the "LLM quota reached: mock responses" badge.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { runLlmQuota, type LlmQuota } from '@/lib/utils/acdp';
import { RunSummary, llmQuotaChipText } from '@/components/runs/run-summary';
import { COMPLETED_RUN_ID, MOCK_RUNS, MOCK_RUN_EVENTS } from '@/lib/data/mock-data';
import { formatInstant } from '@/lib/utils/format';
import type { CpRun, StepEvent } from '@/lib/types';

afterEach(cleanup);

const RESET = '2026-11-08T00:00:00Z';
const WIRE = { quota: 'per_ip_daily', limit: 20, resets_at: RESET };
const ev = (e: Partial<StepEvent>): StepEvent => ({ type: 'run.started', run_id: 'r', ts: 't', ...e }) as StepEvent;
const QUOTA_EVENT = ev({ type: 'llm.quota_exceeded', llm_quota_exceeded: true, quota: 'global_daily', limit: 500, resets_at: RESET });
const COMPLETE_EVENT = ev({ type: 'run.complete', llm_quota_exceeded: true, llm_quota: { quota: 'per_ip_monthly', limit: 5, resets_at: RESET }, llm_calls_on_mock: 3 });

describe('runLlmQuota (criterion 1)', () => {
  it('CpRun.result.summary wins over everything', () => {
    const run = { result: { summary: { llm_quota_exceeded: true, llm_quota: WIRE, llm_calls_on_mock: 4 } } };
    expect(runLlmQuota(run, [QUOTA_EVENT, COMPLETE_EVENT], { llm_quota_exceeded: true, llm_quota: { quota: 'x', limit: 1, resets_at: null } })).toEqual({
      quota: 'per_ip_daily',
      limit: 20,
      resetsAt: RESET,
      callsOnMock: 4,
    });
  });

  it('then the replay summary', () => {
    expect(runLlmQuota({}, [QUOTA_EVENT], { llm_quota_exceeded: true, llm_quota: WIRE, llm_calls_on_mock: 1 })).toEqual({
      quota: 'per_ip_daily', limit: 20, resetsAt: RESET, callsOnMock: 1,
    });
  });

  it('then the latest run.complete', () => {
    expect(runLlmQuota({}, [QUOTA_EVENT, COMPLETE_EVENT])).toEqual({ quota: 'per_ip_monthly', limit: 5, resetsAt: RESET, callsOnMock: 3 });
  });

  it('then the llm.quota_exceeded event (mid-run)', () => {
    expect(runLlmQuota(null, [ev({ type: 'agent.started' }), QUOTA_EVENT])).toEqual({
      quota: 'global_daily', limit: 500, resetsAt: RESET, callsOnMock: undefined,
    });
  });

  it('null when nothing reports it', () => {
    expect(runLlmQuota(undefined)).toBeNull();
    expect(runLlmQuota({ result: { summary: { degraded: true } } }, [ev({ type: 'run.complete' })], {})).toBeNull();
    expect(runLlmQuota({ result: { summary: { llm_quota_exceeded: false, llm_quota: WIRE } } })).toBeNull();
  });

  it('a flagged summary with an unreadable denial is still reported', () => {
    expect(runLlmQuota({ result: { summary: { llm_quota_exceeded: true, llm_quota: 'garbage' } } })).toEqual({
      quota: 'unknown', limit: null, resetsAt: null,
    });
  });

  it('quota store unavailable: null limit and reset', () => {
    expect(runLlmQuota(null, [ev({ type: 'llm.quota_exceeded', quota: 'quota_store_unavailable', limit: null, resets_at: null })])).toEqual({
      quota: 'quota_store_unavailable', limit: null, resetsAt: null, callsOnMock: undefined,
    });
  });
});

describe('chip text', () => {
  const q = (o: Partial<LlmQuota>): LlmQuota => ({ quota: 'per_ip_daily', limit: 20, resetsAt: RESET, ...o });
  it('with a reset time', () => {
    expect(llmQuotaChipText(q({}))).toBe(`LLM quota reached: mock responses (resets ${formatInstant(RESET)})`);
  });
  it('quota store unavailable', () => {
    expect(llmQuotaChipText(q({ quota: 'quota_store_unavailable', resetsAt: null }))).toBe(
      'LLM quota reached: mock responses (quota store unavailable)',
    );
  });
  it('a malformed resets_at shows the raw value', () => {
    expect(llmQuotaChipText(q({ resetsAt: 'tomorrow-ish' }))).toBe('LLM quota reached: mock responses (resets tomorrow-ish)');
  });
  it('no reset time for another reason says so', () => {
    expect(llmQuotaChipText(q({ resetsAt: null }))).toBe('LLM quota reached: mock responses (reset time not reported)');
  });
});

const BASE_RUN: CpRun = {
  runId: 'run-x',
  tenantId: 'default',
  scenarioId: 's1',
  status: 'running',
  startedAt: new Date().toISOString(),
  completedAt: null,
  contextsCount: 0,
  registries: [],
} as unknown as CpRun;

function renderSummary(run: CpRun, events: StepEvent[] = []) {
  return render(
    <RunSummary run={run} scenarioName="S1" liveStatus="live" contextsCount={0} llmQuota={runLlmQuota(run, events)} />,
  );
}

describe('RunSummary renders the chip as text (criterion 2)', () => {
  it('a live run from the event alone', () => {
    renderSummary(BASE_RUN, [QUOTA_EVENT]);
    expect(screen.getByRole('status')).toHaveTextContent(`LLM quota reached: mock responses (resets ${formatInstant(RESET)})`);
  });

  it('a completed run from CpRun.result alone', () => {
    renderSummary({
      ...BASE_RUN,
      status: 'completed',
      completedAt: new Date().toISOString(),
      result: { summary: { llm_quota_exceeded: true, llm_quota: WIRE, llm_calls_on_mock: 2 } },
    } as CpRun);
    expect(screen.getByRole('status')).toHaveTextContent(
      `LLM quota reached: mock responses (resets ${formatInstant(RESET)}) · 2 calls on mock`,
    );
  });

  it('no chip without quota fields', () => {
    renderSummary(BASE_RUN, [ev({ type: 'run.complete' })]);
    expect(screen.queryByText(/LLM quota reached/)).toBeNull();
  });
});

describe('demo data (criterion 4)', () => {
  it('the demo completed run renders the chip from its result and its events', () => {
    const run = MOCK_RUNS.find((r) => r.runId === COMPLETED_RUN_ID)!;
    const events = MOCK_RUN_EVENTS[COMPLETED_RUN_ID];
    expect(runLlmQuota(run, events)).toEqual({ quota: 'per_ip_daily', limit: 20, resetsAt: RESET, callsOnMock: 1 });
    expect(runLlmQuota({}, events)).toEqual({ quota: 'per_ip_daily', limit: 20, resetsAt: RESET, callsOnMock: 1 });
    render(<RunSummary run={run} scenarioName="S1" liveStatus="complete" contextsCount={1} llmQuota={runLlmQuota(run, events)} />);
    expect(screen.getByText(/LLM quota reached: mock responses \(resets /)).toBeInTheDocument();
  });
});
