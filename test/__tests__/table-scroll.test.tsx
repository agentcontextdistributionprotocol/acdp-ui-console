// ══════════════════════════════════════════════════════════════════════
// Wide tables scroll inside their own card (#93).
//
// The defect was that a table wider than the viewport pushed the entire
// `.content` region sideways: `.content` is `overflow-y: auto` with no
// `overflow-x`, and CSS computes the unspecified axis to `auto` too, so the
// overflow surfaced on the page rather than on the table. At phone width the
// whole console slid.
//
// WHAT THESE TESTS CAN AND CANNOT PROVE. jsdom performs no layout — every
// element is 0×0, `scrollWidth` equals `clientWidth` always — so nothing here
// can demonstrate the 400px behaviour. No `playwright` is installed and adding
// one is out of this plan's scope. So the layout half is a documented MANUAL
// gate, recorded in `PROGRESS.md`, and these tests pin the two things that are
// mechanically checkable and that a future edit would silently break:
//
//   1. The STRUCTURE — every `.data-table` really is inside a `TableScroll`, the
//      container is focusable, and it carries a name a browser will honour.
//   2. The CSS TEXT — the rules that make the structure do anything, read off
//      `app/globals.css`, in the `readFileSync` style `use-verdicts.test.ts`
//      already uses for the same reason.
//
// The accessible half is the part worth the most scrutiny. FIVE of the eleven
// tables contain nothing focusable at all (agents, the security JWKS table, the
// SDK matrix, recent runs, events), so `overflow-x: auto` on its own would have
// produced a scroll region no keyboard user could reach — WCAG 2.1.1. That is
// why `tabIndex` is on the shared component rather than left to eleven call
// sites, and why the source gate below counts the sites instead of trusting a
// sample.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TableScroll } from '@/components/ui/table-scroll';
import type { CpRun, CpContextEvent, RunTrustSummary } from '@/lib/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { EventsTable } = await import('@/components/events/events-table');
const { RecentRunsTable } = await import('@/components/dashboard/recent-runs-table');
const { RunsTable } = await import('@/components/runs/runs-table');
const { RunTrustPanel } = await import('@/components/runs/run-trust-panel');

afterEach(cleanup);

// Comments STRIPPED before matching. The rules these tests assert the absence
// of are described in the comments explaining why they were removed, so a naive
// read would match the explanation and report the defect still present.
const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}');
  return CSS.match(re)?.[0] ?? '';
}

describe('the TableScroll component contract', () => {
  it('is a named, focusable group', () => {
    const { container } = render(
      <TableScroll label="Widgets, scrollable">
        <table className="data-table">
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>,
    );
    const group = screen.getByRole('group', { name: 'Widgets, scrollable' });
    expect(group).toBe(container.firstElementChild);
    expect(group.className).toBe('table-scroll');
    expect(group.tabIndex).toBe(0);
    expect(group.querySelector('table')).not.toBeNull();
  });

  it('is found by ROLE plus name, which a nameless div would not be', () => {
    // The distinction this repo has already been bitten by once, in
    // `LiveMarker`: an element with NO role maps to ARIA's `generic`, which is
    // name-prohibited in ARIA 1.2, so Chromium drops the `aria-label` and the
    // focusable container announces as nothing at all. `getByLabelText` matches
    // the attribute as text and so cannot tell an honoured name from a discarded
    // one; `getByRole` pins the element to a role that CAN be named.
    //
    // This asserts the positive case is reachable by role. The negative — that a
    // roleless div is NOT — is demonstrated by the control render below, which
    // is the same markup minus the role.
    const { container: bare } = render(
      <div className="table-scroll" aria-label="Widgets, scrollable" tabIndex={0}>
        <table />
      </div>,
    );
    expect(bare.querySelector('[role="group"]')).toBeNull();
    cleanup();

    render(
      <TableScroll label="Widgets, scrollable">
        <table />
      </TableScroll>,
    );
    expect(screen.getByRole('group', { name: 'Widgets, scrollable' })).toBeTruthy();
  });

  it('adds no landmark', () => {
    // `role="region"` would also have given a name, and eleven new landmarks —
    // one per table, on pages that hold one table — is noise in the landmark
    // list that costs more than it gives. `group` is nameable and is not a
    // landmark.
    const { container } = render(
      <TableScroll label="Widgets, scrollable">
        <table />
      </TableScroll>,
    );
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('puts a passed style on the wrapper, not on the table', () => {
    const { container } = render(
      <TableScroll label="Widgets, scrollable" style={{ marginBottom: 14 }}>
        <table className="data-table" />
      </TableScroll>,
    );
    expect((container.firstElementChild as HTMLElement).style.marginBottom).toBe('14px');
    expect(container.querySelector('table')?.getAttribute('style')).toBeNull();
  });
});

describe('the CSS that makes the wrapper do something', () => {
  it('scrolls horizontally', () => {
    expect(rule('.table-scroll')).toMatch(/overflow-x:\s*auto/);
  });

  it('shows a focus ring, because tabIndex made it focusable', () => {
    // A focusable element with no visible focus state is WCAG 2.4.7, and this
    // one is focusable on purpose for the five tables with nothing else to focus.
    expect(CSS).toMatch(/\.table-scroll:focus-visible\s*\{[^}]*outline:/);
  });

  it('leaves .content alone', () => {
    // Deliberate: `overflow-x: hidden` there would CLIP the columns with no way
    // to reach them — data present in the DOM and unreadable, a WCAG 1.4.10
    // failure rather than a fix. The overflow has to stop before it arrives.
    const content = rule('.content');
    expect(content).toMatch(/overflow-y:\s*auto/);
    expect(content).not.toMatch(/overflow-x/);
  });

  it('drops the three inert .did rules and keeps the four real ones', () => {
    // `max-width: 220px`, `overflow: hidden` and `text-overflow: ellipsis` on a
    // table cell did nothing: CSS 2.1 §10.4 leaves `max-width` undefined there
    // and auto table layout sizes the column to content regardless. They were
    // worse than useless — reading them suggested the overflow was handled.
    const did = rule('.data-table .did');
    expect(did).not.toMatch(/max-width/);
    expect(did).not.toMatch(/overflow/);
    expect(did).not.toMatch(/text-overflow/);
    // `nowrap` stays and is now load-bearing: a wrapped DID is unreadable, and
    // an unwrappable column is exactly what the scroll container is for.
    expect(did).toMatch(/white-space:\s*nowrap/);
    expect(did).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(did).toMatch(/font-size:\s*11px/);
    expect(did).toMatch(/color:\s*var\(--muted\)/);
  });

  it('hides the captions without removing them from the accessibility tree', () => {
    // `display: none` and `visibility: hidden` both take the element OUT of the
    // accessibility tree, which would make every caption pointless. The
    // 1px-box + `clip-path` form is the one that keeps it announced.
    const sr = rule('.sr-only');
    expect(sr).toMatch(/clip-path/);
    expect(sr).not.toMatch(/display:\s*none/);
    expect(sr).not.toMatch(/visibility:\s*hidden/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// The repo-wide gate. A sample of three renders proves the pattern works; it
// says nothing about the eighth call site. This counts them.
// ══════════════════════════════════════════════════════════════════════
describe('every data-table in the repo is wrapped', () => {
  const FILES = [
    'app/agents/page.tsx',
    'app/trust/page.tsx',
    'app/security/page.tsx',
    'components/registries/enrollments.tsx',
    'components/config/webhook-config.tsx',
    'components/config/sdk-matrix.tsx',
    'components/events/events-table.tsx',
    'components/dashboard/recent-runs-table.tsx',
    'components/runs/run-trust-panel.tsx',
    'components/runs/runs-table.tsx',
  ];

  // Whitespace-collapsed, so a `<TableScroll>` open tag broken over several
  // lines still matches — the wrapping is a formatting choice and this gate must
  // not turn red for one.
  const sources = new Map(
    FILES.map((f) => [f, readFileSync(join(process.cwd(), f), 'utf8').replace(/\s+/g, ' ')]),
  );

  it('finds exactly the eleven known sites and no twelfth', () => {
    // The count is asserted so that ADDING an unwrapped table fails here rather
    // than passing unnoticed — the per-site check below can only speak about
    // files it was told to look in.
    const total = [...sources.values()].reduce(
      (n, s) => n + (s.match(/className="data-table/g) ?? []).length,
      0,
    );
    expect(total).toBe(11);
  });

  it.each(FILES)('%s wraps each of its tables', (file) => {
    const src = sources.get(file)!;
    const tables = (src.match(/className="data-table/g) ?? []).length;
    expect(tables).toBeGreaterThan(0);
    // The open tag must be IMMEDIATELY before the table — a `TableScroll`
    // elsewhere in the file would otherwise satisfy a naive `includes` check.
    const wrapped = (src.match(/<TableScroll[^>]*>\s*<table className="data-table/g) ?? []).length;
    expect(wrapped).toBe(tables);
    // And each table names itself, independently of what wraps it.
    const captions = (src.match(/<caption className="sr-only">/g) ?? []).length;
    expect(captions).toBe(tables);
  });

  it('gives every wrapper a non-empty label', () => {
    for (const [file, src] of sources) {
      for (const m of src.matchAll(/<TableScroll label="([^"]*)"/g)) {
        expect(m[1].length, `${file}: empty TableScroll label`).toBeGreaterThan(3);
      }
    }
  });

  it('gives every caption a non-empty name', () => {
    for (const [file, src] of sources) {
      for (const m of src.matchAll(/<caption className="sr-only">([^<]*)</g)) {
        expect(m[1].trim().length, `${file}: empty caption`).toBeGreaterThan(3);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Three real consumer renders. The source gate above can be satisfied by text
// that does not compile into the shape it looks like; these prove the rendered
// DOM.
// ══════════════════════════════════════════════════════════════════════
const RUN: CpRun = {
  runId: 'run-1',
  tenantId: 'default',
  scenarioId: 'sc-1',
  status: 'completed',
  startedAt: '2026-08-01T00:00:00Z',
  completedAt: '2026-08-01T00:01:00Z',
  contextsCount: 3,
  registries: ['registry-a.playground.local'],
};

const EVENT: CpContextEvent = {
  id: 'ev-1',
  eventType: 'context_published',
  agentId: 'did:key:z6Mkabc',
  ctxId: 'acdp://registry-a.playground.local/ctx-1',
  registryAuthority: 'registry-a.playground.local',
  runId: 'run-1',
  eventTs: '2026-08-01T00:00:00Z',
  receiptPresent: true,
};

describe('the rendered DOM at three real call sites', () => {
  it.each([
    ['EventsTable', () => render(<EventsTable events={[EVENT]} />)],
    ['RecentRunsTable', () => render(<RecentRunsTable runs={[RUN]} scenarioName={(id) => id} />)],
    ['RunsTable', () => render(<RunsTable runs={[RUN]} scenarioName={(id) => id} />)],
  ] as const)('%s puts its table in a named focusable group', (_name, mount) => {
    const { container } = mount();
    const table = container.querySelector('table.data-table')!;
    const group = table.parentElement as HTMLElement;
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(3);
    expect(group.tabIndex).toBe(0);
    // Every one of these three also has focusable rows, so the container is not
    // the only way in — but the five that do not are the reason the tabIndex is
    // unconditional, and asserting it here is what keeps it that way.
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(table.querySelector('caption.sr-only')?.textContent?.length ?? 0).toBeGreaterThan(3);
  });
});

describe('the run trust panel keeps the spacing it had', () => {
  function summary(over: Partial<RunTrustSummary> = {}): RunTrustSummary {
    return {
      audited: 1,
      verified: 0,
      verifiedHistorical: 0,
      structural: 0,
      noReceipt: 0,
      errors: 0,
      flagged: [
        {
          eventId: 'ev-flag',
          ctxId: 'acdp://registry-a.playground.local/ctx-1',
          status: 'discrepancy',
          discrepancies: ['content_hash_mismatch:sha256'],
        },
      ],
      ...over,
    };
  }

  it('moves the conditional margin onto the wrapper and still applies it', () => {
    // The margin was inline on the `<table>`. A margin on a child of an
    // `overflow` container still applies, but the visual result differs once the
    // child can be wider than the parent — so it belongs on the wrapper, and
    // this asserts it arrived there rather than being dropped in the move.
    const { container } = render(
      <RunTrustPanel
        trust={summary({
          revoked: [
            {
              eventId: 'ev-1',
              ctxId: 'acdp://registry-a.playground.local/ctx-1',
              status: 'revoked_at_or_after',
              boundary: '2026-08-01 00:00:00+00',
              trustClass: 'producer_signed',
              sources: [],
            },
          ],
        })}
      />,
    );
    const groups = container.querySelectorAll('.table-scroll');
    expect(groups).toHaveLength(2);
    expect((groups[0] as HTMLElement).style.marginBottom).toBe('14px');
    // And the table itself no longer carries it.
    expect(groups[0].querySelector('table')?.getAttribute('style')).toBeNull();
  });

  it('drops the margin when there is no second table below it', () => {
    const { container } = render(<RunTrustPanel trust={summary()} />);
    const groups = container.querySelectorAll('.table-scroll');
    expect(groups).toHaveLength(1);
    expect((groups[0] as HTMLElement).style.marginBottom).toBe('0px');
  });
});

describe('the lineage run picker can shrink', () => {
  it('sits in a wrapping row and is capped at the container width', () => {
    // Not a table, but the same defect: a fixed 320px child in a non-wrapping
    // flex row cannot shrink, so it pushed `.content` sideways exactly as the
    // tables did. Asserted on the source because the page needs a router, a
    // query client and three hooks to render, none of which this claim depends
    // on.
    const src = readFileSync(join(process.cwd(), 'app/lineage/page.tsx'), 'utf8').replace(/\s+/g, ' ');
    expect(src).toMatch(/flexWrap: 'wrap'[^}]*justifyContent: 'flex-end'/);
    expect(src).toMatch(/width: 320, maxWidth: '100%'/);
  });
});
