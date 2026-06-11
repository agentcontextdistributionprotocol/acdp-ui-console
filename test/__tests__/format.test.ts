import { describe, expect, it } from 'vitest';
import { timeAgo, elapsed, clockTime, formatNumber, formatBytes, shortId } from '@/lib/utils/format';

describe('timeAgo', () => {
  it('handles null and undefined', () => {
    expect(timeAgo(null)).toBe('—');
    expect(timeAgo(undefined)).toBe('—');
  });

  it('returns the em dash for an unparseable input', () => {
    expect(timeAgo('not-a-date')).toBe('—');
  });

  it('reports recent times', () => {
    expect(timeAgo(new Date())).toBe('just now');
  });

  it('clamps a future timestamp to "just now"', () => {
    expect(timeAgo(new Date(Date.now() + 60_000))).toBe('just now');
  });

  it('reports seconds, minutes, hours, and days', () => {
    expect(timeAgo(new Date(Date.now() - 30_000))).toBe('30s ago');
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toBe('5 min ago');
    expect(timeAgo(new Date(Date.now() - 3 * 3600_000))).toBe('3 hr ago');
    expect(timeAgo(new Date(Date.now() - 4 * 86_400_000))).toBe('4d ago');
  });

  it('falls back to a locale date beyond 30 days', () => {
    const old = new Date(Date.now() - 60 * 86_400_000);
    expect(timeAgo(old)).toBe(old.toLocaleDateString());
  });

  it('treats a sub-1e12 number as epoch seconds', () => {
    const secs = Math.floor(Date.now() / 1000) - 300;
    expect(timeAgo(secs)).toBe('5 min ago');
  });
});

describe('clockTime', () => {
  it('returns the em dash for null/undefined/invalid', () => {
    expect(clockTime(null)).toBe('—');
    expect(clockTime(undefined)).toBe('—');
    expect(clockTime('nonsense')).toBe('—');
  });

  it('formats a parseable timestamp as a wall clock', () => {
    expect(clockTime('2020-01-01T14:03:21Z')).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});

describe('elapsed', () => {
  it('formats minutes:seconds', () => {
    const start = new Date(Date.now() - 24_000);
    expect(elapsed(start)).toMatch(/^0:2\d$/);
  });

  it('formats hours when long', () => {
    const start = new Date('2020-01-01T00:00:00Z');
    const end = new Date('2020-01-01T01:03:20Z');
    expect(elapsed(start, end)).toBe('1:03:20');
  });

  it('clamps a negative span to 0:00', () => {
    const start = new Date('2020-01-01T01:00:00Z');
    const end = new Date('2020-01-01T00:00:00Z');
    expect(elapsed(start, end)).toBe('0:00');
  });

  it('returns the em dash for an invalid date', () => {
    expect(elapsed('nope')).toBe('—');
  });
});

describe('formatNumber', () => {
  it('adds separators', () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
  });
  it('handles undefined, null, and NaN', () => {
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('0');
  });
});

describe('formatBytes', () => {
  it('formats bytes without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
  it('formats KB and MB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });
  it('treats falsy, NaN, and negative sizes as 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });
});

describe('shortId', () => {
  it('truncates long ids', () => {
    expect(shortId('abcdefghijklmnop', 4, 4)).toBe('abcd…mnop');
  });
  it('keeps ids at or below the head+tail+1 threshold', () => {
    expect(shortId('abc', 4, 4)).toBe('abc');
    expect(shortId('123456789', 4, 4)).toBe('123456789');
  });
  it('returns an empty string for null/undefined', () => {
    expect(shortId(null)).toBe('');
    expect(shortId(undefined)).toBe('');
  });
  it('uses the documented default head/tail', () => {
    expect(shortId('0123456789abcdef0123')).toBe('01234567…0123');
  });
});
