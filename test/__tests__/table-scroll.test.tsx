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
// gate, recorded in `PROGRESS.md`, and these tests pin the three things that are
// mechanically checkable and that a future edit would silently break:
//
//   1. The STRUCTURE — every `.data-table` really is inside a `TableScroll`, the
//      container is focusable, and it carries a name a browser will honour.
//   2. The NAMES — each caption enumerates the table's ACTUAL `<th>` set, both
//      directions: no header left out, and no column named that does not exist.
//      The first version of this change failed that second direction at six of
//      eleven sites, because the captions were written from the plan instead of
//      from the rendered header row.
//   3. The CSS TEXT — the rules that make the structure do anything, read off
//      `app/globals.css`, in the `readFileSync` style `use-verdicts.test.ts`
//      already uses for the same reason.
//
// The accessible half is the part worth the most scrutiny. FOUR of the eleven
// tables contain nothing focusable at all — the SDK matrix, the security
// revocation feed, and both tables in `run-trust-panel.tsx` — so
// `overflow-x: auto` on its own would have produced a scroll region no keyboard
// user could reach, which is WCAG 2.1.1. (An earlier version of this comment
// said FIVE and named agents, recent runs and events: all three spread
// `pressable()` onto their rows, which sets `role="button"` and `tabIndex: 0`.
// It also named a "security JWKS table", which does not exist. The corrected
// count is smaller; the conclusion is not weakened, because four tables with no
// other way in is still four.) That is why `tabIndex` lives on the shared
// component rather than at eleven call sites, and why the repo-wide gate below
// DISCOVERS its files rather than being handed a list.
// ══════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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

// EVERY block for the selector, joined — not just the first. CSS cascades, so a
// second `.data-table .did { max-width: 220px }` further down the file would
// reinstate exactly what this change deleted while a first-match-only reader
// reported it gone.
function rule(selector: string): string {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}', 'g');
  return (CSS.match(re) ?? []).join('\n');
}

describe('the TableScroll component contract', () => {
  it('is a named, focusable group', () => {
    const { container } = render(
      <TableScroll label="Widget inventory">
        <table className="data-table">
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>,
    );
    const group = screen.getByRole('group', { name: 'Widget inventory' });
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
      <div className="table-scroll" aria-label="Widget inventory" tabIndex={0}>
        <table />
      </div>,
    );
    expect(bare.querySelector('[role="group"]')).toBeNull();
    cleanup();

    render(
      <TableScroll label="Widget inventory">
        <table />
      </TableScroll>,
    );
    expect(screen.getByRole('group', { name: 'Widget inventory' })).toBeTruthy();
  });

  it('adds no landmark', () => {
    // `role="region"` would also have given a name, and eleven new landmarks —
    // one per table, on pages that hold one table — is noise in the landmark
    // list that costs more than it gives. `group` is nameable and is not a
    // landmark.
    const { container } = render(
      <TableScroll label="Widget inventory">
        <table />
      </TableScroll>,
    );
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);
    expect(screen.queryAllByRole('region')).toHaveLength(0);
  });

  it('puts a passed style on the wrapper, not on the table', () => {
    const { container } = render(
      <TableScroll label="Widget inventory" style={{ marginBottom: 14 }}>
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

  it('has NO local :focus-visible copy — that convention is stated in this very file', () => {
    // The first version of this change shipped
    // `.table-scroll:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px }`,
    // which is precisely the local copy `globals.css` forbids beside
    // `.error-detail > pre`: "a local copy would silently keep the old treatment
    // for this component alone the day that one changes."
    //
    // It was not hypothetical harm. The copy had ALREADY diverged on the day it
    // landed — it omitted the global rule's `border-radius` — and being more
    // specific it won, so the eleven new containers rendered a square focus ring
    // where every other focusable element in the console gets a rounded one.
    expect(CSS).not.toMatch(/\.table-scroll:focus-visible/);
  });

  it('the repo-wide :focus-visible rule still exists, because it is now load-bearing here', () => {
    // A focusable element with no visible focus state is WCAG 2.4.7, and these
    // containers are focusable on purpose for the four tables with nothing else
    // to focus. Having deleted the local copy, this file is the only thing that
    // notices if the universal rule is deleted or narrowed to a selector list —
    // which, before this test, killed ZERO tests in the suite.
    //
    // Anchored at line start so `.form-input:focus-visible { outline: none }`
    // cannot satisfy it: that rule is a deliberate exception for inputs and says
    // nothing about whether the universal one survives.
    const universal = CSS.match(/^:focus-visible\s*\{[^}]*\}/m)?.[0] ?? '';
    expect(universal).toMatch(/outline:\s*\d+px\s+solid/);
    expect(universal).toMatch(/outline-offset:/);
    // The exact property the deleted local copy was missing.
    expect(universal).toMatch(/border-radius:/);
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
// The repo-wide gate.
//
// It DISCOVERS its own files by walking `app/` and `components/`. The first
// version of this gate was handed a frozen list of ten paths, which made its
// headline assertion ("no twelfth table") false advertising: a new file with an
// unwrapped table was invisible to it, because a file not in the list is a file
// it never reads. Discovery is the whole point — the risk this guards is a
// table added LATER, and a later table is exactly the one a hardcoded list
// cannot contain.
// ══════════════════════════════════════════════════════════════════════
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

const TABLE_MARK = 'className="data-table';
const SOURCES = new Map<string, string>(
  ['app', 'components']
    .flatMap((root) => walk(join(process.cwd(), root)))
    .map((abs) => [relative(process.cwd(), abs), readFileSync(abs, 'utf8')] as const)
    .filter(([, raw]) => raw.includes(TABLE_MARK))
    // Whitespace-collapsed, so a `<TableScroll>` open tag broken over several
    // lines still matches — the wrapping is a formatting choice and this gate
    // must not turn red for one.
    .map(([file, raw]) => [file, raw.replace(/\s+/g, ' ')]),
);
const FILES = [...SOURCES.keys()].sort();

// `it.each([])` asserts nothing at all, silently. Discovery that finds nothing
// — a moved directory, a renamed class — would turn this whole gate green and
// empty, so it fails at import instead. Same guard `sdk-matrix-utils.test.ts`
// uses, for the same reason.
if (FILES.length === 0) throw new Error('table discovery found no files — the gate below would be vacuous');

/**
 * Every `<th>` of a table, in order, as a browser would announce it.
 *
 * An empty `<th aria-label="Actions" />` IS a column — the enrollments and
 * webhook tables each have one — so its accessible name comes from the
 * attribute. Returning the raw JSX for anything else is deliberate: if a header
 * ever holds an element rather than text, `parseTables` below fails loudly
 * rather than quietly dropping that column from the correspondence check.
 */
function headerNames(thead: string): string[] {
  return [...thead.matchAll(/<th\b([^>]*?)(?:\/>|>([^<]*)<\/th>)/g)].map((m) => {
    const text = (m[2] ?? '').trim();
    if (text) return text;
    return /aria-label="([^"]*)"/.exec(m[1])?.[1]?.trim() ?? '';
  });
}

/** `"Registry enrollments: authority, base URL and actions"` → the column list. */
function captionColumns(caption: string): string[] {
  const colon = caption.indexOf(': ');
  if (colon < 0) return [];
  return caption
    .slice(colon + 2)
    .split(/,\s*|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type ParsedTable = { file: string; caption: string; headers: string[] };

function parseTables(file: string, src: string): ParsedTable[] {
  // From the wrapper's table open tag to the end of its header row. Lazy, so
  // two tables in one file (run-trust-panel) parse as two.
  const blocks = [...src.matchAll(/<table className="data-table[\s\S]*?<\/thead>/g)].map((m) => m[0]);
  return blocks.map((block) => {
    const caption = /<caption className="sr-only">([^<]*)<\/caption>/.exec(block)?.[1]?.trim() ?? '';
    const headers = headerNames(block);
    // A `<th>` that held an element instead of text would be silently skipped
    // by the matcher, which would weaken the set-equality below into something
    // that passes for the wrong reason. Count first, compare second.
    const declared = (block.match(/<th\b/g) ?? []).length;
    expect(headers.length, `${file}: a <th> was not parseable as plain text or aria-label`).toBe(declared);
    return { file, caption, headers };
  });
}

const TABLES = FILES.flatMap((f) => parseTables(f, SOURCES.get(f)!));

describe('every data-table in the repo is wrapped', () => {
  it('discovers the call sites rather than being told them', () => {
    // A lower bound, not an equality: a legitimately-wrapped twelfth table must
    // not turn this red. The per-table checks below are what an unwrapped one
    // fails, and they now run on files that did not exist when this was written.
    expect(FILES.length).toBeGreaterThanOrEqual(10);
    expect(TABLES.length).toBeGreaterThanOrEqual(11);
    // And the walker really reaches both roots, so a discovery bug that returns
    // only `components/` cannot pass by coincidence.
    expect(FILES.some((f) => f.startsWith('app/'))).toBe(true);
    expect(FILES.some((f) => f.startsWith('components/'))).toBe(true);
  });

  it.each(FILES)('%s wraps each of its tables', (file) => {
    const src = SOURCES.get(file)!;
    const opens = [...src.matchAll(/<table className="data-table/g)];
    expect(opens.length).toBeGreaterThan(0);
    for (const open of opens) {
      // Walk BACKWARDS from the table to the nearest tag open. `<TableScroll[^>]*>`
      // would false-fail the day a label holds a `>` inside an expression; this
      // asks the question that actually matters — what is the immediately
      // enclosing element — and cannot be satisfied by a `TableScroll` that sits
      // elsewhere in the file.
      const before = src.slice(0, open.index).trimEnd();
      expect(before.endsWith('>'), `${file}: table is not the first child of anything`).toBe(true);
      const openedAt = before.lastIndexOf('<');
      expect(
        before.slice(openedAt).startsWith('<TableScroll'),
        `${file}: table at ${open.index} is wrapped by ${before.slice(openedAt, openedAt + 24)}…, not <TableScroll>`,
      ).toBe(true);
    }
  });

  it('gives every wrapper a literal, non-empty, non-over-claiming label', () => {
    for (const [file, src] of SOURCES) {
      const tags = (src.match(/<TableScroll\b/g) ?? []).length;
      const labels = [...src.matchAll(/<TableScroll label="([^"]*)"/g)].map((m) => m[1]);
      // Without this, the loop below is vacuous for any site that passes an
      // expression (`label={x}`) or puts another prop first — the exact shapes a
      // "every wrapper is labelled" check is supposed to catch.
      expect(labels.length, `${file}: a <TableScroll> has no literal label= as its first prop`).toBe(tags);
      for (const label of labels) {
        expect(label.trim().length, `${file}: empty TableScroll label`).toBeGreaterThan(3);
        // "Agent inventory, scrollable" was the first draft. A name should say
        // what the thing IS; whether it scrolls is a property of the moment
        // (it does not, on a wide screen) and assistive tech announces the
        // scroll container itself. Naming it in the label states as fact
        // something that is often false.
        expect(label.toLowerCase(), `${file}: label narrates its own scrollability`).not.toContain('scroll');
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Caption ↔ header correspondence.
//
// The gate above proves a caption EXISTS. That is not the property worth having:
// the first version of this change had all eleven captions present, non-empty
// and over three characters, and SIX of them described columns the table does
// not have — including `app/security/page.tsx`, whose table is the revocation
// feed and whose caption called it "Registry signing keys". A caption is read
// instead of the header row by exactly the users who cannot see the header row,
// so a wrong one is worse than none.
//
// Both directions are asserted, because they fail independently: a caption can
// omit a real column (incomplete) or name an absent one (false).
// ══════════════════════════════════════════════════════════════════════
describe('each caption enumerates its table’s real columns', () => {
  it.each(TABLES.map((t, i) => [`${t.file} #${i}`, t] as const))(
    '%s names exactly its <th> set',
    (_id, table) => {
      expect(table.headers.length, 'a table with no parsed headers').toBeGreaterThan(0);
      expect(table.caption, `${table.file}: caption must be "<name>: <col>, <col> and <col>"`).toContain(': ');
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const named = captionColumns(table.caption).map(norm).sort();
      const actual = table.headers.map(norm).sort();
      // Set equality, not `toContain`. `toContain` in one direction alone is
      // what let "Registry signing keys" survive: every word it needed was
      // absent, and nothing asked whether the words present were real.
      expect(named, `${table.file}: caption "${table.caption}" vs headers [${table.headers.join(' | ')}]`).toEqual(
        actual,
      );
    },
  );
});

// ══════════════════════════════════════════════════════════════════════
// Real consumer renders. The source gates above can be satisfied by text that
// does not compile into the shape it looks like; these prove the rendered DOM —
// and re-run the correspondence check against what a browser would actually
// build, where the caption and the headers are elements rather than regex hits.
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

const REVOKED = {
  eventId: 'ev-1',
  ctxId: 'acdp://registry-a.playground.local/ctx-1',
  status: 'revoked_at_or_after' as const,
  boundary: '2026-08-01 00:00:00+00',
  trustClass: 'producer_signed' as const,
  sources: [],
};

describe('the rendered DOM at four real call sites', () => {
  it.each([
    ['EventsTable', 1, () => render(<EventsTable events={[EVENT]} />)],
    ['RecentRunsTable', 1, () => render(<RecentRunsTable runs={[RUN]} scenarioName={(id: string) => id} />)],
    ['RunsTable', 1, () => render(<RunsTable runs={[RUN]} scenarioName={(id: string) => id} />)],
    ['RunTrustPanel', 2, () => render(<RunTrustPanel trust={summary({ revoked: [REVOKED] })} />)],
  ] as const)('%s puts each table in a named focusable group that matches its caption', (_name, count, mount) => {
    const { container } = mount();
    const tables = [...container.querySelectorAll('table.data-table')];
    expect(tables).toHaveLength(count);
    for (const table of tables) {
      const group = table.parentElement as HTMLElement;
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-label')?.length ?? 0).toBeGreaterThan(3);
      expect(group.tabIndex).toBe(0);

      // The same correspondence as the source gate, but through the DOM: this
      // reads the `<th>` elements a browser builds and the caption it announces,
      // so a header emitted by a map or a caption assembled from a variable is
      // still held to it.
      const caption = table.querySelector('caption.sr-only')?.textContent ?? '';
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const headers = [...table.querySelectorAll('thead th')].map((th) =>
        norm(th.textContent || th.getAttribute('aria-label') || ''),
      );
      expect(headers.every((h) => h.length > 0)).toBe(true);
      expect(captionColumns(caption).map(norm).sort()).toEqual([...headers].sort());
    }
    // The container is never a landmark, at any call site.
    expect(container.querySelectorAll('[role="region"]')).toHaveLength(0);
  });
});

describe('the run trust panel keeps the spacing it had', () => {
  it('moves the conditional margin onto the wrapper and still applies it', () => {
    // The margin was inline on the `<table>`. A margin on a child of an
    // `overflow` container still applies, but the visual result differs once the
    // child can be wider than the parent — so it belongs on the wrapper, and
    // this asserts it arrived there rather than being dropped in the move.
    const { container } = render(<RunTrustPanel trust={summary({ revoked: [REVOKED] })} />);
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

describe('the lineage page’s two flex rows can shrink', () => {
  // Not tables, but the same defect and the same page. Asserted on the source
  // because the page needs a router, a query client and three hooks to render,
  // none of which these claims depend on.
  const src = readFileSync(join(process.cwd(), 'app/lineage/page.tsx'), 'utf8').replace(/\s+/g, ' ');

  it('caps the run picker at the container width', () => {
    // A fixed 320px child in a non-wrapping flex row cannot shrink, so it pushed
    // `.content` sideways exactly as the tables did.
    expect(src).toMatch(/flexWrap: 'wrap'[^}]*justifyContent: 'flex-end'/);
    expect(src).toMatch(/width: 320, maxWidth: '100%'/);
  });

  it('lets the lineage_id input shrink below its intrinsic width', () => {
    // Missed on the first pass, and the subtler of the two: `flex: 1` is
    // `1 1 0%`, but a flex item's `min-width` is `auto`, which for a text input
    // resolves to the intrinsic width of its default `size=20` — about 180px it
    // will not give up. With the fixed 130px select and the button beside it the
    // row cannot fit 400px. `minWidth: 0` is the half that actually lets it
    // shrink, so both halves are pinned.
    expect(src).toMatch(/flex: 1, minWidth: 0/);
    expect(src).toMatch(/display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14/);
  });
});
