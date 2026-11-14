import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompass, pickAngle, smoother, COMPASS_DEFAULTS } from '../src/ui/compass.js';

// small seeded generator so the tests are repeatable
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296);
}

test('smoother eases: 0 at the start, 1 at the end, half way at the middle, flat at both ends', () => {
  assert.equal(smoother(-1), 0);
  assert.equal(smoother(0), 0);
  assert.equal(smoother(1), 1);
  assert.equal(smoother(2), 1);
  assert.ok(Math.abs(smoother(0.5) - 0.5) < 1e-12);
  assert.ok(smoother(0.02) < 0.0001, 'barely moves at the start');
  assert.ok(smoother(0.98) > 0.9999, 'barely moves at the end');
});

test('pickAngle stays within +-max and favors small angles', () => {
  const rng = lcg(7);
  const picks = Array.from({ length: 20000 }, () => pickAngle(rng, 32, 2.2));
  assert.ok(picks.every((a) => a >= -32 && a <= 32));
  const small = picks.filter((a) => Math.abs(a) <= 8).length / picks.length;
  const big = picks.filter((a) => Math.abs(a) >= 24).length / picks.length;
  assert.ok(small > 0.5, `most picks are within 8 degrees (${small})`);
  assert.ok(big < 0.15, `few picks are near the limit (${big}): about 12% by the math`);
  const left = picks.filter((a) => a < 0).length / picks.length;
  assert.ok(left > 0.47 && left < 0.53, 'both directions are used about equally');
  // pull 1 is uniform: far more large angles than the weighted pick
  const rng2 = lcg(7);
  const flat = Array.from({ length: 20000 }, () => pickAngle(rng2, 32, 1));
  const flatBig = flat.filter((a) => Math.abs(a) >= 24).length / flat.length;
  assert.ok(flatBig > big * 2, `uniform picks reach the limit more often (${flatBig} vs ${big})`);
});

function run(seconds, options = {}) {
  const c = createCompass({ rng: lcg(11), ...options });
  const dt = 1 / 60;
  const out = [];
  for (let t = 0; t < seconds; t += dt) out.push(c.step(t, dt));
  return out;
}

test('the needle starts at 0, moves, and mostly stays close to 0', () => {
  const a = run(600);
  assert.equal(a[0], 0);
  const max = Math.max(...a.map(Math.abs));
  assert.ok(max > 10, `it does swing (${max})`);
  assert.ok(max <= COMPASS_DEFAULTS.max * 1.25, `it stays inside the range plus a little bounce (${max})`);
  const near = a.filter((x) => Math.abs(x) <= 4).length / a.length;
  assert.ok(near > 0.5, `most of the time it sits near 0 (${near})`);
});

test('motion is smooth: no frame jumps more than a degree or so', () => {
  const a = run(300);
  let worst = 0;
  for (let i = 1; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - a[i - 1]));
  assert.ok(worst < 1.2, `largest change in one 60 fps frame: ${worst.toFixed(3)} degrees`);
});

test('no bounce and no sway: it never goes past the largest angle', () => {
  const a = run(300, { bounce: 0, sway: 0, rest: 1 });
  const peak = Math.max(...a.map(Math.abs));
  assert.ok(peak <= COMPASS_DEFAULTS.max + 0.5, `peak ${peak}`);
});
