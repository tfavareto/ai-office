import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checkReadmeAlignment,
  collectAnchors,
  createSlugger,
  extractLinks,
  findRepoUrls,
  jsonError,
  mapRepoUrl,
  maskCode,
  resolveLocalTarget,
  slugify,
  validateDocs,
} from './validate-docs.mjs';

const RAW = 'https://raw.githubusercontent.com/tfavareto/ai-office/main/';
const BLOB = 'https://github.com/tfavareto/ai-office/blob/main/';

const targets = (markdown) => extractLinks(markdown).map((link) => link.target);

describe('slugify', () => {
  test('lowercases and turns spaces into hyphens', () => {
    assert.equal(slugify('Quick Start Guide'), 'quick-start-guide');
  });

  test('keeps accented letters', () => {
    assert.equal(slugify('Instalação rápida'), 'instalação-rápida');
  });

  test('drops emoji and punctuation but keeps hyphens and underscores', () => {
    assert.equal(slugify('🚀 What is it? (v1.0) snake_case-ok'), '-what-is-it-v10-snake_case-ok');
  });

  test('drops the variation selector left behind by emoji', () => {
    assert.equal(slugify('✔️ Done'), '-done');
  });

  test('keeps the two hyphens around an ampersand', () => {
    assert.equal(slugify('Tips & tricks'), 'tips--tricks');
  });
});

describe('createSlugger', () => {
  test('suffixes duplicates with -1, -2', () => {
    const slug = createSlugger();
    assert.deepEqual([slug('Setup'), slug('Setup'), slug('Setup')], ['setup', 'setup-1', 'setup-2']);
  });

  test('does not collide with a heading literally named like a suffixed slug', () => {
    const slug = createSlugger();
    assert.deepEqual([slug('A'), slug('A-1'), slug('A')], ['a', 'a-1', 'a-2']);
  });
});

describe('collectAnchors', () => {
  const markdown = [
    '# Title',
    '## `npm run dev` and [links](x.md)',
    '## Title',
    '<a id="custom"></a>',
    '<a name="legacy"></a>',
    '```md',
    '## Not a heading',
    '<a id="in-fence"></a>',
    '```',
    '### 7 / Evidence **and** limits',
  ].join('\n');

  test('collects heading slugs with duplicates and formatting removed', () => {
    const anchors = collectAnchors(markdown);
    for (const slug of ['title', 'title-1', 'npm-run-dev-and-links', '7--evidence-and-limits']) {
      assert.ok(anchors.has(slug), slug);
    }
  });

  test('collects explicit id and name attributes', () => {
    const anchors = collectAnchors(markdown);
    assert.ok(anchors.has('custom'));
    assert.ok(anchors.has('legacy'));
  });

  test('ignores fenced code', () => {
    const anchors = collectAnchors(markdown);
    assert.ok(!anchors.has('not-a-heading'));
    assert.ok(!anchors.has('in-fence'));
  });
});

describe('maskCode', () => {
  test('keeps length and line breaks', () => {
    const source = 'a `b`\n```\nc\n```\nd <!-- e -->';
    const masked = maskCode(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked.split('\n').length, source.split('\n').length);
  });

  test('handles longer fences that contain shorter ones', () => {
    const masked = maskCode('````\n```\n[x](gone.md)\n```\n````\n[y](kept.md)');
    assert.ok(!masked.includes('gone.md'));
    assert.ok(masked.includes('kept.md'));
  });
});

describe('extractLinks', () => {
  test('finds inline links and images with titles', () => {
    assert.deepEqual(targets('[a](one.md) ![b](img/two.png "Title") [c](three.md#part)'), [
      'one.md',
      'img/two.png',
      'three.md#part',
    ]);
  });

  test('handles angle-bracket destinations with spaces and parentheses in plain ones', () => {
    assert.deepEqual(targets('[a](<my file.md>) [b](dir/page_(1).md)'), ['my file.md', 'dir/page_(1).md']);
  });

  test('ignores fenced blocks, inline code and comments', () => {
    const markdown = [
      '`[a](inline.md)`',
      '```',
      '[b](fenced.md)',
      '```',
      '<!-- [c](comment.md) -->',
      '[d](real.md)',
    ].join('\n');
    assert.deepEqual(targets(markdown), ['real.md']);
  });

  test('reads HTML href and src, also across lines', () => {
    const markdown = '<a href="a.md"><img\n  src=\'docs/b.svg\'\n  alt="x"></a>';
    assert.deepEqual(targets(markdown), ['a.md', 'docs/b.svg']);
  });

  test('splits srcset candidates', () => {
    const markdown = '<img srcset="small.png 1x, big.png 2x, huge.png 640w" src="small.png">';
    assert.deepEqual(targets(markdown), ['small.png', 'big.png', 'huge.png', 'small.png']);
  });

  test('reads reference definitions', () => {
    assert.deepEqual(targets('[ref]: docs/a.md "Title"\n[other]: <docs/b.md>'), ['docs/a.md', 'docs/b.md']);
  });

  test('reports the line of each link', () => {
    assert.deepEqual(extractLinks('x\n\n[a](one.md)'), [{ target: 'one.md', line: 3 }]);
  });
});

describe('repository URLs', () => {
  test('maps raw and blob/tree URLs to local paths', () => {
    assert.deepEqual(mapRepoUrl(`${RAW}docs/prompts/01-install-and-run.md`), {
      path: 'docs/prompts/01-install-and-run.md',
      fragment: '',
    });
    assert.deepEqual(mapRepoUrl(`${BLOB}docs/README.md#index`), { path: 'docs/README.md', fragment: 'index' });
    assert.deepEqual(mapRepoUrl('https://github.com/tfavareto/ai-office/tree/main/docs'), {
      path: 'docs',
      fragment: '',
    });
    assert.deepEqual(mapRepoUrl('https://github.com/tfavareto/ai-office/tree/main'), { path: '', fragment: '' });
  });

  test('ignores other URLs and other branches', () => {
    assert.equal(mapRepoUrl('https://example.com/a.md'), null);
    assert.equal(mapRepoUrl('https://github.com/tfavareto/ai-office/issues'), null);
    assert.equal(mapRepoUrl('https://github.com/tfavareto/ai-office/blob/main-copy/x.md'), null);
    assert.equal(mapRepoUrl('https://github.com/other/ai-office/blob/main/x.md'), null);
  });

  test('finds URLs inside fenced prompt blocks and drops trailing punctuation', () => {
    const markdown = ['```text', `Read ${RAW}docs/a.md and run it.`, '```', `See ${BLOB}docs/b.md.`].join('\n');
    assert.deepEqual(
      findRepoUrls(markdown).map(({ path, line }) => ({ path, line })),
      [
        { path: 'docs/a.md', line: 2 },
        { path: 'docs/b.md', line: 4 },
      ],
    );
  });

  test('resolveLocalTarget maps repo URLs and skips external ones', () => {
    assert.deepEqual(resolveLocalTarget('README.md', `${BLOB}LICENSE`), { path: 'LICENSE', fragment: '' });
    assert.equal(resolveLocalTarget('README.md', 'https://example.com'), null);
    assert.equal(resolveLocalTarget('README.md', 'mailto:a@b.c'), null);
    assert.equal(resolveLocalTarget('README.md', '//cdn.example.com/x.js'), null);
  });

  test('resolveLocalTarget resolves relative, root-relative, fragment-only and encoded paths', () => {
    assert.deepEqual(resolveLocalTarget('docs/a.md', '../README.md#top'), { path: 'README.md', fragment: 'top' });
    assert.deepEqual(resolveLocalTarget('docs/a.md', '/LICENSE'), { path: 'LICENSE', fragment: '' });
    assert.deepEqual(resolveLocalTarget('docs/a.md', '#intro'), { path: 'docs/a.md', fragment: 'intro' });
    assert.deepEqual(resolveLocalTarget('docs/a.md', 'my%20file.md?raw=1'), { path: 'docs/my file.md', fragment: '' });
    assert.deepEqual(resolveLocalTarget('docs/a.md', './'), { path: 'docs', fragment: '' });
  });
});

describe('README alignment', () => {
  const english = '# T\n<a id="install"></a>\n## One\n## Two\n```\n## ignored\n```';

  test('passes when anchors and section counts match', () => {
    const translated = '# T\n<a id="install"></a>\n## Um\n## Dois';
    assert.deepEqual(checkReadmeAlignment({ 'README.md': english, 'README.pt-BR.md': translated }), []);
  });

  test('reports missing anchors, extra anchors and section count drift', () => {
    const drifted = '# T\n<a id="other"></a>\n## Um';
    const failures = checkReadmeAlignment({ 'README.md': english, 'README.es.md': drifted });
    assert.equal(failures.length, 3);
    assert.match(failures[0], /missing anchors .*install/);
    assert.match(failures[1], /not present .*other/);
    assert.match(failures[2], /1 "##" sections but README.md has 2/);
  });
});

describe('jsonError', () => {
  test('accepts valid JSON and reports syntax errors', () => {
    assert.equal(jsonError('a.json', '{"a":[1,2]}'), null);
    assert.match(jsonError('a.json', '{"a":,}'), /./);
  });

  test('tolerates comments and trailing commas in tsconfig files only', () => {
    const jsonc = '{\n // c\n "a": "x//y", /* d */\n "b": [1,],\n}';
    assert.equal(jsonError('packages/web/tsconfig.json', jsonc), null);
    assert.notEqual(jsonError('package.json', jsonc), null);
  });
});

describe('validateDocs', () => {
  const run = (contents) => {
    const files = Object.keys(contents);
    return validateDocs({ files, readText: (path) => contents[path] });
  };

  test('passes for a consistent tree', () => {
    const { failures, stats } = run({
      'README.md': '# Home\n[docs](docs/guide.md#setup) ![x](docs/x.svg) [dir](docs/)',
      'docs/guide.md': `# Guide\n## Setup\n[home](../README.md#home)\nRead ${RAW}docs/guide.md#setup`,
      'docs/x.svg': '<svg/>',
      'package.json': '{}',
    });
    assert.deepEqual(failures, []);
    assert.equal(stats.markdownFiles, 2);
    assert.equal(stats.jsonFiles, 1);
  });

  test('reports missing files, missing anchors and bad repo URLs with line numbers', () => {
    const { failures } = run({
      'README.md': [
        '# Home',
        '[a](nope.md)',
        '[b](docs/guide.md#absent)',
        `\`\`\`text`,
        `${RAW}docs/missing.md`,
        '```',
      ].join('\n'),
      'docs/guide.md': '# Guide',
    });
    assert.equal(failures.length, 3);
    assert.match(failures[0], /^README\.md:2: missing target "nope\.md"/);
    assert.match(failures[1], /^README\.md:3: missing anchor "#absent" in docs\/guide\.md/);
    assert.match(failures[2], /^README\.md:5: missing target "docs\/missing\.md"/);
  });

  test('matches file names case-sensitively and rejects links outside the repository', () => {
    const { failures } = run({ 'README.md': '[a](readme.md) [b](../outside.md)' });
    assert.equal(failures.length, 2);
    assert.match(failures[1], /leaves the repository/);
  });

  test('reports invalid JSON and README drift', () => {
    const { failures } = run({
      'README.md': '# T\n<a id="a"></a>\n## One',
      'README.pt-BR.md': '# T\n## Um',
      'README.es.md': '# T\n<a id="a"></a>\n## Uno',
      'broken.json': '{',
    });
    assert.equal(failures.length, 2);
    assert.ok(failures.some((failure) => failure.startsWith('broken.json: invalid JSON')));
    assert.ok(failures.some((failure) => failure.startsWith('README.pt-BR.md: missing anchors')));
  });
});
