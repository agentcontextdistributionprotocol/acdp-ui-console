import type { KeyboardEvent } from 'react';

/**
 * Make a non-button element behave like a button for keyboard + screen-reader
 * users. Spread onto a clickable <div>/<tr>: `<tr {...pressable(onClick)}>`.
 */
export function pressable(onClick: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
  };
}
