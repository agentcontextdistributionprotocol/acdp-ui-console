/**
 * ACDP-specific parsing helpers.
 * ctx_id form:  acdp://<authority>/<uuid>
 * agent DID:    did:web:<authority>:agents:<name>
 */

export interface ParsedCtxId {
  authority: string;
  id: string;
  short: string;
}

export function parseCtxId(ctxId: string | null | undefined): ParsedCtxId | null {
  if (!ctxId) return null;
  const m = ctxId.match(/^acdp:\/\/([^/]+)\/(.+)$/);
  if (!m) return { authority: '', id: ctxId, short: ctxId };
  const [, authority, id] = m;
  return { authority, id, short: id.slice(0, 8) };
}

/** Compact display for a ctx_id: "acdp://registry-a…/f4a2". */
export function formatCtxId(ctxId: string | null | undefined): string {
  const p = parseCtxId(ctxId);
  if (!p) return '';
  if (!p.authority) return p.short;
  const authShort = p.authority.split('.')[0];
  return `acdp://${authShort}…/${p.short}`;
}

/** Extract the trailing readable name from a did:web agent identifier. */
export function formatAgentDid(did: string | null | undefined): string {
  if (!did) return '';
  if (!did.startsWith('did:web:')) return did;
  const parts = did.split(':');
  const name = parts[parts.length - 1];
  return `did:web:…${name}`;
}

/** Pull the authority host out of a did:web identifier. */
export function authorityFromDid(did: string | null | undefined): string {
  if (!did || !did.startsWith('did:web:')) return '';
  const parts = did.split(':');
  // did:web:<authority>:agents:<name>
  return parts[2] ?? '';
}

/** Short host label, e.g. "registry-a.playground.local" → "registry-a". */
export function shortAuthority(authority: string | null | undefined): string {
  if (!authority) return '';
  return authority.split('.')[0];
}
