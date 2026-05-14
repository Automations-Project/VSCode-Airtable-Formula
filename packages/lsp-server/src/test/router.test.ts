import { describe, it, expect } from 'vitest';
import { routeDocument } from '../router.js';

describe('routeDocument: language ID routing (priority over extension)', () => {
  it('routes airtable-formula language ID to formula engine', () => {
    expect(routeDocument('file:///foo.txt', 'airtable-formula')).toBe('formula');
  });
  it('routes airtable-script language ID to script engine', () => {
    expect(routeDocument('file:///foo.txt', 'airtable-script')).toBe('script');
  });
  it('routes airtable-automation language ID to automation engine', () => {
    expect(routeDocument('file:///foo.txt', 'airtable-automation')).toBe('automation');
  });
});

describe('routeDocument: file extension fallback (no language ID)', () => {
  it('routes .formula extension to formula engine', () => {
    expect(routeDocument('file:///foo.formula', undefined)).toBe('formula');
  });
  it('routes .fx extension to formula engine', () => {
    expect(routeDocument('file:///foo.fx', undefined)).toBe('formula');
  });
  it('routes .ats extension to script engine', () => {
    expect(routeDocument('file:///foo.ats', undefined)).toBe('script');
  });
  it('routes .script extension to script engine', () => {
    expect(routeDocument('file:///foo.script', undefined)).toBe('script');
  });
  it('routes .ata extension to automation engine', () => {
    expect(routeDocument('file:///foo.ata', undefined)).toBe('automation');
  });
  it('routes .automation extension to automation engine', () => {
    expect(routeDocument('file:///foo.automation', undefined)).toBe('automation');
  });
  it('returns null for unknown extension .js', () => {
    expect(routeDocument('file:///foo.js', undefined)).toBeNull();
  });
  it('returns null for unknown extension when no language ID', () => {
    expect(routeDocument('file:///foo.ts', undefined)).toBeNull();
  });
});
