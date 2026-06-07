import { NextRequest } from 'next/server';
import {
  buildUpstreamUrl,
  getIntegrationConfig,
  isProxyService,
  type ProxyService,
} from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';

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
    if (['host', 'connection', 'content-length'].includes(key.toLowerCase())) return;
    headers.set(key, value);
  });

  if (config.authToken && config.authHeaderName === 'authorization') {
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
    responseHeaders.delete('content-encoding');

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
