import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils/cn';

describe('cn', () => {
  it('joins truthy class values', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values and honours conditional objects/arrays', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(cn('base', { active: true, hidden: false }, ['x', 0 && 'y'])).toBe('base active x');
  });

  it('returns an empty string with no inputs', () => {
    expect(cn()).toBe('');
  });
});
