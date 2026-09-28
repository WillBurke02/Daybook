// Import an app's browser module from disk. In the browser an app's files sit
// over the shared ones (/learn/core/formula.js is web/core/formula.js); on disk
// they do not, so the shared imports are pointed at web/ before importing.
// ponytail: a text rewrite of './core/', '../core/', './ui/', '../ui/' imports, followed through the module's own
// relative imports; enough for logic modules that do not touch the page.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'daybook-'));
const done = new Map();

export const load = async rel => import(prep(resolve(ROOT, rel)));

/** A copy of the file with its imports pointed at files on disk (and its own relative imports copied the same way). */
function prep(file) {
  if (done.has(file)) return done.get(file);
  const url = pathToFileURL(join(out, relative(ROOT, file).replace(/[\\/]/g, '_'))).href;
  done.set(file, url);                                    // before the imports, so a cycle ends here
  const web = pathToFileURL(join(ROOT, 'web')).href;
  const src = readFileSync(file, 'utf8')
    .replace(/from '\.\.?\/(core|ui)\//g, `from '${web}/$1/`)
    .replace(/from '(\.\.?\/[^']+)'/g, (m, p) => `from '${prep(resolve(dirname(file), p))}'`);
  writeFileSync(fileURLToPath(url), src);
  return url;
}
