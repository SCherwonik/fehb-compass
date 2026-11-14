// Finds asset references that would break under a sub-path deploy: root-absolute '/x' and protocol-relative '//x'.
// http(s):, data:, mailto: and '#' references are fine. Used by tests/paths.test.js.
const HTML = [/\b(?:href|src|content|action|poster|srcset)\s*=\s*["'](\/[^"']*)["']/g];
const CSS = [/url\(\s*["']?(\/[^"')]*)["']?\s*\)/g, /@import\s+["'](\/[^"']*)["']/g];
const JS = [
  /\bimport\s*(?:[^'"]*?\sfrom\s*)?["'](\/[^"']*)["']/g,
  /\bimport\(\s*["'](\/[^"']*)["']\s*\)/g,
  /\bfetch\(\s*["'`](\/[^"'`]*)["'`]/g,
  /\bnew\s+URL\(\s*["'`](\/[^"'`]*)["'`]\s*,/g,
  /\b(?:href|src)\s*[:=]\s*["'`](\/[^"'`]*)["'`]/g,
];

/** [{ ref, line }] for each absolute reference in `text` (kind: 'html' | 'css' | 'js'). */
export function absoluteRefs(text, kind) {
  const pats = kind === 'html' ? [...HTML, ...CSS, ...JS] : kind === 'css' ? CSS : JS;
  const found = new Map(); // offset of the reference -> entry (several patterns can match the same one)
  for (const re of pats) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].indexOf(m[1]);
      if (!found.has(at)) found.set(at, { ref: m[1], line: text.slice(0, at).split('\n').length });
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
