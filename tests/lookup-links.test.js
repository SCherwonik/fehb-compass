// I4: a misprinted host in a brochure (Sharp: "sharphealtplan.com") never becomes a live "Look up your drug" button;
// the corrected link from pipeline/link_overrides.json is used and says so. Link shorteners printed in a brochure
// (TakeCare: bit.ly) are labelled as such. Real brochure facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { lookupFor, linkHost } from '../src/ui/rx-model.js';

const FACTS = JSON.parse(fs.readFileSync(new URL('../data/brochure_facts.json', import.meta.url), 'utf8'));

test('YJ1 and YJ4 open the corrected Sharp link, with the printed text and reason kept', () => {
  for (const code of ['YJ1', 'YJ4']) {
    const l = lookupFor(code, FACTS);
    assert.equal(l.href, 'https://www.sharphealthplan.com/search-drug-list');
    assert.equal(l.corrected.printed, 'www.sharphealtplan.com/search-drug-list');
    assert.match(l.corrected.reason, /Misprinted host/);
    assert.equal(l.shortener, false);
  }
});

test('JK1, JK4 and KX1: the bit.ly link is labelled as a link shortener from the brochure', () => {
  for (const code of ['JK1', 'JK4', 'KX1']) {
    const l = lookupFor(code, FACTS);
    assert.equal(new URL(l.href).hostname, 'bit.ly');
    assert.equal(l.shortener, true);
    assert.equal(l.note, 'Link shortener from the brochure: it does not show where it leads.');
  }
  assert.equal(lookupFor('104', FACTS).shortener, false);
});

test('linkHost names the destination host without www', () => {
  assert.equal(linkHost('https://www.sharphealthplan.com/search-drug-list'), 'sharphealthplan.com');
  assert.equal(linkHost('https://bit.ly/x'), 'bit.ly');
  assert.equal(linkHost('javascript:alert(1)'), null);
});

test('no shipped lookup link points at the misprinted host', () => {
  for (const code of Object.keys(FACTS.plans)) {
    const l = lookupFor(code, FACTS);
    if (l) assert.doesNotMatch(l.href, /sharphealtplan/, code);
  }
});
