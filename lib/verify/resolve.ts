// ══════════════════════════════════════════════════════════════════════
// DID / key resolution for client-side verification.
//
//   did:key  → resolved fully OFFLINE via the wasm `resolveDidKey` (the public
//              key is embedded in the identifier). No network, no DID doc.
//   did:web  → resolved from a DID-document map the HOST supplies (in demo mode
//              the mock docs; in live mode whatever a resolver populates). If a
//              did:web document is not on hand, resolution returns `null` and the
//              caller renders an honest "signer key not fetched" state — never a
//              false green.
//
// The wasm signature verifiers (`verifySignatureEd25519` / `verifySignatureP256`)
// take a RAW public key, so for did:web we extract it from the verification
// method (`publicKeyMultibase` base58btc / `publicKeyJwk`). The receipt / log /
// witness verifiers instead take a whole DID document, which we pass through.
// ══════════════════════════════════════════════════════════════════════
import { getAcdpWasm } from './wasm';

export type SigAlgorithm = 'ed25519' | 'ecdsa-p256';

/** A public key ready to feed a wasm signature verifier. */
export interface ResolvedKey {
  algorithm: SigAlgorithm;
  /** ed25519 → raw 32-byte key, base64. p256 → SEC1-uncompressed 65-byte key, base64. */
  pubKeyB64: string;
}

export type DidDocMap = Record<string, unknown> | undefined;

// ── base64 / base58 / multibase helpers (browser-safe, no Buffer) ─────────
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    const val = B58.indexOf(ch);
    if (val < 0) throw new Error(`invalid base58 char '${ch}'`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  for (const ch of s) {
    if (ch === '1') zeros++;
    else break;
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}
/** `z…` multibase (base58btc) with a multicodec prefix → raw key bytes after the prefix. */
function multibaseEd25519Raw(mb: string): Uint8Array {
  if (!mb.startsWith('z')) throw new Error('unsupported multibase (expected base58btc "z")');
  const decoded = base58decode(mb.slice(1));
  // multicodec ed25519-pub = 0xed 0x01
  if (decoded[0] === 0xed && decoded[1] === 0x01) return decoded.slice(2);
  return decoded; // already raw
}

// ── did:web document access ───────────────────────────────────────────
interface VerificationMethod {
  id: string;
  type?: string;
  publicKeyMultibase?: string;
  publicKeyJwk?: { kty?: string; crv?: string; x?: string; y?: string };
}
interface DidDoc {
  id: string;
  verificationMethod?: VerificationMethod[];
}

function didOf(keyId: string): string {
  return keyId.split('#')[0];
}
function fragmentOf(keyId: string): string | undefined {
  const i = keyId.indexOf('#');
  return i >= 0 ? keyId.slice(i + 1) : undefined;
}

function findMethod(doc: DidDoc, keyId: string): VerificationMethod | undefined {
  const frag = fragmentOf(keyId);
  const methods = doc.verificationMethod ?? [];
  if (frag === undefined) return methods[0];
  return methods.find((m) => fragmentOf(m.id) === frag);
}

function keyFromMethod(m: VerificationMethod): ResolvedKey | null {
  // Ed25519
  if (m.publicKeyMultibase) {
    return { algorithm: 'ed25519', pubKeyB64: bytesToB64(multibaseEd25519Raw(m.publicKeyMultibase)) };
  }
  const jwk = m.publicKeyJwk;
  if (jwk?.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x) {
    return { algorithm: 'ed25519', pubKeyB64: bytesToB64(b64urlToBytes(jwk.x)) };
  }
  if (jwk?.kty === 'EC' && jwk.crv === 'P-256' && jwk.x && jwk.y) {
    const x = b64urlToBytes(jwk.x);
    const y = b64urlToBytes(jwk.y);
    const sec1 = new Uint8Array(1 + x.length + y.length);
    sec1[0] = 0x04;
    sec1.set(x, 1);
    sec1.set(y, 1 + x.length);
    return { algorithm: 'ecdsa-p256', pubKeyB64: bytesToB64(sec1) };
  }
  return null;
}

/**
 * Resolve a verification method (`did:…#fragment`) to a raw public key, or
 * `null` when the signer document is not on hand (did:web with no doc supplied).
 */
export async function resolveVerificationKey(keyId: string, docs: DidDocMap): Promise<ResolvedKey | null> {
  const did = didOf(keyId);
  if (did.startsWith('did:key:')) {
    const wasm = await getAcdpWasm();
    const resolved = JSON.parse(wasm.resolveDidKey(did)) as { algorithm: string; public_key_b64: string };
    return {
      algorithm: resolved.algorithm === 'ecdsa-p256' ? 'ecdsa-p256' : 'ed25519',
      pubKeyB64: resolved.public_key_b64,
    };
  }
  const doc = docs?.[did] as DidDoc | undefined;
  if (!doc) return null;
  const method = findMethod(doc, keyId);
  if (!method) return null;
  return keyFromMethod(method);
}

/** Raw Ed25519 public key (base64) for a DID, or null if unavailable. */
export async function resolveEd25519Raw(keyId: string, docs: DidDocMap): Promise<string | null> {
  const key = await resolveVerificationKey(keyId, docs);
  return key && key.algorithm === 'ed25519' ? key.pubKeyB64 : null;
}

/**
 * A full DID document for the given DID, suitable to hand to the receipt /
 * checkpoint / witness verifiers. did:key documents are synthesized offline
 * (the multibase key is the identifier itself); did:web documents come from the
 * supplied map. Returns `null` when a did:web document is not available.
 */
export function resolveDidDocument(did: string, docs: DidDocMap, keyId?: string): unknown | null {
  if (did.startsWith('did:key:')) {
    const mb = did.slice('did:key:'.length); // 'z…' multibase — the key material
    // The verification-method fragment must match the fragment the signer used
    // (e.g. a witness cosignature's `signature.key_id`), not the canonical
    // multibase fragment, so the offline verifier can resolve the method.
    const vmId = keyId ?? `${did}#${mb}`;
    return {
      id: did,
      verificationMethod: [
        { id: vmId, type: 'Ed25519VerificationKey2020', controller: did, publicKeyMultibase: mb },
      ],
      assertionMethod: [vmId],
    };
  }
  return (docs?.[did] as unknown) ?? null;
}
