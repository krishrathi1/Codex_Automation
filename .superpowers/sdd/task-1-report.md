# Task 1 Report: GitHub API read/write functions

## What was changed

### Files modified/created

1. **`backend/src/services/github-api.service.ts`** (modified — appended)
   - Added `export interface ChangedFile { path: string; content: string | null }`
   - Added `export interface PushResult { commitSha: string; htmlUrl: string; filesPushed: number }`
   - Added `export async function getFileContent(cfg, filePath, ref?)` — fetches file via GitHub Contents API, decodes base64, returns `{ content, sha }` or `null` on 404/error
   - Added `export async function getRepoTree(cfg, ref?)` — fetches recursive git tree, returns array of blob paths
   - Added `export async function pushFilesViaApi(cfg, branch, message, files)` — implements full Git Data API flow: ref lookup → base commit → blobs → tree → commit → ref update (PATCH with force:false)
   - All functions reuse existing `headers(cfg)`, `getRepo(cfg)`, and `GITHUB_API` constant; no duplicate declarations
   - Token values are never logged; only status codes and paths appear in logger calls

2. **`backend/src/test/github-api.service.test.ts`** (created)
   - 5 tests covering `getFileContent` (decode + sha, 404 returns null) and `pushFilesViaApi` (correct API call sequence, deletion entry with sha:null, throws on missing token)

## TDD Sequence

- RED: Test file written first; ran `npx vitest run` → 5 failures ("is not a function") as expected
- GREEN: Implementation appended to service; ran `npx vitest run` → 5 passes, clean output
- REFACTOR: No duplication or cleanup needed; code was minimal

## Test command and full output

```
cd backend && npx vitest run src/test/github-api.service.test.ts
```

**RED run output:**
```
 ❯ src/test/github-api.service.test.ts (5 tests | 5 failed) 2082ms
     × decodes base64 content and returns sha
     × returns null on 404
     × runs ref -> commit -> blob -> tree -> commit -> ref in order and returns the new commit
     × sends base_tree and a deletion entry with sha:null
     × throws when no token

 Test Files  1 failed (1)
       Tests  5 failed (5)
    Start at  16:39:03
    Duration  3.00s

TypeError: (0 , __vite_ssr_import_1__.getFileContent) is not a function
TypeError: (0 , __vite_ssr_import_1__.pushFilesViaApi) is not a function
[all 5 tests failed with "is not a function"]
```

**GREEN run output:**
```
 ✓ src/test/github-api.service.test.ts (5 tests) 2089ms

 Test Files  1 passed (1)
       Tests  5 passed (5)
    Start at  16:39:40
    Duration  3.06s (transform 177ms, setup 244ms, import 287ms, tests 2.09s, environment 0ms)
```

## Deviations from the brief

None. The implementation is verbatim from the brief's Step 3 code block. The test file is verbatim from Step 1. The commit message matches Step 5 exactly.

## Concerns

None. All constraints satisfied:
- All GitHub HTTP goes through `headers(cfg)`
- Token values are not logged (only `status` and `filePath` are logged)
- Push uses `force: false`
- Default branch falls back to `'main'`
- ESM `.js` specifier used in the test import

---

## Post-completion TypeScript Fix

**Issue:** `npx tsc --noEmit` reported 2 type errors in `src/test/github-api.service.test.ts:29`:
- TS2352: Conversion of type 'undefined' to type 'string'
- TS2493: Tuple type '[]' has no element at index '0'

**Root cause:** Mock callback had no typed parameters, so TypeScript inferred call args as `[]`.

**Fix applied to `backend/src/test/github-api.service.test.ts`:**
1. Line 22: Changed `vi.fn(() =>` to `vi.fn((_url: string) =>` to give the mock a typed parameter
2. Line 29: Changed `fetchMock.mock.calls[0][0]` to `fetchMock.mock.calls[0]![0]` (non-null assertion)

**Verification:**
- `npx tsc --noEmit` → "TypeScript: No errors found" ✓
- `npx vitest run src/test/github-api.service.test.ts` → "PASS (5) FAIL (0)" ✓

**Commit:** f055af7 (fix(test): type fetch mock so github-api tests pass tsc)
