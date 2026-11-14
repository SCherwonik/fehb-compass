// Dental & Vision cards (the default view), the view-mode key in the share link, and the shared filter prefs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dvRows, rankDv, dvContext, dvCard, dvHeader, DV_CARD_FACTS } from '../src/ui/dv-model.js';
import { createDvPrefs, parseDvUi, filtersOn, DV_UI_KEY } from '../src/ui/dv-prefs.js';
import { defaultState, encodeState, decodeState, sanitizeState } from '../src/state.js';

const FV = JSON.parse(fs.readFileSync(new URL('../data/fedvip.json', import.meta.url), 'utf8'));
const S = (extra = {}) => ({ ...defaultState(), ...extra, location: { state: 'VA', zip: '22302', ...(extra.location ?? {}) } });

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('dvView: defaults to cards, round-trips as dv=b, separate from the health plan view, junk falls back', () => {
  assert.equal(defaultState().dvView, 'cards');
  assert.equal(encodeState(defaultState()), '');
  const s = { ...defaultState(), dvView: 'board' };
  assert.match(encodeState(s), /(^|&)dv=b(&|$)/);
  assert.equal(decodeState(encodeState(s)).dvView, 'board');
  assert.equal(decodeState(encodeState(s)).view, 'cards'); // the health plan view is its own key (v)
  const both = decodeState(encodeState({ ...defaultState(), view: 'board', dvView: 'cards' }));
  assert.equal(both.view, 'board');
  assert.equal(both.dvView, 'cards');
  assert.equal(decodeState('#dv=x').dvView, 'cards');
  assert.equal(decodeState('#dv=board').dvView, 'cards'); // long forms are not hash tokens
  assert.equal(sanitizeState({ dvView: '__proto__' }).dvView, 'cards');
  assert.equal(sanitizeState({ dvView: 'board' }).dvView, 'board');
});

test('dvCard: ranked by total, built from the board header and cells (cards and board agree)', () => {
  for (const kind of ['dental', 'vision']) {
    const s = S({ tab: kind });
    const ranked = rankDv(dvRows(FV, s, kind));
    assert.ok(ranked.length > 3, kind);
    const ctx = dvContext(ranked, s, kind);
    const cards = ranked.map((r) => dvCard(r, ctx));
    for (let i = 1; i < cards.length; i++) assert.ok(cards[i].total >= cards[i - 1].total, `${kind} sorted by total`);
    const c = cards[0];
    const hd = dvHeader(ranked[0], [], ctx);
    assert.equal(c.rankText, '#1');
    assert.equal(c.isTop, true);
    assert.equal(c.title, hd.title);
    assert.equal(c.total, ranked[0].cost.total);
    assert.equal(c.totalLabel, hd.totalLabel);
    assert.match(c.premium.text, /^\$/);
    assert.equal(c.oop.label, kind === 'dental' ? 'Expected out-of-pocket' : 'Expected copays');
    assert.deepEqual(c.facts.map((f) => f.key), DV_CARD_FACTS[kind].map(([k]) => k));
    for (const f of c.facts) assert.equal(typeof f.text, 'string');
    assert.ok(c.links.every((l) => /^https?:\/\//.test(l.href)), 'links only through normalizeUrl');
    assert.equal(c.vsMine, null);
    assert.ok(!c.chips.some((x) => x.tone === 'type' || x.tone === 'acct'));
  }
});

test('dvCard: with your plan pinned, other cards say how they compare', () => {
  const s = S({ tab: 'dental' });
  const all = dvRows(FV, s, 'dental');
  const mineId = rankDv(all)[3].code;
  const res = rankDv(all, { withMine: true, mineId, all });
  const ctx = dvContext(res.ranked, s, 'dental', res.mine);
  const mine = dvCard(res.mine, ctx);
  assert.equal(mine.isMine, true);
  assert.equal(mine.isTop, false);
  assert.equal(mine.vsMine, null);
  const best = dvCard(res.others[0], ctx);
  assert.match(best.vsMine.text, /^−?\$[\d,]+ vs your plan$|^Same as your plan$/);
  assert.equal(best.vsMine.tone, 'down');
});

test('dv prefs: parse junk safely, filters per kind, subscribers hear changes, storage failures do not throw', () => {
  const p0 = parseDvUi('{"dental":{"carriers":["Aetna","Aetna",5,""],"area":"regional","oon":true},"vision":{"area":"moon"},"lastKind":"vision","open":{"a":true,"b":"x"}}');
  assert.deepEqual(p0.dental, { carriers: ['Aetna'], area: 'regional', oon: true, in2: false });
  assert.deepEqual(p0.vision, { carriers: [], area: 'any', oon: false, in2: false });
  assert.equal(p0.lastKind, 'vision');
  assert.deepEqual(p0.open, { a: true });
  assert.deepEqual(parseDvUi('nope').dental.carriers, []);
  assert.deepEqual(parseDvUi('[1,2]').dental.carriers, []);

  const mem = memoryStorage();
  const prefs = createDvPrefs(mem);
  const heard = [];
  prefs.subscribe((k) => heard.push(k));
  prefs.setFilter('dental', { carriers: ['Delta Dental'] });
  prefs.setFilter('vision', { oon: true });
  assert.deepEqual(prefs.filter('dental').carriers, ['Delta Dental']);
  assert.equal(prefs.filter('vision').oon, true);
  assert.equal(prefs.filter('medical').carriers.length, 1); // anything not vision reads the dental filters
  assert.deepEqual(heard, ['dental', 'vision']);
  assert.equal(filtersOn(prefs.filter('dental')), true);
  assert.equal(JSON.parse(mem._m.get(DV_UI_KEY)).dental.carriers[0], 'Delta Dental');
  prefs.resetFilter('dental');
  assert.equal(filtersOn(prefs.filter('dental')), false);
  // a second copy reads what the first saved
  assert.equal(createDvPrefs(mem).filter('vision').oon, true);

  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('y'); }, removeItem() {} };
  const p2 = createDvPrefs(broken);
  assert.doesNotThrow(() => p2.setFilter('dental', { area: 'nationwide' }));
  assert.equal(p2.filter('dental').area, 'nationwide');
});
