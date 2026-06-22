const SOURCE_EXT = 'tsx?|jsx?|mjs|cjs|json|css|scss|sass|less|html|vue|svelte|py|go|rs|java|rb|php|ya?ml|md|sql';
const FILE_PATH_RE = new RegExp(`([\\w./-]+\\.(?:${SOURCE_EXT}))`, 'g');

/**
 * Extract repo-relative source file paths from free-form error/log text.
 * Strips trailing :line:col, drops node_modules and absolute paths, dedupes
 * while preserving first-seen order.
 */
export function extractRepoFilePaths(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(FILE_PATH_RE)) {
    let p = match[1];
    // strip a leading "./"
    p = p.replace(/^\.\//, '');
    if (!p || p.includes('node_modules') || p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) continue;
    if (p.startsWith('..')) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

const FILE_BLOCK_RE = /===FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n===END FILE===/g;
const DELETE_RE = /===DELETE:\s*(.+?)\s*===/g;

/**
 * Parse a fix payload made of ===FILE: path=== / ===END FILE=== blocks and
 * ===DELETE: path=== markers. Unterminated or malformed blocks are skipped so
 * a truncated agent response can never produce a corrupt file.
 */
export function parseFileBlocks(text: string): Array<{ path: string; content: string | null }> {
  if (!text) return [];
  const result: Array<{ path: string; content: string | null }> = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(FILE_BLOCK_RE)) {
    const path = m[1].trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push({ path, content: m[2] });
  }
  for (const m of text.matchAll(DELETE_RE)) {
    const path = m[1].trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push({ path, content: null });
  }
  return result;
}
