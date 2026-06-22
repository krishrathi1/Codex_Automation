import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFileContent, pushFilesViaApi } from '../services/github-api.service.js';

const cfg = { token: 't0ken', repo: 'owner/repo', branch: 'main' };

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('getFileContent', () => {
  it('decodes base64 content and returns sha', async () => {
    const fetchMock = vi.fn((_url: string) =>
      jsonResponse({ content: Buffer.from('hello world', 'utf8').toString('base64'), encoding: 'base64', sha: 'abc123' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getFileContent(cfg, 'src/app.ts');
    expect(result).toEqual({ content: 'hello world', sha: 'abc123' });
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toBe('https://api.github.com/repos/owner/repo/contents/src/app.ts?ref=main');
  });

  it('returns null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ message: 'Not Found' }, 404)));
    expect(await getFileContent(cfg, 'missing.ts')).toBeNull();
  });
});

describe('pushFilesViaApi', () => {
  it('runs ref -> commit -> blob -> tree -> commit -> ref in order and returns the new commit', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'BASE_COMMIT' } });
      if (url.endsWith('/git/commits/BASE_COMMIT')) return jsonResponse({ tree: { sha: 'BASE_TREE' } });
      if (url.endsWith('/git/blobs')) return jsonResponse({ sha: 'BLOB1' });
      if (url.endsWith('/git/trees')) return jsonResponse({ sha: 'NEW_TREE' });
      if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'NEW_COMMIT', html_url: 'https://github.com/owner/repo/commit/NEW_COMMIT' });
      if (url.endsWith('/git/refs/heads/main')) return jsonResponse({ object: { sha: 'NEW_COMMIT' } });
      throw new Error('unexpected url ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushFilesViaApi(cfg, 'main', 'fix: x', [{ path: 'src/app.ts', content: 'patched' }]);

    expect(result).toEqual({ commitSha: 'NEW_COMMIT', htmlUrl: 'https://github.com/owner/repo/commit/NEW_COMMIT', filesPushed: 1 });
    expect(calls.map(c => `${c.method} ${c.url.split('/repos/owner/repo')[1]}`)).toEqual([
      'GET /git/ref/heads/main',
      'GET /git/commits/BASE_COMMIT',
      'POST /git/blobs',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ]);
  });

  it('sends base_tree and a deletion entry with sha:null', async () => {
    let treeBody: any = null;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'BASE_COMMIT' } });
      if (url.endsWith('/git/commits/BASE_COMMIT')) return jsonResponse({ tree: { sha: 'BASE_TREE' } });
      if (url.endsWith('/git/trees')) { treeBody = JSON.parse(String(init?.body)); return jsonResponse({ sha: 'NEW_TREE' }); }
      if (url.endsWith('/git/commits')) return jsonResponse({ sha: 'C', html_url: 'h' });
      if (url.endsWith('/git/refs/heads/main')) return jsonResponse({ object: { sha: 'C' } });
      throw new Error('unexpected ' + url);
    }));

    await pushFilesViaApi(cfg, 'main', 'msg', [{ path: 'gone.ts', content: null }]);
    expect(treeBody.base_tree).toBe('BASE_TREE');
    expect(treeBody.tree).toEqual([{ path: 'gone.ts', mode: '100644', type: 'blob', sha: null }]);
  });

  it('throws when no token', async () => {
    await expect(pushFilesViaApi({ token: '', repo: 'o/r' }, 'main', 'm', [{ path: 'a', content: 'b' }]))
      .rejects.toThrow(/token/i);
  });
});
