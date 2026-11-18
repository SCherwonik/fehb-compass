// DOM primitives shared by every view. h() puts text in as text (never parsed as HTML); svg() parses only static,
// author-controlled icon markup. Kept dependency-free so any module can import it without an import cycle.

/** Tiny element builder. Children may be strings, nodes, arrays, or falsy. Text always goes in as text. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const svg = (markup) => {
  const t = document.createElement('template');
  t.innerHTML = markup; // static, author-controlled markup only
  return t.content.firstElementChild;
};

/**
 * Fill a <select> from [[value, label]] and select `value`. When the select already has exactly these values only
 * the changed labels are rewritten in place, so an open list or the focus on it is never disturbed.
 */
export function setOptions(select, opts, value) {
  const cur = Array.from(select.options);
  if (cur.length === opts.length && cur.every((o, i) => o.value === opts[i][0])) {
    cur.forEach((o, i) => { if (o.textContent !== opts[i][1]) o.textContent = opts[i][1]; });
  } else {
    select.replaceChildren(...opts.map(([v, t]) => h('option', { value: v }, t)));
  }
  if (select.value !== String(value)) select.value = String(value);
}

export const ICON_CHECK = '<svg class="chip-check" viewBox="0 0 16 16" aria-hidden="true"><circle class="chip-ring" cx="8" cy="8" r="6.25"/><path class="chip-tick" d="M4.6 8.4l2.3 2.3 4.5-5"/></svg>';
// Disclosure chevron and stepper (-/+) icons shared by the fine-tune sliders and the covered-people rows.
export const ICON_CHEV = '<svg viewBox="0 0 16 16" aria-hidden="true" class="icon-chev"><path d="M4 6l4 4 4-4"/></svg>';
export const ICON_MINUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9"/></svg>';
export const ICON_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>';
export const ICON_CHEVRON = '<svg class="select-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
