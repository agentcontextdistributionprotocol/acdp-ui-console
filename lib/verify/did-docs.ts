// ══════════════════════════════════════════════════════════════════════
// Acceptance gate for a registry's own did:web DID document.
//
// Real mode fetches `/.well-known/did.json` from the registry this console is
// configured to use (`REGISTRY_*_BASE_URL`, via the proxy). That is NOT did:web
// resolution: did:web says to fetch `https://<authority>/.well-known/did.json`
// over DNS + TLS, and this console instead asks the configured base URL. So the
// document is only accepted when it is CONSISTENT with that registry — its id
// equals the DID the registry advertises in its capabilities, which equals
// `did:web:<authority>` for the authority the registry advertises, which must
// equal the authority named in the context's ctx_id. Anything else returns
// `null`, and the surfaces it would have fed stay honestly `unavailable`.
//
// Pure, no React, no network — the hook (`lib/hooks/use-registry-did-docs.ts`)
// calls it and the unit test drives it directly.
// ══════════════════════════════════════════════════════════════════════

/**
 * Upper bound on `verificationMethod` entries. A registry keeps every retired
 * receipt key in `verificationMethod` forever (RFC-ACDP-0010 §9), so the list
 * legitimately grows — but a registry-controlled array is walked by the
 * resolver on every verification, so it is bounded rather than trusted.
 */
export const MAX_VERIFICATION_METHODS = 64;

/**
 * `did:web:<authority>`, with a port's `:` percent-encoded as `%3A` — the same
 * mapping as acdp-rs `acdp-did` `authority_to_did_web`.
 */
export function authorityToDidWeb(authority: string): string {
  return `did:web:${authority.replace(/:/g, '%3A')}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isVerificationMethod(vm: unknown, did: string): boolean {
  if (!isObject(vm)) return false;
  if (!isNonEmptyString(vm.id) || !vm.id.startsWith(`${did}#`) || vm.id.length === did.length + 1) return false;
  if (!isNonEmptyString(vm.type)) return false;
  if (vm.controller !== did) return false;
  const hasMultibase = isNonEmptyString(vm.publicKeyMultibase);
  const hasJwk = isObject(vm.publicKeyJwk);
  // Exactly one key encoding — never both, never neither.
  return hasMultibase !== hasJwk;
}

/**
 * Accept a fetched registry DID document, or return `null`.
 *
 * @param raw the parsed `/.well-known/did.json` body (registry-controlled).
 * @param expected.authority the authority the registry advertises in its
 *   capabilities (`/.well-known/acdp.json` `authority`).
 * @param expected.registryDid the DID the registry advertises there
 *   (`registry_did`).
 * @param expected.ctxAuthority the authority parsed from the context's ctx_id.
 *
 * Returns the SAME object it was given (no copy), so a caller that memoises on
 * the fetched value keeps a stable identity.
 */
export function acceptRegistryDidDocument(
  raw: unknown,
  expected: { authority: string; registryDid: string; ctxAuthority: string },
): Record<string, unknown> | null {
  const { authority, registryDid, ctxAuthority } = expected;
  if (!isNonEmptyString(authority) || !isNonEmptyString(registryDid)) return null;
  if (authority !== ctxAuthority) return null;
  const did = authorityToDidWeb(authority);
  if (registryDid !== did) return null;

  if (!isObject(raw)) return null;
  if (raw.id !== did) return null;

  const vms = raw.verificationMethod;
  if (!Array.isArray(vms) || vms.length === 0 || vms.length > MAX_VERIFICATION_METHODS) return null;
  if (!vms.every((vm) => isVerificationMethod(vm, did))) return null;

  const am = raw.assertionMethod;
  if (am !== undefined) {
    if (!Array.isArray(am) || am.length > MAX_VERIFICATION_METHODS) return null;
    if (!am.every((ref) => typeof ref === 'string' && ref.startsWith(`${did}#`))) return null;
  }

  return raw;
}
