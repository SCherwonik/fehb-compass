// GitHub Pages serves the site from a sub-path (https://<user>.github.io/<repo>/), so every asset reference
// must be relative. Fails on root-absolute ('/x') or protocol-relative ('//x') references in the files we ship.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteRefs } from './helpers/abs-paths.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
function walk(dir, exts) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

test('absoluteRefs finds root-absolute references and ignores relative and external ones', () => {
  assert.deepEqual(absoluteRefs('<link href="/styles/app.css"><script src="src/app.js"></script>', 'html').map((r) => r.ref), ['/styles/app.css']);
  assert.deepEqual(absoluteRefs('<a href="https://www.opm.gov/x">', 'html'), []);
  assert.deepEqual(absoluteRefs('<img src="//cdn.example.com/a.png">', 'html').map((r) => r.ref), ['//cdn.example.com/a.png']);
  assert.deepEqual(absoluteRefs("import x from '/src/a.js';\nimport y from './b.js';", 'js').map((r) => r.ref), ['/src/a.js']);
  assert.deepEqual(absoluteRefs("const r = await fetch('/data/plans.json');", 'js').map((r) => r.ref), ['/data/plans.json']);
  assert.deepEqual(absoluteRefs("new URL('../data/', import.meta.url)", 'js'), []);
  assert.deepEqual(absoluteRefs('.a { background: url("/img/x.svg"); } .b { background: url(data:image/svg+xml,%3Csvg/%3E); }', 'css').map((r) => r.ref), ['/img/x.svg']);
  assert.deepEqual(absoluteRefs('<script>location.replace("/index.html")</script>', 'html').map((r) => r.ref), []); // not an asset attr
});

test('no shipped HTML, CSS or JS file references an asset by an absolute path', () => {
  const files = [
    ...['index.html', '404.html'].map((f) => join(ROOT, f)).filter(existsSync),
    ...walk(join(ROOT, 'src'), ['.js']),
    ...walk(join(ROOT, 'styles'), ['.css']),
    ...walk(join(ROOT, 'assets'), ['.svg', '.html', '.css', '.webmanifest']),
  ];
  assert.ok(files.length > 10);
  const bad = [];
  for (const f of files) {
    const kind = f.endsWith('.js') ? 'js' : f.endsWith('.css') ? 'css' : 'html';
    for (const r of absoluteRefs(readFileSync(f, 'utf8'), kind)) bad.push(`${relative(ROOT, f)}:${r.line} ${r.ref}`);
  }
  assert.deepEqual(bad, []);
});
