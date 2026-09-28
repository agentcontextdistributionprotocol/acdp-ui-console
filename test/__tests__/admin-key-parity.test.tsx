// ══════════════════════════════════════════════════════════════════════
// The admin-key sentence exists once, and three surfaces render it.
//
// It used to exist three times: verbatim twice in
// `components/registries/enrollments.tsx` (`:68` and `:269`) and a third time,
// DIFFERENTLY WORDED, in `app/security/page.tsx`. That is the same shape as the
// defect `context-error-parity.test.tsx` was written for — a correction applied
// to one copy leaves the others lying, and nobody notices because each surface
// tests fine on its own.
//
// This is a PARITY suite, not a pairs suite. The thing under test is that the
// three cannot disagree, so the assertion is equality of the shared half, taken
// from the RENDERED output of all three rather than from the constant.
//
// It also guards the provenance gate, which is the behavioural half of this
// change: a 403 this console minted is unstamped, and telling an operator to go
// get the deployment key re-scoped for a request that never left the browser
// sends them to fix the wrong thing.
// ══════════════════════════════════════════════════════════════════════
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/fetcher';
import { ADMIN_KEY_REQUIRED, ADMIN_ROUTE_FORBIDDEN } from '@/lib/utils/api-error-messages';

const listEnrollments = vi.fn();
const enrollRegistry = vi.fn();
const listRevocations = vi.fn();
const getRegistryJwks = vi.fn();
const getLogWitness = vi.fn();
const listRegistries = vi.fn();
const listWebhooks = vi.fn();
const createWebhook = vi.fn();

vi.mock('@/lib/api/client', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/client')>()),
  listEnrollments: (...a: unknown[]) => listEnrollments(...a),
  enrollRegistry: (...a: unknown[]) => enrollRegistry(...a),
  listRevocations: (...a: unknown[]) => listRevocations(...a),
  getRegistryJwks: (...a: unknown[]) => getRegistryJwks(...a),
  getLogWitness: (...a: unknown[]) => getLogWitness(...a),
  listRegistries: (...a: unknown[]) => listRegistries(...a),
  listWebhooks: (...a: unknown[]) => listWebhooks(...a),
  createWebhook: (...a: unknown[]) => createWebhook(...a),
}));

import SecurityPage from '@/app/security/page';
import { Enrollments } from '@/components/registries/enrollments';
import { WebhookConfig } from '@/components/config/webhook-config';

function mount(node: React.ReactNode): RenderResult {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** A 403 that CROSSED the proxy — the control plane refusing an admin route. */
function upstream403(path: string): ApiError {
  return new ApiError(403, '{"message":"admin scope required"}', 'control-plane', path, true);
}

/** A 403 THIS CONSOLE minted — the proxy's own allow-list, or middleware. */
function console403(path: string): ApiError {
  return new ApiError(403, 'path not allowed', 'control-plane', path, false);
}

const ENROLLMENT = {
  authority: 'registry-a.playground.local',
  tenantId: 'acme',
  registryDid: 'did:web:registry-a.playground.local',
  baseUrl: 'http://localhost:8100',
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

beforeEach(() => {
  listEnrollments.mockResolvedValue([ENROLLMENT]);
  listRevocations.mockResolvedValue({ entries: [], next_cursor: null });
  getRegistryJwks.mockResolvedValue({ keys: [] });
  getLogWitness.mockResolvedValue(null);
  listRegistries.mockResolvedValue([]);
  listWebhooks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── The three renders ─────────────────────────────────────────────────

/** `/security`'s revocation feed, refused by the control plane. */
async function renderFeed403(error: ApiError): Promise<HTMLElement> {
  listRevocations.mockRejectedValue(error);
  const { container } = mount(<SecurityPage />);
  await waitFor(() => expect(container.textContent).toMatch(/admin-gated|Could not load the revocation feed/));
  return container;
}

/** The enrollment TOGGLE, refused by the control plane. */
async function renderToggle403(error: ApiError): Promise<HTMLElement> {
  enrollRegistry.mockRejectedValue(error);
  const { container } = mount(<Enrollments />);
  fireEvent.click(await screen.findByTitle('Toggle ingest enabled'));
  await waitFor(() => expect(container.textContent).toMatch(/admin-gated|Could not change/));
  return container;
}

/** The enroll FORM's save, refused by the control plane. */
async function renderEnrollForm403(error: ApiError): Promise<HTMLElement> {
  enrollRegistry.mockRejectedValue(error);
  const { container } = mount(<Enrollments />);
  fireEvent.click(await screen.findByRole('button', { name: /Enroll$/ }));
  fireEvent.change(await screen.findByPlaceholderText('registry-a.example'), {
    target: { value: 'registry-c.example' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(container.textContent).toMatch(/admin-gated|Could not save/));
  return container;
}

describe('the admin-key sentence exists once', () => {
  it('appears in NO source file under app/ or components/', () => {
    // Criterion 1, asserted at the source rather than the render: three
    // surfaces rendering the same string proves nothing about whether they each
    // hold their own copy of it. Walk the trees and look for the variable name,
    // which is the load-bearing, greppable half of the sentence.
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
        } else if (/\.tsx?$/.test(name)) {
          if (readFileSync(p, 'utf8').includes('CONTROL_PLANE_API_KEY')) hits.push(p);
        }
      }
    };
    walk(join(process.cwd(), 'app'));
    walk(join(process.cwd(), 'components'));
    // No exemptions. An earlier cut filtered on `p.includes('/api/')`, meaning
    // to spare server code under `app/api/**` — but that string matches any
    // path segment named `api` anywhere, so a future `components/api/…` would
    // have inherited the exemption silently. It was also inert: the env var
    // appears in NO file under either tree today (the proxy reads it through
    // `lib/server/integrations.ts`), so the filter hid nothing and guarded
    // nothing. The sibling gate in `error-copy-sweep.test.tsx` names its three
    // exempt files individually for exactly this reason; here the right number
    // of exemptions is zero.
    expect(hits).toEqual([]);
  });

  it('is rendered, identically, by all three 403 surfaces', async () => {
    // Equality of the SHARED half, from three real renders. The subjects differ
    // on purpose — "Enrollment changes", "Enrollment", "Reading the revocation
    // feed" are three different things — and that distinction is what an
    // earlier consolidation attempt would have flattened.
    const feed = (await renderFeed403(upstream403('/auth/revocations'))).textContent!;
    cleanup();
    const toggle = (await renderToggle403(upstream403('/registries/enroll'))).textContent!;
    cleanup();
    const form = (await renderEnrollForm403(upstream403('/registries/enroll'))).textContent!;

    for (const text of [feed, toggle, form]) {
      expect(text).toContain(ADMIN_ROUTE_FORBIDDEN);
      expect(text).toContain(ADMIN_KEY_REQUIRED);
    }
    // A first cut closed here with a `Set` over
    // `t.slice(t.indexOf(K)).slice(0, K.length)` and asserted its size was 1.
    // Verification proved that a TAUTOLOGY: given the `toContain` above,
    // `indexOf` is a valid index and slicing exactly `K.length` characters
    // re-derives `K` by construction, for any three inputs — it passes on
    // `['A' + K, 'zzz' + K, K]`, and on a render that also carries a
    // contradicting near-copy. An exhaustive search over 50 653 satisfying
    // inputs produced zero failures. Deleted rather than repaired: the
    // `toContain` loop is what does the work, and the consolidation regression
    // is caught twice over by the source-walk (a byte-identical inline copy)
    // and by this loop (a paraphrase). A test that cannot fail is the class
    // this plan's own Phase 20 exists to remove.
  });

  it('keeps the three subjects distinct', async () => {
    const feed = (await renderFeed403(upstream403('/auth/revocations'))).textContent!;
    cleanup();
    const toggle = (await renderToggle403(upstream403('/registries/enroll'))).textContent!;
    cleanup();
    const form = (await renderEnrollForm403(upstream403('/registries/enroll'))).textContent!;

    expect(feed).toContain('The revocation feed is admin-gated.');
    expect(toggle).toContain('Enrollment changes are admin-gated.');
    expect(form).toContain('Enrollment is admin-gated.');
    // The feed no longer carries its own near-copy of the shared half.
    expect(feed).not.toContain('is not an admin key');
  });

  it('does NOT assert that the key lacks admin scope — it is one of four reasons', () => {
    // The control plane answers 403 on these routes from four places and sends
    // a code for none of them (acdp-control-plane#179), so this console cannot
    // tell them apart. Three have nothing to do with admin scope:
    //
    //   registries.controller.ts:174  assertNotReservedTenant(body.tenantId)
    //                                 — AFTER the admin check at :168 passes
    //   auth.guard.ts:170 / :179      X-Tenant-Id reserved, or mismatched
    //                                 (and that header IS in FORWARD_HEADERS)
    //   auth.guard.ts:184             unbound key under AUTH_REQUIRE_TENANT
    //
    // The first is a click away: the enrollment form has a Tenant field, and
    // its placeholder used to suggest `default` — the reserved sentinel.
    expect(ADMIN_ROUTE_FORBIDDEN).toContain('cannot tell which of its reasons applies');
    expect(ADMIN_ROUTE_FORBIDDEN).toContain('likeliest');
    expect(ADMIN_ROUTE_FORBIDDEN).toContain('reserved tenant');
    expect(ADMIN_ROUTE_FORBIDDEN).toContain('AUTH_REQUIRE_TENANT');
    // …and it never states the diagnosis as fact.
    expect(ADMIN_ROUTE_FORBIDDEN).not.toMatch(/requires an admin API key\.|is not an admin key/);
  });

  it('does not suggest the reserved tenant sentinel in the enrollment form', async () => {
    // `default` is refused by `assertNotReservedTenant` with a 403 — from a key
    // that already passed the admin check. A placeholder proposing it handed
    // the operator a one-click route to a refusal, and then explained that
    // refusal as an under-scoped key.
    mount(<Enrollments />);
    fireEvent.click(await screen.findByRole('button', { name: /Enroll$/ }));
    const tenant = await screen.findByPlaceholderText(/untenanted/);
    expect(tenant.getAttribute('placeholder')).not.toBe('default');
  });

  it.each([
    ['the revocation feed', renderFeed403, '/auth/revocations'],
    ['the enrollment toggle', renderToggle403, '/registries/enroll'],
    ['the enroll form', renderEnrollForm403, '/registries/enroll'],
  ] as const)(
    '%s makes the control plane\'s own reason reachable, since the copy refuses to guess',
    async (_n, render403, path) => {
      // Load-bearing, not decorative: `ADMIN_ROUTE_FORBIDDEN` ends with "Read
      // the detail before changing any key." A surface rendering that sentence
      // with no detail sends the operator looking for something that is not on
      // the page.
      const err = new ApiError(
        403,
        "'default' is a reserved tenant sentinel and cannot be asserted via tenantId",
        'control-plane',
        path,
        true,
      );
      const container = await render403(err);
      const det = container.querySelector('details.error-detail');
      expect(det).not.toBeNull();
      expect(det!.textContent).toContain('reserved tenant sentinel');
    },
  );

  it('says "grant it admin scope", never the 401 remedy', () => {
    // A 403 is authorisation; a 401 is authentication. An earlier cut of the
    // module used the admin-scope wording for both, which prescribes an action
    // that cannot resolve half the cases.
    expect(ADMIN_KEY_REQUIRED).toContain('grant it admin scope');
    expect(ADMIN_KEY_REQUIRED).not.toContain('is set and current');
  });
});

// ── The provenance gate ───────────────────────────────────────────────

describe('a 403 this console minted is not an admin-scope problem', () => {
  // The proxy route mints a 403 for any path outside its allow-list, and
  // `middleware.ts` mints one on an Origin mismatch. Both are UNSTAMPED, and
  // neither is fixed by re-scoping the deployment key. The old predicate at all
  // three sites was a bare `status === 403`.
  it.each([
    ['the revocation feed', renderFeed403, '/auth/revocations'],
    ['the enrollment toggle', renderToggle403, '/registries/enroll'],
    ['the enroll form', renderEnrollForm403, '/registries/enroll'],
  ] as const)('%s falls to the console sentence, not the key sentence', async (_n, render403, path) => {
    const text = (await render403(console403(path))).textContent!;
    expect(text).not.toContain(ADMIN_KEY_REQUIRED);
    expect(text).not.toContain('admin API key');
    expect(text).toContain('This console could not complete the request');
  });
});

// ── The five swept sites ──────────────────────────────────────────────

describe('the five non-403 arms render a sentence, not a response body', () => {
  const RAW = '{"error":{"code":"schema_violation","message":"bad column"}}';
  function stamped(status: number, path: string): ApiError {
    return new ApiError(status, RAW, 'control-plane', path, true);
  }

  it('the revocation feed', async () => {
    listRevocations.mockRejectedValue(stamped(500, '/auth/revocations'));
    const { container } = mount(<SecurityPage />);
    await waitFor(() =>
      expect(container.textContent).toContain('Could not load the revocation feed'),
    );
    const det = container.querySelector('details.error-detail');
    expect(det!.textContent).toContain('schema_violation');
    det!.remove();
    expect(container.textContent).not.toContain('schema_violation');
  });

  it('the enrollment list', async () => {
    listEnrollments.mockRejectedValue(stamped(500, '/registries/enrollments'));
    const { container } = mount(<Enrollments />);
    await waitFor(() =>
      expect(container.textContent).toContain('Could not load the registry enrollments'),
    );
    const det = container.querySelector('details.error-detail');
    expect(det!.textContent).toContain('schema_violation');
    det!.remove();
    expect(container.textContent).not.toContain('schema_violation');
  });

  it('the enrollment toggle', async () => {
    const { container } = await renderToggle403Generic(stamped(500, '/registries/enroll'));
    expect(container.textContent).toContain('Could not change this enrollment');
    const det = container.querySelector('details.error-detail');
    expect(det!.textContent).toContain('schema_violation');
    det!.remove();
    expect(container.textContent).not.toContain('schema_violation');
  });

  it('the enroll form', async () => {
    enrollRegistry.mockRejectedValue(stamped(500, '/registries/enroll'));
    const { container } = mount(<Enrollments />);
    fireEvent.click(await screen.findByRole('button', { name: /Enroll$/ }));
    fireEvent.change(await screen.findByPlaceholderText('registry-a.example'), {
      target: { value: 'registry-c.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(container.textContent).toContain('Could not save this enrollment'),
    );
    const det = container.querySelector('details.error-detail');
    expect(det!.textContent).toContain('schema_violation');
    det!.remove();
    expect(container.textContent).not.toContain('schema_violation');
  });

  it('the webhook save — and NO admin-key copy, for any status', async () => {
    // Webhook CRUD is not admin-gated upstream. Inventing the copy here would
    // send an operator to fix a permission that is not what refused them.
    for (const status of [400, 401, 403, 500, 503]) {
      createWebhook.mockRejectedValue(stamped(status, '/webhooks'));
      const { container } = mount(<WebhookConfig />);
      fireEvent.click(await screen.findByRole('button', { name: /Add webhook|New webhook|Add/ }));
      fireEvent.change(await screen.findByPlaceholderText('https://…'), {
        target: { value: 'https://example.test/hook' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(container.textContent).toContain('Could not save this webhook'),
      );
      expect(container.textContent).not.toContain('admin API key');
      expect(container.textContent).not.toContain(ADMIN_KEY_REQUIRED);
      // The raw body is demoted, not deleted — `POST /webhooks` is
      // `ValidationPipe`-checked, so its body is where "which field" lives.
      const det = container.querySelector('details.error-detail');
      expect(det).not.toBeNull();
      expect(det!.textContent).toContain('schema_violation');
      det!.remove();
      expect(container.textContent).not.toContain('schema_violation');
      cleanup();
    }
  });

  // No `codes` map exists for enroll, and none can: the handler raises only
  // `ForbiddenException`, `assertNotReservedTenant`'s and `ValidationPipe`'s,
  // none of which carries an `errorCode`, so `withAcdpEnvelope` defaults
  // `error.code` to `INTERNAL_ERROR`. These assert the STATUS arms reach the
  // screen — which is the whole of what this surface can say.
  it.each([
    [400, 'the control plane answered 400'],
    [500, 'the control plane did not answer successfully (500)'],
  ])('enroll renders the status arm for %d', async (status, expected) => {
    enrollRegistry.mockRejectedValue(stamped(status, '/registries/enroll'));
    const { container } = mount(<Enrollments />);
    fireEvent.click(await screen.findByTitle('Toggle ingest enabled'));
    await waitFor(() => expect(container.textContent).toContain('Could not change this enrollment'));
    expect(container.textContent).toContain(expected);
  });

  async function renderToggle403Generic(error: ApiError): Promise<RenderResult> {
    enrollRegistry.mockRejectedValue(error);
    const r = mount(<Enrollments />);
    fireEvent.click(await screen.findByTitle('Toggle ingest enabled'));
    await waitFor(() => expect(r.container.textContent).toContain('Could not change'));
    return r;
  }
});
