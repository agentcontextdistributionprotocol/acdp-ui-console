/** The two upstreams these relays can name in a refusal message. */
export type SseUpstreamService = 'control-plane' | 'playground';

/**
 * Essence comparison, not `startsWith`: `text/event-stream-foo` must be
 * refused, and `text/event-stream; charset=utf-8` / `TEXT/EVENT-STREAM` must
 * not. A missing header refuses too — `EventSource` on a direct connection
 * fails a response whose MIME essence is not `text/event-stream`, absent
 * included, and relaying overwrites the header before the browser ever sees
 * it, which is exactly the check this restores.
 */
function isEventStream(contentType: string | null): boolean {
  if (contentType === null) return false;
  return contentType.split(';')[0].trim().toLowerCase() === 'text/event-stream';
}

/**
 * Turns an already-fetched upstream `Response` into the browser-facing relay
 * response: refuses a 3xx (`redirect: 'manual'` already resolved it to a real
 * status rather than following it), a non-2xx or bodyless response, and a 200
 * whose `content-type` is not `text/event-stream` — then relays anything else
 * as a live event stream.
 *
 * Ordering is load-bearing: the `!ok || !body` gate runs BEFORE the
 * content-type check, so a 404-with-HTML still reads `upstream returned 404`
 * rather than being relabelled as a content-type mismatch — the new refusal
 * below only ever fires for a 200 with the wrong label.
 *
 * None of these refusals set `x-acdp-ui-proxy` — neither relay stamps that
 * header on any path today, only `app/api/proxy/[service]/[...path]/route.ts`
 * does, and a stamped 502 here would report the console's own upstream
 * problem as the service itself answering degraded.
 */
export function relayEventStream(
  service: SseUpstreamService,
  upstreamUrl: string,
  upstream: Response,
): Response {
  if ((upstream.status >= 300 && upstream.status < 400) || upstream.type === 'opaqueredirect') {
    const location = upstream.headers.get('location');
    const answered = upstream.type === 'opaqueredirect' ? 'an opaque redirect' : `${upstream.status}`;
    return new Response(
      `upstream '${service}' answered ${answered} — this relay does not follow 3xx responses. ` +
        `${upstreamUrl} -> ${location ?? '(no Location header)'}. Point this service's *_BASE_URL at ` +
        `the final URL (often the https:// form) so no request has to cross a redirect.`,
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`upstream returned ${upstream.status}`, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type');
  if (!isEventStream(contentType)) {
    return new Response(
      `upstream '${service}' answered 200 with content-type '${contentType ?? '(none)'}' — this relay ` +
        `only relays text/event-stream. ${upstreamUrl}. Point this service's *_BASE_URL at the SSE ` +
        `endpoint itself; an HTML error or login page answered here would otherwise reach the browser ` +
        `labelled as a live event feed.`,
      { status: 502 },
    );
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
}
