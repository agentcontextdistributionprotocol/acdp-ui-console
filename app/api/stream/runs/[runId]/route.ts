import { NextRequest } from 'next/server';
import { buildUpstreamUrl, upstreamAuthHeaders } from '@/lib/server/integrations';
import { getClientIp } from '@/lib/server/client-ip';
import { relayEventStream } from '@/lib/server/sse-relay';

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
      // The playground key and the end user's IP, like every playground call
      // through the proxy route; never inherited from the client.
      headers: {
        accept: 'text/event-stream',
        ...upstreamAuthHeaders('playground', { clientIp: getClientIp(request.headers) }),
      },
      cache: 'no-store',
      signal: request.signal,
      // This relay now carries the playground key, so following a same-origin
      // redirect would hand it to a path the playground chose; and any
      // redirect would relay the target's bytes as though the playground had
      // sent them. Deliberately identical to the control-plane relay.
      redirect: 'manual',
    });

    // Explicit, before the generic bail, so an operator gets the sentence that
    // names the fix rather than a bare "upstream returned 302". Kept clause-for
    // -clause identical to the control-plane relay, `opaqueredirect` included —
    // see the longer note there for why that arm exists and why the whole 3xx
    // range, 304 included, is refused. `relayEventStream` also refuses a 200
    // whose content-type is not `text/event-stream` — see its own doc.
    return relayEventStream('playground', upstreamUrl, upstream);
  } catch (err) {
    return new Response(`stream relay failed: ${String(err)}`, { status: 502 });
  }
}
