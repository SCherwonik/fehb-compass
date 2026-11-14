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
    root.classList.add('theme-shift');
    apply();
    setTimeout(() => root.classList.remove('theme-shift'), 450);
  });

  apply();
}
