// ==UserScript==
// @name         Internshala Saved Filters
// @namespace    https://internshala.com/
// @version      1.1.1
// @description  Save, restore, and switch between Internshala internship/job searches without re-entering filters.
// @author       You
// @match        https://internshala.com/*
// @match        https://www.internshala.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Avoid a second panel when both the extension and the userscript are active.
  if (document.querySelector('[data-internshala-saved-filters]')) return;

  /* ------------------------------------------------------------------ *
   * Config
   * ------------------------------------------------------------------ */

  const STORAGE_KEY = 'isf:v1';
  const AUTO_RESTORE_KEY = 'isf:auto-restored:';
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const MAX_PRESETS = 500;
  const MAX_URL_LENGTH = 4096;

  const SECTIONS = {
    internships: { label: 'Internships', base: '/internships' },
    jobs: { label: 'Jobs', base: '/jobs' }
  };

  const TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'utm_id', 'gclid', 'fbclid', 'msclkid', 'ref', 'source', 'src'
  ];

  const DETAIL_PATH = /^\/(?:internship|job)\/detail\//i;
  const CATEGORY_INDEX_PATH = /-by-category\/?$/i;

  const ICONS = {
    bookmark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 11v5M14 11v5"/></svg>',
    arrow:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M7 17 17 7M8 7h9v9"/></svg>',
    pencil:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>'
  };

  /* ------------------------------------------------------------------ *
   * Storage
   * ------------------------------------------------------------------ */

  function freshState() {
    return { version: 1, autoRestore: false, last: {}, presets: [] };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();

      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return freshState();

      const last = {};
      if (saved.last && typeof saved.last === 'object') {
        for (const section of Object.keys(SECTIONS)) {
          const entry = saved.last[section];
          if (entry && typeof entry.url === 'string' && sectionFor(entry.url) === section) {
            last[section] = {
              url: entry.url,
              name: typeof entry.name === 'string' ? entry.name : 'Last search',
              savedAt: Number(entry.savedAt) || Date.now()
            };
          }
        }
      }

      return {
        version: 1,
        autoRestore: saved.autoRestore === true,
        last,
        presets: Array.isArray(saved.presets) ? saved.presets.filter(isPreset) : []
      };
    } catch (error) {
      console.warn('[Saved filters] Could not read local data:', error);
      return freshState();
    }
  }

  function isPreset(preset) {
    if (!preset || typeof preset !== 'object') return false;

    const section = preset.section;

    return Boolean(
      typeof preset.id === 'string' &&
      typeof preset.name === 'string' &&
      typeof preset.url === 'string' &&
      typeof section === 'string' &&
      Object.prototype.hasOwnProperty.call(SECTIONS, section) &&
      sectionFor(preset.url) === section
    );
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.warn('[Saved filters] Could not save local data:', error);
      if (uiReady) toast('Could not save: browser storage is full');
      return false;
    }
  }

  /**
   * Saves the current state, and reloads the last good copy if the write fails
   * (for example when localStorage is full). Returns whether the write worked.
   */
  function persistOrRevert() {
    if (persist()) return true;
    state = loadState();
    return false;
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'isf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  let state = loadState();
  let uiReady = false;

  /* ------------------------------------------------------------------ *
   * URL helpers
   * ------------------------------------------------------------------ */

  function isInternshalaUrl(href) {
    try {
      if (typeof href !== 'string' || href.length > MAX_URL_LENGTH) return false;

      const url = new URL(href, location.href);
      if (url.href.length > MAX_URL_LENGTH) return false;

      return (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        /(^|\.)internshala\.com$/i.test(url.hostname)
      );
    } catch (error) {
      return false;
    }
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (error) {
      return value;
    }
  }

  /**
   * Removes tracking noise and pagination so a saved search always starts
   * on page 1 of the same filtered results.
   */
  function cleanUrl(href) {
    if (!isInternshalaUrl(href)) return null;

    const url = new URL(href, location.href);
    url.hash = '';
    TRACKING_PARAMS.forEach((name) => url.searchParams.delete(name));

    url.pathname = url.pathname
      .replace(/(?:^|\/)page-\d+(?=\/|$)/gi, '')
      .replace(/\/{2,}/g, '/');

    if (!url.pathname.startsWith('/')) url.pathname = '/' + url.pathname;
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/$/, '') + '/';
    }

    return url.toString();
  }

  function sectionFor(href) {
    if (!isInternshalaUrl(href)) return null;

    const path = new URL(href, location.href).pathname;

    if (DETAIL_PATH.test(path) || CATEGORY_INDEX_PATH.test(path)) return null;
    if (/^\/internships(?:\/|-|$)/i.test(path)) return 'internships';
    if (/^\/jobs(?:\/|-|$)/i.test(path)) return 'jobs';
    if (/(?:^|-)internships?(?:\/|$)/i.test(path)) return 'internships';
    if (/(?:^|-)jobs(?:\/|$)/i.test(path)) return 'jobs';

    return null;
  }

  function isFilteredSearch(section, href = location.href) {
    const cleaned = cleanUrl(href);
    if (!cleaned || !section) return false;

    const url = new URL(cleaned);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === SECTIONS[section].base) {
      return url.search !== '';
    }

    return true;
  }

  function isBasePage(section) {
    if (!section) return false;

    const cleaned = cleanUrl(location.href);
    if (!cleaned) return false;

    const url = new URL(cleaned);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    return path === SECTIONS[section].base && !url.search;
  }

  /* ------------------------------------------------------------------ *
   * Naming
   * ------------------------------------------------------------------ */

  const MINOR_WORDS = new Set([
    'in', 'at', 'on', 'for', 'and', 'or', 'of', 'the', 'to', 'with', 'by'
  ]);

  function titleCase(value) {
    return value
      .split(' ')
      .filter(Boolean)
      .map((word, index) => {
        const lower = word.toLowerCase();
        if (index > 0 && MINOR_WORDS.has(lower)) return lower;
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(' ');
  }

  /**
   * Turns a filter URL into a readable name, e.g.
   * /internships/full-stack-development-internship-in-delhi/
   * -> "Full Stack Development in Delhi"
   */
  function deriveName(section, href = location.href) {
    const cleaned = cleanUrl(href);
    if (!cleaned) return 'My search';

    const path = new URL(cleaned).pathname;
    let slug = path
      .replace(/^\/internships\/?/i, '')
      .replace(/^\/jobs\/?/i, '')
      .replace(/\/+$/, '');

    if (!slug) return 'All ' + SECTIONS[section].label.toLowerCase();

    slug = safeDecode(slug)
      .replace(/^internships?-/i, '')
      .replace(/^jobs?-/i, '')
      .replace(/-internships?/gi, '')
      .replace(/-jobs?/gi, '')
      .replace(/-in-/gi, ' in ')
      .replace(/-/g, ' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();

    const name = titleCase(slug).slice(0, 64).trim();
    return name || 'My search';
  }

  /* ------------------------------------------------------------------ *
   * Page state
   * ------------------------------------------------------------------ */

  const currentSection = sectionFor(location.href);

  if (!currentSection) return;

  function autoRestoreLastSearch(section) {
    if (!state.autoRestore || !isBasePage(section)) return false;

    const last = state.last[section];
    if (!last || !isInternshalaUrl(last.url)) return false;

    // Only once per tab, so Clear all and normal navigation do not fight it.
    const key = AUTO_RESTORE_KEY + section;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch (error) {
      // sessionStorage can be unavailable; still allow the redirect.
    }

    location.replace(last.url);
    return true;
  }

  function rememberLastSearch() {
    if (!isFilteredSearch(currentSection)) return;

    const url = cleanUrl(location.href);
    if (!url) return;

    const existingPreset = state.presets.find((preset) => preset.url === url);
    const name = existingPreset ? existingPreset.name : deriveName(currentSection, url);
    const previous = state.last[currentSection];

    if (!previous || previous.url !== url || previous.name !== name) {
      state.last[currentSection] = { url, name, savedAt: Date.now() };
      persist();
    }
  }

  if (autoRestoreLastSearch(currentSection)) return;

  rememberLastSearch();

  /* ------------------------------------------------------------------ *
   * UI
   * ------------------------------------------------------------------ */

  const CSS = `
    :host {
      all: initial;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    [hidden] {
      display: none !important;
    }

    button, input {
      font: inherit;
    }

    button {
      cursor: pointer;
    }

    .isf-root {
      --ink: #0f2433;
      --muted: #5f7484;
      --line: #e1ebf2;
      --brand: #0b78b5;
      --brand-dark: #075f92;
      --soft: #f2f8fc;
      --danger: #b3261e;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      color: var(--ink);
    }

    .isf-fab {
      position: fixed;
      left: 20px;
      bottom: 20px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      padding: 10px 15px;
      border: 1px solid #cfe2ef;
      border-radius: 999px;
      background: #ffffff;
      color: var(--brand-dark);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.01em;
      box-shadow: 0 8px 24px rgba(10, 54, 82, 0.16), 0 2px 6px rgba(10, 54, 82, 0.08);
      transition: transform 140ms ease, box-shadow 140ms ease;
      pointer-events: auto;
    }

    .isf-fab:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 28px rgba(10, 54, 82, 0.2), 0 3px 8px rgba(10, 54, 82, 0.1);
    }

    .isf-fab:focus-visible,
    .isf-resume:focus-visible,
    .isf-btn:focus-visible,
    .isf-icon-btn:focus-visible,
    .isf-link:focus-visible,
    .isf-input:focus-visible {
      outline: 3px solid rgba(11, 120, 181, 0.28);
      outline-offset: 2px;
    }

    .isf-fab svg {
      width: 18px;
      height: 18px;
      flex: none;
    }

    .isf-resume {
      position: fixed;
      left: 20px;
      bottom: 76px;
      z-index: 2147483646;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      max-width: 310px;
      padding: 11px 15px;
      border: 0;
      border-radius: 13px;
      background: var(--brand-dark);
      color: #ffffff;
      text-align: left;
      box-shadow: 0 10px 28px rgba(7, 58, 88, 0.28);
      pointer-events: auto;
    }

    .isf-resume-kicker {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      opacity: 0.72;
    }

    .isf-resume-name {
      max-width: 100%;
      overflow: hidden;
      font-size: 13.5px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .isf-panel {
      position: fixed;
      left: 20px;
      bottom: 76px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      width: 374px;
      max-width: calc(100vw - 24px);
      max-height: min(72vh, 620px);
      overflow: hidden;
      border: 1px solid rgba(16, 55, 80, 0.12);
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 24px 70px rgba(9, 42, 64, 0.24), 0 4px 14px rgba(9, 42, 64, 0.1);
      pointer-events: auto;
      animation: isf-in 160ms ease-out;
    }

    @keyframes isf-in {
      from { opacity: 0; transform: translateY(8px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .isf-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 16px 13px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #fafdff 0%, #ffffff 100%);
    }

    .isf-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .isf-brand-mark {
      display: grid;
      flex: none;
      width: 34px;
      height: 34px;
      place-items: center;
      border-radius: 10px;
      background: var(--soft);
      color: var(--brand);
    }

    .isf-brand-mark svg {
      width: 17px;
      height: 17px;
    }

    .isf-brand-copy {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .isf-brand-copy strong {
      font-size: 14.5px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .isf-brand-copy small {
      color: var(--muted);
      font-size: 11.5px;
    }

    .isf-icon-btn {
      display: grid;
      flex: none;
      width: 32px;
      height: 32px;
      padding: 0;
      place-items: center;
      border: 1px solid transparent;
      border-radius: 9px;
      background: transparent;
      color: var(--muted);
      font-size: 16px;
      line-height: 1;
    }

    .isf-icon-btn:hover {
      border-color: var(--line);
      background: var(--soft);
      color: var(--ink);
    }

    .isf-body {
      padding: 14px 16px 4px;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .isf-current {
      padding: 12px;
      border: 1px solid #cfe6f4;
      border-radius: 13px;
      background: var(--soft);
    }

    .isf-current-copy {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      margin-bottom: 10px;
    }

    .isf-dot {
      flex: none;
      width: 7px;
      height: 7px;
      margin-top: 5px;
      border-radius: 50%;
      background: #17a673;
      box-shadow: 0 0 0 3px rgba(23, 166, 115, 0.14);
    }

    .isf-current-copy span:last-child {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 1px;
    }

    .isf-current-copy b {
      font-size: 12.5px;
      font-weight: 700;
    }

    .isf-current-name {
      overflow: hidden;
      color: var(--muted);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .isf-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 36px;
      padding: 8px 13px;
      border: 1px solid transparent;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 650;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .isf-btn-primary {
      width: 100%;
      background: var(--brand);
      color: #ffffff;
    }

    .isf-btn-primary:hover {
      background: var(--brand-dark);
    }

    .isf-btn-ghost {
      border-color: var(--line);
      background: #ffffff;
      color: var(--ink);
    }

    .isf-btn-ghost:hover {
      background: var(--soft);
    }

    .isf-save-form {
      margin-top: 11px;
      padding-top: 11px;
      border-top: 1px solid #d7e8f3;
    }

    .isf-save-form label {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 11.5px;
      font-weight: 650;
    }

    .isf-input {
      width: 100%;
      height: 38px;
      padding: 0 11px;
      border: 1px solid #bfd7e6;
      border-radius: 9px;
      background: #ffffff;
      color: var(--ink);
      font-size: 13px;
    }

    .isf-input::placeholder {
      color: #96a9b7;
    }

    .isf-form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 9px;
    }

    .isf-hint {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.5;
    }

    .isf-group + .isf-group {
      margin-top: 13px;
    }

    .isf-group-label {
      margin-bottom: 5px;
      color: #8297a5;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
    }

    .isf-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .isf-preset {
      display: flex;
      align-items: center;
      gap: 2px;
      border: 1px solid transparent;
      border-radius: 10px;
    }

    .isf-preset:hover {
      border-color: var(--line);
      background: #fafdff;
    }

    .isf-preset-open {
      display: flex;
      flex: 1;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      min-width: 0;
      padding: 9px 10px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--ink);
      text-align: left;
    }

    .isf-preset-name {
      display: block;
      width: 100%;
      overflow: hidden;
      font-size: 13px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .isf-preset-meta {
      display: block;
      width: 100%;
      overflow: hidden;
      color: #8a9daa;
      font-size: 10.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .isf-preset-actions {
      display: flex;
      flex: none;
      gap: 1px;
      padding-right: 4px;
      opacity: 0.55;
      transition: opacity 120ms ease;
    }

    .isf-preset:hover .isf-preset-actions,
    .isf-preset-actions:focus-within {
      opacity: 1;
    }

    .isf-preset-actions .isf-icon-btn {
      width: 29px;
      height: 29px;
    }

    .isf-preset-actions svg {
      width: 14px;
      height: 14px;
    }

    .isf-rename-form {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding: 5px 6px 5px 8px;
    }

    .isf-rename-form .isf-input {
      height: 32px;
      min-width: 0;
    }

    .isf-rename-actions {
      display: flex;
      flex: none;
      gap: 4px;
    }

    .isf-rename-form .isf-btn {
      min-height: 31px;
      padding: 5px 10px;
      font-size: 11.5px;
    }

    .isf-rename-form .isf-btn-primary {
      width: auto;
    }

    .isf-delete:hover {
      border-color: #f1d5d2;
      background: #fdf3f2;
      color: var(--danger);
    }

    .isf-settings {
      margin: 14px 0 4px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fbfdff;
    }

    .isf-switch-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      cursor: pointer;
    }

    .isf-switch-row input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }

    .isf-switch {
      position: relative;
      flex: none;
      width: 34px;
      height: 20px;
      margin-top: 1px;
      border-radius: 999px;
      background: #cfdde7;
      transition: background 140ms ease;
    }

    .isf-switch::after {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(10, 40, 60, 0.25);
      content: "";
      transition: transform 140ms ease;
    }

    .isf-switch-row input:checked + .isf-switch {
      background: var(--brand);
    }

    .isf-switch-row input:checked + .isf-switch::after {
      transform: translateX(14px);
    }

    .isf-switch-row input:focus-visible + .isf-switch {
      outline: 3px solid rgba(11, 120, 181, 0.28);
      outline-offset: 2px;
    }

    .isf-switch-copy {
      display: flex;
      flex-direction: column;
      gap: 1px;
      font-size: 12.5px;
      font-weight: 600;
    }

    .isf-switch-copy small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 400;
      line-height: 1.35;
    }

    .isf-data {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 11px;
      padding-top: 10px;
      border-top: 1px solid var(--line);
    }

    .isf-data-label {
      color: var(--muted);
      font-size: 11px;
    }

    .isf-data-actions {
      display: flex;
      flex: none;
      gap: 2px;
    }

    .isf-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 16px 12px;
      border-top: 1px solid var(--line);
      color: #8a9daa;
      font-size: 10.5px;
    }

    .isf-link {
      padding: 2px;
      border: 0;
      background: transparent;
      color: var(--brand);
      font-size: 10.5px;
      font-weight: 650;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .isf-link:hover {
      color: var(--brand-dark);
    }

    .isf-toast {
      position: fixed;
      left: 20px;
      bottom: 76px;
      z-index: 2147483647;
      max-width: 320px;
      padding: 9px 13px;
      border-radius: 999px;
      background: #102b3d;
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      opacity: 0;
      pointer-events: none;
      transform: translateY(6px);
      transition: opacity 150ms ease, transform 150ms ease;
    }

    .isf-toast.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    @media (max-width: 991px) {
      .isf-fab {
        left: 12px;
        bottom: 84px;
        min-height: 42px;
        padding: 9px 12px;
      }

      .isf-resume {
        left: 12px;
        bottom: 138px;
        max-width: calc(100vw - 24px);
      }

      .isf-panel {
        left: 12px;
        bottom: 138px;
        max-height: calc(100vh - 160px);
      }

      .isf-toast {
        left: 12px;
        bottom: 138px;
      }
    }

    @media (max-width: 560px) {
      .isf-fab-text {
        display: none;
      }

      .isf-panel {
        right: 12px;
        width: auto;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .isf-panel,
      .isf-fab,
      .isf-toast,
      .isf-switch,
      .isf-switch::after {
        animation: none;
        transition: none;
      }
    }
  `;

  const host = document.createElement('div');
  host.setAttribute('data-internshala-saved-filters', '');
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'isf-root';
  root.innerHTML = `
    <button class="isf-resume" id="isf-resume" type="button" hidden>
      <span class="isf-resume-kicker">Resume last search</span>
      <span class="isf-resume-name" id="isf-resume-name"></span>
    </button>

    <button class="isf-fab" id="isf-fab" type="button" aria-expanded="false" aria-controls="isf-panel">
      ${ICONS.bookmark}
      <span class="isf-fab-text">Saved filters</span>
    </button>

    <section class="isf-panel" id="isf-panel" role="dialog" aria-label="Saved Internshala filters" hidden>
      <div class="isf-head">
        <div class="isf-brand">
          <span class="isf-brand-mark">${ICONS.bookmark}</span>
          <span class="isf-brand-copy">
            <strong>Saved filters</strong>
            <small>for Internshala</small>
          </span>
        </div>
        <button class="isf-icon-btn" id="isf-close" type="button" aria-label="Close saved filters">&times;</button>
      </div>

      <div class="isf-body">
        <div class="isf-current" id="isf-current" hidden>
          <div class="isf-current-copy">
            <span class="isf-dot" aria-hidden="true"></span>
            <span>
              <b>Filters detected</b>
              <span class="isf-current-name" id="isf-current-name"></span>
            </span>
          </div>
          <button class="isf-btn isf-btn-primary" id="isf-save-current" type="button">Save this search</button>
          <form class="isf-save-form" id="isf-save-form" hidden>
            <label for="isf-preset-name">Name this search</label>
            <input class="isf-input" id="isf-preset-name" type="text" maxlength="60" autocomplete="off" spellcheck="false" placeholder="e.g. Full stack + Delhi">
            <div class="isf-form-actions">
              <button class="isf-btn isf-btn-ghost" id="isf-cancel-save" type="button">Cancel</button>
              <button class="isf-btn isf-btn-primary" type="submit">Save</button>
            </div>
          </form>
        </div>

        <p class="isf-hint" id="isf-hint">
          Apply your filters on this page, then save the search here. Next time it is one click.
        </p>

        <div id="isf-groups"></div>

        <div class="isf-settings">
          <label class="isf-switch-row" for="isf-auto-restore">
            <input type="checkbox" id="isf-auto-restore">
            <span class="isf-switch" aria-hidden="true"></span>
            <span class="isf-switch-copy">
              Auto-open my last search
              <small>Only on the unfiltered page, once per new tab.</small>
            </span>
          </label>

          <div class="isf-data">
            <span class="isf-data-label">Back up or move presets</span>
            <span class="isf-data-actions">
              <button class="isf-link" id="isf-export" type="button">Export</button>
              <button class="isf-link" id="isf-import" type="button">Import</button>
            </span>
          </div>
        </div>
      </div>

      <div class="isf-foot">
        <span id="isf-last-saved">No search saved yet</span>
        <button class="isf-link" id="isf-clear-last" type="button" hidden>Clear</button>
      </div>
    </section>

    <div class="isf-toast" id="isf-toast" role="status" aria-live="polite"></div>
    <input type="file" id="isf-import-file" accept="application/json,.json" hidden>
  `;
  shadow.appendChild(root);

  const el = {
    fab: root.querySelector('#isf-fab'),
    panel: root.querySelector('#isf-panel'),
    close: root.querySelector('#isf-close'),
    resume: root.querySelector('#isf-resume'),
    resumeName: root.querySelector('#isf-resume-name'),
    current: root.querySelector('#isf-current'),
    currentName: root.querySelector('#isf-current-name'),
    hint: root.querySelector('#isf-hint'),
    groups: root.querySelector('#isf-groups'),
    saveCurrent: root.querySelector('#isf-save-current'),
    saveForm: root.querySelector('#isf-save-form'),
    presetName: root.querySelector('#isf-preset-name'),
    cancelSave: root.querySelector('#isf-cancel-save'),
    autoRestore: root.querySelector('#isf-auto-restore'),
    exportData: root.querySelector('#isf-export'),
    importData: root.querySelector('#isf-import'),
    importFile: root.querySelector('#isf-import-file'),
    lastSaved: root.querySelector('#isf-last-saved'),
    clearLast: root.querySelector('#isf-clear-last'),
    toast: root.querySelector('#isf-toast')
  };

  let panelOpen = false;
  let toastTimer = 0;

  // Keep our widget's interactions away from Internshala's global handlers.
  ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit']
    .forEach((type) => {
      root.addEventListener(type, (event) => event.stopPropagation());
    });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') event.stopPropagation();
  });

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      el.toast.classList.remove('is-visible');
    }, 2300);
  }

  function relativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.round(hours / 24);
    if (days < 30) return days + 'd ago';
    return new Date(timestamp).toLocaleDateString();
  }

  function friendlyUrl(href) {
    try {
      const url = new URL(href, location.href);
      return safeDecode(url.pathname).replace(/^\/+|\/+$/g, '');
    } catch (error) {
      return href;
    }
  }

  function openPanel() {
    panelOpen = true;
    el.panel.hidden = false;
    el.fab.setAttribute('aria-expanded', 'true');
    el.resume.hidden = true;
    render();
  }

  function closePanel() {
    panelOpen = false;
    el.panel.hidden = true;
    el.fab.setAttribute('aria-expanded', 'false');
    render();
  }

  function showSaveForm() {
    if (!isFilteredSearch(currentSection)) return;

    el.saveForm.hidden = false;
    el.saveCurrent.hidden = true;
    el.presetName.value = deriveName(currentSection);
    el.presetName.focus();
    el.presetName.select();
  }

  function hideSaveForm() {
    el.saveForm.hidden = true;
    el.saveCurrent.hidden = false;
  }

  function saveCurrentSearch(rawName) {
    if (!isFilteredSearch(currentSection)) {
      toast('Apply at least one filter first');
      return;
    }

    const url = cleanUrl(location.href);
    if (!url) return;

    const name = (rawName || '').trim().slice(0, 60) || deriveName(currentSection, url);
    const existing = state.presets.find((preset) => preset.url === url);
    let message;

    if (existing) {
      existing.name = name;
      existing.updatedAt = Date.now();
      message = 'Saved search updated';
    } else {
      state.presets.unshift({
        id: uid(),
        name,
        url,
        section: currentSection,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      message = 'Search saved';
    }

    state.last[currentSection] = { url, name, savedAt: Date.now() };
    const saved = persistOrRevert();
    hideSaveForm();
    render();

    if (saved) toast(message);
  }

  function deletePreset(id) {
    const preset = state.presets.find((item) => item.id === id);
    if (!preset) return;

    if (!window.confirm('Delete "' + preset.name + '"?')) return;

    state.presets = state.presets.filter((item) => item.id !== id);
    const saved = persistOrRevert();
    render();

    if (saved) toast('Saved search deleted');
  }

  function renamePreset(id, row) {
    const preset = state.presets.find((item) => item.id === id);
    if (!preset || !row) return;

    const form = document.createElement('form');
    form.className = 'isf-rename-form';

    const input = document.createElement('input');
    input.className = 'isf-input';
    input.type = 'text';
    input.maxLength = 60;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = preset.name;
    input.setAttribute('aria-label', 'New name for ' + preset.name);

    const actions = document.createElement('span');
    actions.className = 'isf-rename-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'isf-btn isf-btn-ghost';
    cancel.textContent = 'Cancel';

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'isf-btn isf-btn-primary';
    save.textContent = 'Save';

    actions.append(cancel, save);
    form.append(input, actions);

    form.addEventListener('submit', (event) => {
      event.preventDefault();

      const name = input.value.trim().slice(0, 60);
      if (!name) {
        input.focus();
        return;
      }

      preset.name = name;
      preset.updatedAt = Date.now();

      const last = state.last[preset.section];
      if (last && last.url === preset.url) last.name = name;

      const saved = persistOrRevert();
      render();

      if (saved) toast('Saved search renamed');
    });

    cancel.addEventListener('click', render);

    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      render();
    });

    row.replaceChildren(form);
    input.focus();
    input.select();
  }

  function exportBackup() {
    const payload = {
      app: 'internshala-saved-filters',
      version: 1,
      exportedAt: new Date().toISOString(),
      state: {
        version: 1,
        autoRestore: state.autoRestore,
        last: state.last,
        presets: state.presets
      }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      'internshala-saved-filters-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup downloaded');
  }

  function importBackup(file) {
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      toast('That file is too large (max 2 MB)');
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      let data;

      try {
        data = JSON.parse(String(reader.result));
      } catch (error) {
        toast('That file is not valid JSON');
        return;
      }

      // Accept a full backup, a bare state object, or an array of presets.
      const source = Array.isArray(data)
        ? { presets: data }
        : data && typeof data === 'object' && data.state && typeof data.state === 'object'
          ? data.state
          : data;

      if (!source || typeof source !== 'object') {
        toast('No saved searches found in that file');
        return;
      }

      const incoming = Array.isArray(source.presets) ? source.presets : [];
      const seenUrls = new Set(
        state.presets.map((preset) => preset.url.replace(/\/+$/, ''))
      );
      const usedIds = new Set(state.presets.map((preset) => preset.id));

      let added = 0;
      let duplicate = 0;
      let limitReached = false;

      for (const preset of incoming) {
        if (state.presets.length >= MAX_PRESETS) {
          limitReached = true;
          break;
        }

        if (!preset || typeof preset !== 'object' || typeof preset.url !== 'string') {
          continue;
        }

        if (preset.url.length > MAX_URL_LENGTH) continue;

        const url = cleanUrl(preset.url);
        if (!url) continue;

        // Trust the URL, not the section label in the file.
        const section = sectionFor(url);
        if (!section) continue;

        const urlKey = url.replace(/\/+$/, '');
        if (seenUrls.has(urlKey)) {
          duplicate += 1;
          continue;
        }

        let id =
          typeof preset.id === 'string' && preset.id ? preset.id : uid();
        if (usedIds.has(id)) id = uid();

        const name =
          (typeof preset.name === 'string' ? preset.name.trim() : '') ||
          deriveName(section, url);

        const now = Date.now();
        state.presets.push({
          id,
          name: name.slice(0, 60),
          url,
          section,
          createdAt: Number(preset.createdAt) || now,
          updatedAt: Number(preset.updatedAt) || now
        });

        seenUrls.add(urlKey);
        usedIds.add(id);
        added += 1;
      }

      const incomingLast =
        source.last && typeof source.last === 'object' ? source.last : {};

      for (const section of Object.keys(SECTIONS)) {
        const entry = incomingLast[section];
        if (!entry || typeof entry.url !== 'string') continue;

        const url = cleanUrl(entry.url);
        if (!url || sectionFor(url) !== section) continue;

        const savedAt = Number(entry.savedAt) || 0;
        const current = state.last[section];
        if (current && current.savedAt > savedAt) continue;

        state.last[section] = {
          url,
          name: (
            (typeof entry.name === 'string' ? entry.name.trim() : '') ||
            deriveName(section, url)
          ).slice(0, 60),
          savedAt: savedAt || Date.now()
        };
      }

      const saved = persistOrRevert();
      render();

      if (!saved) return;

      if (added > 0) {
        let message =
          'Imported ' + added + ' saved search' + (added === 1 ? '' : 'es');
        if (duplicate > 0) {
          message += '; ' + duplicate + ' already saved';
        }
        if (limitReached) {
          message += '; limit of ' + MAX_PRESETS + ' reached';
        }
        toast(message);
      } else if (duplicate > 0) {
        toast('Those searches are already saved');
      } else if (limitReached) {
        toast('Saved search limit reached (' + MAX_PRESETS + ')');
      } else {
        toast('No valid searches found in that file');
      }
    };

    reader.onerror = () => toast('Could not read that file');
    reader.readAsText(file);
  }

  function openUrl(url) {
    if (!isInternshalaUrl(url)) {
      toast('That saved link is not valid');
      return;
    }

    const current = location.href.replace(/\/+$/, '');
    const target = url.replace(/\/+$/, '');

    if (current === target) {
      toast('You are already viewing this search');
      return;
    }

    location.href = url;
  }

  function makePresetRow(preset) {
    const item = document.createElement('li');
    item.className = 'isf-preset';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'isf-preset-open';
    open.dataset.open = preset.id;
    open.title = 'Open this search';

    const name = document.createElement('span');
    name.className = 'isf-preset-name';
    name.textContent = preset.name;

    const meta = document.createElement('span');
    meta.className = 'isf-preset-meta';
    meta.textContent = friendlyUrl(preset.url);

    open.append(name, meta);

    const actions = document.createElement('span');
    actions.className = 'isf-preset-actions';

    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'isf-icon-btn';
    rename.dataset.rename = preset.id;
    rename.setAttribute('aria-label', 'Rename ' + preset.name);
    rename.title = 'Rename';
    rename.innerHTML = ICONS.pencil;

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'isf-icon-btn';
    go.dataset.open = preset.id;
    go.setAttribute('aria-label', 'Open ' + preset.name);
    go.title = 'Open';
    go.innerHTML = ICONS.arrow;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'isf-icon-btn isf-delete';
    remove.dataset.delete = preset.id;
    remove.setAttribute('aria-label', 'Delete ' + preset.name);
    remove.title = 'Delete';
    remove.innerHTML = ICONS.trash;

    actions.append(rename, go, remove);
    item.append(open, actions);
    return item;
  }

  function renderPresets() {
    el.groups.replaceChildren();

    const other = currentSection === 'internships' ? 'jobs' : 'internships';
    const order = [currentSection, other];

    for (const section of order) {
      const presets = state.presets.filter((preset) => preset.section === section);
      if (!presets.length) continue;

      const group = document.createElement('div');
      group.className = 'isf-group';

      const label = document.createElement('div');
      label.className = 'isf-group-label';
      label.textContent = SECTIONS[section].label;

      const list = document.createElement('ul');
      list.className = 'isf-list';
      presets.forEach((preset) => list.appendChild(makePresetRow(preset)));

      group.append(label, list);
      el.groups.appendChild(group);
    }
  }

  function render() {
    const filtered = isFilteredSearch(currentSection);
    const presetsForSection = state.presets.filter(
      (preset) => preset.section === currentSection
    );
    const hasPresets = state.presets.length > 0;
    const last = state.last[currentSection];

    el.current.hidden = !filtered;
    if (filtered) {
      el.currentName.textContent = deriveName(currentSection);
    } else {
      hideSaveForm();
    }

    el.hint.hidden = filtered || hasPresets;

    renderPresets();

    el.autoRestore.checked = state.autoRestore;

    if (last) {
      el.lastSaved.textContent = 'Last used ' + relativeTime(last.savedAt);
      el.clearLast.hidden = false;
    } else {
      el.lastSaved.textContent = 'No search saved yet';
      el.clearLast.hidden = true;
    }

    const canResume = Boolean(
      !panelOpen &&
      last &&
      isBasePage(currentSection) &&
      !state.autoRestore
    );

    el.resume.hidden = !canResume;
    if (canResume) {
      el.resumeName.textContent = last.name;
    }

    el.fab.title = presetsForSection.length
      ? presetsForSection.length + ' saved search' + (presetsForSection.length === 1 ? '' : 'es')
      : 'Save and restore search filters';
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  el.fab.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panelOpen) closePanel();
    else openPanel();
  });

  el.close.addEventListener('click', closePanel);

  el.resume.addEventListener('click', () => {
    const last = state.last[currentSection];
    if (last) openUrl(last.url);
  });

  el.saveCurrent.addEventListener('click', showSaveForm);
  el.cancelSave.addEventListener('click', hideSaveForm);

  el.saveForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCurrentSearch(el.presetName.value);
  });

  el.presetName.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hideSaveForm();
    }
  });

  el.autoRestore.addEventListener('change', () => {
    state.autoRestore = el.autoRestore.checked;
    const saved = persistOrRevert();
    render();

    if (saved) {
      toast(state.autoRestore ? 'Auto-open enabled' : 'Auto-open disabled');
    }
  });

  el.clearLast.addEventListener('click', () => {
    delete state.last[currentSection];
    const saved = persistOrRevert();
    render();

    if (saved) toast('Last search cleared');
  });

  el.groups.addEventListener('click', (event) => {
    const renameButton = event.target.closest('[data-rename]');
    if (renameButton) {
      renamePreset(
        renameButton.dataset.rename,
        renameButton.closest('.isf-preset')
      );
      return;
    }

    const openButton = event.target.closest('[data-open]');
    if (openButton) {
      const preset = state.presets.find((item) => item.id === openButton.dataset.open);
      if (preset) openUrl(preset.url);
      return;
    }

    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) {
      deletePreset(deleteButton.dataset.delete);
    }
  });

  el.exportData.addEventListener('click', exportBackup);
  el.importData.addEventListener('click', () => el.importFile.click());

  el.importFile.addEventListener('change', () => {
    const file = el.importFile.files && el.importFile.files[0];
    importBackup(file);
    el.importFile.value = '';
  });

  document.addEventListener('click', (event) => {
    if (!panelOpen) return;
    if (!event.isTrusted) return;
    if (event.composedPath().includes(host)) return;
    closePanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (panelOpen) {
      closePanel();
    } else if (!el.saveForm.hidden) {
      hideSaveForm();
    }
  });

  /* ------------------------------------------------------------------ *
   * Keep the panel in sync when the site changes the URL without reload
   * ------------------------------------------------------------------ */

  function watchHistory() {
    const notify = () => window.dispatchEvent(new Event('isf:locationchange'));

    for (const method of ['pushState', 'replaceState']) {
      try {
        const original = history[method];
        if (typeof original !== 'function') continue;
        history[method] = function () {
          const result = original.apply(this, arguments);
          notify();
          return result;
        };
      } catch (error) {
        // Some pages lock history down; popstate still works.
      }
    }

    window.addEventListener('popstate', notify);

    let lastHref = location.href;
    window.addEventListener('isf:locationchange', () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      rememberLastSearch();
      render();
    });
  }

  watchHistory();

  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    state = loadState();
    render();
  });

  if (!document.body) return;

  uiReady = true;
  document.body.appendChild(host);
  render();
})();
