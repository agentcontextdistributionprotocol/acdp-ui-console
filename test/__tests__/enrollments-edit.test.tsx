// Issue #170: re-enroll is PATCH-like since acdp-control-plane#240 —
// omitting a nullable field KEEPS the stored value, an explicit `null` CLEARS
// it (`src/dto/enroll-registry.dto.ts`, `buildEnrollmentUpdateSet`). So the
// edit form must send `null` for a previously set baseUrl/registryDid the
// operator blanked, and must still omit a field that was unset and stayed
// blank (and a blank webhook secret, which means "keep").
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RegistryEnrollment } from '@/lib/types';

const listEnrollments = vi.fn();
const enrollRegistry = vi.fn();

vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  listEnrollments: (...a: unknown[]) => listEnrollments(...a),
  enrollRegistry: (...a: unknown[]) => enrollRegistry(...a),
}));

import { Enrollments } from '@/components/registries/enrollments';

const SET: RegistryEnrollment = {
  authority: 'registry-a.playground.local',
  tenantId: 'acme',
  registryDid: 'did:web:registry-a.playground.local',
  baseUrl: 'http://localhost:8100',
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const UNSET: RegistryEnrollment = { ...SET, registryDid: null, baseUrl: null };

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Enrollments />
    </QueryClientProvider>,
  );
}

async function openEdit(enrollment: RegistryEnrollment) {
  listEnrollments.mockResolvedValue([enrollment]);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: `Edit enrollment ${enrollment.authority}` }));
}

const didInput = () => screen.getByPlaceholderText('did:web:registry-a.example');
const urlInput = () => screen.getByPlaceholderText('https://registry-a.example');

async function save(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(enrollRegistry).toHaveBeenCalledTimes(1));
  return enrollRegistry.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  enrollRegistry.mockResolvedValue(SET);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EnrollForm — clearing a previously set field (#170)', () => {
  it('sends baseUrl: null when a stored baseUrl is blanked, keeping registryDid', async () => {
    await openEdit(SET);
    fireEvent.change(urlInput(), { target: { value: '' } });
    const body = await save();
    expect(body).toHaveProperty('baseUrl', null);
    expect(body).toHaveProperty('registryDid', SET.registryDid);
  });

  it('sends registryDid: null when a stored registryDid is blanked, keeping baseUrl', async () => {
    await openEdit(SET);
    fireEvent.change(didInput(), { target: { value: '' } });
    const body = await save();
    expect(body).toHaveProperty('registryDid', null);
    expect(body).toHaveProperty('baseUrl', SET.baseUrl);
  });

  it('sends both nulls when both stored fields are blanked', async () => {
    await openEdit(SET);
    fireEvent.change(urlInput(), { target: { value: '' } });
    fireEvent.change(didInput(), { target: { value: '' } });
    const body = await save();
    expect(body).toHaveProperty('baseUrl', null);
    expect(body).toHaveProperty('registryDid', null);
  });

  it('omits both fields when they were unset and stayed blank (no spurious null)', async () => {
    await openEdit(UNSET);
    const body = await save();
    expect(body).not.toHaveProperty('baseUrl');
    expect(body).not.toHaveProperty('registryDid');
  });

  it('sends a new value for a previously unset field', async () => {
    await openEdit(UNSET);
    fireEvent.change(urlInput(), { target: { value: 'https://registry-a.example' } });
    const body = await save();
    expect(body).toHaveProperty('baseUrl', 'https://registry-a.example');
    expect(body).not.toHaveProperty('registryDid');
  });

  it('never sends webhookSecret on an edit that leaves the secret blank ("unchanged")', async () => {
    await openEdit(SET);
    fireEvent.change(urlInput(), { target: { value: '' } });
    const body = await save();
    expect(body).not.toHaveProperty('webhookSecret');
  });

  it('a create with blank optional fields sends no nulls', async () => {
    listEnrollments.mockResolvedValue([SET]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Enroll$/ }));
    fireEvent.change(screen.getByPlaceholderText('registry-a.example'), {
      target: { value: 'registry-z.test' },
    });
    const body = await save();
    expect(body).toEqual({ authority: 'registry-z.test', enabled: true });
  });
});
