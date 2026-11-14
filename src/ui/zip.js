// ZIP code: 5-digit ZIP -> state (OPM's FEDVIP zip file) and the ZIP field in the input panel.
// lookupZip/cleanZip are pure (unit tested under node); createZipField builds DOM only when called.
//
// OPM's data (data/fedvip.json): zip3_to_states[zip3] lists the states of every ZIP5 OPM has in that ZIP3;
// zip5_state_exceptions[zip5] names the state for ZIP3s that span several states. A ZIP OPM labels
// "No State Mapping Found" (Puerto Rico, some military ZIPs) has no state but may still list dental plans
// (geo.zip3), so dental prices and eligibility still work there.

const ZIP5 = /^[0-9]{5}$/;
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
  const z = typeof zip === 'string' && ZIP5.test(zip.trim()) ? zip.trim() : null;
  const out = { zip: z, state: null, reason: 'format', candidates: [], priced: false };
  if (!z) return out;
  if (!fedvip || typeof fedvip !== 'object') return { ...out, reason: 'loading' };
  const z3 = z.slice(0, 3);
  out.priced = Boolean(own(own(own(own(fedvip.years, '2027'), 'geo'), 'zip3'), z3));
  const exc = own(fedvip.zip5_state_exceptions, z);
  const states = own(fedvip.zip3_to_states, z3);
  const usable = (s) => typeof s === 'string' && STATE.test(s);
  if (usable(exc)) return { ...out, state: exc, reason: 'ok' };
  if (!Array.isArray(states) || !states.length) return { ...out, reason: out.priced ? 'nostate' : 'unknown' };
  if (states.length === 1) {
    return usable(states[0]) ? { ...out, state: states[0], reason: 'ok' } : { ...out, reason: 'nostate' };
  }
  return { ...out, reason: 'ambiguous', candidates: states.filter(usable) };
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
  const msg = h('p', { class: 'field-hint zip-msg', id: msgId, 'aria-live': 'polite' },
    'Sets your state and prices FEDVIP dental for your area.');
  const el = h('div', { class: 'field zip-field' },
    h('label', { class: 'field-label', for: id }, 'ZIP code'), input, msg);
  let pending = null;

  function apply(raw, { commit }) {
    const z = cleanZip(raw);
    if (!raw.trim()) {
      input.removeAttribute('aria-invalid');
      setMsg('Sets your state and prices FEDVIP dental for your area.', '');
      if (commit && store.get().location.zip) store.set({ location: { zip: null } });
      return;
    }
    if (!z) {
      if (commit) { input.setAttribute('aria-invalid', 'true'); setMsg('Enter a 5-digit ZIP code.', 'warn'); }
      return;
    }
    const fv = getFedvip();
    if (!fv) {
      setMsg('Looking up your ZIP…', '');
      pending = z;
      onNeedData?.();
      return;
    }
    pending = null;
    const res = lookupZip(fv, z);
    input.removeAttribute('aria-invalid');
    if (res.state) {
      setMsg(`${stateName(res.state)}, from ZIP ${z}.`, 'ok');
      store.set({ location: { zip: z, state: res.state } });
    } else if (res.priced) {
      setMsg(zipMessage(res, stateName), 'warn');
      store.set({ location: { zip: z } });
    } else {
      input.setAttribute('aria-invalid', 'true');
      setMsg(zipMessage(res, stateName), 'warn');
      if (store.get().location.zip) store.set({ location: { zip: null } });
    }
  }

  function setMsg(text, tone) {
    msg.textContent = text;
    msg.dataset.tone = tone;
  }

  input.addEventListener('focus', () => onNeedData?.(), { once: true });
  input.addEventListener('input', () => {
    const z = cleanZip(input.value);
    if (z) apply(input.value, { commit: true });
  });
  input.addEventListener('change', () => apply(input.value, { commit: true }));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(input.value, { commit: true }); } });

  return {
    el,
    input,
    sync(s) {
      const z = s.location.zip;
      if (document.activeElement !== input && (z ?? '') !== cleanZip(input.value)) input.value = z ?? '';
      if (z && getFedvip() && msg.dataset.tone !== 'warn') {
        const res = lookupZip(getFedvip(), z);
        if (res.state && res.state === s.location.state) setMsg(`${stateName(res.state)}, from ZIP ${z}.`, 'ok');
      }
    },
    refresh() {
      if (pending) apply(pending, { commit: true });
    },
  };
}
