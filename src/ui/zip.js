// ZIP code: 5-digit ZIP -> state (OPM's FEDVIP zip file) and the ZIP field in the input panel.
// lookupZip/cleanZip are pure (unit tested under node); createZipField builds DOM only when called.
//
// OPM's data (data/fedvip.json): zip3_to_states[zip3] lists the states of every ZIP5 OPM has in that ZIP3;
// zip5_state_exceptions[zip5] names the state for ZIP3s that span several states. A ZIP OPM labels
// "No State Mapping Found" (Puerto Rico, some military ZIPs) has no state but may still list dental plans
// (geo.zip3), so dental prices and eligibility still work there.

const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const STATE = /^[A-Z]{2}$/;

/** '22302', ' 22302 ' or '22302-1234' -> '22302'; anything else -> null. */
export function cleanZip(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = s.match(/^([0-9]{5})(?:-[0-9]{4})?$/);
  return m ? m[1] : null;
}

/**
 * lookupZip(fedvip, zip) -> { zip, state, reason, candidates, priced }
 *   state:  2-letter code, or null
 *   reason: 'ok' | 'format' (not 5 digits) | 'loading' (no data yet) | 'unknown' (OPM has no such ZIP3)
 *           | 'ambiguous' (multi-state ZIP3, ZIP5 not listed) | 'nostate' (OPM lists it without a state)
 *   priced: OPM's FEDVIP geography covers this ZIP (dental eligibility and regions available)
 */
export function lookupZip(fedvip, zip) {
  const z = cleanZip(zip); // same rule as the field: 5 digits, ZIP+4 accepted
  const out = { zip: z, state: null, reason: 'format', candidates: [], priced: false };
  if (!z) return out;
  if (!fedvip || typeof fedvip !== 'object') return { ...out, reason: 'loading' };
  const z3 = z.slice(0, 3);
  out.priced = Boolean(own(own(own(own(fedvip.years, '2027'), 'geo'), 'zip3'), z3));
  const exc = own(fedvip.zip5_state_exceptions, z);
  const states = own(fedvip.zip3_to_states, z3);
  const usable = (s) => typeof s === 'string' && STATE.test(s);
  if (usable(exc)) return { ...out, state: exc, reason: 'ok' };
  if (typeof exc === 'string') return { ...out, reason: 'nostate' }; // OPM names a non-state ("Military")
  if (!Array.isArray(states) || !states.length) return { ...out, reason: out.priced ? 'nostate' : 'unknown' };
  // labels that are not states ("MIL") do not make a ZIP3 ambiguous: 970 = MIL, OR -> OR
  const real = states.filter(usable);
  if (real.length === 1) return { ...out, state: real[0], reason: 'ok' };
  if (!real.length) return { ...out, reason: 'nostate' };
  return { ...out, reason: 'ambiguous', candidates: real };
}

/**
 * Does a stored ZIP still fit a state the user picked by hand? Only a definite contradiction drops it: the ZIP
 * resolves to exactly one state and it is another one, or it is ambiguous and the pick is none of its states.
 * ZIPs OPM gives no state (Puerto Rico, military), and any check before the data loads, keep the ZIP.
 */
export function zipKeepsWith(fedvip, zip, state) {
  if (!zip || !fedvip) return true;
  const r = lookupZip(fedvip, zip);
  if (r.state) return r.state === state;
  if (r.reason === 'ambiguous') return r.candidates.includes(state);
  return true;
}

const HINT = 'Sets your state and prices FEDVIP dental for your area.';

/**
 * What the ZIP field does with its text. -> { patch|null, msg, tone, invalid, loading? }
 * patch: the store write (null = none). A partial or invalid entry clears the stored ZIP, so results never
 * keep using a ZIP the field no longer shows.
 */
export function zipPatch(fedvip, raw, currentZip, stateName = (x) => x) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const clear = currentZip ? { location: { zip: null } } : null;
  if (!text) return { patch: clear, msg: HINT, tone: '', invalid: false };
  const z = cleanZip(text);
  if (!z) return { patch: clear, msg: 'Enter a 5-digit ZIP code. Dental prices need one.', tone: 'warn', invalid: true };
  if (!fedvip) return { patch: null, msg: 'Looking up your ZIP…', tone: '', invalid: false, loading: true };
  const res = lookupZip(fedvip, z);
  if (res.state) return { patch: { location: { zip: z, state: res.state } }, msg: `${stateName(res.state)}, from ZIP ${z}.`, tone: 'ok', invalid: false };
  if (res.priced) return { patch: { location: { zip: z } }, msg: zipMessage(res, stateName), tone: 'warn', invalid: false };
  return { patch: clear, msg: zipMessage(res, stateName), tone: 'warn', invalid: true };
}

/** Friendly sentence for a lookup that did not give a state ('' when it did). */
export function zipMessage(res, stateName = (s) => s) {
  switch (res?.reason) {
    case 'ok': return '';
    case 'format': return 'Enter a 5-digit ZIP code.';
    case 'loading': return 'Looking up your ZIP…';
    case 'ambiguous':
      return `ZIP ${res.zip} is on a state line in OPM’s list (${res.candidates.map(stateName).join(', ')}). Pick your state below.`;
    case 'nostate':
      return `OPM’s list has no state for ZIP ${res.zip}. Dental plans for this ZIP are priced; pick your state for medical plans.`;
    default:
      return 'OPM’s list has no state for this ZIP: e.g. some PR/VI/APO ZIPs; pick your state manually.';
  }
}

/**
 * ZIP field for the input panel. createZipField({ h, store, getFedvip, onNeedData, stateName })
 *   getFedvip(): the loaded fedvip.json or null; onNeedData(): start loading it (resolves when loaded).
 * On a valid ZIP with a state, sets location { zip, state } in one write (the state picker follows).
 * Returns { el, sync(state), refresh() } (refresh: re-run the lookup once the data arrives).
 */
export function createZipField({ h, store, getFedvip, onNeedData, stateName = (s) => s }) {
  const id = 'in-zip';
  const msgId = 'in-zip-msg';
  const input = h('input', {
    type: 'text', id, class: 'select zip-input', inputmode: 'numeric', autocomplete: 'postal-code',
    maxlength: '10', pattern: '[0-9]{5}', placeholder: 'e.g. 22302', spellcheck: 'false', 'aria-describedby': msgId,
  });
  const msg = h('p', { class: 'field-hint zip-msg', id: msgId, 'aria-live': 'polite' }, HINT);
  const el = h('div', { class: 'field zip-field' },
    h('label', { class: 'field-label', for: id }, 'ZIP code'), input, msg);
  let pending = null;

  // `quiet`: while typing, a partial entry clears the stored ZIP but only says so once the user leaves the field
  function apply(raw, { quiet = false } = {}) {
    const r = zipPatch(getFedvip(), raw, store.get().location.zip, stateName);
    pending = r.loading ? cleanZip(raw) : null;
    if (r.loading) onNeedData?.();
    if (r.invalid && quiet) {
      input.removeAttribute('aria-invalid');
      setMsg(store.get().location.zip ? 'Finish the 5-digit ZIP code.' : HINT, '');
    } else {
      if (r.invalid) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      setMsg(r.msg, r.tone);
    }
    if (r.patch) store.set(r.patch);
  }

  function setMsg(text, tone) {
    msg.textContent = text;
    msg.dataset.tone = tone;
  }

  input.addEventListener('focus', () => onNeedData?.(), { once: true });
  input.addEventListener('input', () => apply(input.value, { quiet: true }));
  input.addEventListener('change', () => apply(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(input.value); } });

  return {
    el,
    input,
    sync(s) {
      const z = s.location.zip;
      // follow outside changes (a pasted link, back/forward) without wiping a partial entry the user is fixing
      if (document.activeElement !== input) {
        const cur = cleanZip(input.value);
        if (z ? cur !== z : cur) input.value = z ?? '';
      }
      if (z && getFedvip() && msg.dataset.tone !== 'warn') {
        const res = lookupZip(getFedvip(), z);
        if (res.state && res.state === s.location.state) setMsg(`${stateName(res.state)}, from ZIP ${z}.`, 'ok');
      }
    },
    refresh() {
      if (pending) apply(pending);
    },
    /** Announce something about the ZIP (e.g. that a state pick cleared it). */
    note(text) {
      setMsg(text, 'warn');
    },
  };
}
