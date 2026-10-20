import { describe, expect, it } from 'vitest';
import { permission } from '../../test/fixtures';
import { similarityKey, similarityLabel } from './permission-pattern';

const bash = (command: string) => permission({ toolName: 'Bash', summary: command, input: { command } });
const file = (toolName: string, path: string) => permission({ toolName, summary: path, input: { file_path: path } });

describe('similarityKey', () => {
  it('matches the same command regardless of whitespace', () => {
    expect(similarityKey(bash('npm   install zod'))).toBe(similarityKey(bash(' npm install zod\n')));
  });

  it('keeps different commands apart, even with the same program', () => {
    expect(similarityKey(bash('npm install zod'))).not.toBe(similarityKey(bash('npm install react')));
    expect(similarityKey(bash('npm run build'))).not.toBe(similarityKey(bash('npm run deploy')));
  });

  it('keeps the tool in the key', () => {
    expect(similarityKey(permission({ toolName: 'Bash', summary: 'x', input: { command: 'x' } }))).not.toBe(similarityKey(permission({ toolName: 'Other', summary: 'x', input: undefined })));
  });

  it('groups file edits by folder and extension', () => {
    expect(similarityKey(file('Edit', 'src/a.ts'))).toBe(similarityKey(file('Edit', 'src/b.ts')));
    expect(similarityKey(file('Edit', 'src/a.ts'))).not.toBe(similarityKey(file('Edit', 'lib/a.ts')));
    expect(similarityKey(file('Edit', 'src/a.ts'))).not.toBe(similarityKey(file('Edit', 'src/a.css')));
    expect(similarityKey(file('Edit', 'src/a.ts'))).not.toBe(similarityKey(file('Write', 'src/a.ts')));
  });

  it('groups web fetches by host', () => {
    const fetch = (url: string) => permission({ toolName: 'WebFetch', summary: url, input: { url } });
    expect(similarityKey(fetch('https://docs.stripe.com/api'))).toBe(similarityKey(fetch('https://DOCS.stripe.com/other')));
    expect(similarityKey(fetch('https://docs.stripe.com/api'))).not.toBe(similarityKey(fetch('https://evil.example/api')));
  });

  it('falls back to the exact summary for other tools', () => {
    const tool = (summary: string) => permission({ toolName: 'mcp__db__query', summary, input: undefined });
    expect(similarityKey(tool('SELECT 1'))).toBe(similarityKey(tool('SELECT 1')));
    expect(similarityKey(tool('SELECT 1'))).not.toBe(similarityKey(tool('SELECT 2')));
  });
});

describe('similarityLabel', () => {
  it('describes what the group has in common', () => {
    expect(similarityLabel(bash('npm test'))).toBe('npm test');
    expect(similarityLabel(file('Edit', 'src/config.ts'))).toBe('src/*.ts');
    expect(similarityLabel(file('Edit', 'Makefile'))).toBe('*');
  });
});
