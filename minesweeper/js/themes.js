/* Theme registry and picker.
 *
 * A theme is nothing but a `data-theme` value on <html>; every colour lives in
 * style.css as a custom property. Adding one means adding an entry here and a
 * matching block there — no JavaScript anywhere else needs to know.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'ms:theme';

  // `swatch` is [tile, accent] — the two colours that identify a theme at 18px.
  // Keep them in step with --tile-b and --accent in style.css.
  const THEMES = [
    { id: 'slate', name: 'Slate', dark: false, swatch: ['#dde3ef', '#4666f1'] },
    { id: 'midnight', name: 'Midnight', dark: true, swatch: ['#242b40', '#7aa2ff'] },
    { id: 'sakura', name: 'Sakura', dark: false, swatch: ['#ffd8e1', '#db2c5e'] },
    { id: 'forest', name: 'Forest', dark: false, swatch: ['#d8e3cd', '#2f7d4f'] },
    { id: 'sunset', name: 'Sunset', dark: false, swatch: ['#ffd9c2', '#c74c1c'] },
    { id: 'carbon', name: 'Carbon', dark: true, swatch: ['#2c2e31', '#f0b429'] }
  ];

  const byId = {};
  THEMES.forEach(function (theme) { byId[theme.id] = theme; });

  function read() {
    try {
      const saved = global.localStorage.getItem(STORAGE_KEY);
      if (saved && byId[saved]) return saved;
    } catch (err) { /* private mode: fall through to the default */ }
    // No stored choice, so take the cue the browser already gives us.
    const prefersDark = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'midnight' : 'slate';
  }

  function write(id) {
    try {
      global.localStorage.setItem(STORAGE_KEY, id);
    } catch (err) { /* the theme still applies for this session */ }
  }

  let current = read();

  function paint(id) {
    current = id;
    document.documentElement.setAttribute('data-theme', id);
    // Keep the browser chrome (mobile status bar, form controls) in step with
    // the page rather than flashing the previous theme's colour.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (bg) meta.setAttribute('content', bg);
    }
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute('content', byId[id].dark ? 'dark' : 'light');
  }

  function apply(id, animate) {
    if (!byId[id] || id === current) return;
    write(id);
    // Claim the new theme before the transition runs, not inside it: the
    // callback fires a frame or two later, and until it does a second click
    // would still be comparing against the old value.
    current = id;
    // A view transition crossfades the whole page in one go; without it the
    // properties still change, just instantly. Never on reduced motion.
    const reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduced && document.startViewTransition) {
      document.startViewTransition(function () { paint(id); });
    } else {
      paint(id);
    }
    document.querySelectorAll('[data-theme-id]').forEach(function (button) {
      button.setAttribute('aria-checked', String(button.dataset.themeId === id));
    });
  }

  function buildPicker(container) {
    THEMES.forEach(function (theme) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.dataset.themeId = theme.id;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(theme.id === current));
      // The dot is decorative; the accessible name has to carry the theme name.
      button.setAttribute('aria-label', theme.name);
      button.title = theme.name;
      button.style.setProperty('--swatch-a', theme.swatch[0]);
      button.style.setProperty('--swatch-b', theme.swatch[1]);

      const dot = document.createElement('span');
      dot.className = 'swatch-dot';
      dot.setAttribute('aria-hidden', 'true');
      button.appendChild(dot);

      button.addEventListener('click', function () { apply(theme.id, true); });
      container.appendChild(button);
    });

    // Arrow keys walk the group, which is what a radiogroup is expected to do.
    container.addEventListener('keydown', function (event) {
      const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
      if (keys.indexOf(event.key) === -1) return;
      const buttons = Array.prototype.slice.call(container.querySelectorAll('.swatch'));
      const from = buttons.indexOf(document.activeElement);
      if (from === -1) return;
      event.preventDefault();
      const step = (event.key === 'ArrowRight' || event.key === 'ArrowDown') ? 1 : -1;
      const to = (from + step + buttons.length) % buttons.length;
      buttons[to].focus();
      apply(buttons[to].dataset.themeId, true);
    });
  }

  paint(current);

  global.MS = global.MS || {};
  global.MS.Themes = {
    list: THEMES,
    apply: apply,
    build: buildPicker,
    get current() { return current; }
  };
})(window);
