import { NextRequest } from 'next/server';
import { buildUpstreamUrl, getIntegrationConfig } from '@/lib/server/integrations';

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
    });

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
