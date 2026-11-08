import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createQueryClient } from '@/components/providers';
import { isAnonymousVisitor } from '@/lib/hooks/use-console-session';

// A signed-out public-mode visitor is refused every admin route by the console
// itself (403 CONSOLE_OPERATOR_SESSION_REQUIRED). The operator-only sections
// must therefore neither fetch nor offer their controls to that visitor, and
// must behave exactly as before for a signed-in operator.

const session = vi.fn(async () => ({ publicMode: true, signedIn: false }));
const listEnrollments = vi.fn(async () => [] as unknown[]);
const listWebhooks = vi.fn(async () => [] as unknown[]);
const getCpMetrics = vi.fn(async () => [] as unknown[]);
const listLogWitnessAlerts = vi.fn(async () => ({
  data: [
    {
      authority: 'registry-c.playground.local',
      logId: null,
      lastWitnessedSize: 100,
      lastRootHash: null,
      reason: 'root_mismatch',
      detail: null,
      at: '2026-09-27T10:00:00.000Z',
      acknowledgedAt: null,
      acknowledgedBy: null,
      consecutiveFailures: 0,
    },
  ],
  total: 1,
}));

vi.mock('@/lib/api/client', () => ({
  getConsoleSession: () => session(),
  listEnrollments: () => listEnrollments(),
  enrollRegistry: vi.fn(),
  listWebhooks: () => listWebhooks(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  getCpMetrics: () => getCpMetrics(),
  listLogWitnessAlerts: () => listLogWitnessAlerts(),
  acknowledgeLogWitnessAlert: vi.fn(),
}));

vi.mock('@/lib/stores/preferences-store', () => ({
  usePreferencesStore: (sel: (s: { demoMode: boolean }) => unknown) => sel({ demoMode: false }),
}));

const { Enrollments } = await import('@/components/registries/enrollments');
const { WebhookConfig } = await import('@/components/config/webhook-config');
const { MetricsPanel } = await import('@/components/observability/metrics-panel');
const { LogWitnessAlerts } = await import('@/components/registries/log-witness-alerts');

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={createQueryClient()}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.clearAllMocks();
  session.mockImplementation(async () => ({ publicMode: true, signedIn: false }));
});

describe('isAnonymousVisitor', () => {
  it('is true only for a signed-out public-mode visitor', () => {
    expect(isAnonymousVisitor({ publicMode: true, signedIn: false })).toBe(true);
    expect(isAnonymousVisitor({ publicMode: true, signedIn: true })).toBe(false);
    expect(isAnonymousVisitor({ publicMode: false, signedIn: false })).toBe(false);
    expect(isAnonymousVisitor({ publicMode: false, signedIn: true })).toBe(false);
    expect(isAnonymousVisitor(undefined)).toBe(false);
  });
});

describe('operator-only sections, signed-out public-mode visitor', () => {
  it('enrollments: notice, no Enroll button, no fetch', async () => {
    wrap(<Enrollments />);
    await screen.findByText('Registry enrollments are operator-only');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(screen.queryAllByRole('button', { name: /Enroll/ })).toHaveLength(0);
    expect(listEnrollments).not.toHaveBeenCalled();
  });

  it('webhooks: notice, no Add button, no fetch', async () => {
    wrap(<WebhookConfig />);
    await screen.findByText('Outbound webhooks are operator-only');
    expect(screen.queryAllByRole('button', { name: /Add/ })).toHaveLength(0);
    expect(listWebhooks).not.toHaveBeenCalled();
  });

  it('metrics: notice, no fetch', async () => {
    wrap(<MetricsPanel />);
    await screen.findByText('Control-plane metrics are operator-only');
    expect(getCpMetrics).not.toHaveBeenCalled();
  });

  it('witness alerts: the public worklist still lists, but there is no Acknowledge button', async () => {
    wrap(<LogWitnessAlerts />);
    await screen.findByText('Sign in to acknowledge');
    expect(screen.getByText('registry-c.playground.local')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Re-)?acknowledge registry/i })).toBeNull();
  });
});

describe('operator-only sections, signed-in operator', () => {
  it('fetches and offers the controls as before', async () => {
    session.mockImplementation(async () => ({ publicMode: true, signedIn: true }));
    wrap(
      <>
        <Enrollments />
        <WebhookConfig />
        <MetricsPanel />
        <LogWitnessAlerts />
      </>,
    );
    await waitFor(() => expect(listEnrollments).toHaveBeenCalled());
    await waitFor(() => expect(listWebhooks).toHaveBeenCalled());
    await waitFor(() => expect(getCpMetrics).toHaveBeenCalled());
    expect((await screen.findAllByRole('button', { name: /Enroll/ })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Add/ }).length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: 'Acknowledge registry-c.playground.local' })).toBeTruthy();
    expect(screen.queryByText(/is operator-only|are operator-only/)).toBeNull();
  });

  it('a password-gated console (public mode off) is never treated as anonymous', async () => {
    session.mockImplementation(async () => ({ publicMode: false, signedIn: true }));
    wrap(<Enrollments />);
    await waitFor(() => expect(listEnrollments).toHaveBeenCalled());
    expect(screen.queryByText('Registry enrollments are operator-only')).toBeNull();
  });
});
