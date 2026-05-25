// Shared dark-mode toggle. The first-paint script in <head> reads
// localStorage + prefers-color-scheme to set the .dark class before paint
// (no flash). This module just wires the toggle button after the DOM loads
// and persists the user override.
(function () {
  'use strict';

  function bind() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var root = document.documentElement;
      var nowDark = !root.classList.contains('dark');
      root.classList.toggle('dark', nowDark);
      try {
        localStorage.setItem('pinpoint-theme', nowDark ? 'dark' : 'light');
      } catch (_) {}
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
