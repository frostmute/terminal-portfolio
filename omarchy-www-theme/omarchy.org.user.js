// ==UserScript==
// @name         Omarchy.org — Project System Theme (auto)
// @namespace    omarchy-org-theme
// @version      1.0.0
// @description  Mirrors your installed Omarchy theme (colors.toml + wallpaper) onto omarchy.org — auto-updates on `omarchy theme set` with no repaste.
// @author       deoxizn
// @match        https://omarchy.org/*
// @match        https://www.omarchy.org/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

/*
  INSTALL (once):
    1. Tampermonkey / Violentmonkey / ScriptCat → Create script → paste this file → Save.
       Tampermonkey will prompt for 127.0.0.1 access — Allow.
    2. Keep the localhost bridge running (installed automatically):
         systemctl --user enable --now omarchy-org-theme-server.service
         omarchy theme set <any>  # triggers rebuild, or run: ~/.local/bin/omarchy-org-theme-build

  HOW IT WORKS:
    - On boot and on every `omarchy theme set`, the hook `~/.config/omarchy/hooks/theme-set.d/99-omarchy-org-sync.sh:1`
      runs `~/.local/bin/omarchy-org-theme-build:1` which converts
      `~/.local/state/omarchy/current/theme/colors.toml:1` → `~/.cache/omarchy-org/theme.css`
    - This script fetches `http://127.0.0.1:17823/theme.css` via GM_xmlhttpRequest (bypasses https→http mixed-content + CORS)
      and injects it as <style>. Polls while tab is visible so a theme switch shows after reload/focus without repaste.

  WHY NOT PURE STYLUS?
    https://omarchy.org is https. Fetching http://127.0.0.1/theme.css from Stylus @import is blocked as mixed active content.
    GM_xmlhttpRequest runs in extension context and is not blocked — hence userscript.

  DEBUG:
    - CSS source: http://127.0.0.1:17823/theme.css  (view in browser)
    - JSON meta:  http://127.0.0.1:17823/theme.json
    - Logs:       DevTools → Console → filter "omarchy-org"
*/

(function () {
  'use strict';
  const URL_CSS = 'http://127.0.0.1:17823/theme.css';
  const POLL_VISIBLE_MS = 3000;
  const POLL_HIDDEN_MS = 15000;
  const RETRY_MS = 2000;
  let lastCss = null;
  let styleEl = null;
  let pollTimer = null;

  function log(...a) { console.log('[omarchy-org]', ...a); }
  function warn(...a) { console.warn('[omarchy-org]', ...a); }

  function ensureStyleEl() {
    if (styleEl && document.contains(styleEl)) return styleEl;
    styleEl = document.createElement('style');
    styleEl.id = 'omarchy-org-theme-bridge';
    styleEl.setAttribute('data-source', URL_CSS);
    // inject as early as possible for minimal FOUC
    const target = document.head || document.documentElement;
    if (target) target.appendChild(styleEl);
    else document.addEventListener('DOMContentLoaded', () => (document.head || document.documentElement).appendChild(styleEl), { once: true });
    return styleEl;
  }

  function applyCss(css) {
    if (css === lastCss) return;
    lastCss = css;
    const el = ensureStyleEl();
    el.textContent = css;
    // annotate with theme name from header comment
    const m = css.match(/Theme:\s*([^\s|]+)/);
    if (m) el.setAttribute('data-theme', m[1]);
    log('applied', m ? m[1] : '', `${css.length} bytes`);
  }

  function fetchCss() {
    // Prefer GM_xmlhttpRequest (bypasses mixed-content + CORS). Fallback to fetch() if GM unavailable (Violentmonkey supports both)
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: URL_CSS,
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        onload: (res) => {
          if (res.status === 200 && res.responseText) {
            applyCss(res.responseText);
            schedulePoll(false);
          } else {
            warn('fetch failed', res.status, res.statusText);
            schedulePoll(true);
          }
        },
        onerror: (e) => {
          warn('GM_xmlhttpRequest error - is omarchy-org-theme-server running? systemctl --user status omarchy-org-theme-server', e);
          schedulePoll(true);
        },
        ontimeout: () => {
          warn('timeout fetching', URL_CSS);
          schedulePoll(true);
        }
      });
    } else {
      // fallback: fetch (will fail on https→http mixed content in most browsers, but try)
      fetch(URL_CSS, { cache: 'no-store' })
        .then(r => {
          if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
          return r.text();
        })
        .then(applyCss)
        .then(() => schedulePoll(false))
        .catch(e => {
          warn('fetch failed (use Tampermonkey GM_xmlhttpRequest for http bridge)', e.message);
          schedulePoll(true);
        });
    }
  }

  function schedulePoll(isError) {
    clearTimeout(pollTimer);
    const delay = isError ? RETRY_MS : (document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    pollTimer = setTimeout(fetchCss, delay);
  }

  // initial
  fetchCss();

  // re-fetch on visibility/focus (common after `omarchy theme set` + alt-tab back)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fetchCss();
    else schedulePoll(false);
  });
  window.addEventListener('focus', fetchCss);
  // also poll periodically while visible so a theme switch in another window shows without reload (compare text, cheap)
})();

// Fallback for users who install as pure Stylus (no GM): expose CSS URL as comment
// Stylus one-liner (will be blocked by mixed-content unless you enable insecure localhost - prefer userscript):
// @-moz-document domain("omarchy.org") { @import url("http://127.0.0.1:17823/theme.css"); }
