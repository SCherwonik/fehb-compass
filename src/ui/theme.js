// Theme toggle: light <-> dark. The first visit follows the device's setting; after a click the choice is saved.
import { safeStorage } from '../state.js';

export const THEME_KEY = 'fehb-compass:theme';

/** The saved choice, else what the device prefers. */
export function initialTheme(storage = safeStorage()) {
  const saved = storage.get(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function initTheme(button, root = document.documentElement) {
  const storage = safeStorage();
  let mode = initialTheme(storage);

  const apply = () => {
    root.setAttribute('data-theme', mode);
    button.dataset.mode = mode;
    const next = mode === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Color theme: ${mode}. Switch to ${next}.`);
    button.title = `Theme: ${mode}`;
  };

  button.addEventListener('click', () => {
    mode = mode === 'dark' ? 'light' : 'dark';
    storage.set(THEME_KEY, mode);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && typeof document.startViewTransition === 'function') {
      // One cross-fade of the whole page: background, text, gradients, icons and shadows change together and finish
      // together. Element transitions are switched off meanwhile, or they would keep running under the fade.
      root.classList.add('theme-instant');
      const t = document.startViewTransition(apply);
      // a second click mid-fade skips the first transition (its colors still apply): not an error
      for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch(() => {});
      t.finished.finally(() => root.classList.remove('theme-instant'));
    } else if (reduce) {
      apply();
    } else {
      root.classList.add('theme-shift');
      apply();
      setTimeout(() => root.classList.remove('theme-shift'), 450);
    }
  });

  apply();
}
