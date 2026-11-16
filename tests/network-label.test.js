import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { networkLabel, cleanNetworkName } from '../src/ui/network.js';
import { networkFor } from '../src/ui/rx-model.js';

const json = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const facts = json('brochure_facts.json');
const plansRaw = json('plans.json');
const plans27 = (Array.isArray(plansRaw) ? plansRaw : plansRaw.plans).filter((p) => p.year === 2027);
const plan = (code) => plans27.find((p) => p.code === code);

test('cleanNetworkName keeps the brand and drops the filler', () => {
  assert.equal(cleanNetworkName('UnitedHealthcare Choice Plus network'), 'UnitedHealthcare Choice Plus');
  assert.equal(cleanNetworkName('Cigna Open Access Plus (OAP) Network'), 'Cigna Open Access Plus (OAP)');
  assert.equal(cleanNetworkName('Aetna Choice POS II (Open Access) network in the 50 United States; Network in Alaska'), 'Aetna Choice POS II (Open Access)');
  assert.equal(cleanNetworkName(undefined), '');
  assert.ok(cleanNetworkName('x'.repeat(200)).length <= 90);
});

test('the brochure names the network for plans that use a national network', () => {
  assert.equal(networkFor('441', facts).name, 'Cigna Open Access Plus (OAP) Network');
  assert.equal(networkFor('nope', facts), null);
  assert.equal(networkFor('441', null), null);
  const cigna = networkLabel(plan('441'), '441', facts);
  assert.equal(cigna.text, 'Cigna Open Access Plus (OAP)');
  assert.equal(cigna.from, 'brochure');
  assert.match(cigna.title, /^From the plan’s 2027 brochure, page \d+: “Cigna Open Access Plus/);
  assert.equal(networkLabel(plan('341'), '341', facts).text, 'UnitedHealthcare Choice Plus');
  // the Foreign Service plan is run by its own association but its brochure says the network is Aetna's
  assert.equal(networkLabel(plan('401'), '401', facts).text, 'Aetna Choice POS II (Open Access)');
});

test('a generic type description is not a network; an HMO falls back to its own', () => {
  const generic = networkFor('104', facts);
  assert.match(generic.name, /^Preferred Provider Organization/);
  const l104 = networkLabel(plan('104'), '104', facts);
  // Blue Cross (family) is a national network: used, and said to be the carrier's family, not a brochure quote
  assert.equal(l104.text, 'Blue Cross');
  assert.equal(l104.from, 'family');
  const hmo = plans27.find((p) => p.type === 'HMO' && !networkFor(p.code, facts));
  if (hmo) assert.equal(networkLabel(hmo, hmo.code, facts).from, 'carrier');
});

test('a plan whose network cannot be read is left out, never guessed', () => {
  const unknown = plans27.find((p) => p.type !== 'HMO' && !['Aetna', 'UnitedHealthcare', 'Cigna', 'Blue Cross'].includes(p.network_family) && !(networkLabel(p, p.code, facts)?.from === 'brochure'));
  assert.ok(unknown, 'such a plan exists in the data');
  assert.equal(networkLabel(unknown, unknown.code, facts), null);
});

test('coverage: how many 2027 plans get a network line', () => {
  const by = { brochure: 0, carrier: 0, family: 0, none: 0 };
  for (const p of plans27) by[networkLabel(p, p.code, facts)?.from ?? 'none']++;
  assert.equal(by.brochure + by.carrier + by.family + by.none, plans27.length);
  assert.ok(by.brochure >= 30, `brochure-named networks: ${JSON.stringify(by)}`);
  assert.ok(by.none < plans27.length / 2, `most plans show a network: ${JSON.stringify(by)}`);
});
