// Stateless, HMAC-signed session token for the single-operator passphrase
// gate enforced by `middleware.ts` (see plans/wave4-ui-fixes.md Phase UI-6).
//
// No session store: the token carries its own expiry and is verified with
// Web Crypto's `subtle.verify`, which compares MACs in constant time. Web
// Crypto (`globalThis.crypto.subtle`) is available identically in the Edge
// middleware runtime and in Node route handlers, so this needs no new
// dependency and no runtime pragma.
//
// The signing key itself is never the raw password — it's derived via HKDF
// (RFC 5869) so the password is never used directly as an HMAC key.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // ~12h
const HKDF_SALT = 'acdp-ui-console-session-v1';
const HKDF_INFO = 'acdp-ui-console-session-hmac';

export const SESSION_COOKIE_NAME = 'acdp_ui_session';
export const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveHmacKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(HKDF_INFO) },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

/** Mints a signed session token valid for `SESSION_TTL_MS` from now. */
export async function createSessionToken(password: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })));
  const key = await deriveHmacKey(password);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/**
 * Verifies a session token against `password`: well-formed, HMAC valid
 * (constant-time), and not expired. Never throws — any malformed input is
 * simply an invalid session.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  password: string,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64Url(signature);
  } catch {
    return false;
  }

  const key = await deriveHmacKey(password);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(signatureBytes),
    new TextEncoder().encode(payload),
  );
  if (!valid) return false;

  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { exp?: unknown };
    return typeof decoded.exp === 'number' && Date.now() < decoded.exp;
  } catch {
    return false;
  }
}

/**
 * Constant-time-ish comparison of the login passphrase against the
 * configured secret. Comparing fixed-length SHA-256 digests (rather than the
 * raw strings) means the loop below never short-circuits on length or
 * content, at the negligible cost of a theoretical hash collision.
 */
export async function passphraseMatches(candidate: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(candidate)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
