import { describe, expect, it } from 'vitest';
import {
  FixedWindowRateLimiter,
  INSTANCE_KEY,
  RATE_LIMIT_POLICIES,
  STREAM_MAX_DURATION_SECONDS,
  StreamGate,
  consoleStreamGate,
  rateLimitKey,
  type RateLimitCheck,
} from '@/lib/server/rate-limit';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const read = (ip: string): RateLimitCheck => ({ policy: 'read', key: rateLimitKey(ip) });
const launch = (ip: string): RateLimitCheck => ({ policy: 'launch', key: rateLimitKey(ip) });
const cpRead = (ip: string): RateLimitCheck[] => [
  read(ip),
  { policy: 'cp-read-ip', key: rateLimitKey(ip) },
  { policy: 'cp-read', key: INSTANCE_KEY },
];

describe('policies', () => {
  it('are the briefed numbers', () => {
    expect(RATE_LIMIT_POLICIES.read).toEqual({ limit: 300, windowMs: 60_000 });
    expect(RATE_LIMIT_POLICIES.launch).toEqual({ limit: 5, windowMs: 600_000 });
    expect(RATE_LIMIT_POLICIES['cp-read']).toEqual({ limit: 150, windowMs: 60_000 });
    expect(RATE_LIMIT_POLICIES['cp-read-ip']).toEqual({ limit: 30, windowMs: 60_000 });
    expect(RATE_LIMIT_POLICIES.login).toEqual({ limit: 10, windowMs: 600_000 });
  });
});

describe('FixedWindowRateLimiter', () => {
  it('(1) refuses the 301st read in a window with retryAfter in [1,60]', () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter(c.now);
    for (let i = 0; i < 300; i++) expect(rl.consume([read('203.0.113.1')]).allowed).toBe(true);
    c.advance(12_345);
    const r = rl.consume([read('203.0.113.1')]);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.policy).toBe('read');
    expect(r.limit).toBe(300);
    expect(r.retryAfterSeconds).toBe(48);
    expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('retryAfter never drops below 1 just before the window ends', () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter(c.now);
    for (let i = 0; i < 5; i++) rl.consume([launch('203.0.113.1')]);
    c.advance(600_000 - 1);
    const r = rl.consume([launch('203.0.113.1')]);
    expect(r.allowed === false && r.retryAfterSeconds).toBe(1);
  });

  it('(2) refuses the 6th launch in 600s while reads for the same IP still pass', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let i = 0; i < 5; i++) expect(rl.consume([read('203.0.113.2'), launch('203.0.113.2')]).allowed).toBe(true);
    const sixth = rl.consume([read('203.0.113.2'), launch('203.0.113.2')]);
    expect(sixth.allowed === false && sixth.policy).toBe('launch');
    expect(rl.consume([read('203.0.113.2')]).allowed).toBe(true);
  });

  it('(6) a refused consume changes no bucket', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let i = 0; i < 5; i++) rl.consume([read('203.0.113.3'), launch('203.0.113.3')]);
    // 100 refused launches must not spend 100 read tokens.
    for (let i = 0; i < 100; i++) expect(rl.consume([read('203.0.113.3'), launch('203.0.113.3')]).allowed).toBe(false);
    for (let i = 0; i < 295; i++) expect(rl.consume([read('203.0.113.3')]).allowed).toBe(true);
    expect(rl.consume([read('203.0.113.3')]).allowed).toBe(false);
  });

  it('(6) a refusal by a later policy leaves an earlier, not-yet-existing bucket uncreated', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let i = 0; i < 150; i++) rl.consume([{ policy: 'cp-read', key: INSTANCE_KEY }]);
    const before = rl.size;
    const r = rl.consume(cpRead('203.0.113.4'));
    expect(r.allowed === false && r.policy).toBe('cp-read');
    expect(rl.size).toBe(before);
  });

  it('(3) different IPs are independent', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let i = 0; i < 5; i++) rl.consume([launch('203.0.113.5')]);
    expect(rl.consume([launch('203.0.113.5')]).allowed).toBe(false);
    expect(rl.consume([launch('203.0.113.6')]).allowed).toBe(true);
  });

  it('(4) allows again exactly at resetAt', () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter(c.now);
    for (let i = 0; i < 5; i++) rl.consume([launch('203.0.113.7')]);
    c.advance(600_000 - 1);
    expect(rl.consume([launch('203.0.113.7')]).allowed).toBe(false);
    c.advance(1);
    expect(rl.consume([launch('203.0.113.7')]).allowed).toBe(true);
  });

  it('(9) one IP exhausting cp-read-ip leaves another IP able to make a CP read', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let i = 0; i < 30; i++) expect(rl.consume(cpRead('203.0.113.8')).allowed).toBe(true);
    const r = rl.consume(cpRead('203.0.113.8'));
    expect(r.allowed === false && r.policy).toBe('cp-read-ip');
    expect(rl.consume(cpRead('203.0.113.9')).allowed).toBe(true);
  });

  it('the instance cp-read budget is shared across IPs', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let ip = 0; ip < 5; ip++) {
      for (let i = 0; i < 30; i++) expect(rl.consume(cpRead(`198.51.100.${ip}`)).allowed).toBe(true);
    }
    const r = rl.consume(cpRead('198.51.100.99'));
    expect(r.allowed === false && r.policy).toBe('cp-read');
  });

  it('reports the longest wait when several policies refuse', () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter(c.now);
    for (let i = 0; i < 5; i++) rl.consume([launch('203.0.113.10')]);
    c.advance(30_000);
    for (let i = 0; i < 300; i++) rl.consume([read('203.0.113.10')]);
    const r = rl.consume([read('203.0.113.10'), launch('203.0.113.10')]);
    expect(r.allowed === false && r.policy).toBe('read');
    expect(r.allowed === false && r.retryAfterSeconds).toBe(570);
  });

  it('(5) never tracks more than MAX_BUCKETS, and keeps the instance bucket under an IP spray', () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter(c.now, RATE_LIMIT_POLICIES, 100);
    rl.consume([{ policy: 'cp-read', key: INSTANCE_KEY }]);
    for (let i = 0; i < 1000; i++) {
      rl.consume([read(`10.0.${i >> 8}.${i & 255}`)]);
      expect(rl.size).toBeLessThanOrEqual(100);
    }
    for (let i = 0; i < 149; i++) rl.consume([{ policy: 'cp-read', key: INSTANCE_KEY }]);
    expect(rl.consume([{ policy: 'cp-read', key: INSTANCE_KEY }]).allowed).toBe(false);
  });

  it('evicts the oldest live bucket, not the newest', () => {
    const rl = new FixedWindowRateLimiter(clock().now, RATE_LIMIT_POLICIES, 3);
    for (let i = 0; i < 5; i++) rl.consume([launch('203.0.113.40')]);
    for (let i = 0; i < 5; i++) rl.consume([launch('203.0.113.41')]);
    rl.consume([launch('203.0.113.42')]);
    rl.consume([launch('203.0.113.43')]);
    // .41 kept its count; .40 (the oldest) was evicted. Check .41 first:
    // re-creating .40 would itself evict the then-oldest bucket.
    expect(rl.consume([launch('203.0.113.41')]).allowed).toBe(false);
    expect(rl.consume([launch('203.0.113.40')]).allowed).toBe(true);
  });

  it('prunes expired buckets before evicting live ones', () => {
    const c = clock();
    const rl = new FixedWindowRateLimiter(c.now, RATE_LIMIT_POLICIES, 3);
    rl.consume([launch('203.0.113.20')]);
    rl.consume([read('203.0.113.21')]);
    rl.consume([read('203.0.113.22')]);
    c.advance(60_000);
    rl.consume([read('203.0.113.23')]);
    expect(rl.size).toBe(2);
    for (let i = 0; i < 4; i++) rl.consume([launch('203.0.113.20')]);
    expect(rl.consume([launch('203.0.113.20')]).allowed).toBe(false);
  });

  it('reset clears every bucket', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let i = 0; i < 5; i++) rl.consume([launch('203.0.113.30')]);
    rl.reset();
    expect(rl.size).toBe(0);
    expect(rl.consume([launch('203.0.113.30')]).allowed).toBe(true);
  });
});

describe('rateLimitKey', () => {
  it('(7) buckets IPv6 by /64', () => {
    expect(rateLimitKey('2001:db8:1:2::1')).toBe(rateLimitKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
    expect(rateLimitKey('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:0db8:0001:0002:0:0:0:9')).toBe('2001:db8:1:2::/64');
    expect(rateLimitKey('2001:db8:1:3::1')).not.toBe(rateLimitKey('2001:db8:1:2::1'));
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKey('64:ff9b::1.2.3.4')).toBe('64:ff9b:0:0::/64');
  });

  it('(7) two addresses in one /64 share a limiter bucket', () => {
    const rl = new FixedWindowRateLimiter(clock().now);
    for (let i = 0; i < 5; i++) rl.consume([launch(`2001:db8:aa:bb::${i + 1}`)]);
    expect(rl.consume([launch('2001:db8:aa:bb:1234::9')]).allowed).toBe(false);
  });

  it('maps IPv4-mapped IPv6 to IPv4 and leaves IPv4 and unknown alone', () => {
    expect(rateLimitKey('::ffff:203.0.113.1')).toBe('203.0.113.1');
    expect(rateLimitKey('::FFFF:cb00:7101')).toBe('203.0.113.1');
    expect(rateLimitKey('203.0.113.1')).toBe('203.0.113.1');
    expect(rateLimitKey('unknown')).toBe('unknown');
  });
});

describe('StreamGate', () => {
  const opts = { perIp: 4, total: 200, ttlMs: 65_000 };

  it('(8) refuses the 5th concurrent stream per IP; releasing frees a slot', () => {
    const g = new StreamGate(opts, clock().now);
    const held = Array.from({ length: 4 }, () => g.acquire('a'));
    expect(held.every((h) => h.allowed)).toBe(true);
    const fifth = g.acquire('a');
    expect(fifth.allowed === false && fifth.scope).toBe('ip');
    expect(g.acquire('b').allowed).toBe(true);
    const first = held[0];
    if (first.allowed) first.release();
    expect(g.acquire('a').allowed).toBe(true);
  });

  it('(8) refuses the 201st concurrent stream per instance', () => {
    const g = new StreamGate(opts, clock().now);
    for (let i = 0; i < 200; i++) expect(g.acquire(`ip-${i}`).allowed).toBe(true);
    const r = g.acquire('ip-new');
    expect(r.allowed === false && r.scope).toBe('instance');
    expect(r.allowed === false && r.limit).toBe(200);
  });

  it('(8) an unreleased slot lapses after the ttl (maxDuration + 5 s)', () => {
    const c = clock();
    const g = new StreamGate(opts, c.now);
    for (let i = 0; i < 4; i++) g.acquire('a');
    c.advance(64_999);
    const r = g.acquire('a');
    expect(r.allowed === false && r.retryAfterSeconds).toBe(1);
    c.advance(1);
    expect(g.acquire('a').allowed).toBe(true);
    expect(g.size).toBe(1);
  });

  it('release is idempotent and never frees another stream', () => {
    const g = new StreamGate({ perIp: 2, total: 10, ttlMs: 65_000 }, clock().now);
    const a = g.acquire('a');
    g.acquire('a');
    if (a.allowed) {
      a.release();
      a.release();
    }
    expect(g.size).toBe(1);
    expect(g.acquire('a').allowed).toBe(true);
    expect(g.acquire('a').allowed).toBe(false);
  });

  it('the shared gate uses the briefed caps and maxDuration + 5 s', () => {
    consoleStreamGate.reset();
    const held = Array.from({ length: 4 }, () => consoleStreamGate.acquire('x'));
    expect(consoleStreamGate.acquire('x').allowed).toBe(false);
    for (const h of held) if (h.allowed) h.release();
    expect(consoleStreamGate.size).toBe(0);
    for (let i = 0; i < 200; i++) consoleStreamGate.acquire(`ip-${i}`);
    const r = consoleStreamGate.acquire('ip-new');
    expect(r.allowed === false && r.scope).toBe('instance');
    expect(r.allowed === false && r.retryAfterSeconds).toBe(65);
    consoleStreamGate.reset();
  });

  it('STREAM_MAX_DURATION_SECONDS matches both stream routes', async () => {
    const events = await import('@/app/api/stream/events/route');
    const runs = await import('@/app/api/stream/runs/[runId]/route');
    expect(events.maxDuration).toBe(STREAM_MAX_DURATION_SECONDS);
    expect(runs.maxDuration).toBe(STREAM_MAX_DURATION_SECONDS);
  });
});
