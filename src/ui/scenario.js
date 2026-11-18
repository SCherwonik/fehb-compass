// "Your year": who is covered (several people only), scenario picker, the "Fine-tune your year" worst-case controls
// (overrides layered on the scenario) and the "Your own costs" custom line editor.
import { h } from './dom.js';
import { segmented } from './inputs.js';
import { describeUsage, effectiveUsage } from './assumptions.js';
import { createCustomLines } from './custom-lines.js';
import { createFineTune, SCENARIO_OPTIONS } from './fine-tune.js';
import { createMembersSection } from './members.js';
import { memberCount } from '../state.js';
import { reduceMotion, EASE_OUT } from './motion.js';

export { SCENARIO_OPTIONS };

/**
 * createScenarioSection({ store }) -> { el: Node[], sync(state) }
 * With one person the section is as it always was; with several, "Covered people" (src/ui/members.js) replaces the
 * single scenario picker and fine-tune, since each person has their own.
 */
export function createScenarioSection({ store }) {
  const scenario = segmented({ name: 'scenario', legend: 'Expected care in 2027', options: SCENARIO_OPTIONS });
  scenario.el.classList.add('field-scenario');
  const desc = h('p', { class: 'scenario-desc', 'aria-live': 'polite' });
  scenario.el.append(desc);

  const fine = createFineTune({
    idPrefix: 'ft',
    get: () => ({ scenario: store.get().scenario, overrides: store.get().overrides }),
    set: (overrides) => store.set({ overrides }),
  });
  const members = createMembersSection({ store });
  const custom = createCustomLines({ store });

  let lastDesc = null;
  function sync(state) {
    const several = memberCount(state) > 1;
    members.sync(state);
    scenario.el.hidden = several;
    fine.el.hidden = several;
    scenario.sync(state.scenario);
    const text = describeUsage(effectiveUsage(state));
    if (text !== lastDesc) {
      if (lastDesc !== null && !reduceMotion()) {
        desc.animate([{ opacity: 0.2, filter: 'blur(2px)' }, { opacity: 1, filter: 'none' }], { duration: 260, easing: EASE_OUT });
      }
      desc.textContent = text;
      lastDesc = text;
    }
    fine.sync({ scenario: state.scenario, overrides: state.overrides });
    custom.sync(state);
  }

  return { el: [members.el, scenario.el, fine.el, custom.el], sync };
}
