import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicMode } from '@/lib/server/public-mode';

afterEach(() => vi.restoreAllMocks());

describe('isPublicMode — strict parser', () => {
  it.each(['on', 'true', '1', 'ON', ' True '])('%j is on', (v) => {
    expect(isPublicMode({ ACDP_UI_PUBLIC_MODE: v })).toBe(true);
  });

  it.each([undefined, '', 'off', 'false', '0', 'OFF'])('%j is off, silently', (v) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isPublicMode({ ACDP_UI_PUBLIC_MODE: v })).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(['yes', 'enabled', 'onn', '2'])('%j is off with a warning (fails toward the password gate)', (v) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isPublicMode({ ACDP_UI_PUBLIC_MODE: v })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    // The value itself is never logged.
    expect(String(warn.mock.calls[0][0])).not.toContain(v);
  });
});
