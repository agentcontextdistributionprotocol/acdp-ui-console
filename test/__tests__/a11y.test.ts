import { describe, expect, it, vi } from 'vitest';
import { pressable } from '@/lib/utils/a11y';

describe('pressable', () => {
  it('exposes button semantics', () => {
    const props = pressable(() => {}, 'Open run');
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
    expect(props['aria-label']).toBe('Open run');
  });

  it('fires onClick for Enter and Space, ignores others', () => {
    const onClick = vi.fn();
    const props = pressable(onClick);
    const make = (key: string) => ({ key, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent;

    props.onKeyDown(make('Enter'));
    props.onKeyDown(make(' '));
    props.onKeyDown(make('a'));

    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
