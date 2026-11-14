// Entry point: theme, state (URL hash + saved), staged data load, input panel, ranked results.
import { createStore, loadInitialState, encodeState, encodeHash, saveOverflow, decodeState, sanitizeAgainstData } from './state.js';
import { loadDataProgressive } from './data.js';
import { renderInputs } from './ui/inputs.js';
import { initTheme } from './ui/theme.js';
import { createResults } from './ui/results.js';
import { dataVocabulary } from './ui/model.js';

const NEEDLE_ANGLE = { nothing: -64, healthy: -42, typical: -12, condition: 24, worst: 58 };

const store = createStore(loadInitialState({ hash: location.hash }));
export { store };

// Keep the shareable URL in step with state (replaceState: no history spam, no scroll jump).
// Custom lines that do not fit the URL budget are kept in localStorage (see state.js encodeHash).
function writeHash(s) {
  const res = encodeHash(s);
  saveOverflow(res);
  const hash = res.hash;
  const url = hash ? `#${hash}` : location.pathname + location.search;
  if (`#${hash}` !== location.hash && !(hash === '' && location.hash === '')) {
    history.replaceState(null, '', url);
  }
}

// Brand needle points toward the chosen scenario: the one piece of decorative motion, tied to input.
function pointNeedle(s) {
  // Set on the needle itself, not :root: a root custom property would restyle the whole results list.
  document.querySelector('.brand-needle')?.style.setProperty('--needle', `${NEEDLE_ANGLE[s.scenario] ?? 0}deg`);
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
  pointNeedle(store.get());

  const form = document.getElementById('inputs');
  const results = createResults(document.getElementById('results'), { store });
  const { core, full } = loadDataProgressive();

  // Stage 1 (plans, service areas, meta: small): paint the input panel while benefits.json streams in.
  let vocab = null;
  try {
    const coreData = await core;
    vocab = dataVocabulary(coreData);
    // Drop values the data does not know (a pasted link with st=ZZ, a renamed network), then make the URL
    // shareable even when state came from localStorage with an empty hash.
    const clean = sanitizeAgainstData(store.get(), vocab);
    if (clean !== store.get()) store.set(clean);
    writeHash(store.get());
    renderInputs(form, { data: coreData, store });
    renderSource(coreData.meta);
    document.documentElement.classList.add('is-loaded');
  } catch (err) {
    console.error(err);
    showLoadError(form, err);
    results.showError(err);
    return;
  }

  // Back/forward or a pasted link: adopt the hash, minus anything the data does not know.
  window.addEventListener('hashchange', () => {
    const next = sanitizeAgainstData(decodeState(location.hash, { storage: undefined }), vocab);
    // droppedCustom is not part of the link, so compare it separately (a pasted link may announce missing lines)
    if (encodeState(next) !== encodeState(store.get()) || next.droppedCustom !== store.get().droppedCustom) store.set(next);
    writeHash(store.get());
  });

  // Stage 2 (rates + benefits): rank plans.
  try {
    results.setData(await full);
  } catch (err) {
    console.error(err);
    results.showError(err);
  }
}

main();
