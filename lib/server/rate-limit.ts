import { isIP } from 'node:net';

/**
 * In-memory, per-IP rate limiting for the console's proxy and stream routes.
 *
 * CAVEAT — per instance, by design. Counters live in this server instance's
 * memory (no KV/Upstash: the ACDP leader ruled a shared store out). Vercel runs
 * this project with Fluid compute (`resourceConfig.fluid: true`, checked
 * 2026-11-07), so one warm instance serves many concurrent requests and these
 * counters are shared across them. But several instances can be warm at once,
 * each with its own counters, so the effective limit is roughly
 * `limit × warm instances`, and a cold start resets them. That is still a real
 * brake on one abusive client. The durable limits live upstream: the
 * playground's Postgres per-IP LLM quota, its `MAX_CONCURRENT_RUNS`, and its
 * own per-IP run limit, all charged to the `X-ACDP-Client-IP` this console
 * forwards (`lib/server/client-ip.ts`).
 *
 * Fixed windows, ported from macp-ui-console `lib/server/rate-limit.ts`, with
 * one deliberate change: `consume` is atomic across several policies. It checks
 * every bucket first and commits only if all of them allow, so a refused
 * launch never spends the same request's read token (MACP's `check()`
 * increments as it goes).
 */

export type RateLimitPolicyName = 'read' | 'launch' | 'cp-read' | 'cp-read-ip' | 'login';

export interface RateLimitPolicy {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES: Record<RateLimitPolicyName, RateLimitPolicy> = {
  // Generous enough for a page load fanning out to ~10 queries plus polling.
  read: { limit: 300, windowMs: 60_000 },
  // Playground POST /runs: each launch can make real LLM calls.
  launch: { limit: 5, windowMs: 10 * 60_000 },
  // Instance-wide budget for anonymous control-plane reads (ONE shared key),
  // below CP's own default throttle of 200/60s per token, so visitors run out
  // here, with a friendly 429, before the control plane starts refusing the
  // console's key for everyone.
  'cp-read': { limit: 150, windowMs: 60_000 },
  // Per-IP slice of that budget, so one visitor cannot drain it for the rest.
  'cp-read-ip': { limit: 30, windowMs: 60_000 },
  // POST /api/auth/login attempts per IP.
  login: { limit: 10, windowMs: 10 * 60_000 },
};

/** The key `cp-read` is counted under: one bucket per instance, not per IP. */
export const INSTANCE_KEY = '*';

export interface RateLimitCheck {
  policy: RateLimitPolicyName;
  /** The bucket key, normally `rateLimitKey(ip)`, or `INSTANCE_KEY`. */
  key: string;
}

export type ConsumeResult =
  | { allowed: true }
  | {
      allowed: false;
      /** The first policy that refused, in the order the checks were given. */
      policy: RateLimitPolicyName;
      limit: number;
      /** Seconds until every refusing bucket has reset; at least 1. */
      retryAfterSeconds: number;
    };

interface Bucket {
  count: number;
  resetAt: number;
}

/** Hard cap on tracked buckets, so a spray of distinct IPs cannot grow memory without bound. */
export const MAX_BUCKETS = 50_000;

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly policies: Record<RateLimitPolicyName, RateLimitPolicy> = RATE_LIMIT_POLICIES,
    private readonly maxBuckets: number = MAX_BUCKETS,
  ) {}

  /**
   * Spend one token from every listed bucket, or from none. A refusal leaves
   * every bucket exactly as it was.
   */
  consume(checks: readonly RateLimitCheck[]): ConsumeResult {
    const now = this.now();
    let refused: { policy: RateLimitPolicyName; limit: number } | undefined;
    let retryAfterMs = 0;
    for (const { policy, key } of checks) {
      const { limit } = this.policies[policy];
      const bucket = this.buckets.get(bucketId(policy, key));
      const live = bucket && bucket.resetAt > now ? bucket : undefined;
      if (live && live.count >= limit) {
        refused ??= { policy, limit };
        retryAfterMs = Math.max(retryAfterMs, live.resetAt - now);
      }
    }
    if (refused) {
      return { allowed: false, ...refused, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    for (const { policy, key } of checks) {
      const id = bucketId(policy, key);
      const bucket = this.buckets.get(id);
      if (bucket && bucket.resetAt > now) {
        bucket.count += 1;
        continue;
      }
      if (!bucket && this.buckets.size >= this.maxBuckets) this.prune(now);
      // Delete first so a renewed bucket moves to the end of insertion order,
      // which is what `prune` treats as newest.
      this.buckets.delete(id);
      this.buckets.set(id, { count: 1, resetAt: now + this.policies[policy].windowMs });
    }
    return { allowed: true };
  }

  /** Tracked bucket count (tests and diagnostics). */
  get size(): number {
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }

  private prune(now: number): void {
    for (const [id, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(id);
    }
    // Still full of live buckets: drop the oldest insertions rather than
    // refuse to track new clients. Never an instance-wide bucket: an IP spray
    // is exactly when the `cp-read` budget must not quietly reset. Frees 1% at
    // once, so a sustained spray pays this full scan once per ~500 new keys,
    // not on every request.
    let overflow = this.buckets.size - this.maxBuckets + Math.max(1, Math.floor(this.maxBuckets / 100));
    for (const id of this.buckets.keys()) {
      if (overflow <= 0) break;
      if (id.endsWith(`|${INSTANCE_KEY}`)) continue;
      this.buckets.delete(id);
      overflow -= 1;
    }
  }
}

function bucketId(policy: RateLimitPolicyName, key: string): string {
  return `${policy}|${key}`;
}

/**
 * The bucket key for a client IP. IPv6 is bucketed by its /64, matching the
 * playground (`playground/security.py`), since one subscriber routinely holds a
 * whole /64 and could otherwise rotate addresses for fresh buckets. An
 * IPv4-mapped IPv6 address counts as the IPv4 address. Anything else (the
 * `unknown` bucket) is used as is.
 */
export function rateLimitKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const groups = expandIpv6(ip);
  // IPv4-mapped (::ffff:a.b.c.d, also written ::ffff:hhhh:hhhh) counts as IPv4.
  if (groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff') {
    const [hi, lo] = [parseInt(groups[6], 16), parseInt(groups[7], 16)];
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(ip: string): string[] {
  let text = ip.toLowerCase();
  // A trailing dotted quad (e.g. 64:ff9b::1.2.3.4) is two groups.
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (quad) {
    const [a, b, c, d] = quad.slice(1).map(Number);
    text = `${text.slice(0, quad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.includes('::') ? text.split('::') : [text, undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((g) => g.replace(/^0+(?=.)/, ''));
}

/** Process-wide limiter used by the proxy, stream and login routes. */
export const consoleRateLimiter = new FixedWindowRateLimiter();

/**
 * Concurrent SSE streams. A stream holds a function instance open for up to
 * `maxDuration`, so streams are capped by how many are open, not by a rate:
 * per IP (`perIp`) and per instance (`total`).
 *
 * Every slot carries its start time and lapses after `ttlMs` even if
 * `release` never runs, because a function killed at `maxDuration` runs no
 * cleanup. Set `ttlMs` to the stream route's `maxDuration` plus a margin.
 */
export interface StreamGateOptions {
  perIp: number;
  total: number;
  ttlMs: number;
}

export type StreamAcquireResult =
  | { allowed: true; release: () => void }
  | { allowed: false; scope: 'ip' | 'instance'; limit: number; retryAfterSeconds: number };

export class StreamGate {
  private readonly slots = new Map<number, { key: string; at: number }>();
  private nextId = 0;

  constructor(
    private readonly options: StreamGateOptions,
    private readonly now: () => number = Date.now,
  ) {}

  acquire(key: string): StreamAcquireResult {
    const now = this.now();
    this.expire(now);
    let forKey = 0;
    let oldestForKey = Infinity;
    let oldest = Infinity;
    for (const slot of this.slots.values()) {
      oldest = Math.min(oldest, slot.at);
      if (slot.key === key) {
        forKey += 1;
        oldestForKey = Math.min(oldestForKey, slot.at);
      }
    }
    const retryAfter = (at: number) => Math.max(1, Math.ceil((at + this.options.ttlMs - now) / 1000));
    if (forKey >= this.options.perIp) {
      return { allowed: false, scope: 'ip', limit: this.options.perIp, retryAfterSeconds: retryAfter(oldestForKey) };
    }
    if (this.slots.size >= this.options.total) {
      return { allowed: false, scope: 'instance', limit: this.options.total, retryAfterSeconds: retryAfter(oldest) };
    }
    const id = this.nextId++;
    this.slots.set(id, { key, at: now });
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        this.slots.delete(id);
      },
    };
  }

  /** Open slot count (tests and diagnostics). */
  get size(): number {
    this.expire(this.now());
    return this.slots.size;
  }

  reset(): void {
    this.slots.clear();
  }

  private expire(now: number): void {
    for (const [id, slot] of this.slots) {
      if (now - slot.at >= this.options.ttlMs) this.slots.delete(id);
    }
  }
}

/** Both stream routes export `maxDuration = 60`; slots lapse 5 s after it. */
export const STREAM_MAX_DURATION_SECONDS = 60;

/** Process-wide gate shared by both SSE relays. */
export const consoleStreamGate = new StreamGate({
  perIp: 4,
  total: 200,
  ttlMs: (STREAM_MAX_DURATION_SECONDS + 5) * 1000,
});
