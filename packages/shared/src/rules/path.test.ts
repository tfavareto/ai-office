import { describe, expect, it } from 'vitest';
import { globMatches, hasParentSegment, normalizePath, resolvePath, staticBase } from './path';

describe('normalizePath and resolvePath', () => {
  it('collapses dots and slashes', () => {
    expect(normalizePath('/a//b/./c/../d')).toBe('/a/b/d');
    expect(normalizePath('/../..')).toBe('/');
    expect(normalizePath('a/../../b')).toBe('../b');
  });

  it('anchors relative paths in the base', () => {
    expect(resolvePath('src/a.ts', '/demo/loja')).toBe('/demo/loja/src/a.ts');
    expect(resolvePath('/etc/hosts', '/demo/loja')).toBe('/etc/hosts');
    expect(resolvePath('src/a.ts')).toBe('src/a.ts');
  });

  it('spots parent segments and static bases', () => {
    expect(hasParentSegment('a/../b')).toBe(true);
    expect(hasParentSegment('a/b')).toBe(false);
    expect(staticBase('/demo/loja/src/**/*.ts')).toEqual(['demo', 'loja', 'src']);
  });
});

describe('globMatches', () => {
  const base = '/demo/loja';

  it('matches a folder with **, at any depth', () => {
    expect(globMatches('src/**', '/demo/loja/src/a.ts', base)).toBe(true);
    expect(globMatches('src/**', '/demo/loja/src/deep/er/a.ts', base)).toBe(true);
    expect(globMatches('src/**', '/demo/loja/lib/a.ts', base)).toBe(false);
  });

  it('keeps * inside one folder and matches extensions', () => {
    expect(globMatches('src/*.ts', '/demo/loja/src/a.ts', base)).toBe(true);
    expect(globMatches('src/*.ts', '/demo/loja/src/sub/a.ts', base)).toBe(false);
    expect(globMatches('src/**/*.ts', '/demo/loja/src/sub/a.ts', base)).toBe(true);
    expect(globMatches('src/a?.ts', '/demo/loja/src/ab.ts', base)).toBe(true);
    expect(globMatches('src/a?.ts', '/demo/loja/src/abc.ts', base)).toBe(false);
  });

  it('never lets wildcards reach dot files or hidden folders', () => {
    expect(globMatches('**', '/demo/loja/.env', base)).toBe(false);
    expect(globMatches('src/**', '/demo/loja/src/.env', base)).toBe(false);
    expect(globMatches('**', '/demo/loja/.git/config', base)).toBe(false);
    expect(globMatches('src/.env*', '/demo/loja/src/.env.local', base)).toBe(true);
  });

  it('judges the path the agent asked for after normalizing it, so .. cannot escape', () => {
    expect(globMatches('src/**', '/demo/loja/src/../../../etc/passwd', base)).toBe(false);
    expect(globMatches('/demo/loja/src/**', '/demo/loja/src/a.ts')).toBe(true);
  });

  it('does not mix relative and absolute without a base', () => {
    expect(globMatches('src/**', '/demo/loja/src/a.ts')).toBe(false);
  });

  it('stays fast on pathological patterns', () => {
    const started = Date.now();
    globMatches('**/**/**/*a*a*a*a*a*b', `/${'a/'.repeat(40)}${'a'.repeat(200)}`);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
