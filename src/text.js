// One rule for free text the user types (custom cost labels, medication names): plain text only.
// Line breaks and tabs become spaces; markup characters (<>), control characters, zero-width and bidi-override
// characters (which can make text read differently from what it holds) are removed; spaces collapse.

const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
const STRIP = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF<>]/g;

/** Plain text of at most `max` characters ('' for anything that is not a string). */
export function plainText(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, 4 * max).replace(BREAKS, ' ').replace(STRIP, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
