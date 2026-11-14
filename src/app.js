// Entry point: theme, state (URL hash + saved), data load, input panel, results placeholder.
import { createStore, loadInitialState, encodeState, decodeState } from './state.js';
import { loadData, STATE_NAMES } from './data.js';
import { renderInputs } from './ui/inputs.js';
import { initTheme } from './ui/theme.js';

const NEEDLE_ANGLE = { healthy: -42, typical: -12, condition: 24, worst: 58 };
const ENROLLMENT_TEXT = { self: 'Self only', self_plus_one: 'Self plus one', family: 'Family' };

const store = createStore(loadInitialState({ hash: location.hash }));
export { store };

// Keep the shareable URL in step with state (replaceState: no history spam, no scroll jump).
function writeHash(s) {
  const hash = encodeState(s);
  const url = hash ? `#${hash}` : location.pathname + location.search;
  if (`#${hash}` !== location.hash && !(hash === '' && location.hash === '')) {
    history.replaceState(null, '', url);
  }
}

// Brand needle points toward the chosen scenario: the one piece of decorative motion, tied to input.
function pointNeedle(s) {
  document.documentElement.style.setProperty('--needle', `${NEEDLE_ANGLE[s.scenario] ?? 0}deg`);
}

function renderPlaceholder(s) {
  const main = document.getElementById('results');
  const box = main.querySelector('[data-placeholder]');
  if (!box) return; // Task 5 owns #results once it renders real content.
  const body = box.querySelector('.results-empty-body');
  const st = s.location.state;
  body.textContent = st
    ? `Ready to rank 2027 plans offered in ${STATE_NAMES[st] ?? st} for ${ENROLLMENT_TEXT[s.enrollment].toLowerCase()} coverage.`
    : 'Choose your state to start.';
  box.classList.toggle('is-ready', Boolean(st));
}

function renderSource(meta) {
  const dates = Object.entries(meta?.files ?? {})
    .filter(([k]) => k.includes('2027'))
    .map(([, f]) => f.published)
    .filter(Boolean)
    .sort();
  if (!dates.length) return;
  const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const range = dates[0] === dates.at(-1) ? fmt(dates[0]) : `${fmt(dates[0])} to ${fmt(dates.at(-1))}`;
  document.getElementById('data-source').textContent =
    `Data from U.S. Office of Personnel Management public use files for 2027, published ${range}. Estimates, not quotes.`;
}

function showLoadError(form, err) {
  const msg = document.createElement('div');
  msg.className = 'panel-error';
  msg.setAttribute('role', 'alert');
  const title = document.createElement('p');
  title.className = 'panel-error-title';
  title.textContent = 'Plan data did not load.';
  const body = document.createElement('p');
  body.textContent = location.protocol === 'file:'
    ? 'Open the app through a local web server (for example: python -m http.server) instead of the file directly.'
    : `Check your connection and reload the page. (${err.message})`;
  msg.append(title, body);
  form.replaceChildren(msg);
}

async function main() {
  initTheme(document.getElementById('theme-toggle'));

  store.subscribe(writeHash);
  store.subscribe(pointNeedle);
  store.subscribe(renderPlaceholder);
  pointNeedle(store.get());
  renderPlaceholder(store.get());

  // Back/forward or a pasted link: adopt the hash.
  window.addEventListener('hashchange', () => {
    const next = decodeState(location.hash);
    if (encodeState(next) !== encodeState(store.get())) store.set(next);
  });

  const form = document.getElementById('inputs');
  try {
    const data = await loadData();
    renderInputs(form, { data, store });
    renderSource(data.meta);
    document.documentElement.classList.add('is-loaded');
  } catch (err) {
    console.error(err);
    showLoadError(form, err);
  }
}

main();
