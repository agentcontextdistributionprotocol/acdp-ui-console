import { describe, expect, it } from 'vitest';
import {
  parseCtxId,
  formatCtxId,
  formatAgentDid,
  authorityFromDid,
  shortAuthority,
} from '@/lib/utils/acdp';

describe('parseCtxId', () => {
  it('parses a well-formed ctx_id', () => {
    const parsed = parseCtxId('acdp://registry-a.local/f4a2c9e1-1234');
    expect(parsed).toEqual({ authority: 'registry-a.local', id: 'f4a2c9e1-1234', short: 'f4a2c9e1' });
  });

  it('returns null for empty input', () => {
    expect(parseCtxId('')).toBeNull();
    expect(parseCtxId(undefined)).toBeNull();
  });

  it('falls back when the scheme is missing', () => {
    const parsed = parseCtxId('not-a-ctx');
    expect(parsed?.authority).toBe('');
    expect(parsed?.short).toBe('not-a-ctx');
  });
});

describe('formatCtxId', () => {
  it('shortens authority and id', () => {
    expect(formatCtxId('acdp://registry-a.playground.local/f4a2c9e1-1234')).toBe('acdp://registry-a…/f4a2c9e1');
  });

  it('returns an empty string for empty/nullish input', () => {
    expect(formatCtxId('')).toBe('');
    expect(formatCtxId(null)).toBe('');
  });

  it('returns just the short id when there is no authority', () => {
    expect(formatCtxId('not-a-ctx')).toBe('not-a-ctx');
  });
});

describe('formatAgentDid', () => {
  it('keeps the trailing name', () => {
    expect(formatAgentDid('did:web:registry-a.local:agents:cross-a')).toBe('did:web:…cross-a');
  });

  it('returns non-did values unchanged', () => {
    expect(formatAgentDid('plain')).toBe('plain');
  });

  it('returns an empty string for empty/nullish input', () => {
    expect(formatAgentDid('')).toBe('');
    expect(formatAgentDid(undefined)).toBe('');
  });
});

describe('authorityFromDid', () => {
  it('extracts the authority host', () => {
    expect(authorityFromDid('did:web:registry-a.local:agents:cross-a')).toBe('registry-a.local');
  });

  it('returns an empty string for non-did or nullish input', () => {
    expect(authorityFromDid('plain')).toBe('');
    expect(authorityFromDid(null)).toBe('');
  });
});

describe('shortAuthority', () => {
  it('returns an empty string for nullish input', () => {
    expect(shortAuthority(undefined)).toBe('');
    expect(shortAuthority('')).toBe('');
  });

  it('takes the first host segment', () => {
    expect(shortAuthority('registry-a.playground.local')).toBe('registry-a');
  });
});
