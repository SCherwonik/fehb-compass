// Entry point: theme, state (URL hash + saved), staged data load, input panel, ranked results.
import { createStore, loadInitialState, encodeState, encodeHash, saveOverflow, decodeState, sanitizeAgainstData, safeStorage, STORAGE_KEY } from './state.js';
import { initSituation, loadOpenPrefs } from './ui/situation.js';
import { situationOpen } from './ui/situation-model.js';
import { loadDataProgressive, loadBrochureFacts, fedvipHub } from './data.js';
import { renderInputs } from './ui/inputs.js';
import { initTheme } from './ui/theme.js';
import { createResults } from './ui/results.js';
import { dataVocabulary } from './ui/model.js';
import { createMedsStore } from './ui/meds-store.js';
import { createMedsPanel } from './ui/meds.js';
import { setBrochureFacts } from './ui/rx-model.js';
import { createDvTabs, createDvPanel, revealPanel } from './ui/dental-board.js';
import { sanitizeDvState } from './ui/dv-model.js';
import { initShare } from './ui/share-ui.js';
import { initAbout } from './ui/about.js';
import { initPrint } from './ui/print.js';
import { noticeEl } from './ui/notices.js';

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

// Footer provenance: OPM's public use files (dates from data/meta.json) and the brochures (data/brochure_facts.json).
const source = { range: '', brochures: '' };
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
function renderSource({ meta, facts } = {}) {
  if (meta) {
    const dates = Object.entries(meta.files ?? {})
      .filter(([k]) => k.includes('2027'))
      .map(([, f]) => f.published)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ''))
      .sort();
    if (dates.length) source.range = dates[0] === dates.at(-1) ? fmtDate(dates[0]) : `${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}`;
  }
  const gen = facts?.meta?.generated;
  if (typeof gen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(gen)) source.brochures = fmtDate(gen);
  const el = document.getElementById('data-source');
  if (!el || !source.range) return;
  el.textContent = `Data: U.S. Office of Personnel Management (OPM) 2027 FEHB and FEDVIP public use files, published ${source.range}, `
    + `and the 2027 plan brochures${source.brochures ? ` (read ${source.brochures})` : ''}.`;
}

/** A friendly failure with a way out: reload the page (the data files are static, so a retry usually works). */
function retryButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-primary panel-retry';
  b.textContent = 'Try again';
  b.addEventListener('click', () => location.reload());
  return b;
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
    : `Check your connection and try again. (${err.message})`;
  msg.append(title, body);
  if (location.protocol !== 'file:') msg.append(retryButton());
  form.replaceChildren(msg);
}

// Medical | Dental & Vision tabs at the top of the results region, and the Dental & Vision panel after it.
function mountDentalVision(main) {
  const frame = main.querySelector('.results-frame');
  if (!frame) return;
  frame.id = 'results-frame';
  frame.setAttribute('role', 'tabpanel');
  frame.setAttribute('aria-labelledby', 'dvt-medical');
  const tabs = createDvTabs({ store });
  const panel = createDvPanel({ store });
  main.prepend(tabs.el);
  main.append(panel.el);
  const sync = (s, prev) => {
    tabs.sync(s);
    frame.hidden = s.tab !== 'medical';
    panel.render(s, { animate: Boolean(prev && prev.tab === s.tab) });
    if (prev && (prev.tab === 'medical') !== (s.tab === 'medical')) revealPanel(s.tab === 'medical' ? frame : panel.el);
  };
  sync(store.get());
  store.subscribe(sync);
}

// What the page opened with, read before the store saves anything: decides whether the editor starts open.
const openedWith = { hash: location.hash, stored: safeStorage().get(STORAGE_KEY) };

async function main() {
  initTheme(document.getElementById('theme-toggle'));
  initShare({ store, copyBtn: document.getElementById('share-copy'), printBtn: document.getElementById('print-page') });
  initAbout(document.getElementById('about-open'));
  // who this tool is not for: Postal Service employees and annuitants (PSHB); dismissible
  const pshb = noticeEl('pshb', {
    focusAfter: () => {
      const t = document.querySelector('.intro-title');
      t?.setAttribute('tabindex', '-1');
      return t;
    },
  });
  if (pshb) document.querySelector('.intro')?.append(pshb);

  store.subscribe(writeHash);
  store.subscribe(pointNeedle);
  pointNeedle(store.get());

  const form = document.getElementById('inputs');
  // "My medications": private (localStorage only), shared by the panel, the GLP-1 chip and the results
  const meds = createMedsStore();

  // "Your situation": summary strip + inline editor (open on a first visit, closed once there is state)
  let planName = () => null;
  const situation = initSituation({
    bar: document.getElementById('sit-bar'),
    editor: document.getElementById('sit-editor'),
    store,
    expanded: situationOpen({ tab: store.get().tab, remembered: loadOpenPrefs(), ...openedWith }),
    chipOpts: () => ({ planName, medsCount: meds.get()?.drugs?.length ?? 0 }),
  });
  meds.subscribe(() => situation.refresh());
  fedvipHub.subscribe(() => situation.refresh());
  const results = createResults(document.getElementById('results'), {
    store,
    onRanked: (rows) => meds.setTop(rows.map((r) => ({ code: r.code, name: r.plan.name, rank: r.rank }))),
  });
  const pushRx = () => results.setRx({ facts: meds.facts(), factsStatus: meds.factsStatus(), meds: meds.get() });
  meds.subscribe((_, reason) => { if (reason !== 'top') pushRx(); });
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
    renderInputs(form, { data: coreData, store, meds });
    planName = (code) => coreData.plans.find((p) => p.year === 2026 && p.code === code)?.name ?? null;
    situation.refresh();
    initPrint({
      store,
      results,
      planName,
      medsCount: () => meds.get()?.drugs?.length ?? 0,
    });
    form.after(createMedsPanel({ meds }).el);
    renderSource({ meta: coreData.meta });
    document.documentElement.classList.add('is-loaded');
  } catch (err) {
    console.error(err);
    showLoadError(form, err);
    results.showError(err);
    return;
  }

  // Back/forward or a pasted link: adopt the hash, minus anything the data does not know.
  window.addEventListener('hashchange', () => {
    let next = sanitizeAgainstData(decodeState(location.hash, { storage: undefined }), vocab);
    if (fedvipHub.get()) next = sanitizeDvState(next, fedvipHub.get());
    // droppedCustom is not part of the link, so compare it separately (a pasted link may announce missing lines)
    if (encodeState(next) !== encodeState(store.get()) || next.droppedCustom !== store.get().droppedCustom) store.set(next);
    writeHash(store.get());
  });

  // FEDVIP dental and vision (data/fedvip.json, about 530 KB): needed now for a dental tab, the add-on or a ZIP
  // in the link; otherwise fetched once the medical plans are ranked.
  fedvipHub.subscribe((fv) => {
    const clean = sanitizeDvState(store.get(), fv);
    if (clean !== store.get()) store.set(clean);
    results.setFedvip(fv);
  });
  const s0 = store.get();
  if (s0.tab !== 'medical' || s0.dental || s0.location.zip) fedvipHub.load();

  // Stage 2 (rates + benefits): rank plans.
  try {
    pushRx();
    results.setData(await full);
  } catch (err) {
    console.error(err);
    results.showError(err);
    return;
  }
  mountDentalVision(document.getElementById('results'));
  fedvipHub.load();

  // Stage 3 (brochure facts, about 1.6 MB): prescription tiers, drug lookup links, what changed in 2027.
  const facts = await loadBrochureFacts();
  setBrochureFacts(facts);
  meds.setFacts(facts);
  renderSource({ facts });
}

main();
