import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  ACDP_UI_CONSOLE_PASSWORD,
  CONTROL_PLANE_API_KEY,
  CONTROL_PLANE_URL,
  PLAYGROUND_URL,
} from '../../playwright.config';

// CONTROL_PLANE_API_KEY is injected by the proxy route server-side and must
// never reach the browser (CLAUDE.md, "Architecture"). Unit tests lock the
// preferences store and the proxy's header handling; nothing else checks the
// thing that actually ships: the client bundle a production build emits and
// the bytes a real browser receives. A `NEXT_PUBLIC_` rename, an `env:` entry
// in next.config.ts, or a server module pulled into a 'use client' import
// graph would each inline the key here with every unit test still green.
//
// The webServer in playwright.config.ts builds with exactly these env values,
// so the build on disk is the build under test.

const SECRETS: Record<string, string> = {
  CONTROL_PLANE_API_KEY,
  ACDP_UI_CONSOLE_PASSWORD,
};
// Server-side upstream addresses. Only these two: the registry URLs collide
// with lib/data/mock-data.ts's demo dataset (`http://localhost:8100` is a
// mock `baseUrl`), which legitimately ships in the bundle for demo mode.
const SERVER_ONLY_URLS: Record<string, string> = {
  CONTROL_PLANE_BASE_URL: CONTROL_PLANE_URL,
  PLAYGROUND_BASE_URL: PLAYGROUND_URL,
};

const PAGES = [
  '/dashboard',
  '/scenarios',
  '/runs',
  '/events',
  '/contexts',
  '/lineage',
  '/trust',
  '/security',
  '/registries',
  '/agents',
  '/observability',
  '/config',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test.describe('Client bundle never carries server-side secrets (real production build)', () => {
  test('no file under .next/static contains the API key, the passphrase, or a server-only upstream URL', () => {
    const staticDir = path.join(__dirname, '../../.next/static');
    expect(existsSync(staticDir), 'expected the production build the webServer just made').toBe(true);
    const files = walk(staticDir);
    expect(files.length).toBeGreaterThan(0);

    const leaks: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, 'latin1');
      for (const [name, value] of Object.entries({ ...SECRETS, ...SERVER_ONLY_URLS })) {
        if (value && body.includes(value)) leaks.push(`${name} in ${path.relative(staticDir, file)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test('a browser session across every page talks only to the console origin and never receives a secret', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const offOrigin = new Set<string>();
    const leaks: string[] = [];
    const pending: Promise<void>[] = [];

    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.protocol.startsWith('http') && url.origin !== origin) offOrigin.add(url.origin);
      // The browser must never itself carry the bearer, even to its own origin.
      if (req.headers()['authorization']) leaks.push(`authorization header on ${url.pathname}`);
    });
    page.on('response', (res) => {
      const url = new URL(res.url());
      if (url.origin !== origin) return;
      for (const [name, value] of Object.entries(res.headers())) {
        for (const [secret, v] of Object.entries(SECRETS)) {
          if (value.includes(v)) leaks.push(`${secret} in response header ${name} of ${url.pathname}`);
        }
      }
      // SSE responses never end; their bodies cannot be awaited.
      if ((res.headers()['content-type'] ?? '').includes('text/event-stream')) return;
      pending.push(
        res
          .body()
          .then((buf) => {
            const body = buf.toString('latin1');
            for (const [secret, v] of Object.entries(SECRETS)) {
              if (body.includes(v)) leaks.push(`${secret} in body of ${url.pathname}`);
            }
          })
          .catch(() => {
            /* redirects and aborted navigations have no body */
          }),
      );
    });

    for (const route of PAGES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => {
        /* pages holding an SSE stream never go fully idle */
      });
    }
    await Promise.all(pending);

    expect([...offOrigin]).toEqual([]);
    expect(leaks).toEqual([]);
    // Nor in the live DOM, e.g. echoed into the Config page.
    const inDom = await page.evaluate((needle) => document.documentElement.outerHTML.includes(needle), CONTROL_PLANE_API_KEY);
    expect(inDom).toBe(false);
  });
});
