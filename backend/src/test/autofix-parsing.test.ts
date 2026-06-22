import { describe, expect, it } from 'vitest';
import { extractRepoFilePaths, parseFileBlocks } from '../services/autofix-parsing.js';

describe('extractRepoFilePaths', () => {
  it('pulls source paths out of a stack trace and dedupes', () => {
    const stack = [
      'TypeError: Cannot read properties of undefined',
      '    at Dashboard (src/pages/Dashboard.tsx:42:13)',
      '    at render (src/pages/Dashboard.tsx:10:1)',
      '    at app/api/route.ts:5',
    ].join('\n');
    expect(extractRepoFilePaths(stack)).toEqual(['src/pages/Dashboard.tsx', 'app/api/route.ts']);
  });

  it('ignores node_modules and unknown extensions', () => {
    const text = 'at node_modules/react/index.js:1 and README.unknownext and src/x.ts:2';
    expect(extractRepoFilePaths(text)).toEqual(['src/x.ts']);
  });

  it('returns empty array when no paths', () => {
    expect(extractRepoFilePaths('no files here')).toEqual([]);
  });
});

describe('parseFileBlocks', () => {
  it('parses multiple FILE blocks with full content', () => {
    const out = [
      'Here is the fix.',
      '===FILE: src/a.ts===',
      'export const a = 1;',
      'export const b = 2;',
      '===END FILE===',
      '===FILE: src/b.ts===',
      'export const c = 3;',
      '===END FILE===',
    ].join('\n');
    expect(parseFileBlocks(out)).toEqual([
      { path: 'src/a.ts', content: 'export const a = 1;\nexport const b = 2;' },
      { path: 'src/b.ts', content: 'export const c = 3;' },
    ]);
  });

  it('parses a DELETE marker as null content', () => {
    expect(parseFileBlocks('===DELETE: src/old.ts===')).toEqual([{ path: 'src/old.ts', content: null }]);
  });

  it('skips an unterminated block and returns the valid ones', () => {
    const out = '===FILE: src/a.ts===\nok\n===END FILE===\n===FILE: src/b.ts===\nno end marker';
    expect(parseFileBlocks(out)).toEqual([{ path: 'src/a.ts', content: 'ok' }]);
  });

  it('returns empty array when there are no blocks', () => {
    expect(parseFileBlocks('just prose, no markers')).toEqual([]);
  });
});
