/**
 * `ACDP_UI_PUBLIC_MODE`: whether anonymous visitors may use the console's
 * public routes (see `lib/server/proxy-allowlist.ts`). Server-only, read per
 * request so a redeploy-free env change takes effect, and dependency-free so
 * the edge `middleware.ts` and the Node route handlers parse it identically.
 *
 * Strict on purpose: only `on`, `true` or `1` (any case) turn it on. Unset,
 * empty, `off`, `false` and `0` are off. Anything else is a typo, and a typo
 * must fail toward the password gate, not toward an open console, so it reads
 * as off and logs a warning.
 */
const ON = new Set(['on', 'true', '1']);
const OFF = new Set(['', 'off', 'false', '0']);

let warnedValue: string | undefined;

export function isPublicMode(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.ACDP_UI_PUBLIC_MODE;
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (ON.has(value)) return true;
  if (!OFF.has(value) && warnedValue !== value) {
    warnedValue = value;
    console.warn(
      `[ACDP UI] ACDP_UI_PUBLIC_MODE has an unrecognised value; treating it as off (password gate). Use on/true/1 or off/false/0.`,
    );
  }
  return false;
}
