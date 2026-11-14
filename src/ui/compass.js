// The brand compass needle: rests at 0 degrees, now and then glides to a random angle (mostly small ones) and
// settles back with a soft bounce. The motion logic is pure (createCompass) so tests can drive it with a fake
// clock; initCompass runs it on requestAnimationFrame and writes the angle to the needle's --needle property.

/** Quintic ease: zero speed and zero acceleration at both ends, so a glide starts and ends without a jolt. */
export const smoother = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10));

/**
 * A random angle in [-max, +max], more often near 0: magnitude = max * U^pull (pull 1 is uniform; 2.2 puts half of
 * the picks within about 22% of max).
 */
export function pickAngle(rng, max, pull) {
  const sign = rng() < 0.5 ? -1 : 1;
  return sign * max * Math.pow(rng(), pull);
}

export const COMPASS_DEFAULTS = Object.freeze({ max: 32, pull: 2.2, glide: 1.6, bounce: 40, rest: 3, sway: 1 });

/**
 * createCompass(options) -> { step(nowSeconds, dtSeconds) -> angle in degrees }.
 * options: max (degrees each way), pull (weight toward 0), glide (seconds for a full-size swing), bounce (0-100:
 * overshoot when settling), rest (average seconds at 0), sway (degrees of idle drift at rest), rng.
 */
export function createCompass(options = {}) {
  const o = { ...COMPASS_DEFAULTS, ...options };
  const rng = options.rng ?? Math.random;
  let angle = 0;
  let velocity = 0;
  let phase = 'rest';
  let until = 1.2; // first swing after a short pause
  let from = 0;
  let to = 0;
  let startedAt = 0;
  let duration = 1;
  let swayClock = 0;

  const refAt = (now) => from + (to - from) * smoother((now - startedAt) / duration);
  function glideTo(now, x, ref) {
    from = ref;
    to = x;
    startedAt = now;
    duration = o.glide * (0.55 + 0.45 * Math.min(1, Math.abs(x - ref) / o.max));
  }
  function schedule(now, ref) {
    if (phase === 'rest') {
      glideTo(now, pickAngle(rng, o.max, o.pull), ref);
      phase = 'hold';
      until = now + duration + 0.3 + rng() * 0.8;
    } else if (rng() < 0.2) {
      glideTo(now, pickAngle(rng, o.max, o.pull), ref); // sometimes go straight to another angle
      until = now + duration + 0.3 + rng() * 0.8;
    } else {
      glideTo(now, 0, ref);
      phase = 'rest';
      until = now + duration + (0.4 + rng() * 1.2) * o.rest;
    }
  }

  return {
    step(now, dt) {
      if (now >= until) schedule(now, refAt(now));
      const ref = refAt(now);
      swayClock += dt;
      const calm = phase === 'rest' && now > startedAt + duration;
      const sway = calm ? o.sway * Math.sin(swayClock * 2 * Math.PI * 0.35) : 0;
      // a soft spring follows the eased path: the bounce setting is how much it overshoots when it arrives
      const zeta = 1 - 0.0088 * o.bounce;
      const k = 45;
      const c = 2 * zeta * Math.sqrt(k);
      const target = ref + sway;
      const n = 4;
      for (let i = 0; i < n; i++) {
        const h = dt / n;
        velocity += (k * (target - angle) - c * velocity) * h;
        angle += velocity * h;
      }
      return angle;
    },
  };
}

/** Run the sway on `needle` (an element whose transform reads --needle). Holds still for reduced motion. */
export function initCompass(needle, options = {}) {
  if (!needle) return () => {};
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const compass = createCompass(options);
  let raf = 0;
  let t0 = 0;
  let last = 0;
  const set = (deg) => needle.style.setProperty('--needle', `${deg.toFixed(2)}deg`);
  const frame = (ms) => {
    if (!t0) { t0 = ms; last = ms; }
    const dt = Math.min(0.05, (ms - last) / 1000);
    last = ms;
    set(compass.step((ms - t0) / 1000, dt));
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (raf) return;
    needle.classList.add('is-swaying'); // no CSS transition: the loop is the animation
    t0 = 0;
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    needle.classList.remove('is-swaying');
    set(0);
  };
  const sync = () => (mq?.matches ? stop() : start());
  mq?.addEventListener?.('change', sync);
  sync();
  return () => { mq?.removeEventListener?.('change', sync); stop(); };
}
