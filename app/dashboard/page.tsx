'use client';

import { useMemo, useState } from 'react';
import { LayoutGrid, Boxes, Users, Database, Layers, ShieldAlert } from 'lucide-react';
import { SectionTitle } from '@/components/ui/section-title';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { RecentRunsTable } from '@/components/dashboard/recent-runs-table';
import { EventTicker } from '@/components/dashboard/event-ticker';
import { RegistryHealthBar } from '@/components/dashboard/registry-health-bar';
import { ReceiptCoverageBars, DidMethodBars } from '@/components/trust/coverage-bars';
import dynamic from 'next/dynamic';
import { LoadingPanel } from '@/components/ui/loading-skeleton';
import { ErrorPanel } from '@/components/ui/error-panel';
import { errorDiagnostic, operatorErrorMessage } from '@/lib/utils/api-error-messages';
import { Badge } from '@/components/ui/badge';
import { useDashboard } from '@/lib/hooks/use-dashboard';
import { useScenarios } from '@/lib/hooks/use-scenarios';
import { useGlobalEvents } from '@/lib/hooks/use-global-events';
import { formatNumber } from '@/lib/utils/format';
import { dashboardRevocationState } from '@/lib/utils/revocation';
import type { DashboardRevocationState } from '@/lib/utils/revocation';

// recharts is heavy; keep it out of the initial bundle.
const BarChartCard = dynamic(
  () => import('@/components/charts/bar-chart-card').then((m) => m.BarChartCard),
  { ssr: false, loading: () => <div className="skeleton" style={{ height: 200 }} /> },
);

// Exactly the set `DashboardOverviewQueryDto` accepts upstream (`IsIn`), so no
// selection here can produce a 400. The page hard-coded '24h' while captioning
// itself "window 24h", which made a window-scoped figure look absolute — and,
// with every revocation counter window-scoped too, left the Key Revocation
// card's not-reported state unreachable without editing code.
const WINDOWS: { value: string; label: string }[] = [
  { value: '1h', label: 'Last 1 h' },
  { value: '6h', label: 'Last 6 h' },
  { value: '24h', label: 'Last 24 h' },
  { value: '7d', label: 'Last 7 d' },
  { value: '30d', label: 'Last 30 d' },
];

export default function DashboardPage() {
  // NOT named `window` — that shadows the global, and this file's `dynamic()`
  // import is SSR-disabled precisely because it needs the real one.
  const [dashWindow, setDashWindow] = useState('24h');
  const dash = useDashboard(dashWindow);
  const { data: scenarios } = useScenarios();
  const { events, live } = useGlobalEvents(true);

  const windowLabel = WINDOWS.find((w) => w.value === dashWindow)?.label ?? dashWindow;
  const windowPicker = (
    <select
      className="form-input"
      style={{ width: 130 }}
      aria-label="Dashboard time window"
      value={dashWindow}
      onChange={(e) => setDashWindow(e.target.value)}
    >
      {WINDOWS.map((w) => (
        <option key={w.value} value={w.value}>
          {w.label}
        </option>
      ))}
    </select>
  );

  const scenarioName = useMemo(() => {
    const map = new Map((scenarios ?? []).map((s) => [s.id, s.name]));
    return (id: string) => map.get(id) ?? id;
  }, [scenarios]);

  const scenarioChart = useMemo(
    () =>
      (dash.data?.byScenario ?? []).map((s) => ({
        label: scenarioName(s.scenario_id),
        value: s.run_count,
      })),
    [dash.data, scenarioName],
  );

  if (dash.isLoading) {
    return (
      <div className="page">
        <SectionTitle icon={LayoutGrid} title="Dashboard" sub={`${windowLabel} · auto-refreshes every 30 s`} right={windowPicker} />
        <LoadingPanel label="Loading dashboard…" />
      </div>
    );
  }
  if (dash.error || !dash.data) {
    return (
      <div className="page">
        {/* The picker stays on the error path too — otherwise a window whose
            query failed is unrecoverable without a reload. */}
        <SectionTitle icon={LayoutGrid} title="Dashboard" right={windowPicker} />
        {/* The branch above is `error || !data`, so the no-error-no-data case is
            live and is NOT a failure — React Query can settle with `undefined`
            (a disabled or reset query). Passing `undefined` into
            `operatorErrorMessage` would answer it with a load-failure sentence.
            The existing literal is more specific than anything generic, so it
            stays, and only the error arm gains a cause clause. */}
        <ErrorPanel
          message={
            dash.error
              ? operatorErrorMessage(dash.error, 'Could not load the dashboard')
              : 'Dashboard data unavailable.'
          }
          details={errorDiagnostic(dash.error)}
        />
      </div>
    );
  }

  const d = dash.data;

  return (
    <div className="page">
      <SectionTitle icon={LayoutGrid} title="Dashboard" sub={`${windowLabel} · auto-refreshes every 30 s`} right={windowPicker} />

      <div className="kpi-grid">
        <KpiCard label="Total Runs" value={formatNumber(d.totalRuns)} delta={`window ${d.window}`} deltaTone="muted" accent="var(--brand)" icon={<Layers size={28} />} />
        <KpiCard label="Contexts Published" value={formatNumber(d.totalContexts)} accent="var(--info)" icon={<Boxes size={28} />} />
        <KpiCard label="Active Agents" value={formatNumber(d.totalAgents)} accent="var(--purple)" icon={<Users size={28} />} />
        {/* No `delta`, and deliberately not a wired one.

            This tile counted `byRegistry.length` — how many registries appear
            in the event breakdown — and captioned it `● all healthy`, a claim
            it had no input for: the literal was true of every dataset, every
            deployment and every outage. A control plane with a dead database
            rendered it unchanged.

            Wiring it to `pingHealth` was considered and rejected. The subject
            is wrong twice over. The figure is an EVENT COUNT, so a health
            caption under it answers a question the tile is not asking; and the
            registries can be perfectly healthy while the thing that failed is
            the control plane this page reads from — the exact scenario #100
            names — so a correctly-wired registry-health delta would still have
            said "all healthy" through it. Demo mode seals it: `pingHealth`
            returns `{ ok: true }` unconditionally there (`lib/api/client.ts`),
            and demo is the default, so a wired delta would render the same
            sentence forever with a probe's authority behind it. Worse than the
            literal, not better.

            The information is not lost. `components/layout/topbar.tsx` renders
            a per-service pill on every route except `/login` — this one
            included — and it now says `degraded` or `unreachable` in text rather
            than in a tooltip.
            One health surface that works beats two that disagree. */}
        <KpiCard label="Registries" value={formatNumber(d.byRegistry.length)} accent="var(--warning)" icon={<Database size={28} />} />
      </div>

      <div className="grid-2" style={{ marginBottom: 12 }}>
        <Card>
          {/* No "Most recent 0" — an empty window gets the table's own
              "No runs yet" empty state and no count to contradict it. */}
          <CardHeader
            title="Recent Runs"
            sub={d.recentRuns.length > 0 ? `Most recent ${d.recentRuns.length}` : undefined}
          />
          <RecentRunsTable runs={d.recentRuns} scenarioName={scenarioName} />
        </Card>
        <Card>
          <CardHeader title="Live Events" right={<Badge variant={live ? 'running' : 'neutral'}>{live ? '● live' : '○ idle'}</Badge>} />
          <EventTicker events={events} />
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader title="Runs by Scenario" sub={windowLabel} />
          <CardBody>
            <BarChartCard data={scenarioChart} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Events by Registry" />
          <CardBody>
            <RegistryHealthBar byRegistry={d.byRegistry} />
          </CardBody>
        </Card>
      </div>

      {(d.receiptCoverage || d.didMethods) && (
        <div className="grid-2" style={{ marginTop: 12 }}>
          <Card>
            <CardHeader title="Receipt Coverage" sub="RFC-ACDP-0010 · receipts per publish" />
            <CardBody>
              <ReceiptCoverageBars coverage={d.receiptCoverage ?? []} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Producer DID Methods" sub="did:web vs did:key adoption" />
            <CardBody>
              <DidMethodBars methods={d.didMethods ?? []} />
            </CardBody>
          </Card>
        </div>
      )}

      {/* The card ALWAYS renders. A card that silently vanishes is
          indistinguishable from a backend that predates the feature, and the
          operator learns nothing either way — so when revocation was not
          reported, the card stays and says so in words instead of showing
          three confident zeros. */}
      <Card style={{ marginTop: 12 }}>
        <CardHeader
          title="Key Revocation"
          // Precise about the limitation rather than broad: upstream's
          // `docs/API.md` records that a retroactive re-audit deliberately
          // never touches `checked_at`, so an amendment to an event this
          // window has already scrolled past stays invisible here. An
          // amendment to an event still INSIDE the window IS reflected —
          // saying "a retroactive re-audit is not reflected" overstated it.
          sub="RFC-ACDP-0014 · window-scoped compromise-boundary checks · counted at audit time, so a re-audit amending an event older than this window is not reflected here"
          right={<ShieldAlert size={18} style={{ color: 'var(--danger)' }} />}
        />
        <CardBody>
          <RevocationBody state={dashboardRevocationState(d.keyRevocation, d.features)} />
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * The four things the console can honestly say about key revocation (#97).
 *
 * It was a boolean, and the `false` arm asserted "the check is disabled by
 * default" — which is simply false whenever `features.keyRevocationCheck` is
 * true, and was the last surviving instance in this file of the class of defect
 * this plan exists to remove: a sentence that states a cause the console never
 * established.
 *
 * `checked-clean` is the state that did not previously exist. It is a POSITIVE
 * statement, and it is deliberately WINDOW-scoped: "nothing in this window was
 * classified", never "nothing is revoked". The window picker can change the
 * answer, so a deployment-level claim would be unwarranted from the same data.
 *
 * `unknown` renders THREE ways, one per `because`, and only `no-flags` keeps the
 * old prose with its "disabled by default" hedge. That route is a control plane
 * predating acdp-control-plane#178, where nothing has told us whether the check
 * runs — so the hedge is still the honest thing to say there, and confining it
 * to that route is what lets every other rendering stop saying it.
 *
 * The other two say only what holds on their own route: `flag-on-no-counters`
 * may state that the deployment reports the check as on (it does — `=== true`),
 * and `flag-unreadable` may state only that the flag could not be read, since
 * on that route the counters may be absent or present-and-zero and the flag
 * says nothing either way. Round 2 of this change's gate found the merged
 * version stating the first arm's cause over the second's, which is the defect
 * this whole file exists to remove.
 *
 * SIX renderings, four states. That is deliberate: `unknown` is one state
 * about one thing we do not know, split three ways only by what may honestly be
 * said ABOUT not knowing. The six are: the `.kpi-grid` for `reported`, one
 * paragraph each for `checked-clean` and `disabled`, and one for each of the
 * three `because` values. Counted here because an earlier version of this line
 * said five, which invites the next reader to conclude an arm is dead and
 * merge it — which is precisely how the over-claiming `flags-disagree` copy
 * came to be written.
 */
function RevocationBody({ state }: { state: DashboardRevocationState }) {
  if (state.kind === 'reported') {
    // `state.counts` needs no `!`: the discriminant carries the guarantee that
    // the old type predicate existed to provide.
    return (
      <div className="kpi-grid">
        <KpiCard
          label="Pre-compromise (authorized)"
          value={formatNumber(state.counts.preCompromise)}
          accent="var(--success)"
          hint="Signed strictly before the compromise boundary — historically authorized"
        />
        <KpiCard
          label="Revoked at/after boundary"
          value={formatNumber(state.counts.revokedAtOrAfter)}
          accent="var(--danger)"
          hint="Fails closed under the strict profile — not attributable to the producer"
        />
        <KpiCard
          label="Revoked time unverifiable"
          value={formatNumber(state.counts.revokedTimeUnverifiable)}
          accent="var(--warning)"
          hint="No receipt-attested publish time to compare against the compromise boundary"
        />
      </div>
    );
  }

  // `margin: 0` because these render as `<p>` rather than `<div>`. The element
  // is a paragraph — one block of explanatory prose — and saying so is what
  // lets a test assert sentence-by-sentence over the PROSE alone. Round 2 of
  // this change's gate found the window-scoping guard reading the whole card:
  // the header and subtitle carry no terminal period, so splitting on the
  // period glued the subtitle onto the first claim, and the subtitle's own
  // "older than this window" satisfied the scope assertion no matter what the
  // claim said.
  const prose = { fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 } as const;

  if (state.kind === 'checked-clean') {
    return (
      <p style={prose}>
        <strong style={{ color: 'var(--text)' }}>
          Revocation checking is enabled, and nothing in this window is classified against a revoked
          key.
        </strong>
        <br />
        Two facts, stated separately because the console holds them separately: the deployment
        reports the compromise-boundary check as on, and this window&rsquo;s counters are zero. It
        does not follow that every event in the window was checked — classification happens at audit
        time, so an event audited before the check was switched on was given its status then. Nor
        does that status stay fixed: when a revocation fact arrives later, the control plane
        re-audits and amends already-sealed events in place. An amendment does not update the
        audit timestamp, so it moves these figures only where the amended event already sits inside
        this window. A longer window may also show figures.
      </p>
    );
  }

  if (state.kind === 'disabled') {
    return (
      <p style={prose}>
        <strong style={{ color: 'var(--text)' }}>
          Revocation checking is switched off on this deployment.
        </strong>
        <br />
        No figures are shown for this window because a zero produced while the check is off is
        not a finding — which is not the same as having looked and found nothing. It is
        also not a claim that nothing was classified: classification happens at audit time and is
        not undone by disabling the check, so anything already recorded stays recorded, in this
        window as much as an earlier one. What the console cannot tell you from here is whether the
        check was running earlier in this window. Nothing new will be classified until it is
        enabled.
      </p>
    );
  }

  // `unknown`, whose three reasons license different explanations. Only
  // `no-flags` may keep the original hedge — see `dashboardRevocationState`.
  if (state.because === 'flag-on-no-counters') {
    return (
      <p style={prose}>
        <strong style={{ color: 'var(--text)' }}>
          This deployment&rsquo;s report about revocation checking does not add up.
        </strong>
        <br />
        {/*
          Both halves of this sentence are things the console holds directly on
          this route and nowhere else: the flag was read as exactly `true`, and
          `keyRevocation` was absent rather than zeroed. Upstream derives both
          from the same setting, so one of them is wrong.
        */}
        It reports the compromise-boundary check as enabled, yet sent no counters at all — not even
        zeros. Those two come from the same setting upstream, so one of them is wrong and there is
        no way to tell which from here. No figures are shown, and no cause is offered beyond that:
        the check is not reported as off, so saying it was would be inventing an explanation.
      </p>
    );
  }

  if (state.because === 'counters-partial') {
    return (
      <p style={prose}>
        <strong style={{ color: 'var(--text)' }}>
          This deployment&rsquo;s revocation counters arrived incomplete.
        </strong>
        <br />
        {/*
          Says nothing about the flag, deliberately: this arm is reached with
          the check reported on, off, unreadable, or not reported at all, and a
          sentence naming any of those would be true on one route and false on
          three. The only fact that holds everywhere here is the shape of the
          payload.
        */}
        Some of the three counters came through and some did not, so the ones that did have no
        denominator to be read against. No figures are shown, because rendering the members that
        arrived would print a zero for each member that did not — and a zero this console invented
        is indistinguishable, on screen, from one the check produced.
      </p>
    );
  }

  if (state.because === 'flag-unreadable') {
    return (
      <p style={prose}>
        <strong style={{ color: 'var(--text)' }}>
          This deployment did not say whether revocation checking is running.
        </strong>
        <br />
        {/*
          The ONE fact that holds on every route here. Nothing is said about the
          counters: on this route they may be absent or present-and-zero, and
          the previous merged copy claimed the second could not happen. Nothing
          is said about the deployment being old either — a feature block did
          arrive; it just could not be read.
        */}
        It sent a feature report, but the compromise-boundary setting in it was not a value this
        console can read as on or off. No figures are shown, because whether anything was measured
        is exactly what could not be established.
      </p>
    );
  }

  return (
    <p style={prose}>
      <strong style={{ color: 'var(--text)' }}>
        Nothing in this window carried a revocation classification.
      </strong>
      <br />
      No figures are shown rather than zeros: a zero would claim &ldquo;nothing is revoked&rdquo;
      when it cannot be told apart from never having looked — the check is disabled by default. This
      is a statement about the selected window, not about the deployment: a different window may
      well show figures. They appear as soon as anything is classified.
    </p>
  );
}
