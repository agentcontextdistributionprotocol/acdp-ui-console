import { describe, expect, it } from 'vitest';
import { timeAgo, elapsed, formatNumber, formatBytes, shortId } from '@/lib/utils/format';

describe('timeAgo', () => {
  it('handles null', () => {
    expect(timeAgo(null)).toBe('—');
  });

  it('reports recent times', () => {
    expect(timeAgo(new Date())).toBe('just now');
  });

  it('reports minutes', () => {
    expect(timeAgo(new Date(Date.now() - 5 * 60_000))).toBe('5 min ago');
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
});

describe('formatNumber', () => {
  it('adds separators', () => {
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
  });
  it('handles undefined', () => {
    expect(formatNumber(undefined)).toBe('0');
  });
});

describe('formatBytes', () => {
  it('formats KB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });
  it('formats bytes', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
});

describe('shortId', () => {
  it('truncates long ids', () => {
    expect(shortId('abcdefghijklmnop', 4, 4)).toBe('abcd…mnop');
  });
  it('keeps short ids', () => {
    expect(shortId('abc', 4, 4)).toBe('abc');
  });
});
