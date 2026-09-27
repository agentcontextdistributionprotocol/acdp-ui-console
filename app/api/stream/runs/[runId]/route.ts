import { NextRequest } from 'next/server';
import { buildUpstreamUrl } from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';
// Keep the SSE relay alive past Vercel's default function timeout. Only
// exercised in real mode; demo mode replays the recorded stream client-side.
export const maxDuration = 60;

/**
 * Relays the playground per-run SSE stream (/runs/{runId}/events) to the
 * browser so the upstream service never needs to be publicly reachable.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const upstreamUrl = buildUpstreamUrl('playground', `/runs/${encodeURIComponent(runId)}/events`);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { accept: 'text/event-stream' },
      cache: 'no-store',
      signal: request.signal,
      // This relay injects no bearer today, so its exposure is not a credential
      // leak but the other half of the same defect: the redirect target's bytes
      // relayed to the browser as though the playground had sent them. Pinned
      // here anyway, and deliberately identical to the control-plane relay —
      // the asymmetry would be a trap for whoever adds auth to the playground.
      redirect: 'manual',
    });

    // Explicit, before the generic bail, so an operator gets the sentence that
    // names the fix rather than a bare "upstream returned 302". Kept clause-for
    // -clause identical to the control-plane relay, `opaqueredirect` included —
    // see the longer note there for why that arm exists and why the whole 3xx
    // range, 304 included, is refused.
    if (
      (upstream.status >= 300 && upstream.status < 400) ||
      upstream.type === 'opaqueredirect'
    ) {
      const location = upstream.headers.get('location');
      const answered =
        upstream.type === 'opaqueredirect' ? 'an opaque redirect' : `${upstream.status}`;
      return new Response(
        `upstream 'playground' answered ${answered} — this relay does not follow 3xx responses. ` +
          `${upstreamUrl} -> ${location ?? '(no Location header)'}. Point this service's *_BASE_URL at ` +
          `the final URL (often the https:// form) so no request has to cross a redirect.`,
        { status: 502 },
      );
    }

    if (!upstream.ok || !upstream.body) {
      return new Response(`upstream returned ${upstream.status}`, { status: 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
  } catch (err) {
    return new Response(`stream relay failed: ${String(err)}`, { status: 502 });
  }
}
