#!/usr/bin/env node
// Documentation validator: local links and anchors in Markdown, links to this repository's own public URLs, JSON syntax
// and alignment of the translated READMEs. Node built-ins only. Run with `npm run docs:check`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_SLUG = 'tfavareto/ai-office';
const REPO_BRANCH = 'main';
const README_FILES = ['README.md', 'README.pt-BR.md', 'README.es.md'];
const REPO_URL_PATTERNS = [
  new RegExp(
    `https://raw\\.githubusercontent\\.com/${REPO_SLUG}/${REPO_BRANCH}(?![\\w.-])(?:/([^\\s)"'<>\\]\`]*))?`,
    'g',
  ),
  new RegExp(`https://github\\.com/${REPO_SLUG}/(?:blob|tree)/${REPO_BRANCH}(?![\\w.-])(?:/([^\\s)"'<>\\]\`]*))?`, 'g'),
];
const EXTERNAL_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

// ---------------------------------------------------------------------------------------------------------------------
// Masking: blank out the parts of a Markdown file that must not be scanned for links, keeping offsets and line breaks.
// ---------------------------------------------------------------------------------------------------------------------

const blank = (text) => text.replace(/[^\n]/g, ' ');

/** Replaces fenced code blocks (``` or ~~~) with spaces. */
export function maskFences(markdown) {
  const lines = markdown.split('\n');
  let fence = null;
  const masked = lines.map((line) => {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (!open) return line;
      fence = { char: open[1][0], size: open[1].length };
      return blank(line);
    }
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fence.char && close[1].length >= fence.size) fence = null;
    return blank(line);
  });
  return masked.join('\n');
}

/** Replaces fenced blocks, inline code spans and HTML comments with spaces. */
export function maskCode(markdown) {
  const withoutFences = maskFences(markdown);
  const withoutSpans = withoutFences.replace(/(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?[^`])\1(?!`)/g, blank);
  return withoutSpans.replace(/<!--[\s\S]*?-->/g, blank);
}

const lineOf = (failure) => Number(/^[^:]+:(\d+):/.exec(failure)?.[1] ?? 0);

const lineAt = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
};

// ---------------------------------------------------------------------------------------------------------------------
// Slugs and anchors (GitHub rules)
// ---------------------------------------------------------------------------------------------------------------------

/** Lowercases, drops punctuation and emoji, turns spaces into hyphens. Accented letters are kept, as on GitHub. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[︎️‍]/gu, '')
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-');
}

/** Returns a function that slugs headings in document order, suffixing duplicates with -1, -2, ... */
export function createSlugger() {
  const occurrences = new Map();
  return (text) => {
    const base = slugify(text);
    let slug = base;
    while (occurrences.has(slug)) {
      occurrences.set(base, (occurrences.get(base) ?? 0) + 1);
      slug = `${base}-${occurrences.get(base)}`;
    }
    occurrences.set(slug, 0);
    return slug;
  };
}

/** Reduces the Markdown source of a heading to the text GitHub slugs. */
export function headingPlainText(raw) {
  return raw
    .replace(/\s+#+\s*$/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`/g, '')
    .replace(/[*~]/g, '')
    .replace(/(^|\s)_+([^_]+?)_+(?=\s|$)/g, '$1$2')
    .trim();
}

/** Headings outside code fences: `{ level, text, line }`. */
export function extractHeadings(markdown) {
  const headings = [];
  maskFences(markdown)
    .split('\n')
    .forEach((line, index) => {
      const match = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
      if (match) headings.push({ level: match[1].length, text: headingPlainText(match[2]), line: index + 1 });
    });
  return headings;
}

/** Every fragment a link may use to reach this file: heading slugs plus explicit id/name attributes. */
export function collectAnchors(markdown) {
  const anchors = new Set();
  const slug = createSlugger();
  for (const heading of extractHeadings(markdown)) anchors.add(slug(heading.text));
  const masked = maskCode(markdown);
  for (const match of masked.matchAll(/\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi))
    anchors.add(match[1] ?? match[2]);
  return anchors;
}

// ---------------------------------------------------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------------------------------------------------

/** Parses the destination that follows `](`: `<angle bracket>` form or a bare one with balanced parentheses. */
function readDestination(text, start) {
  let i = start;
  while (i < text.length && /[ \t]/.test(text[i])) i += 1;
  if (text[i] === '<') {
    const end = text.indexOf('>', i + 1);
    if (end === -1 || text.slice(i + 1, end).includes('\n')) return null;
    return text.slice(i + 1, end);
  }
  let depth = 0;
  let destination = '';
  for (; i < text.length; i += 1) {
    const char = text[i];
    if (/\s/.test(char)) break;
    if (char === '(') depth += 1;
    if (char === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    destination += char;
  }
  return destination;
}

/**
 * Local-or-external link targets found outside code: Markdown inline links and images, reference definitions, and HTML
 * `href`, `src` and `srcset` attributes. Returns `{ target, line }` in document order.
 */
export function extractLinks(markdown) {
  const masked = maskCode(markdown);
  const links = [];
  const add = (target, offset) => {
    if (target) links.push({ target: target.trim(), line: lineAt(masked, offset) });
  };

  for (const match of masked.matchAll(/\]\(/g)) {
    const destination = readDestination(masked, match.index + 2);
    if (destination !== null) add(destination, match.index);
  }
  for (const match of masked.matchAll(/^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^>\n]*>|\S+)/gm)) {
    add(match[1].replace(/^<|>$/g, ''), match.index);
  }
  for (const match of masked.matchAll(/\b(href|src|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const value = match[2] ?? match[3];
    if (match[1].toLowerCase() === 'srcset') {
      for (const candidate of value.split(',')) add(candidate.trim().split(/\s+/)[0], match.index);
    } else {
      add(value, match.index);
    }
  }
  return links;
}

/** Maps a public URL of this repository to `{ path, fragment }` relative to the repo root, or null. */
export function mapRepoUrl(url) {
  for (const pattern of REPO_URL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(url);
    if (!match || match.index !== 0) continue;
    const rest = (match[1] ?? '').replace(TRAILING_PUNCTUATION, '');
    const [beforeFragment, ...fragmentParts] = rest.split('#');
    const [path] = beforeFragment.split('?');
    return { path: safeDecode(path), fragment: safeDecode(fragmentParts.join('#')) };
  }
  return null;
}

/** Every URL pointing to this repository, found anywhere in the text (also inside code and prompt blocks). */
export function findRepoUrls(markdown) {
  const found = [];
  for (const pattern of REPO_URL_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of markdown.matchAll(pattern)) {
      const mapped = mapRepoUrl(match[0]);
      if (mapped) found.push({ ...mapped, url: match[0], line: lineAt(markdown, match.index) });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------
// README alignment
// ---------------------------------------------------------------------------------------------------------------------

/** Explicit `<a id="...">` anchors outside code fences. */
export function readmeAnchors(markdown) {
  const masked = maskFences(markdown);
  const ids = [...masked.matchAll(/<a\s+[^>]*\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)].map((m) => m[1] ?? m[2]);
  return [...new Set(ids)].sort();
}

/** Number of `##` headings outside code fences. */
export function countSections(markdown) {
  return extractHeadings(markdown).filter((heading) => heading.level === 2).length;
}

/** Compares README translations (`{ name: markdown }`): same explicit anchors and same number of `##` sections. */
export function checkReadmeAlignment(readmes) {
  const names = Object.keys(readmes);
  if (names.length < 2) return [];
  const failures = [];
  const [reference, ...others] = names;
  const referenceAnchors = readmeAnchors(readmes[reference]);
  const referenceSections = countSections(readmes[reference]);
  for (const name of others) {
    const anchors = readmeAnchors(readmes[name]);
    const missing = referenceAnchors.filter((id) => !anchors.includes(id));
    const extra = anchors.filter((id) => !referenceAnchors.includes(id));
    if (missing.length > 0) failures.push(`${name}: missing anchors present in ${reference}: ${missing.join(', ')}`);
    if (extra.length > 0) failures.push(`${name}: anchors not present in ${reference}: ${extra.join(', ')}`);
    const sections = countSections(readmes[name]);
    if (sections !== referenceSections) {
      failures.push(`${name}: ${sections} "##" sections but ${reference} has ${referenceSections}`);
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------------------------------------------------

/** Removes comments and trailing commas (tsconfig-style JSONC) without touching string contents. */
export function stripJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** Returns an error message when the JSON does not parse, otherwise null. `tsconfig*.json` may contain comments. */
export function jsonError(path, text) {
  const isJsonc = /(^|\/)tsconfig[^/]*\.json$/.test(path);
  try {
    JSON.parse(isJsonc ? stripJsonc(text) : text);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------------

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Resolves a link found in `fromFile` to `{ path, fragment }` (repo-relative), or null when it is not a local link. */
export function resolveLocalTarget(fromFile, target) {
  const mapped = mapRepoUrl(target);
  if (mapped) return mapped;
  if (EXTERNAL_SCHEME.test(target)) return null;
  const [beforeFragment, ...fragmentParts] = target.split('#');
  const [rawPath] = beforeFragment.split('?');
  const fragment = safeDecode(fragmentParts.join('#'));
  const decoded = safeDecode(rawPath);
  if (decoded === '') return { path: fromFile, fragment };
  const path = decoded.startsWith('/')
    ? posix.normalize(decoded.slice(1))
    : posix.join(posix.dirname(fromFile), decoded);
  return { path: path === '.' ? '' : path.replace(/\/$/, ''), fragment };
}

/**
 * Validates documentation. `files` are repo-relative POSIX paths (existing files only); `readText(path)` returns the file
 * content. Returns `{ failures, stats }`.
 */
export function validateDocs({ files, readText }) {
  const fileSet = new Set(files);
  const dirSet = new Set(['']);
  for (const file of files) {
    for (let dir = posix.dirname(file); dir !== '.' && !dirSet.has(dir); dir = posix.dirname(dir)) dirSet.add(dir);
  }
  const failures = [];
  const stats = { markdownFiles: 0, links: 0, jsonFiles: 0 };
  const anchorCache = new Map();
  const anchorsOf = (path) => {
    if (!anchorCache.has(path)) anchorCache.set(path, collectAnchors(readText(path)));
    return anchorCache.get(path);
  };

  const checkTarget = (from, line, label, resolved) => {
    stats.links += 1;
    const { path, fragment } = resolved;
    if (path.startsWith('..') || path.startsWith('/')) {
      failures.push(`${from}:${line}: link leaves the repository: ${label}`);
      return;
    }
    const isFile = fileSet.has(path);
    if (!isFile && !dirSet.has(path)) {
      failures.push(`${from}:${line}: missing target "${path}" (${label})`);
      return;
    }
    if (fragment && isFile && path.endsWith('.md') && !fragment.startsWith('user-content-')) {
      if (!anchorsOf(path).has(fragment))
        failures.push(`${from}:${line}: missing anchor "#${fragment}" in ${path} (${label})`);
    }
  };

  const markdownFiles = files.filter((file) => file.endsWith('.md'));
  for (const file of markdownFiles) {
    stats.markdownFiles += 1;
    const firstFailure = failures.length;
    const text = readText(file);
    const seen = new Set();
    for (const { target, line } of extractLinks(text)) {
      const resolved = resolveLocalTarget(file, target);
      if (!resolved) continue;
      const key = `${resolved.path}#${resolved.fragment}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checkTarget(file, line, target, resolved);
    }
    for (const { path, fragment, url, line } of findRepoUrls(text)) {
      const key = `${path}#${fragment}@${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checkTarget(file, line, url, { path: path.replace(/\/$/, ''), fragment });
    }
    failures.push(...failures.splice(firstFailure).sort((a, b) => lineOf(a) - lineOf(b)));
  }

  for (const file of files.filter((name) => name.endsWith('.json'))) {
    stats.jsonFiles += 1;
    const error = jsonError(file, readText(file));
    if (error) failures.push(`${file}: invalid JSON: ${error}`);
  }

  const readmes = Object.fromEntries(
    README_FILES.filter((name) => fileSet.has(name)).map((name) => [name, readText(name)]),
  );
  if (Object.keys(readmes).length === README_FILES.length) failures.push(...checkReadmeAlignment(readmes));

  return { failures, stats };
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------

/** Tracked files plus untracked files that are not ignored, limited to those that exist on disk. */
export function listRepoFiles(root) {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return output.split('\0').filter((file) => file !== '' && existsSync(join(root, file)));
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = listRepoFiles(root);
  const { failures, stats } = validateDocs({ files, readText: (path) => readFileSync(join(root, path), 'utf8') });
  if (failures.length > 0) {
    console.error(`docs:check FAILED (${failures.length})`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log(
    `docs:check PASS: ${stats.markdownFiles} Markdown files, ${stats.links} local links and anchors, ${stats.jsonFiles} JSON files.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
