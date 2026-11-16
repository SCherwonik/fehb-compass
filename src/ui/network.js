// The provider network a plan uses (UnitedHealthcare, Aetna, Cigna, Blue Cross ...), shown near the top of every
// plan. DOM-free. Sources, most certain first:
//   1. the 2027 brochure's own network name (data/brochure_facts.json `network.name`, a verified quote with a page);
//   2. for an HMO, its own network (the carrier), because an HMO's network is the HMO's;
//   3. a national network brand when the carrier family is one (Aetna, Cigna, UnitedHealthcare, Blue Cross).
// Anything else is left out (null): a plan whose network the brochure does not name in a way we can read is not guessed.
import { networkFor } from './rx-model.js';

// "Preferred Provider Organization (PPO) within a fee-for-service plan" says the TYPE, not which network.
const GENERIC = /^(preferred provider organization|ppo\b|hmo\b|health maintenance|a health maintenance|fee[- ]for[- ]service|ffs\b|point[- ]of[- ]service|pos\b|exclusive provider|epo\b|open access hmo$|plan providers|performance$|choice open access)/i;

// Carrier families (plans.json network_family) that are national networks in their own right.
const NATIONAL_BRANDS = new Set(['Aetna', 'UnitedHealthcare', 'Cigna', 'Blue Cross']);

/** 'UnitedHealthcare Choice Plus network' -> 'UnitedHealthcare Choice Plus'; stops at ';' and drops ' network ...'. */
export function cleanNetworkName(name) {
  if (typeof name !== 'string') return '';
  let s = name.split(';')[0].trim();
  s = s.replace(/\s+networks?\b.*$/i, '').replace(/[\s,.]+$/, '');
  return s.length > 90 ? `${s.slice(0, 89).trimEnd()}…` : s;
}

/**
 * networkLabel(plan, code, facts?) -> { text, title, from: 'brochure' | 'carrier' | 'family' } | null
 * `plan` is the plans.json entry; `title` is the plain-words source, with the brochure page when there is one.
 */
export function networkLabel(plan, code, facts) {
  const fact = networkFor(code, facts);
  if (fact?.name) {
    const text = cleanNetworkName(fact.name);
    if (text && !GENERIC.test(text)) {
      if (fact.site) {
        let host = '';
        try { host = new URL(fact.site.url).hostname.replace(/^www\./, ''); } catch { host = ''; }
        return {
          text,
          from: 'website',
          title: `Not named in the plan’s brochure. From the plan’s own website${host ? ` (${host})` : ''}${fact.site.retrieved ? `, read ${fact.site.retrieved}` : ''}: “${fact.site.evidence ?? fact.name}”`,
        };
      }
      return {
        text,
        from: 'brochure',
        title: `From the plan’s 2027 brochure${Number.isInteger(fact.page) ? `, page ${fact.page}` : ''}: “${fact.name}”`,
      };
    }
  }
  if (plan?.type === 'HMO') {
    // the normalized brand (Aetna, Kaiser Permanente ...) reads better than a long legal carrier name
    const own = plan.network_family && plan.network_family !== 'Other' ? plan.network_family : plan.carrier;
    if (own) return { text: own, from: 'carrier', title: 'An HMO uses its own network of doctors and hospitals.' };
  }
  if (NATIONAL_BRANDS.has(plan?.network_family)) {
    return { text: plan.network_family, from: 'family', title: `This plan is offered by ${plan.network_family}; check the brochure for the exact network.` };
  }
  return null;
}
