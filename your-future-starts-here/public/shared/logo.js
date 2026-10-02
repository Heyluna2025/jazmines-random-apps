// AI Empowered Club logo as inline SVG + text. It inherits the text colour, so
// it is white on the violet background and violet on lavender cards — no
// separate light/dark image files needed.
//
// Usage: <span data-logo="sm|md|lg|inherit"></span>  (static markup)
//        YFSHLogo.html({ size: 'sm' })                 (inside rendered HTML)
window.YFSHLogo = (() => {
  'use strict';

  // The "A" mark: a rounded peak with a diagonal cut and a dot at the foot.
  const MARK_VIEWBOX = '0 0 240 200';
  const MARK_PATH = 'M76 45A24 24 0 0 1 114 45L232 192H114L32 100Z';
  const MARK_DOT = { cx: 34, cy: 164, r: 28 };

  function markSvg(cls = 'logo-mark') {
    return `<svg class="${cls}" viewBox="${MARK_VIEWBOX}" aria-hidden="true" focusable="false">` +
      `<path d="${MARK_PATH}"/><circle cx="${MARK_DOT.cx}" cy="${MARK_DOT.cy}" r="${MARK_DOT.r}"/></svg>`;
  }

  function html({ size = 'md', text = true } = {}) {
    return `<span class="logo logo-${size}" role="img" aria-label="AI Empowered Club">${markSvg()}` +
      (text ? '<span class="logo-text"><span class="logo-name">AI Empowered</span><span class="logo-sub">Club</span></span>' : '') +
      '</span>';
  }

  function mount(root = document) {
    root.querySelectorAll('[data-logo]').forEach((el) => {
      el.innerHTML = html({ size: el.dataset.logo || 'md', text: el.dataset.logoText !== 'mark' });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
  else mount();

  return { html, mount, markSvg, MARK_PATH, MARK_DOT, MARK_VIEWBOX };
})();
