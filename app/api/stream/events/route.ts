import { NextRequest } from 'next/server';
import { buildUpstreamUrl, getIntegrationConfig } from '@/lib/server/integrations';
import { relayEventStream } from '@/lib/server/sse-relay';

export const dynamic = 'force-dynamic';
// Keep the SSE relay alive past Vercel's default function timeout. Only
// exercised in real mode; demo mode replays the recorded stream client-side.
export const maxDuration = 60;

/** Relays the control-plane global SSE firehose (/events/stream). */
export async function GET(request: NextRequest) {
  const upstreamUrl = buildUpstreamUrl('control-plane', '/events/stream', request.nextUrl.search);

  // The control-plane firehose is auth-guarded; inject the server-side bearer
  // token the same way the proxy route does (never inherited from the client).
  const config = getIntegrationConfig('control-plane');
  const headers: Record<string, string> = { accept: 'text/event-stream' };
  if (config.authHeaderName === 'authorization' && config.authToken) {
    headers.authorization = `Bearer ${config.authToken}`;
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      headers,
      cache: 'no-store',
      signal: request.signal,
      // LOAD-BEARING. The default is `follow`, and it costs us two things.
      //
      // Measured on Node 24.20.0, precisely: a SAME-ORIGIN 302 (a path-only
      // `Location`) does deliver the bearer injected above — and the cookie —
      // to the redirect target. Cross-origin, undici strips both, comparing
      // full origin, so a scheme or port change does NOT leak the credential.
      // State it exactly: an overstated comment is the defect class #102 was
      // about. The narrower leak is still a leak, and it is the likelier shape
      // anyway, since a same-origin `Location` is what a misconfigured ingress
      // or a path-rewriting rule produces.
      //
      // The second cost applies to EVERY redirect, cross-origin included, and
      // is why the credential-free playground relay pins this too: the target's
      // bytes come back `status: 200` and stream to the browser under the named
      // service's identity. Measured: `data: evil-bytes` relayed as a healthy
      // control-plane feed.
      //
      // `manual` answers with the 3xx itself (`ok: false`, status and
      // `location` both readable) and never contacts the target. `error` was
      // rejected: it throws, collapsing into the catch below as
      // `stream relay failed: TypeError: fetch failed`, destroying the status
      // and the Location — the only diagnostic surface these routes have.
      redirect: 'manual',
    });

    // Explicit, before the generic bail, so an operator gets the sentence that
    // names the fix rather than a bare "upstream returned 302". Mirrors the
    // proxy route's redirect refusal so both perimeter surfaces answer alike —
    // including its `opaqueredirect` clause. undici returns the real 3xx
    // (verified on Node 24.20.0), but browser-semantics `fetch` answers
    // `redirect: 'manual'` with a synthetic `status: 0`, which the range check
    // alone would drop into the generic bail as `upstream returned 0`. No
    // credential escapes either way, so this is about the diagnostic, not the
    // fix — but `maxDuration = 60` marks these two as the routes most likely to
    // be moved to the edge runtime, which is exactly that scenario.
    //
    // The whole 3xx range, 304 included. These requests send no conditional
    // header (`cache: 'no-store'`, headers built from scratch), so a 304 is an
    // upstream misconfiguration; relaying one as a stream would be worse than
    // refusing it with slightly off advice. `relayEventStream` also refuses a
    // 200 whose content-type is not `text/event-stream` — see its own doc.
    return relayEventStream('control-plane', upstreamUrl, upstream);
  } catch (err) {
    return new Response(`stream relay failed: ${String(err)}`, { status: 502 });
  }
}
