import { NextRequest } from 'next/server';
import {
  buildUpstreamUrl,
  getIntegrationConfig,
  isProxyService,
  type ProxyService,
} from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';

// Only forward a known-safe set of request headers upstream. Notably this
// excludes the browser's cookies and any client-supplied `authorization`, so a
// client can't borrow the proxy's trust (confused-deputy). The control-plane
// bearer token is injected server-side below.
const FORWARD_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-language',
  'idempotency-key',
  'x-tenant-id',
  'x-run-id',
  'x-acdp-event-id',
]);

async function forward(
  request: NextRequest,
  context: { params: Promise<{ service: string; path?: string[] }> },
) {
  const { service: rawService, path } = await context.params;
  if (!isProxyService(rawService)) {
    return new Response(JSON.stringify({ error: `Unknown service: ${rawService}` }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const service = rawService as ProxyService;
  const config = getIntegrationConfig(service);
  const upstreamUrl = buildUpstreamUrl(service, `/${(path ?? []).join('/')}`, request.nextUrl.search);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  // Authorization is set deterministically per service — never inherited from
  // the client. Only the control-plane gets the server-side bearer token.
  if (config.authHeaderName === 'authorization' && config.authToken) {
    headers.set('authorization', `Bearer ${config.authToken}`);
  }

  const method = request.method.toUpperCase();
  const body = ['GET', 'HEAD'].includes(method) ? undefined : await request.text();

  try {
    const response = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-acdp-ui-proxy', service);
    // The body is re-streamed decoded, so length/encoding framing no longer applies.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    responseHeaders.delete('transfer-encoding');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: `Upstream '${service}' unreachable`, detail: String(err) }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
