// Theme toggle: cycles system -> light -> dark. Choice persists via safe storage; 'system' clears it.
import { safeStorage } from '../state.js';

export const THEME_KEY = 'fehb-compass:theme';
const ORDER = ['system', 'light', 'dark'];
const LABEL = { system: 'system', light: 'light', dark: 'dark' };

export function initTheme(button, root = document.documentElement) {
  const storage = safeStorage();
  const saved = storage.get(THEME_KEY);
  let mode = saved === 'light' || saved === 'dark' ? saved : 'system';

  const apply = () => {
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    button.dataset.mode = mode;
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    button.setAttribute('aria-label', `Color theme: ${LABEL[mode]}. Switch to ${LABEL[next]}.`);
    button.title = `Theme: ${LABEL[mode]}`;
  };

  button.addEventListener('click', () => {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    if (mode === 'system') storage.remove(THEME_KEY);
    else storage.set(THEME_KEY, mode);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && typeof document.startViewTransition === 'function') {
      // One cross-fade of the whole page: background, text, gradients, icons and shadows all change together and
      // finish together (colors animated one property at a time hand off at different moments and speeds).
      const t = document.startViewTransition(apply);
      // a second click mid-fade skips the first transition (its colors still apply): not an error
      for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch(() => {});
    } else if (reduce) {
      apply();
    } else {
      // older browsers: transition the common color properties on every element for a moment
      root.classList.add('theme-shift');
      apply();
      setTimeout(() => root.classList.remove('theme-shift'), 450);
    }
  });

  apply();
}
