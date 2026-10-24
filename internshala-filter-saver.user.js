// ==UserScript==
// @name         Internshala Saved Filters
// @namespace    https://internshala.com/
// @version      1.3.0
// @description  Save Internshala searches, reuse answers to repeat application questions, and work through applications with a manual submit. Local-only.
// @author       You
// @match        https://internshala.com/*
// @match        https://www.internshala.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Avoid a second panel when both the extension and the userscript are
  // active. The flag is set synchronously because boot() appends the host only
  // after awaiting storage.
  const OWNER_ATTR = 'data-internshala-saved-filters-owner';
  if (
    document.documentElement.hasAttribute(OWNER_ATTR) ||
    document.querySelector('[data-internshala-saved-filters]')
  ) {
    return;
  }
  document.documentElement.setAttribute(OWNER_ATTR, '');

  /* ------------------------------------------------------------------ *
   * Config
   * ------------------------------------------------------------------ */

  const STORAGE_KEY = 'isf:v1';
  const AUTO_RESTORE_KEY = 'isf:auto-restored:';
  const ANSWERS_KEY = 'isf:answers:v1';
  const KEYWORDS_KEY = 'isf:keywords:v1';
  const QUEUE_KEY = 'isf:apply-queue:v1';
  const APPLIED_KEY = 'isf:applied:v1';
  const SETTINGS_KEY = 'isf:apply-settings:v1';

  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const MAX_PRESETS = 500;
  const MAX_URL_LENGTH = 4096;
  const MAX_ANSWERS = 1000;
  const MAX_ANSWER_LENGTH = 5000;
  const MAX_QUESTION_LENGTH = 300;
  const MAX_KEYWORDS = 100;
  const MAX_APPLIED = 1000;
  const MAX_QUEUE = 100;
  const DAILY_APPLY_CAP = 20;
  const APPLY_COOLDOWN_MIN = 8000;
  const APPLY_COOLDOWN_MAX = 15000;

  const SECTIONS = {
    internships: { label: 'Internships', base: '/internships' },
    jobs: { label: 'Jobs', base: '/jobs' }
  };

  const TRACKING_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'utm_id', 'gclid', 'fbclid', 'msclkid', 'ref', 'source', 'src'
  ];

  const DETAIL_PATH = /^\/(?:internship|job)\/detail\//i;
  const APPLICATION_PATH = /^\/(?:(?:student\/)?(?:interstitial\/)?application|apply)(?:\/|$)/i;
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
              name: typeof entry.name === 'string'
                ? entry.name.slice(0, 60)
                : 'Last search',
              savedAt: Number(entry.savedAt) || Date.now()
            };
          }
        }
      }

      // Treat stored filters as untrusted: page scripts share this
      // localStorage, so cap the count, text lengths, and duplicates before
      // anything reaches the panel.
      const presets = [];
      const seenPresetUrls = new Set();

      if (Array.isArray(saved.presets)) {
        for (const preset of saved.presets) {
          if (presets.length >= MAX_PRESETS) break;
          if (!isPreset(preset)) continue;

          const urlKey = preset.url.replace(/\/+$/, '');
          if (seenPresetUrls.has(urlKey)) continue;
          seenPresetUrls.add(urlKey);

          presets.push({
            id: preset.id.slice(0, 120),
            name:
              preset.name.trim().slice(0, 60) ||
              deriveName(preset.section, preset.url),
            url: preset.url,
            section: preset.section,
            createdAt: Number(preset.createdAt) || Date.now(),
            updatedAt: Number(preset.updatedAt) || Date.now()
          });
        }
      }

      return {
        version: 1,
        autoRestore: saved.autoRestore === true,
        last,
        presets
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
      preset.id.length > 0 &&
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
   * Extension storage (answers / apply data)
   *
   * Filters stay in localStorage for backwards compatibility. New data
   * uses chrome.storage.local when available so the page cannot read it.
   * The userscript (no extension APIs) falls back to localStorage.
   * ------------------------------------------------------------------ */

  const extensionStorage = (() => {
    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        return chrome.storage.local;
      }
    } catch (error) {
      // Not an extension context.
    }
    return null;
  })();

  const usesExtensionStorage = extensionStorage !== null;

  // A failed read leaves empty state in memory. Writing that back would erase
  // real data, so remember which keys failed and refuse destructive writes
  // until a read or write succeeds again.
  const storageReadFailures = new Set();

  function chromeStorageCall(method, payload) {
    return new Promise((resolve, reject) => {
      try {
        method.call(extensionStorage, payload, (result) => {
          const error = chrome.runtime && chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function storageGet(key, fallback) {
    if (extensionStorage) {
      try {
        const result = await chromeStorageCall(extensionStorage.get, [key]);
        storageReadFailures.delete(key);
        if (result && Object.prototype.hasOwnProperty.call(result, key)) {
          return result[key];
        }
        return fallback;
      } catch (error) {
        storageReadFailures.add(key);
        console.warn('[Saved filters] Could not read extension storage:', error);
        return fallback;
      }
    }

    try {
      const raw = localStorage.getItem(key);
      const value = raw ? JSON.parse(raw) : fallback;
      storageReadFailures.delete(key);
      return value;
    } catch (error) {
      storageReadFailures.add(key);
      console.warn('[Saved filters] Could not read local data:', error);
      return fallback;
    }
  }

  async function storageSet(key, value) {
    if (extensionStorage) {
      try {
        await chromeStorageCall(extensionStorage.set, { [key]: value });
        storageReadFailures.delete(key);
        return true;
      } catch (error) {
        console.warn('[Saved filters] Could not save extension data:', error);
        return false;
      }
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
      storageReadFailures.delete(key);
      return true;
    } catch (error) {
      console.warn('[Saved filters] Could not save local data:', error);
      return false;
    }
  }

  async function storageRemove(key) {
    if (extensionStorage) {
      try {
        await chromeStorageCall(extensionStorage.remove, [key]);
        return true;
      } catch (error) {
        console.warn('[Saved filters] Could not remove extension data:', error);
        return false;
      }
    }

    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

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

  function detailSectionFor(href) {
    if (!isInternshalaUrl(href)) return null;

    const path = new URL(href, location.href).pathname;
    if (/^\/internship\/detail\//i.test(path)) return 'internships';
    if (/^\/job\/detail\//i.test(path)) return 'jobs';

    return null;
  }

  function isDetailPage(href = location.href) {
    return detailSectionFor(href) !== null;
  }

  function isApplicationPage(href = location.href) {
    if (!isInternshalaUrl(href)) return false;
    return APPLICATION_PATH.test(new URL(href, location.href).pathname);
  }

  /**
   * Application URLs contain the listing slug, for example
   * /student/interstitial/application/frontend-internship-in-delhi-at-...
   * Use it only as a hint; the saved queue is the source of truth.
   */
  function detailUrlForApplication(href) {
    if (!isApplicationPage(href)) return null;

    const path = safeDecode(new URL(href, location.href).pathname);
    const match = path.match(/\/application\/([^/]+)\/?$/i);
    if (!match) return null;

    const slug = match[1];
    if (/-internship(?:-|$)/i.test(slug)) {
      return 'https://internshala.com/internship/detail/' + slug + '/';
    }
    if (/-job(?:-|$)/i.test(slug)) {
      return 'https://internshala.com/job/detail/' + slug + '/';
    }

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
   * Answer memory
   * ------------------------------------------------------------------ */

  const ANSWER_TYPES = new Set([
    'text', 'textarea', 'select', 'radio', 'checkbox', 'number', 'date',
    'email', 'tel', 'url'
  ]);

  function cleanQuestionText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_QUESTION_LENGTH);
  }

  /**
   * Conservative normalization: only differences that never change meaning
   * are removed. If two forms word a question differently, the user is asked.
   */
  function normalizeQuestion(value) {
    return cleanQuestionText(value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[*\u2731]+/g, ' ')
      .replace(/[\u201c\u201d\u201e]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/^\s*\d+[.)]\s*/, '')
      .replace(/\s*\((?:optional|required)\)\s*$/i, '')
      .replace(/\s*-\s*(?:optional|required)\s*$/i, '')
      .replace(/\s*[:\-]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_QUESTION_LENGTH);
  }

  function normalizeAnswerValue(value, type) {
    if (type === 'checkbox') {
      if (!Array.isArray(value)) return null;
      const items = value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim().slice(0, 500))
        .filter(Boolean)
        .slice(0, 20);
      return items.length ? items : null;
    }

    if (typeof value !== 'string') return null;
    const trimmed = value.trim().slice(0, MAX_ANSWER_LENGTH);
    return trimmed || null;
  }

  function normalizeAnswerRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const question = cleanQuestionText(raw.question);
    const normalized = normalizeQuestion(question);
    if (!normalized) return null;

    const type = ANSWER_TYPES.has(raw.type) ? raw.type : 'text';
    const answer = normalizeAnswerValue(raw.answer, type);
    if (answer === null) return null;

    const now = Date.now();
    const options = Array.isArray(raw.options)
      ? raw.options
          .filter((option) => typeof option === 'string')
          .map((option) => option.trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 20)
      : [];

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      question,
      normalized,
      type,
      answer,
      options,
      createdAt: Number(raw.createdAt) || now,
      updatedAt: Number(raw.updatedAt) || now,
      lastUsedAt: Number(raw.lastUsedAt) || 0,
      uses: Math.max(0, Number(raw.uses) || 0)
    };
  }

  function normalizeAnswersState(raw) {
    const source = raw && typeof raw === 'object' && Array.isArray(raw.answers)
      ? raw.answers
      : [];

    const byQuestion = new Map();

    for (const entry of source) {
      const record = normalizeAnswerRecord(entry);
      if (!record) continue;

      const previous = byQuestion.get(record.normalized);
      if (!previous || record.updatedAt >= previous.updatedAt) {
        byQuestion.set(record.normalized, record);
      }
    }

    const answers = Array.from(byQuestion.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ANSWERS);

    return { version: 1, answers };
  }

  let answersState = { version: 1, answers: [] };
  let answersLoaded = false;
  let answersPersistTimer = 0;
  let answersWrittenAt = 0;

  async function loadAnswers() {
    const raw = await storageGet(ANSWERS_KEY, null);
    answersState = normalizeAnswersState(raw);
    answersLoaded = true;
    if (uiReady) render();
    return answersState;
  }

  function findSavedAnswer(question) {
    const normalized = normalizeQuestion(question);
    if (!normalized) return null;
    return answersState.answers.find((entry) => entry.normalized === normalized) || null;
  }

  async function persistAnswers(nextState, { silent = false } = {}) {
    if (storageReadFailures.has(ANSWERS_KEY)) {
      if (uiReady && !silent) {
        toast('Saved answers could not be read. Reload the page before changing them.');
      }
      return false;
    }

    const ok = await storageSet(ANSWERS_KEY, nextState);
    if (!ok) {
      if (uiReady && !silent) toast('Could not save answer: browser storage is full');
      return false;
    }

    answersState = nextState;
    answersLoaded = true;
    answersWrittenAt = Date.now();
    if (uiReady && !silent) render();
    return true;
  }

  async function saveAnswer({ question, type, answer, options, id }) {
    const existing = findSavedAnswer(question);
    const now = Date.now();
    const record = normalizeAnswerRecord({
      id: id || (existing && existing.id) || uid(),
      question,
      type,
      answer,
      options,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      lastUsedAt: existing ? existing.lastUsedAt : 0,
      uses: existing ? existing.uses : 0
    });

    if (!record) return null;

    const next = answersState.answers.filter(
      (entry) => entry.normalized !== record.normalized
    );
    next.unshift(record);
    next.sort((a, b) => b.updatedAt - a.updatedAt);

    const ok = await persistAnswers({
      version: 1,
      answers: next.slice(0, MAX_ANSWERS)
    });

    return ok ? record : null;
  }

  async function deleteAnswer(id) {
    const next = answersState.answers.filter((entry) => entry.id !== id);
    return persistAnswers({ version: 1, answers: next });
  }

  function markAnswerUsed(record) {
    if (!record) return;
    record.uses += 1;
    record.lastUsedAt = Date.now();

    window.clearTimeout(answersPersistTimer);
    answersPersistTimer = window.setTimeout(() => {
      persistAnswers(answersState, { silent: true }).catch(() => {});
    }, 1500);
  }

  /* ------------------------------------------------------------------ *
   * Apply queue state
   *
   * The queue survives page navigations, so it lives in extension storage
   * (localStorage in the userscript). Applied history is only written after
   * a clear success signal.
   * ------------------------------------------------------------------ */

  const QUEUE_STATUSES = new Set(['pending', 'done', 'skipped', 'failed']);

  function sameDetailUrl(a, b) {
    const left = cleanUrl(a);
    const right = cleanUrl(b);
    if (!left || !right) return false;
    return left.replace(/\/+$/, '') === right.replace(/\/+$/, '');
  }

  function normalizeQueueItem(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const url = cleanUrl(raw.url);
    if (!url || detailSectionFor(url) === null) return null;

    const status = QUEUE_STATUSES.has(raw.status) ? raw.status : 'pending';

    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      title: cleanQuestionText(raw.title) || 'Internship listing',
      url,
      section: detailSectionFor(url),
      status,
      note: typeof raw.note === 'string' ? raw.note.slice(0, 300) : '',
      addedAt: Number(raw.addedAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    };
  }

  function normalizeQueueState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    const items = [];

    for (const entry of Array.isArray(source.items) ? source.items : []) {
      const item = normalizeQueueItem(entry);
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
      if (items.length >= MAX_QUEUE) break;
    }

    const currentId =
      typeof source.currentId === 'string' &&
      items.some((item) => item.id === source.currentId)
        ? source.currentId
        : null;

    return {
      version: 1,
      active: source.active === true,
      paused: source.paused === true,
      currentId,
      submittingId: currentId && source.submittingId === currentId
        ? source.submittingId
        : null,
      submitStartedAt: Number(source.submitStartedAt) || 0,
      origin: typeof source.origin === 'string' && isInternshalaUrl(source.origin)
        ? cleanUrl(source.origin) || ''
        : '',
      section: Object.prototype.hasOwnProperty.call(SECTIONS, source.section)
        ? source.section
        : null,
      nextRunAt: Number(source.nextRunAt) || 0,
      consecutiveFailures: Math.max(0, Number(source.consecutiveFailures) || 0),
      items
    };
  }

  function normalizeAppliedState(raw) {
    const source = raw && typeof raw === 'object' && Array.isArray(raw.entries)
      ? raw.entries
      : [];
    const seen = new Set();
    const entries = [];

    for (const entry of source) {
      if (!entry || typeof entry !== 'object') continue;

      const url = cleanUrl(entry.url);
      if (!url || detailSectionFor(url) === null || seen.has(url)) continue;

      seen.add(url);
      entries.push({
        id: typeof entry.id === 'string' && entry.id ? entry.id : uid(),
        title: cleanQuestionText(entry.title) || 'Application',
        url,
        appliedAt: Number(entry.appliedAt) || Date.now(),
        source: entry.source === 'detected' ? 'detected' : 'queue'
      });
      if (entries.length >= MAX_APPLIED) break;
    }

    entries.sort((a, b) => b.appliedAt - a.appliedAt);
    return { version: 1, entries };
  }

  function normalizeApplySettings(raw) {
    return {
      version: 1,
      // Auto-submit is intentionally not available in this release.
      mode: raw && raw.mode === 'review' ? 'review' : 'review'
    };
  }

  let queueState = normalizeQueueState(null);
  let appliedState = { version: 1, entries: [] };
  let applySettings = normalizeApplySettings(null);
  let applyLoaded = false;
  let applyMessage = '';

  let queueWriteChain = Promise.resolve();

  function persistQueue(nextState, { silent = false } = {}) {
    queueState = nextState;
    if (uiReady && !silent) render();

    const write = queueWriteChain.then(() => storageSet(QUEUE_KEY, nextState));
    queueWriteChain = write.catch(() => false);

    return write.then((ok) => {
      if (!ok && uiReady && !silent) toast('Could not save the apply queue');
      return ok;
    });
  }

  async function persistApplied(nextState) {
    if (storageReadFailures.has(APPLIED_KEY)) {
      if (uiReady) {
        toast('Applied history could not be read. Reload the page before changing it.');
      }
      return false;
    }

    const ok = await storageSet(APPLIED_KEY, nextState);
    if (!ok) {
      if (uiReady) toast('Could not save applied history');
      return false;
    }

    appliedState = nextState;
    return true;
  }

  async function persistApplySettings(nextState) {
    const ok = await storageSet(SETTINGS_KEY, nextState);
    if (!ok) {
      if (uiReady) toast('Could not save apply settings');
      return false;
    }

    applySettings = nextState;
    if (uiReady) render();
    return true;
  }

  async function loadApplyData() {
    const [queueRaw, appliedRaw, settingsRaw] = await Promise.all([
      storageGet(QUEUE_KEY, null),
      storageGet(APPLIED_KEY, null),
      storageGet(SETTINGS_KEY, null)
    ]);

    queueState = normalizeQueueState(queueRaw);
    appliedState = normalizeAppliedState(appliedRaw);
    applySettings = normalizeApplySettings(settingsRaw);
    applyLoaded = true;

    if (uiReady) render();
    return queueState;
  }

  function appliedInLastDay() {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    return appliedState.entries.filter(
      (entry) => entry.source !== 'detected' && entry.appliedAt >= since
    );
  }

  function isAppliedUrl(url) {
    return appliedState.entries.some((entry) => entry.url === url);
  }

  function currentQueueItem() {
    return queueState.items.find((item) => item.id === queueState.currentId) || null;
  }

  function pendingQueueItems() {
    return queueState.items.filter((item) => item.status === 'pending');
  }

  function queueIsRunning() {
    return queueState.active && !queueState.paused;
  }

  function updateQueueItems(updater) {
    return queueState.items.map(updater);
  }

  // innerText forces layout, and one readiness check can ask for the page text
  // several times. Cache it briefly so a scan cycle reads the page once.
  let pageTextCache = { href: '', at: 0, text: '' };

  function pageTextSample(limit = 8000) {
    const now = Date.now();

    if (pageTextCache.href === location.href && now - pageTextCache.at < 750) {
      return pageTextCache.text.slice(0, limit);
    }

    const node =
      document.querySelector('main, #main_content, .main_content, .container') ||
      document.body;

    const text = node
      ? String(node.innerText || node.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 8000)
      : '';

    pageTextCache = { href: location.href, at: now, text };
    return text.slice(0, limit);
  }

  function hasSubmissionSignal() {
    const path = location.pathname.toLowerCase();
    if (/\/(?:success|submitted|thank-you|thanks)(?:\/|$)/i.test(path)) return true;

    return /\b(?:application (?:has been |was )?submitted|application sent|successfully applied|you have successfully applied|thank you for applying|your application has been received)\b/i
      .test(pageTextSample());
  }

  function hasAlreadyAppliedState() {
    return /\b(?:already applied|application already submitted|you have already applied)\b/i
      .test(pageTextSample());
  }

  function hasSecurityBlocker() {
    return /\b(?:captcha|enter otp|verify otp|one[-\s]?time password|log in to continue|sign in to continue|session expired|too many requests|rate limit)\b/i
      .test(pageTextSample());
  }

  function hasVisiblePasswordField() {
    return Array.from(document.querySelectorAll('input[type="password"]')).some(isVisible);
  }

  function missingRequiredFile() {
    return Array.from(document.querySelectorAll('input[type="file"]')).some((input) => {
      if (!isVisible(input)) return false;
      if (input.files && input.files.length) return false;
      return isRequiredField(input);
    });
  }

  function hasOptionalFileInput() {
    return Array.from(document.querySelectorAll('input[type="file"]')).some(isVisible);
  }

  function uncheckedConsentText() {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(
      (box) => !box.checked && (isVisible(box) || visibleLabelFor(box))
    );

    for (const box of boxes) {
      const label = visibleLabelFor(box);
      const text = cleanQuestionText(label ? label.textContent : '');

      if (
        /(?:\bi\s+agree\b|\bconsent\b|\bterms\b|privacy policy|\bdeclaration\b|confirm that)/i
          .test(text)
      ) {
        return text || 'the consent checkbox';
      }
    }

    return '';
  }

  function visibleValidationError() {
    const scope = applicationScope();
    const root = scope && scope !== document ? scope : document;

    const selectors = [
      '[aria-invalid="true"]',
      '.invalid-feedback',
      '.field-error',
      '.error-message',
      '.form-error',
      '.help-block.error'
    ];

    for (const selector of selectors) {
      const node = Array.from(root.querySelectorAll(selector)).find(isVisible);
      if (!node) continue;

      const text = cleanQuestionText(node.textContent);
      return text || 'a field is marked invalid';
    }

    return '';
  }

  function isEmptyGroupValue(group) {
    const value = groupCurrentValue(group);
    return Array.isArray(value) ? value.length === 0 : !String(value || '').trim();
  }

  function applicationReadiness(knownGroups = null) {
    const groups = knownGroups || collectFieldGroups();
    const required = groups.filter((group) => group.required);
    const unanswered = required.filter(isEmptyGroupValue);
    const blockers = [];
    const warnings = [];

    if (!groups.length) {
      blockers.push('The application form is not visible yet.');
    }

    if (unanswered.length) {
      blockers.push(
        unanswered.length + ' required question' +
        (unanswered.length === 1 ? '' : 's') + ' still need an answer.'
      );
    }

    const pendingRequired = pendingQuestions.filter((item) => item.group.required);
    if (pendingRequired.length) {
      blockers.push('Answer or skip the questions in the card first.');
    }

    if (hasVisiblePasswordField()) {
      blockers.push('Sign in to Internshala in this tab first.');
    }

    if (hasVisibleCaptcha()) {
      blockers.push('Complete the CAPTCHA yourself.');
    }

    const fileMissing = missingRequiredFile();
    if (fileMissing) {
      blockers.push('Attach the required file yourself.');
    }

    const consent = uncheckedConsentText();
    if (consent) {
      blockers.push('Read and tick the consent box yourself.');
    }

    const validation = visibleValidationError();
    if (validation) {
      blockers.push('Fix the form error: ' + validation);
    }

    if (!groups.length && hasSecurityBlocker()) {
      blockers.push('The page is asking for a login, OTP, CAPTCHA, or a pause.');
    }

    if (!fileMissing && hasOptionalFileInput()) {
      warnings.push('Attach any optional files yourself before submitting.');
    }

    const uniqueBlockers = Array.from(new Set(blockers)).slice(0, 6);
    const uniqueWarnings = Array.from(new Set(warnings)).slice(0, 3);

    return {
      groups,
      required: required.length,
      answered: required.length - unanswered.length,
      pending: pendingQuestions.length,
      blockers: uniqueBlockers,
      warnings: uniqueWarnings,
      ready: groups.length > 0 && uniqueBlockers.length === 0
    };
  }

  /* ------------------------------------------------------------------ *
   * Applying: listing scan and queue construction
   * ------------------------------------------------------------------ */

  function detailLinkForCard(card) {
    const direct = card.querySelector('a.job-title-href');
    if (direct) return direct;

    return Array.from(card.querySelectorAll('a[href]')).find(
      (link) => /\/internship\/detail\/|\/job\/detail\//i.test(link.getAttribute('href') || '')
    ) || null;
  }

  function detailLinkTitle(card, link) {
    const heading = card.querySelector(
      '.job-internship-name, .job-title-href, h3, h4'
    );

    return (
      cleanQuestionText(heading ? heading.textContent : '') ||
      cleanQuestionText(link.textContent) ||
      'Internship listing'
    );
  }

  function scanListingItems() {
    if (!listSection) return [];

    const cards = Array.from(
      document.querySelectorAll('.individual_internship')
    ).slice(0, MAX_QUEUE * 3);

    const seen = new Set();
    const found = [];

    for (const card of cards) {
      const link = detailLinkForCard(card);
      if (!link) continue;

      const href = link.href || link.getAttribute('href');
      if (!isInternshalaUrl(href)) continue;

      const url = cleanUrl(href);
      if (!url || detailSectionFor(url) !== listSection) continue;
      if (seen.has(url)) continue;

      seen.add(url);
      found.push({
        url,
        title: detailLinkTitle(card, link),
        section: listSection
      });

      if (found.length >= MAX_QUEUE) break;
    }

    return found;
  }

  function queueItemForListing(listing, existing) {
    if (existing) {
      // A finished item can be queued again once its run is over; reset it so
      // the new queue treats it as waiting instead of already submitted.
      const waiting = existing.status === 'pending' || existing.status === 'failed';
      return {
        ...existing,
        title: existing.title || listing.title,
        status: waiting ? existing.status : 'pending',
        note: waiting ? existing.note : '',
        updatedAt: Date.now()
      };
    }

    return {
      id: uid(),
      title: listing.title,
      url: listing.url,
      section: listing.section,
      status: 'pending',
      note: '',
      addedAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function listingsToQueue(listings, { merge = false } = {}) {
    const existingByUrl = new Map(
      queueState.items.map((item) => [item.url, item])
    );
    const items = [];
    const seen = new Set();

    if (merge) {
      for (const item of queueState.items) {
        items.push(item);
        seen.add(item.url);
      }
    }

    for (const listing of listings) {
      if (isAppliedUrl(listing.url)) continue;
      if (seen.has(listing.url)) continue;

      const existing = existingByUrl.get(listing.url);
      // A finished run keeps its items so the panel can show what happened.
      // Only an active queue treats them as still queued; once it is over the
      // applied history alone decides whether a listing is offered again.
      if (
        existing &&
        queueState.active &&
        existing.status !== 'pending' &&
        existing.status !== 'failed'
      ) {
        continue;
      }

      items.push(queueItemForListing(listing, existing));
      seen.add(listing.url);

      if (items.length >= MAX_QUEUE) break;
    }

    return items;
  }

  /* ------------------------------------------------------------------ *
   * Applying: queue controller
   * ------------------------------------------------------------------ */

  let applyAdvanceTimer = 0;
  let applyScanTimer = 0;
  let applyObserver = null;
  let navigateAt = 0;
  let detailStepItem = '';
  let detailStepTimer = 0;
  let detailActionItem = '';
  let detailActionAt = 0;
  let applicationStepItem = '';
  let applicationStepTimer = 0;
  let submitWatchTimer = 0;
  let reviewDismissed = false;
  let reviewItemId = '';
  let reviewSignature = '';
  let showManualMark = false;

  function clearApplyTimers() {
    window.clearTimeout(applyAdvanceTimer);
    window.clearTimeout(applyScanTimer);
    window.clearTimeout(detailStepTimer);
    window.clearTimeout(applicationStepTimer);
    window.clearTimeout(submitWatchTimer);
    applyAdvanceTimer = 0;
    applyScanTimer = 0;
    detailStepTimer = 0;
    applicationStepTimer = 0;
    submitWatchTimer = 0;
  }

  function navigateToQueueItem(item) {
    if (!item || !isInternshalaUrl(item.url)) {
      pauseApplyQueue('The next listing has an invalid link. The queue is paused.');
      return;
    }

    if (Date.now() - navigateAt < 1200) return;
    navigateAt = Date.now();
    location.href = item.url;
  }

  async function startApplyQueue() {
    if (!listSection) {
      return resumeApplyQueue();
    }

    if (storageReadFailures.has(QUEUE_KEY)) {
      toast('The saved apply queue could not be read. Reload the page and try again.');
      return;
    }

    const listings = scanListingItems();
    if (!listings.length) {
      toast('No internship or job listings found on this page');
      return;
    }

    const capLeft = DAILY_APPLY_CAP - appliedInLastDay().length;
    if (capLeft <= 0) {
      toast('Daily apply limit reached (' + DAILY_APPLY_CAP + ' in 24 hours)');
      return;
    }

    const items = listingsToQueue(listings);
    if (!items.length) {
      toast('Every listing here is already applied or queued');
      return;
    }

    const runnable = items.slice(0, capLeft);
    const proceed = window.confirm(
      'Start a queue of ' + runnable.length + ' application' +
      (runnable.length === 1 ? '' : 's') + '?\n\n' +
      'Each application opens for you to review. Nothing is submitted until ' +
      'you press “Submit application”.'
    );

    if (!proceed) return;

    const saved = await persistQueue({
      version: 1,
      active: true,
      paused: false,
      currentId: null,
      submittingId: null,
      submitStartedAt: 0,
      origin: cleanUrl(location.href) || location.href,
      section: listSection,
      nextRunAt: 0,
      consecutiveFailures: 0,
      items: runnable
    });

    if (!saved) return;

    applyMessage = '';
    activeTab = 'apply';
    advanceApplyQueue();
  }

  async function rescanApplyQueue() {
    if (!listSection) {
      toast('Open a search page to rescan listings');
      return;
    }

    const listings = scanListingItems();
    if (!listings.length) {
      toast('No internship or job listings found on this page');
      return;
    }

    const items = listingsToQueue(listings, { merge: true });
    const added = items.length - queueState.items.length;

    const saved = await persistQueue({ ...queueState, items });
    if (!saved) return;

    toast(
      added > 0
        ? 'Added ' + added + ' listing' + (added === 1 ? '' : 's') + ' to the queue'
        : 'No new listings found'
    );
  }

  async function resumeApplyQueue() {
    if (storageReadFailures.has(QUEUE_KEY)) {
      toast('The saved apply queue could not be read. Reload the page and try again.');
      return;
    }

    const pending = pendingQueueItems();
    if (!pending.length && !queueState.paused) {
      toast('There are no pending applications in the queue');
      return;
    }

    if (appliedInLastDay().length >= DAILY_APPLY_CAP) {
      toast('Daily apply limit reached (' + DAILY_APPLY_CAP + ' in 24 hours)');
      return;
    }

    const items = updateQueueItems((item) =>
      item.id === queueState.currentId && item.status === 'failed'
        ? { ...item, status: 'pending', note: '', updatedAt: Date.now() }
        : item
    );

    const saved = await persistQueue({
      ...queueState,
      items,
      active: true,
      paused: false,
      nextRunAt: 0,
      consecutiveFailures: 0
    });

    if (!saved) return;

    applyMessage = '';
    activeTab = 'apply';
    armApplyObserver();
    handleApplyPage();
  }

  async function stopApplyQueue() {
    clearApplyTimers();
    stopApplyObserver();
    reviewDismissed = true;
    hideReviewCard();

    await persistQueue({
      ...queueState,
      active: false,
      paused: false,
      submittingId: null,
      submitStartedAt: 0
    });

    applyMessage = 'Queue stopped. Your progress is saved.';
    renderApply();
    toast('Apply queue stopped');
  }

  async function skipCurrentApplication() {
    const item = currentQueueItem();
    if (!item) return;

    reviewDismissed = true;
    hideReviewCard();
    window.clearTimeout(applicationStepTimer);
    window.clearTimeout(submitWatchTimer);

    const items = updateQueueItems((entry) =>
      entry.id === item.id
        ? {
            ...entry,
            status: 'skipped',
            note: 'Skipped by you',
            updatedAt: Date.now()
          }
        : entry
    );

    await persistQueue({
      ...queueState,
      items,
      currentId: null,
      submittingId: null,
      submitStartedAt: 0,
      consecutiveFailures: 0
    });

    applyMessage = 'Skipped “' + item.title + '”.';
    advanceApplyQueue();
  }

  async function clearApplyQueue() {
    if (queueState.active) return;

    reviewDismissed = true;
    hideReviewCard();

    await persistQueue({
      version: 1,
      active: false,
      paused: false,
      currentId: null,
      submittingId: null,
      submitStartedAt: 0,
      origin: '',
      section: null,
      nextRunAt: 0,
      consecutiveFailures: 0,
      items: []
    });

    applyMessage = '';
    renderApply();
    toast('Apply queue cleared');
  }

  async function pauseApplyQueue(reason, { markFailed = false } = {}) {
    clearApplyTimers();
    stopApplyObserver();

    let items = queueState.items;
    let failures = queueState.consecutiveFailures;

    if (markFailed) {
      const item = currentQueueItem();
      failures += 1;

      if (item) {
        items = updateQueueItems((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: 'failed',
                note: reason.slice(0, 300),
                updatedAt: Date.now()
              }
            : entry
        );
      }
    }

    const stoppedAfterFailures = markFailed && failures >= 3;
    const message = stoppedAfterFailures
      ? 'Stopped after 3 consecutive problems. Check the listings, then press Resume. ' + reason
      : reason;

    reviewDismissed = true;
    hideReviewCard();
    applyMessage = message;

    await persistQueue({
      ...queueState,
      items,
      active: !stoppedAfterFailures,
      paused: true,
      submittingId: null,
      submitStartedAt: 0,
      consecutiveFailures: failures
    });

    renderApply();
    toast(message);
  }

  async function finishApplyQueue() {
    const done = queueState.items.filter((item) => item.status === 'done').length;

    clearApplyTimers();
    stopApplyObserver();
    reviewDismissed = true;
    hideReviewCard();

    await persistQueue({
      ...queueState,
      active: false,
      paused: false,
      currentId: null,
      submittingId: null,
      submitStartedAt: 0,
      nextRunAt: 0,
      consecutiveFailures: 0
    });

    applyMessage = done
      ? 'Queue finished. ' + done + ' application' + (done === 1 ? '' : 's') + ' submitted.'
      : 'Queue finished. No applications were submitted.';

    renderApply();
    toast('Apply queue finished');
  }

  function scheduleAdvance(delay) {
    window.clearTimeout(applyAdvanceTimer);
    applyAdvanceTimer = window.setTimeout(() => {
      applyAdvanceTimer = 0;
      advanceApplyQueue();
    }, Math.max(250, delay));
  }

  async function advanceApplyQueue() {
    if (!applyLoaded) return;
    if (!queueIsRunning()) return;

    if (appliedInLastDay().length >= DAILY_APPLY_CAP) {
      await pauseApplyQueue(
        'Daily limit reached: ' + DAILY_APPLY_CAP +
        ' applications in 24 hours. The queue is paused.'
      );
      return;
    }

    const wait = queueState.nextRunAt - Date.now();
    if (wait > 0) {
      renderApply();
      scheduleAdvance(wait);
      return;
    }

    let item = currentQueueItem();
    if (item && item.status !== 'pending') item = null;

    if (!item) {
      item = pendingQueueItems()[0] || null;
      if (!item) {
        await finishApplyQueue();
        return;
      }

      const saved = await persistQueue({
        ...queueState,
        currentId: item.id,
        nextRunAt: 0
      });
      if (!saved) return;
    }

    if (isApplicationPage(location.href)) {
      const applicationDetail = detailUrlForApplication(location.href);
      if (applicationDetail && sameDetailUrl(applicationDetail, item.url)) {
        handleApplyPage();
        return;
      }

      if (!hasSubmissionSignal()) {
        await pauseApplyQueue(
          'Paused: an application form is open that is not part of the queue.'
        );
        return;
      }
    }

    if (sameDetailUrl(location.href, item.url)) {
      handleApplyPage();
      return;
    }

    navigateToQueueItem(item);
  }

  function findDetailApplyControl() {
    const scope =
      document.querySelector('main, #main_content, .main_content, .container') ||
      document.body;

    if (!scope) return null;

    const nodes = [];

    ['.apply_now_button', '.apply_now_btn'].forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (!nodes.includes(node)) nodes.push(node);
      });
    });

    Array.from(
      scope.querySelectorAll(
        'a[href*="/student/interstitial/application/"], a[href*="/application/"]'
      )
    ).forEach((node) => {
      if (!nodes.includes(node)) nodes.push(node);
    });

    for (const node of nodes) {
      if (node.closest('[data-internshala-saved-filters]')) continue;
      if (!isVisible(node)) continue;
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') continue;

      const text = String(node.textContent || node.value || '')
        .replace(/\s+/g, ' ')
        .trim();
      const href = node.getAttribute('href') || '';

      if (/withdraw|report|delete|logout|payment|upgrade|share|saved/i.test(text)) {
        continue;
      }

      if (!/apply/i.test(text) && !/\/application\//i.test(href)) continue;

      return node;
    }

    return null;
  }

  function runDetailStep() {
    if (!queueIsRunning()) return;

    const item = currentQueueItem();
    if (!item) return;

    if (hasAlreadyAppliedState()) {
      markExistingApplication(item);
      return;
    }

    const control = findDetailApplyControl();

    if (control) {
      if (
        detailActionItem === item.id &&
        Date.now() - detailActionAt < 15000
      ) {
        return;
      }

      const href = control.getAttribute('href') || '';
      if (/\/(?:registration|login|signin|sign-in)(?:\/|$)/i.test(href)) {
        pauseApplyQueue(
          'Log in to Internshala in this tab, then press Resume to continue the queue.'
        );
        return;
      }

      detailActionItem = item.id;
      detailActionAt = Date.now();
      applyMessage = 'Opening the application form for “' + item.title + '”…';
      renderApply();

      window.setTimeout(() => {
        if (!queueIsRunning()) return;

        const current = currentQueueItem();
        if (!current || current.id !== item.id) return;

        if (href && isInternshalaUrl(href)) {
          const target = new URL(href, location.href).toString();
          if (isApplicationPage(target)) {
            location.href = target;
            return;
          }
        }

        try {
          control.click();
        } catch (error) {
          pauseApplyQueue(
            'Could not open the application form. The queue is paused.',
            { markFailed: true }
          );
          return;
        }

        window.setTimeout(() => {
          if (!queueIsRunning()) return;
          if (currentQueueItem() && currentQueueItem().id === item.id) {
            handleApplyPage();
          }
        }, 2500);
      }, 700);

      return;
    }

    if (detailStepItem === item.id) return;

    detailStepItem = item.id;
    applyMessage = 'Looking for the Apply button…';
    renderApply();

    window.clearTimeout(detailStepTimer);
    detailStepTimer = window.setTimeout(() => {
      if (!queueIsRunning()) return;

      const current = currentQueueItem();
      if (!current || current.id !== item.id) return;

      if (findDetailApplyControl() || hasAlreadyAppliedState()) {
        handleApplyPage();
        return;
      }

      pauseApplyQueue(
        'Could not find the Apply button on this listing. The page may have changed, so the queue is paused.',
        { markFailed: true }
      );
    }, 8000);
  }

  function findSiteSubmitControl() {
    const groups = collectFieldGroups();
    if (!groups.length) return null;

    const sourceForm = groups[groups.length - 1].fields[0].closest('form');
    const scope = sourceForm || null;

    // Without a real form container, a stray "Apply" link in the header could
    // be mistaken for the submit button. In that case the user marks it
    // manually instead of letting the assistant click blindly.
    if (!scope) return null;

    const nodes = Array.from(
      scope.querySelectorAll(
        'button[type="submit"], input[type="submit"], button, a.button, a.btn'
      )
    ).filter(isVisible);

    for (const node of nodes) {
      if (node.closest('[data-internshala-saved-filters]')) continue;

      const text = String(node.textContent || node.value || '')
        .replace(/\s+/g, ' ')
        .trim();

      if (/withdraw|report|delete|logout|payment|upgrade|save|cancel|back|preview|edit/i.test(text)) {
        continue;
      }

      if (node.type === 'submit' || /submit|apply/i.test(text)) {
        return node;
      }
    }

    return null;
  }

  function runApplicationStep() {
    if (!queueIsRunning()) return;

    const item = currentQueueItem();
    if (!item) {
      advanceApplyQueue();
      return;
    }

    if (queueState.submittingId === item.id) {
      if (hasSubmissionSignal()) {
        completeApplication(item);
        return;
      }

      if (Date.now() - queueState.submitStartedAt > 2500) {
        const validation = visibleValidationError();
        if (validation) {
          showManualMark = true;
          pauseApplyQueue(
            'The form was not accepted: ' + validation +
            ' Fix it, then press Resume.',
            { markFailed: true }
          );
          return;
        }

        if (hasSecurityBlocker()) {
          pauseApplyQueue(
            'The page is asking for a login, OTP, or CAPTCHA. Complete it, then press Resume.'
          );
          return;
        }
      }

      if (Date.now() - queueState.submitStartedAt > 20000) {
        showManualMark = true;
        pauseApplyQueue(
          'Could not confirm the submission. Check the page, then press Resume, Skip, or Mark applied.',
          { markFailed: true }
        );
        return;
      }
    }

    const scan = scanApplicationForm();
    const groups = (scan && scan.groupList) || collectFieldGroups();
    if (!groups.length) {
      if (applicationStepItem !== item.id) {
        applicationStepItem = item.id;
        applyMessage = 'Waiting for the application form…';
        renderApply();

        window.clearTimeout(applicationStepTimer);
        applicationStepTimer = window.setTimeout(() => {
          if (!queueIsRunning()) return;

          const current = currentQueueItem();
          if (!current || current.id !== item.id) return;

          if (collectFieldGroups().length || hasSubmissionSignal()) {
            handleApplyPage();
            return;
          }

          if (hasSecurityBlocker() || hasVisiblePasswordField()) {
            pauseApplyQueue(
              'Sign in, clear the CAPTCHA/OTP, or wait for the form to load, then press Resume.'
            );
          } else {
            pauseApplyQueue(
              'Could not find the application form. The page may have changed, so the queue is paused.'
            );
          }
        }, 8000);
      }

      renderApply();
      return;
    }

    applicationStepItem = item.id;
    applyMessage = 'Review the filled application, then submit it yourself.';
    renderReviewCard(applicationReadiness(groups));
    renderApply();
  }

  async function submitCurrentApplication() {
    const item = currentQueueItem();
    if (!item || !queueIsRunning()) return;
    if (queueState.submittingId === item.id) return;

    const readiness = applicationReadiness();

    if (!readiness.ready) {
      renderReviewCard(readiness);
      toast('Finish the highlighted items before submitting');
      return;
    }

    const control = findSiteSubmitControl();
    if (!control) {
      showManualMark = true;
      renderReviewCard(readiness);
      toast('Could not find the site’s Submit button. Submit it yourself or press Mark applied.');
      return;
    }

    const saved = await persistQueue({
      ...queueState,
      submittingId: item.id,
      submitStartedAt: Date.now(),
      paused: false,
      active: true
    });

    if (!saved) return;

    renderReviewCard(applicationReadiness());

    if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      try {
        control.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch (error) {
        // Older engines ignore the options object.
      }
    }

    try {
      control.click();
    } catch (error) {
      showManualMark = true;
      await pauseApplyQueue(
        'Could not press the site’s Submit button. Submit it yourself or press Mark applied.',
        { markFailed: true }
      );
      return;
    }

    toast('Waiting for Internshala to confirm the submission');

    window.clearTimeout(submitWatchTimer);
    submitWatchTimer = window.setTimeout(() => {
      if (!queueState.active) return;
      if (queueState.submittingId !== item.id) return;

      if (hasSubmissionSignal()) {
        completeApplication(item);
        return;
      }

      showManualMark = true;
      pauseApplyQueue(
        'Submission not confirmed. Check the page; press Resume to retry, Skip to move on, or Mark applied if it went through.',
        { markFailed: true }
      );
    }, 20000);
  }

  async function markApplicationApplied(item) {
    if (!item) return;

    const nextApplied = {
      version: 1,
      entries: [
        {
          id: uid(),
          title: item.title,
          url: item.url,
          appliedAt: Date.now(),
          source: 'queue'
        },
        ...appliedState.entries.filter((entry) => entry.url !== item.url)
      ].slice(0, MAX_APPLIED)
    };

    if (!(await persistApplied(nextApplied))) return;

    const items = updateQueueItems((entry) =>
      entry.id === item.id
        ? {
            ...entry,
            status: 'done',
            note: 'Marked applied by you',
            updatedAt: Date.now()
          }
        : entry
    );

    reviewDismissed = true;
    showManualMark = false;
    hideReviewCard();
    clearApplyTimers();

    const remaining = items.some((entry) => entry.status === 'pending');
    const wait = remaining
      ? APPLY_COOLDOWN_MIN +
        Math.floor(Math.random() * (APPLY_COOLDOWN_MAX - APPLY_COOLDOWN_MIN + 1))
      : 0;

    await persistQueue({
      ...queueState,
      items,
      currentId: null,
      submittingId: null,
      submitStartedAt: 0,
      nextRunAt: wait ? Date.now() + wait : 0,
      consecutiveFailures: 0
    });

    applyMessage = 'Application recorded.';
    toast('Marked as applied');

    if (!remaining) {
      await finishApplyQueue();
      return;
    }

    scheduleAdvance(wait);
  }

  async function completeApplication(item) {
    const alreadyRecorded = isAppliedUrl(item.url);

    if (!alreadyRecorded) {
      const saved = await persistApplied({
        version: 1,
        entries: [
          {
            id: uid(),
            title: item.title,
            url: item.url,
            appliedAt: Date.now(),
            source: 'queue'
          },
          ...appliedState.entries
        ].slice(0, MAX_APPLIED)
      });

      if (!saved) {
        await pauseApplyQueue(
          'The submission went through, but applied history could not be saved. Check your applications, then press Resume.'
        );
        return;
      }
    }

    const items = updateQueueItems((entry) =>
      entry.id === item.id
        ? {
            ...entry,
            status: 'done',
            note: 'Submitted',
            updatedAt: Date.now()
          }
        : entry
    );

    reviewDismissed = true;
    showManualMark = false;
    hideReviewCard();
    clearApplyTimers();

    const remaining = items.some((entry) => entry.status === 'pending');
    const wait = remaining
      ? APPLY_COOLDOWN_MIN +
        Math.floor(Math.random() * (APPLY_COOLDOWN_MAX - APPLY_COOLDOWN_MIN + 1))
      : 0;

    await persistQueue({
      ...queueState,
      items,
      currentId: null,
      submittingId: null,
      submitStartedAt: 0,
      nextRunAt: wait ? Date.now() + wait : 0,
      consecutiveFailures: 0
    });

    applyMessage = 'Application submitted.';
    toast('Application submitted');

    if (!remaining) {
      await finishApplyQueue();
      return;
    }

    applyMessage = 'Application submitted. Next one in ' + Math.round(wait / 1000) + ' seconds.';
    renderApply();
    scheduleAdvance(wait);
  }

  async function markExistingApplication(item) {
    if (!isAppliedUrl(item.url)) {
      const saved = await persistApplied({
        version: 1,
        entries: [
          {
            id: uid(),
            title: item.title,
            url: item.url,
            appliedAt: Date.now(),
            source: 'detected'
          },
          ...appliedState.entries
        ].slice(0, MAX_APPLIED)
      });

      if (!saved) return;
    }

    const items = updateQueueItems((entry) =>
      entry.id === item.id
        ? {
            ...entry,
            status: 'done',
            note: 'Already applied',
            updatedAt: Date.now()
          }
        : entry
    );

    reviewDismissed = true;
    hideReviewCard();

    await persistQueue({
      ...queueState,
      items,
      currentId: null,
      submittingId: null,
      submitStartedAt: 0,
      consecutiveFailures: 0
    });

    applyMessage = 'Already applied. Moving on.';
    scheduleAdvance(3000);
  }

  function handleApplyPage() {
    if (!applyLoaded || !queueIsRunning()) {
      renderApply();
      return;
    }

    const item = currentQueueItem();

    if (queueState.submittingId) {
      if (hasSubmissionSignal()) {
        if (item) completeApplication(item);
        return;
      }

      if (!item) {
        pauseApplyQueue(
          'Could not match the last submission to a queue item. The queue is paused.'
        );
        return;
      }

      if (Date.now() - queueState.submitStartedAt <= 20000) {
        renderApply();
        return;
      }
    }

    if (!item) {
      advanceApplyQueue();
      return;
    }

    if (isApplicationPage(location.href)) {
      const applicationDetail = detailUrlForApplication(location.href);
      if (applicationDetail && sameDetailUrl(applicationDetail, item.url)) {
        runApplicationStep();
        return;
      }
    }

    if (sameDetailUrl(location.href, item.url)) {
      runDetailStep();
      return;
    }

    if (listSection) {
      advanceApplyQueue();
      return;
    }

    pauseApplyQueue(
      'Paused: this page is not part of the apply queue. Open the current listing or press Resume.'
    );
  }

  function startApplyAssistant() {
    if (!queueState.active) {
      renderApply();
      return;
    }

    if (queueIsRunning()) {
      handleApplyPage();
    } else {
      applyMessage =
        'Queue paused. Press Resume to continue from “' +
        (currentQueueItem() ? currentQueueItem().title : 'the next listing') + '”.';
      renderApply();
    }

    armApplyObserver();
  }

  function stopApplyObserver() {
    if (applyObserver) applyObserver.disconnect();
    applyObserver = null;
  }

  function armApplyObserver() {
    if (!detailSection && !applicationPage) return;

    stopApplyObserver();

    let lastRunAt = 0;

    const run = () => {
      applyScanTimer = 0;
      lastRunAt = Date.now();

      try {
        if (!queueIsRunning()) return;
        handleApplyPage();
      } catch (error) {
        console.warn('[Saved filters] Could not continue the apply queue:', error);
      }
    };

    applyObserver = new MutationObserver(() => {
      // A page that mutates continuously must not postpone the scan forever.
      if (applyScanTimer && Date.now() - lastRunAt > 2500) {
        window.clearTimeout(applyScanTimer);
        run();
        return;
      }

      window.clearTimeout(applyScanTimer);
      applyScanTimer = window.setTimeout(run, 900);
    });

    applyObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* ------------------------------------------------------------------ *
   * Page state
   * ------------------------------------------------------------------ */

  const listSection = sectionFor(location.href);
  const detailSection = detailSectionFor(location.href);
  const applicationPage = isApplicationPage(location.href);
  const currentSection = listSection || detailSection;

  // Filters only exist on list pages, but the answer assistant also needs to
  // run on detail and application pages.
  if (!currentSection && !applicationPage) return;

  function autoRestoreLastSearch(section) {
    if (!section || !state.autoRestore || !isBasePage(section)) return false;

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
    if (!listSection || !isFilteredSearch(listSection)) return;

    const url = cleanUrl(location.href);
    if (!url) return;

    const existingPreset = state.presets.find((preset) => preset.url === url);
    const name = existingPreset ? existingPreset.name : deriveName(listSection, url);
    const previous = state.last[listSection];

    if (!previous || previous.url !== url || previous.name !== name) {
      state.last[listSection] = { url, name, savedAt: Date.now() };
      persist();
    }
  }

  if (listSection && autoRestoreLastSearch(listSection)) return;

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

    .isf-fab-count {
      display: inline-grid;
      min-width: 17px;
      height: 17px;
      padding: 0 4px;
      place-items: center;
      border-radius: 999px;
      background: var(--brand);
      color: #ffffff;
      font-size: 9.5px;
      font-weight: 700;
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

    .isf-tabs {
      display: flex;
      gap: 2px;
      padding: 7px 12px 0;
      border-bottom: 1px solid var(--line);
      background: #ffffff;
    }

    .isf-tab {
      display: inline-flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 8px 5px 9px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
      font-weight: 650;
    }

    .isf-tab:hover {
      color: var(--ink);
    }

    .isf-tab.is-active {
      border-bottom-color: var(--brand);
      color: var(--brand-dark);
    }

    .isf-tab:disabled {
      cursor: default;
      opacity: 0.4;
    }

    .isf-tab-count {
      display: inline-grid;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      place-items: center;
      border-radius: 999px;
      background: #e8f2f9;
      color: var(--brand-dark);
      font-size: 9.5px;
      font-weight: 700;
    }

    .isf-empty {
      padding: 18px 8px;
      color: var(--muted);
      font-size: 12.5px;
      line-height: 1.5;
      text-align: center;
    }

    .isf-toolbar {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }

    .isf-toolbar .isf-input {
      height: 34px;
      min-width: 0;
    }

    .isf-answer {
      margin-bottom: 6px;
      padding: 9px 10px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #ffffff;
    }

    .isf-answer-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .isf-answer-q {
      min-width: 0;
      font-size: 12.5px;
      font-weight: 650;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .isf-answer-a {
      display: -webkit-box;
      margin-top: 3px;
      overflow: hidden;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.4;
      overflow-wrap: anywhere;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
    }

    .isf-answer-meta {
      margin-top: 4px;
      color: #8a9daa;
      font-size: 10px;
    }

    .isf-answer-actions {
      display: flex;
      flex: none;
      gap: 1px;
      opacity: 0.6;
    }

    .isf-answer:hover .isf-answer-actions,
    .isf-answer-actions:focus-within {
      opacity: 1;
    }

    .isf-answer-actions .isf-icon-btn {
      width: 27px;
      height: 27px;
    }

    .isf-answer-actions svg {
      width: 13px;
      height: 13px;
    }

    .isf-answer-edit {
      margin-top: 7px;
    }

    .isf-textarea {
      width: 100%;
      min-height: 72px;
      padding: 8px 10px;
      border: 1px solid #bfd7e6;
      border-radius: 9px;
      background: #ffffff;
      color: var(--ink);
      font: inherit;
      font-size: 12.5px;
      line-height: 1.45;
      resize: vertical;
    }

    .isf-textarea::placeholder {
      color: #96a9b7;
    }

    .isf-qcard {
      position: fixed;
      right: 20px;
      bottom: 76px;
      z-index: 2147483646;
      width: 372px;
      max-width: calc(100vw - 24px);
      max-height: min(70vh, 560px);
      overflow-y: auto;
      border: 1px solid rgba(16, 55, 80, 0.14);
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 20px 60px rgba(9, 42, 64, 0.26), 0 3px 12px rgba(9, 42, 64, 0.1);
      pointer-events: auto;
    }

    .isf-qcard-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: #fafdff;
    }

    .isf-qcard-head b {
      font-size: 13px;
      font-weight: 700;
    }

    .isf-qcard-sub {
      margin: 10px 14px 0;
      color: var(--muted);
      font-size: 11.5px;
      line-height: 1.45;
    }

    .isf-qcard-list {
      padding: 4px 14px 12px;
    }

    .isf-q-item {
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }

    .isf-q-item:last-child {
      border-bottom: 0;
    }

    .isf-q-question {
      display: block;
      margin-bottom: 6px;
      font-size: 12.5px;
      font-weight: 650;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }

    .isf-q-optional {
      color: var(--muted);
      font-size: 10px;
      font-weight: 500;
    }

    .isf-q-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 8px;
    }

    .isf-q-actions .isf-btn {
      min-height: 31px;
      padding: 5px 10px;
      font-size: 11.5px;
    }

    .isf-q-actions .isf-btn-primary {
      width: auto;
    }

    .isf-check-row {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      margin-top: 6px;
      color: var(--ink);
      font-size: 12px;
      line-height: 1.35;
      cursor: pointer;
    }

    .isf-check-row input {
      flex: none;
      width: 15px;
      height: 15px;
      margin: 1px 0 0;
      accent-color: var(--brand);
    }

    .isf-apply-status {
      margin-bottom: 10px;
      padding: 10px 11px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fbfdff;
    }

    .isf-apply-status strong {
      display: block;
      font-size: 12.5px;
      line-height: 1.35;
    }

    .isf-apply-status small {
      display: block;
      margin-top: 2px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
    }

    .isf-progress {
      height: 5px;
      margin-top: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #e6f0f7;
    }

    .isf-progress span {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--brand);
      transition: width 0.2s ease;
    }

    .isf-apply-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 9px;
    }

    .isf-apply-actions .isf-btn {
      width: auto;
      min-height: 32px;
      padding: 6px 11px;
      font-size: 11.5px;
    }

    .isf-queue {
      margin: 0 0 10px;
      padding: 0;
      list-style: none;
    }

    .isf-queue-item {
      display: flex;
      gap: 8px;
      padding: 7px 2px;
      border-bottom: 1px solid var(--line);
      font-size: 11.5px;
    }

    .isf-queue-item:last-child {
      border-bottom: 0;
    }

    .isf-queue-state {
      flex: none;
      width: 8px;
      height: 8px;
      margin-top: 5px;
      border-radius: 50%;
      background: #c9d9e4;
    }

    .isf-queue-state.is-done {
      background: #17a673;
    }

    .isf-queue-state.is-current {
      background: var(--brand);
      box-shadow: 0 0 0 3px #e2f0fa;
    }

    .isf-queue-state.is-bad {
      background: #d08a2e;
    }

    .isf-queue-copy {
      min-width: 0;
    }

    .isf-queue-title {
      display: block;
      font-weight: 600;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .isf-queue-meta {
      display: block;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }

    .isf-mode-row {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .isf-mode-row label {
      font-size: 11.5px;
      font-weight: 650;
    }

    .isf-mode-row .isf-input {
      height: 34px;
    }

    .isf-mode-note {
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.4;
    }

    .isf-warn {
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px solid #f0d9a8;
      border-radius: 9px;
      background: #fffaf0;
      color: #7a5a16;
      font-size: 11px;
      line-height: 1.4;
    }

    .isf-review {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483646;
      width: 342px;
      max-width: calc(100vw - 24px);
      overflow: hidden;
      border: 1px solid rgba(16, 55, 80, 0.14);
      border-radius: 16px;
      background: #ffffff;
      box-shadow: 0 20px 60px rgba(9, 42, 64, 0.26), 0 3px 12px rgba(9, 42, 64, 0.1);
      pointer-events: auto;
    }

    .isf-review-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--line);
      background: #fafdff;
    }

    .isf-review-head b {
      font-size: 13px;
      font-weight: 700;
    }

    .isf-review-body {
      padding: 10px 14px 12px;
    }

    .isf-review-line {
      display: flex;
      gap: 7px;
      margin-bottom: 5px;
      color: var(--ink);
      font-size: 11.5px;
      line-height: 1.4;
    }

    .isf-review-line b {
      flex: none;
      font-weight: 650;
    }

    .isf-review-line.is-warn {
      color: #8a5a12;
    }

    .isf-review-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 10px;
    }

    .isf-review-actions .isf-btn {
      width: auto;
      min-height: 32px;
      padding: 6px 11px;
      font-size: 11.5px;
    }

    .isf-review.is-busy {
      opacity: 0.72;
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

      .isf-qcard {
        right: 12px;
        bottom: 138px;
      }

      .isf-review {
        top: 12px;
        right: 12px;
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
      <span class="isf-fab-text" id="isf-fab-text">Saved filters</span>
      <span class="isf-fab-count" id="isf-fab-count" hidden></span>
    </button>

    <section class="isf-panel" id="isf-panel" role="dialog" aria-label="Saved Internshala filters" hidden>
      <div class="isf-head">
        <div class="isf-brand">
          <span class="isf-brand-mark">${ICONS.bookmark}</span>
          <span class="isf-brand-copy">
            <strong id="isf-brand-title">Saved filters</strong>
            <small id="isf-brand-sub">for Internshala</small>
          </span>
        </div>
        <button class="isf-icon-btn" id="isf-close" type="button" aria-label="Close saved filters">&times;</button>
      </div>

      <div class="isf-tabs" role="tablist" aria-label="Saved filters, apply queue, and application answers">
        <button class="isf-tab is-active" id="isf-tab-filters" type="button" role="tab"
                aria-selected="true" aria-controls="isf-view-filters" data-tab="filters">Filters</button>
        <button class="isf-tab" id="isf-tab-apply" type="button" role="tab"
                aria-selected="false" aria-controls="isf-view-apply" data-tab="apply">
          Apply <span class="isf-tab-count" id="isf-apply-count" hidden>0</span>
        </button>
        <button class="isf-tab" id="isf-tab-answers" type="button" role="tab"
                aria-selected="false" aria-controls="isf-view-answers" data-tab="answers">
          Answers <span class="isf-tab-count" id="isf-answer-count">0</span>
        </button>
      </div>

      <div class="isf-body">
        <div class="isf-view" id="isf-view-filters" role="tabpanel" aria-labelledby="isf-tab-filters">
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

        <div class="isf-view" id="isf-view-apply" role="tabpanel" aria-labelledby="isf-tab-apply" hidden>
          <p class="isf-hint" id="isf-apply-hint">
            Scan this page and work through applications one at a time.
          </p>

          <div id="isf-apply-status"></div>

          <div class="isf-settings">
            <div class="isf-mode-row">
              <label for="isf-apply-mode">Apply mode</label>
              <select class="isf-input" id="isf-apply-mode" aria-describedby="isf-mode-note">
                <option value="review">Review before submit (recommended)</option>
                <option value="auto" disabled>Auto-submit (next update)</option>
              </select>
              <span class="isf-mode-note" id="isf-mode-note">
                Fills each application and waits for you to review and submit it.
              </span>
            </div>

            <div class="isf-apply-actions">
              <button class="isf-btn isf-btn-primary" id="isf-apply-start" type="button">Start queue</button>
              <button class="isf-btn isf-btn-ghost" id="isf-apply-rescan" type="button">Rescan page</button>
              <button class="isf-btn isf-btn-ghost" id="isf-apply-resume" type="button" hidden>Resume</button>
              <button class="isf-btn isf-btn-ghost" id="isf-apply-stop" type="button" hidden>Stop</button>
              <button class="isf-btn isf-btn-ghost" id="isf-apply-skip" type="button" hidden>Skip this one</button>
              <button class="isf-btn isf-btn-ghost" id="isf-apply-review" type="button" hidden>Show review</button>
              <button class="isf-btn isf-btn-ghost" id="isf-apply-clear" type="button" hidden>Clear queue</button>
              <button class="isf-btn isf-btn-ghost" id="isf-apply-history" type="button" hidden>Clear applied history</button>
            </div>
          </div>

          <div class="isf-group-label" id="isf-apply-list-label" hidden>Listings on this page</div>
          <ul class="isf-queue" id="isf-apply-list"></ul>
        </div>

        <div class="isf-view" id="isf-view-answers" role="tabpanel" aria-labelledby="isf-tab-answers" hidden>
          <p class="isf-hint" id="isf-answers-hint">
            Answers are saved on this device and filled into matching application questions. Nothing is sent anywhere.
          </p>

          <div class="isf-toolbar">
            <input class="isf-input" id="isf-answer-search" type="search" autocomplete="off"
                   placeholder="Search saved answers" aria-label="Search saved answers">
          </div>

          <div id="isf-answer-list"></div>

          <p class="isf-empty" id="isf-answer-empty">
            No saved answers yet. Fill an application question and choose “Save answer” to reuse it next time.
          </p>

          <div class="isf-data">
            <span class="isf-data-label" id="isf-answer-count-label">0 saved answers</span>
            <span class="isf-data-actions">
              <button class="isf-link" id="isf-clear-answers" type="button">Clear all</button>
            </span>
          </div>
        </div>
      </div>

      <div class="isf-foot">
        <span id="isf-last-saved">No search saved yet</span>
        <button class="isf-link" id="isf-clear-last" type="button" hidden>Clear</button>
      </div>
    </section>

    <aside class="isf-qcard" id="isf-qcard" aria-label="Application questions" hidden>
      <div class="isf-qcard-head">
        <b>Application questions</b>
        <button class="isf-icon-btn" id="isf-qcard-close" type="button" aria-label="Hide application questions">&times;</button>
      </div>
      <p class="isf-qcard-sub" id="isf-qcard-sub"></p>
      <div class="isf-qcard-list" id="isf-qcard-list"></div>
    </aside>

    <aside class="isf-review" id="isf-review" aria-label="Review application" hidden>
      <div class="isf-review-head">
        <b id="isf-review-title">Review your application</b>
        <button class="isf-icon-btn" id="isf-review-close" type="button" aria-label="Hide review">&times;</button>
      </div>
      <div class="isf-review-body">
        <div id="isf-review-lines"></div>
        <div class="isf-review-actions">
          <button class="isf-btn isf-btn-ghost" id="isf-review-skip" type="button">Skip</button>
          <button class="isf-btn isf-btn-ghost" id="isf-review-mark" type="button" hidden>Mark applied</button>
          <button class="isf-btn isf-btn-ghost" id="isf-review-recheck" type="button">Recheck</button>
          <button class="isf-btn isf-btn-primary" id="isf-review-submit" type="button">Submit application</button>
        </div>
      </div>
    </aside>

    <div class="isf-toast" id="isf-toast" role="status" aria-live="polite"></div>
    <input type="file" id="isf-import-file" accept="application/json,.json" hidden>
  `;
  shadow.appendChild(root);

  const el = {
    fab: root.querySelector('#isf-fab'),
    fabText: root.querySelector('#isf-fab-text'),
    fabCount: root.querySelector('#isf-fab-count'),
    panel: root.querySelector('#isf-panel'),
    close: root.querySelector('#isf-close'),
    brandTitle: root.querySelector('#isf-brand-title'),
    brandSub: root.querySelector('#isf-brand-sub'),
    tabFilters: root.querySelector('#isf-tab-filters'),
    tabApply: root.querySelector('#isf-tab-apply'),
    tabAnswers: root.querySelector('#isf-tab-answers'),
    viewFilters: root.querySelector('#isf-view-filters'),
    viewApply: root.querySelector('#isf-view-apply'),
    viewAnswers: root.querySelector('#isf-view-answers'),
    applyHint: root.querySelector('#isf-apply-hint'),
    applyStatus: root.querySelector('#isf-apply-status'),
    applyMode: root.querySelector('#isf-apply-mode'),
    modeNote: root.querySelector('#isf-mode-note'),
    applyStart: root.querySelector('#isf-apply-start'),
    applyRescan: root.querySelector('#isf-apply-rescan'),
    applyResume: root.querySelector('#isf-apply-resume'),
    applyStop: root.querySelector('#isf-apply-stop'),
    applySkip: root.querySelector('#isf-apply-skip'),
    applyReview: root.querySelector('#isf-apply-review'),
    applyClear: root.querySelector('#isf-apply-clear'),
    applyHistory: root.querySelector('#isf-apply-history'),
    applyCount: root.querySelector('#isf-apply-count'),
    applyListLabel: root.querySelector('#isf-apply-list-label'),
    applyList: root.querySelector('#isf-apply-list'),
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
    answersHint: root.querySelector('#isf-answers-hint'),
    answerSearch: root.querySelector('#isf-answer-search'),
    answerList: root.querySelector('#isf-answer-list'),
    answerEmpty: root.querySelector('#isf-answer-empty'),
    answerCount: root.querySelector('#isf-answer-count'),
    answerCountLabel: root.querySelector('#isf-answer-count-label'),
    clearAnswers: root.querySelector('#isf-clear-answers'),
    qcard: root.querySelector('#isf-qcard'),
    qcardClose: root.querySelector('#isf-qcard-close'),
    qcardSub: root.querySelector('#isf-qcard-sub'),
    qcardList: root.querySelector('#isf-qcard-list'),
    review: root.querySelector('#isf-review'),
    reviewTitle: root.querySelector('#isf-review-title'),
    reviewLines: root.querySelector('#isf-review-lines'),
    reviewClose: root.querySelector('#isf-review-close'),
    reviewSkip: root.querySelector('#isf-review-skip'),
    reviewMark: root.querySelector('#isf-review-mark'),
    reviewRecheck: root.querySelector('#isf-review-recheck'),
    reviewSubmit: root.querySelector('#isf-review-submit'),
    toast: root.querySelector('#isf-toast')
  };

  let activeTab = listSection ? 'filters' : detailSection ? 'apply' : 'answers';

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

  /* ------------------------------------------------------------------ *
   * Application form detection and filling
   * ------------------------------------------------------------------ */

  const SENSITIVE_QUESTION =
    /password|passcode|\botp\b|one[-\s]?time|captcha|credit\s*card|debit\s*card|\bcvv\b|bank\s*account|aadhaar|passport|pan\s*(?:number|card)/i;

  const TEXT_LIKE_TYPES = new Set(['text', 'textarea', 'email', 'tel', 'url']);
  const OPTION_TYPES = new Set(['select', 'radio']);

  const autoFilledValues = new WeakMap();
  const usedAnswerIds = new Set();
  let pendingQuestions = [];
  let skippedQuestionKeys = new Set();
  let qcardDismissed = false;
  let qcardSignature = '';
  let answerObserver = null;
  let formScanTimer = 0;
  let lastFormSignature = '';
  let lastFormScanAt = 0;

  function isVisible(element) {
    if (!element || element.hidden) return false;
    if (element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function humanizeFieldName(value) {
    return cleanQuestionText(value)
      .replace(/\[\]$/, '')
      .replace(/[_\-.:]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function elementText(element) {
    return cleanQuestionText(
      (element && (element.innerText || element.textContent)) || ''
    );
  }

  function fieldType(field) {
    const tag = field.tagName.toLowerCase();

    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';

    if (tag === 'input') {
      const type = (field.type || 'text').toLowerCase();

      if (type === 'radio') return 'radio';
      if (type === 'checkbox') return 'checkbox';
      if (TEXT_LIKE_TYPES.has(type)) return type;
      if (type === 'number' || type === 'date') return type;
    }

    return null;
  }

  function visibleLabelFor(field) {
    const labels = field.labels ? Array.from(field.labels) : [];
    const wrapper = field.closest('label');
    if (wrapper && !labels.includes(wrapper)) labels.push(wrapper);

    return labels.find((label) => isVisible(label)) || null;
  }

  function isCandidateField(field) {
    if (!field || field.disabled || field.readOnly) return false;
    if (field.closest('[data-internshala-saved-filters]')) return false;

    const type = (field.type || '').toLowerCase();
    const customOption = type === 'radio' || type === 'checkbox';
    const hiddenButLabelled = customOption && visibleLabelFor(field);

    if (!isVisible(field) && !hiddenButLabelled) return false;

    if (
      type === 'hidden' || type === 'file' || type === 'password' ||
      type === 'submit' || type === 'button' || type === 'reset' ||
      type === 'image' || type === 'search' || type === 'range' ||
      type === 'color'
    ) {
      return false;
    }

    if (field.tagName.toLowerCase() === 'select') {
      return field.options.length > 1;
    }

    const identity = (
      (field.name || '') + ' ' + (field.id || '') + ' ' +
      (field.getAttribute('autocomplete') || '')
    ).toLowerCase();

    if (/password|passcode|\botp\b|one-time|captcha|search/.test(identity)) {
      return false;
    }

    return true;
  }

  function fieldLabel(field) {
    const labelledBy = field.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(elementText)
        .join(' ');
      if (text) return text;
    }

    const ariaLabel = cleanQuestionText(field.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;

    if (field.labels && field.labels.length) {
      for (const label of field.labels) {
        const text = elementText(label);
        if (text) return text;
      }
    }

    let node = field;
    for (let depth = 0; depth < 5 && node; depth += 1) {
      let sibling = node.previousElementSibling;

      while (sibling) {
        if (
          !sibling.matches('input, textarea, select, button') &&
          !sibling.querySelector('input, textarea, select, button')
        ) {
          const text = elementText(sibling);
          if (text.length >= 3 && text.length <= 300) return text;
        }
        sibling = sibling.previousElementSibling;
      }

      node = node.parentElement;
    }

    const placeholder = cleanQuestionText(field.getAttribute('placeholder'));
    if (placeholder && !/^(enter|type|select|choose)\b/i.test(placeholder)) {
      return placeholder;
    }

    return humanizeFieldName(field.name || field.id || '');
  }

  /**
   * Radio/checkbox labels usually name the option, not the question. Walk out
   * until a non-option heading is found.
   */
  function groupQuestion(fields) {
    const first = fields[0];
    if (!first) return '';

    const fieldset = first.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) {
        const text = elementText(legend);
        if (text) return text;
      }
    }

    const labelled = first.closest('[role="radiogroup"], [role="group"]');
    if (labelled) {
      const ariaLabel = cleanQuestionText(labelled.getAttribute('aria-label'));
      if (ariaLabel) return ariaLabel;

      const labelledBy = labelled.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id))
          .filter(Boolean)
          .map(elementText)
          .join(' ');
        if (text) return text;
      }
    }

    let node = first.parentElement;

    for (let depth = 0; depth < 6 && node && node !== document.body; depth += 1) {
      for (const child of Array.from(node.childNodes)) {
        if (child === first || (child.nodeType === 1 && child.contains(first))) {
          break;
        }

        if (child.nodeType === 3) {
          const text = cleanQuestionText(child.textContent);
          if (text.length >= 3) return text;
        } else if (
          child.nodeType === 1 &&
          !child.matches('input, textarea, select, button') &&
          !child.querySelector('input, textarea, select, button')
        ) {
          const text = elementText(child);
          if (text.length >= 3 && text.length <= 300) return text;
        }
      }

      let sibling = node.previousElementSibling;
      while (sibling) {
        if (
          !sibling.matches('input, textarea, select, button') &&
          !sibling.querySelector('input, textarea, select, button')
        ) {
          const text = elementText(sibling);
          if (text.length >= 3 && text.length <= 300) return text;
        }
        sibling = sibling.previousElementSibling;
      }

      node = node.parentElement;
    }

    const name = humanizeFieldName(first.name || first.id || '');
    return name.length >= 3 ? name : '';
  }

  function optionText(field, question = '') {
    if (field.tagName.toLowerCase() === 'option') {
      return cleanQuestionText(field.textContent);
    }

    const questionKey = normalizeQuestion(question);
    const isQuestionLabel = (label) =>
      Boolean(questionKey) && normalizeQuestion(elementText(label)) === questionKey;

    const labels = field.labels ? Array.from(field.labels) : [];
    const wrapper = field.closest('label');
    if (wrapper && !labels.includes(wrapper)) labels.unshift(wrapper);

    // Option labels usually follow the input. A <label for> before it is more
    // likely the question heading (some forms point it at the first option).
    const ordered = labels
      .filter((label) => !isQuestionLabel(label))
      .sort((a, b) => {
        const aAfter = Boolean(
          field.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        const bAfter = Boolean(
          field.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
        );
        return Number(bAfter) - Number(aAfter);
      });

    for (const label of ordered) {
      const text = elementText(label);
      if (text && text.length <= 200) return text;
    }

    const next = field.nextElementSibling;
    if (next) {
      const text = elementText(next);
      if (text && text.length <= 200) return text;
    }

    const parent = field.parentElement;
    if (parent && parent.children.length <= 3) {
      const text = elementText(parent);
      if (text && text.length <= 200 && !isQuestionLabel(parent)) return text;
    }

    const value = cleanQuestionText(field.value);
    if (value && !/^(on|true|yes|1)$/i.test(value)) return value;

    return '';
  }

  function groupOptions(group) {
    if (group.type === 'select') {
      return Array.from(group.fields[0].options)
        .filter((option) => !option.disabled)
        .map((option) => cleanQuestionText(option.textContent))
        .filter((text) => text && !/^(select|choose|--|—)/i.test(text))
        .slice(0, 50);
    }

    if (group.type === 'radio' || group.type === 'checkbox') {
      return group.fields
        .map((field) => optionText(field, group.question))
        .filter(Boolean)
        .slice(0, 50);
    }

    return [];
  }

  function isRequiredField(field) {
    if (field.required) return true;
    if (field.getAttribute('aria-required') === 'true') return true;

    if (field.labels && Array.from(field.labels).some((label) => /\*/.test(label.textContent))) {
      return true;
    }

    const container = field.closest(
      '.form-group, .form-control, .input-group, .required, .field'
    );

    return Boolean(container && /\*/.test(elementText(container).slice(0, 300)));
  }

  /**
   * Prefer the form that actually holds the application questions. This keeps
   * the header search, newsletter box, and login modal from being treated as
   * application fields. Falls back to the whole page when the site does not
   * use a real <form> element.
   */
  function applicationScope() {
    const forms = Array.from(document.querySelectorAll('form')).filter(
      (form) => !form.closest('[data-internshala-saved-filters]')
    );

    let best = null;
    let bestCount = 0;

    for (const form of forms) {
      const count = Array.from(
        form.querySelectorAll('input, textarea, select')
      ).filter(isCandidateField).length;

      if (count > bestCount) {
        best = form;
        bestCount = count;
      }
    }

    return bestCount >= 2 ? best : document;
  }

  function collectFieldGroups() {
    const scope = applicationScope();
    const elements = Array.from(
      scope.querySelectorAll('input, textarea, select')
    ).filter(isCandidateField);

    const map = new Map();
    const ancestorKeys = new Map();
    let autoKey = 0;

    function optionGroupKey(field, type) {
      let node = field.parentElement;

      for (let depth = 0; depth < 5 && node && node !== document.body; depth += 1) {
        const siblings = node.querySelectorAll('input[type="' + type + '"]');
        if (siblings.length > 1) {
          if (!ancestorKeys.has(node)) {
            ancestorKeys.set(node, type + '-group:' + ancestorKeys.size);
          }
          return ancestorKeys.get(node);
        }
        node = node.parentElement;
      }

      return null;
    }

    for (const field of elements) {
      const type = fieldType(field);
      if (!type) continue;

      let key;

      if ((type === 'radio' || type === 'checkbox') && field.name) {
        key = type + ':' + (field.form ? field.form.id || 'form' : '') + ':' + field.name;
      } else if (type === 'radio' || type === 'checkbox') {
        key = optionGroupKey(field, type);
      }

      if (!key) {
        if (field.id) {
          key = 'id:' + field.id;
        } else if (field.name) {
          key = 'name:' + field.name;
        } else {
          key = 'field:' + autoKey;
          autoKey += 1;
        }
      }

      let group = map.get(key);
      if (!group) {
        group = { key, type, fields: [] };
        map.set(key, group);
      }
      group.fields.push(field);
    }

    const groups = [];

    for (const group of map.values()) {
      // A lone checkbox is usually consent, not a reusable answer.
      if (group.type === 'checkbox' && group.fields.length < 2) continue;

      const question = group.type === 'radio' || group.type === 'checkbox'
        ? groupQuestion(group.fields)
        : fieldLabel(group.fields[0]);

      const normalized = normalizeQuestion(question);
      if (!normalized || normalized.length < 2) continue;
      if (SENSITIVE_QUESTION.test(question)) continue;

      groups.push({
        key: group.key,
        type: group.type,
        fields: group.fields,
        question: cleanQuestionText(question),
        normalized,
        options: groupOptions(group),
        required: group.fields.some(isRequiredField)
      });
    }

    return groups;
  }

  function typesCompatible(savedType, fieldTypeValue) {
    if (savedType === fieldTypeValue) return true;
    if (TEXT_LIKE_TYPES.has(savedType) && TEXT_LIKE_TYPES.has(fieldTypeValue)) {
      return true;
    }
    if (OPTION_TYPES.has(savedType) && OPTION_TYPES.has(fieldTypeValue)) {
      return true;
    }
    return false;
  }

  function setNativeValue(field, value) {
    const prototype = field.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : field.tagName.toLowerCase() === 'select'
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }

    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function flashField(field) {
    const target = isVisible(field) ? field : visibleLabelFor(field) || field;
    const previousOutline = target.style.outline;
    const previousOffset = target.style.outlineOffset;

    target.style.outline = '2px solid rgba(23, 166, 115, 0.55)';
    target.style.outlineOffset = '2px';

    window.setTimeout(() => {
      target.style.outline = previousOutline;
      target.style.outlineOffset = previousOffset;
    }, 2200);
  }

  function optionMatches(option, answer, question = '') {
    const wanted = normalizeQuestion(answer);
    if (!wanted) return false;

    return (
      (typeof option === 'string' && normalizeQuestion(option) === wanted) ||
      normalizeQuestion(optionText(option, question)) === wanted ||
      normalizeQuestion(option.value || '') === wanted
    );
  }

  function fillText(field, answer) {
    const value = typeof answer === 'string' ? answer.trim() : '';
    if (!value) return false;

    const previousAuto = autoFilledValues.get(field);
    if (field.value.trim() && field.value !== previousAuto) {
      return true; // Never overwrite something the user typed.
    }

    setNativeValue(field, value);
    autoFilledValues.set(field, value);
    flashField(field);
    return true;
  }

  function fillSelect(field, answer, question = '') {
    const wanted = normalizeQuestion(answer);
    if (!wanted) return false;

    const selected = field.options[field.selectedIndex];
    const selectedText = selected ? normalizeQuestion(selected.textContent) : '';
    const selectedValue = selected ? normalizeQuestion(selected.value) : '';

    if (
      field.value &&
      selected &&
      !/^(select|choose|--|—)$/i.test(cleanQuestionText(selected.textContent)) &&
      field.value !== autoFilledValues.get(field)
    ) {
      return selectedText === wanted || selectedValue === wanted;
    }

    const option = Array.from(field.options).find(
      (item) => !item.disabled && !item.hidden && optionMatches(item, answer, question)
    );

    if (!option) return false;

    setNativeValue(field, option.value);
    autoFilledValues.set(field, option.value);
    flashField(field);
    return true;
  }

  function fillRadio(fields, answer, question = '') {
    const wanted = normalizeQuestion(answer);
    if (!wanted) return false;

    const option = fields.find(
      (field) => optionMatches(field, answer, question)
    );

    if (!option) return false;
    if (option.checked) return true;

    // If the user already chose a different option, leave it alone.
    if (fields.some((field) => field.checked)) return true;

    option.click();
    if (!option.checked) {
      option.checked = true;
      option.dispatchEvent(new Event('input', { bubbles: true }));
      option.dispatchEvent(new Event('change', { bubbles: true }));
    }

    autoFilledValues.set(option, '1');
    flashField(option);
    return true;
  }

  function fillCheckboxes(fields, answer, question = '') {
    const answers = (Array.isArray(answer) ? answer : [answer])
      .map((value) => normalizeQuestion(value))
      .filter(Boolean);

    if (!answers.length) return false;

    let matched = 0;

    for (const field of fields) {
      const text = normalizeQuestion(optionText(field, question));
      const value = normalizeQuestion(field.value || '');

      if (answers.includes(text) || answers.includes(value)) {
        matched += 1;
        if (!field.checked) {
          field.click();
          if (!field.checked) {
            field.checked = true;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
          autoFilledValues.set(field, '1');
          flashField(field);
        }
      }
    }

    return matched > 0 || fields.some((field) => field.checked);
  }

  function fillGroup(group, answer) {
    if (!group || !group.fields.length) return false;

    if (TEXT_LIKE_TYPES.has(group.type)) {
      return fillText(group.fields[0], answer);
    }

    if (group.type === 'select') {
      return fillSelect(group.fields[0], answer, group.question);
    }

    if (group.type === 'radio') {
      return fillRadio(group.fields, answer, group.question);
    }

    if (group.type === 'checkbox') {
      return fillCheckboxes(group.fields, answer, group.question);
    }

    return false;
  }

  function groupCurrentValue(group) {
    if (TEXT_LIKE_TYPES.has(group.type)) {
      return cleanQuestionText(group.fields[0].value);
    }

    if (group.type === 'select') {
      const field = group.fields[0];
      const option = field.options[field.selectedIndex];
      const text = option ? cleanQuestionText(option.textContent) : '';
      return /^(select|choose|--|—)$/i.test(text) ? '' : text;
    }

    if (group.type === 'radio') {
      const checked = group.fields.find((field) => field.checked);
      return checked ? optionText(checked, group.question) : '';
    }

    if (group.type === 'checkbox') {
      return group.fields
        .filter((field) => field.checked)
        .map((field) => optionText(field, group.question))
        .filter(Boolean);
    }

    return '';
  }

  function hasVisibleFileInput() {
    return Array.from(document.querySelectorAll('input[type="file"]')).some(isVisible);
  }

  function hasVisibleCaptcha() {
    return Array.from(
      document.querySelectorAll(
        'iframe[src*="recaptcha"], .g-recaptcha, [data-sitekey], [class*="captcha"]'
      )
    ).some((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  /**
   * Scans the current application form. Safe to call repeatedly: it only
   * fills empty fields, never overwrites user input.
   */
  function scanApplicationForm({ force = false } = {}) {
    if (!applicationPage && !force) return null;

    const groups = collectFieldGroups();
    if (!groups.length) {
      pendingQuestions = [];
      qcardSignature = '';
      renderQuestionCard();
      return { filled: 0, matched: 0, groups: 0, groupList: [], pending: 0, blockers: [] };
    }

    const passwordFields = Array.from(
      document.querySelectorAll('input[type="password"]')
    ).filter(isVisible);

    const hasApplicationControls = groups.some(
      (group) =>
        group.type === 'textarea' ||
        group.type === 'select' ||
        group.type === 'radio' ||
        group.type === 'checkbox' ||
        group.fields.length > 1
    );

    // A login modal is not an application form.
    if (passwordFields.length && !hasApplicationControls) {
      pendingQuestions = [];
      qcardSignature = '';
      renderQuestionCard();
      return { filled: 0, matched: 0, groups: 0, groupList: [], pending: 0, blockers: ['login'] };
    }

    const signature = groups
      .map((group) => group.normalized + ':' + group.type + ':' + group.required)
      .join('|');

    if (
      !force &&
      signature === lastFormSignature &&
      Date.now() - lastFormScanAt < 3000
    ) {
      return null;
    }

    if (signature !== lastFormSignature) {
      skippedQuestionKeys = new Set();
      qcardDismissed = false;
    }

    lastFormSignature = signature;
    lastFormScanAt = Date.now();

    let filled = 0;
    let matched = 0;
    const pending = [];
    const questionCounts = new Map();

    for (const group of groups) {
      questionCounts.set(
        group.normalized,
        (questionCounts.get(group.normalized) || 0) + 1
      );
    }

    for (const group of groups) {
      if (skippedQuestionKeys.has(group.key)) continue;

      if ((questionCounts.get(group.normalized) || 0) > 1) {
        pending.push({ group, saved: null, reason: 'ambiguous' });
        continue;
      }

      const saved = findSavedAnswer(group.question);

      if (saved && typesCompatible(saved.type, group.type)) {
        if (fillGroup(group, saved.answer)) {
          filled += 1;
          matched += 1;
          if (!usedAnswerIds.has(saved.id)) {
            usedAnswerIds.add(saved.id);
            markAnswerUsed(saved);
          }
        } else if (group.required) {
          pending.push({ group, saved, reason: 'option' });
        }
        continue;
      }

      const current = groupCurrentValue(group);
      const alreadyAnswered = Array.isArray(current)
        ? current.length > 0
        : Boolean(current);

      const worthPrompting =
        group.required ||
        alreadyAnswered ||
        group.type === 'textarea' ||
        group.type === 'select' ||
        group.type === 'radio' ||
        group.type === 'checkbox';

      if (saved || worthPrompting) {
        pending.push({
          group,
          saved,
          reason: saved ? 'type' : alreadyAnswered ? 'confirm' : 'unknown'
        });
      }
    }

    const blockers = [];
    if (hasVisibleFileInput()) {
      blockers.push('Choose your resume or any other file yourself; extensions cannot attach files.');
    }
    if (hasVisibleCaptcha()) {
      blockers.push('Complete the CAPTCHA manually before submitting.');
    }

    pendingQuestions = pending.slice(0, 20);
    renderQuestionCard(blockers);

    return {
      filled,
      matched,
      groups: groups.length,
      groupList: groups,
      pending: pending.length,
      blockers
    };
  }

  function captureQuestionDrafts() {
    const drafts = new Map();

    for (const item of pendingQuestions) {
      const { group } = item;

      if (group.type === 'checkbox') {
        const checked = Array.from(
          el.qcardList.querySelectorAll(
            '[data-q-check="' + window.CSS.escape(group.key) + '"]:checked'
          )
        ).map((box) => box.value);
        drafts.set(group.key, checked);
        continue;
      }

      const input = el.qcardList.querySelector(
        '[data-q-key="' + window.CSS.escape(group.key) + '"]'
      );
      if (input) drafts.set(group.key, input.value);
    }

    return drafts;
  }

  function renderQuestionCard(blockers = []) {
    if (!uiReady) return;

    const pending = pendingQuestions;
    const signature = pending
      .map((item) => item.group.key + ':' + item.reason)
      .concat(blockers)
      .join('|');

    if (signature === qcardSignature && !el.qcard.hidden) {
      return;
    }

    const drafts = qcardSignature ? captureQuestionDrafts() : new Map();
    qcardSignature = signature;

    if (!pending.length && !blockers.length) {
      el.qcard.hidden = true;
      el.qcardList.replaceChildren();
      el.fabCount.hidden = true;
      return;
    }

    if (qcardDismissed) {
      el.qcard.hidden = true;
      el.fabCount.hidden = pending.length === 0;
      if (pending.length) el.fabCount.textContent = String(pending.length);
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const message of blockers) {
      const note = document.createElement('p');
      note.className = 'isf-qcard-sub';
      note.textContent = message;
      fragment.appendChild(note);
    }

    if (!pending.length) {
      el.qcardList.replaceChildren(fragment);
      el.qcardSub.textContent = 'Everything else is ready. Review the form before submitting.';
      el.qcard.hidden = false;
      el.fabCount.hidden = blockers.length === 0;
      if (blockers.length) el.fabCount.textContent = '!';
      return;
    }

    el.qcardSub.textContent =
      pending.length +
      ' question' + (pending.length === 1 ? '' : 's') +
      ' can be saved and reused. Fill the ones you want, then choose Save answer.';

    for (const item of pending.slice(0, 12)) {
      const { group, saved, reason } = item;

      const wrapper = document.createElement('div');
      wrapper.className = 'isf-q-item';

      const label = document.createElement('label');
      label.className = 'isf-q-question';
      label.textContent = group.question;
      if (!group.required) {
        const optional = document.createElement('span');
        optional.className = 'isf-q-optional';
        optional.textContent = '  (optional)';
        label.appendChild(optional);
      }

      let input;

      if (group.type === 'textarea') {
        input = document.createElement('textarea');
        input.className = 'isf-textarea';
        input.rows = 3;
      } else if (group.type === 'select' || group.type === 'radio') {
        input = document.createElement('select');
        input.className = 'isf-input';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Choose an answer';
        input.appendChild(placeholder);

        for (const option of group.options) {
          const choice = document.createElement('option');
          choice.value = option;
          choice.textContent = option;
          input.appendChild(choice);
        }
      } else if (group.type === 'checkbox') {
        input = document.createElement('div');
        for (const option of group.options) {
          const row = document.createElement('label');
          row.className = 'isf-check-row';

          const box = document.createElement('input');
          box.type = 'checkbox';
          box.value = option;
          box.dataset.qCheck = group.key;

          const text = document.createElement('span');
          text.textContent = option;

          row.append(box, text);
          input.appendChild(row);
        }
      } else {
        input = document.createElement('input');
        input.className = 'isf-input';
        input.type = group.type === 'number' ? 'text' : group.type;
        if (group.type === 'email') input.autocomplete = 'email';
      }

      if (input.matches('input, textarea, select')) {
        input.dataset.qKey = group.key;
        if (!input.id) input.id = 'isf-q-' + group.key.replace(/[^a-z0-9_-]/gi, '-');
        label.htmlFor = input.id;
      }

      const current = drafts.get(group.key);
      const initial = current !== undefined
        ? current
        : saved && typesCompatible(saved.type, group.type)
          ? saved.answer
          : groupCurrentValue(group);

      if (group.type === 'checkbox') {
        const values = Array.isArray(initial)
          ? initial.map((value) => normalizeQuestion(value))
          : [];
        input.querySelectorAll('input[type="checkbox"]').forEach((box) => {
          box.checked = values.includes(normalizeQuestion(box.value));
        });
      } else if (group.type === 'select' || group.type === 'radio') {
        const value = typeof initial === 'string' ? initial : '';
        const match = Array.from(input.options).find(
          (option) => normalizeQuestion(option.value) === normalizeQuestion(value)
        );
        input.value = match ? match.value : '';
      } else if (typeof initial === 'string') {
        input.value = initial;
      }

      const actions = document.createElement('div');
      actions.className = 'isf-q-actions';

      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'isf-btn isf-btn-ghost';
      skip.textContent = 'Skip';
      skip.addEventListener('click', () => {
        skippedQuestionKeys.add(group.key);
        pendingQuestions = pendingQuestions.filter(
          (entry) => entry.group.key !== group.key
        );
        qcardSignature = '';
        renderQuestionCard(blockers);
      });

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'isf-btn isf-btn-primary';
      save.textContent = reason === 'confirm' ? 'Save this answer' : 'Save answer';
      save.addEventListener('click', () => {
        const value = group.type === 'checkbox'
          ? Array.from(input.querySelectorAll('input[type="checkbox"]:checked'))
              .map((box) => box.value)
          : input.value;
        saveQuestionAnswer(group, value);
      });

      actions.append(skip, save);
      wrapper.append(label, input, actions);
      fragment.appendChild(wrapper);
    }

    if (pending.length > 12) {
      const more = document.createElement('p');
      more.className = 'isf-qcard-sub';
      more.textContent =
        (pending.length - 12) + ' more question(s) will appear after these are handled.';
      fragment.appendChild(more);
    }

    el.qcardList.replaceChildren(fragment);
    el.qcard.hidden = false;

    el.fabCount.hidden = false;
    el.fabCount.textContent = String(pending.length);
  }

  async function saveQuestionAnswer(group, rawValue) {
    const value = Array.isArray(rawValue)
      ? rawValue.filter(Boolean)
      : String(rawValue || '').trim();

    if (Array.isArray(value) ? value.length === 0 : !value) {
      toast('Enter an answer first');
      return;
    }

    const record = await saveAnswer({
      question: group.question,
      type: group.type,
      answer: value,
      options: group.options
    });

    if (!record) {
      toast('Could not save that answer');
      return;
    }

    fillGroup(group, value);
    pendingQuestions = pendingQuestions.filter(
      (entry) => entry.group.key !== group.key
    );
    qcardSignature = '';
    renderQuestionCard();
    toast('Answer saved for next time');
  }

  function startAnswerAssistant() {
    if (!applicationPage) return;

    if (answerObserver) answerObserver.disconnect();

    let lastScanAt = 0;

    const run = () => {
      formScanTimer = 0;
      lastScanAt = Date.now();

      try {
        scanApplicationForm();
      } catch (error) {
        console.warn('[Saved filters] Could not scan application form:', error);
      }
    };

    const schedule = () => {
      // A page that mutates continuously must not starve the scan.
      if (formScanTimer && Date.now() - lastScanAt > 2000) {
        window.clearTimeout(formScanTimer);
        run();
        return;
      }

      window.clearTimeout(formScanTimer);
      formScanTimer = window.setTimeout(run, 650);
    };

    answerObserver = new MutationObserver(schedule);
    answerObserver.observe(document.body, { childList: true, subtree: true });
    schedule();
  }

  function switchTab(tab) {
    if (tab !== 'filters' && tab !== 'apply' && tab !== 'answers') tab = 'answers';
    if (tab === 'filters' && !listSection) {
      tab = detailSection || applicationPage ? 'apply' : 'answers';
    }

    activeTab = tab;
    render();
  }

  function openPanel() {
    panelOpen = true;
    el.panel.hidden = false;
    el.fab.setAttribute('aria-expanded', 'true');
    el.resume.hidden = true;

    if (queueState.active && (applicationPage || detailSection)) {
      activeTab = 'apply';
    }

    if (applicationPage && pendingQuestions.length) {
      qcardDismissed = false;
      renderQuestionCard();
    }

    render();
    if (applicationPage && queueState.active) renderReviewCard();
  }

  function closePanel() {
    panelOpen = false;
    el.panel.hidden = true;
    el.fab.setAttribute('aria-expanded', 'false');
    render();
  }

  function showSaveForm() {
    if (!listSection || !isFilteredSearch(listSection)) return;

    el.saveForm.hidden = false;
    el.saveCurrent.hidden = true;
    el.presetName.value = deriveName(listSection);
    el.presetName.focus();
    el.presetName.select();
  }

  function hideSaveForm() {
    el.saveForm.hidden = true;
    el.saveCurrent.hidden = false;
  }

  function saveCurrentSearch(rawName) {
    if (!listSection || !isFilteredSearch(listSection)) {
      toast('Apply at least one filter first');
      return;
    }

    const url = cleanUrl(location.href);
    if (!url) return;

    const name = (rawName || '').trim().slice(0, 60) || deriveName(listSection, url);
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
        section: listSection,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      message = 'Search saved';
    }

    state.last[listSection] = { url, name, savedAt: Date.now() };
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
          typeof preset.id === 'string' && preset.id
            ? preset.id.slice(0, 120)
            : uid();
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

    if (!listSection) {
      const empty = document.createElement('p');
      empty.className = 'isf-empty';
      empty.textContent =
        'Saved searches are available on Internshala internship and job search pages.';
      el.groups.appendChild(empty);
      return;
    }

    const other = listSection === 'internships' ? 'jobs' : 'internships';
    const order = [listSection, other];

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

  function answerPreview(entry) {
    if (Array.isArray(entry.answer)) return entry.answer.join(', ');
    return entry.answer;
  }

  function answerMatches(entry, query) {
    const normalized = normalizeQuestion(query);
    if (!normalized) return true;

    return (
      entry.normalized.includes(normalized) ||
      answerPreview(entry).toLowerCase().includes(normalized)
    );
  }

  function openAnswerEditor(entry, row) {
    const form = document.createElement('form');
    form.className = 'isf-answer-edit';

    const question = document.createElement('div');
    question.className = 'isf-answer-q';
    question.textContent = entry.question;

    const textarea = document.createElement('textarea');
    textarea.className = 'isf-textarea';
    textarea.rows = 3;
    textarea.value = Array.isArray(entry.answer)
      ? entry.answer.join('\n')
      : entry.answer;
    textarea.setAttribute(
      'aria-label',
      'Answer for ' + entry.question
    );

    const actions = document.createElement('div');
    actions.className = 'isf-form-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'isf-btn isf-btn-ghost';
    cancel.textContent = 'Cancel';

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'isf-btn isf-btn-primary';
    save.textContent = 'Save';

    actions.append(cancel, save);
    form.append(question, textarea, actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const raw = textarea.value.trim();
      if (!raw) {
        textarea.focus();
        return;
      }

      const answer = entry.type === 'checkbox'
        ? raw.split(/\n|,/).map((value) => value.trim()).filter(Boolean)
        : raw;

      save.disabled = true;
      const saved = await saveAnswer({
        id: entry.id,
        question: entry.question,
        type: entry.type,
        answer,
        options: entry.options
      });
      save.disabled = false;

      if (saved) {
        render();
        toast('Answer updated');
      }
    });

    cancel.addEventListener('click', render);

    row.replaceChildren(form);
    textarea.focus();
  }

  function makeAnswerRow(entry) {
    const item = document.createElement('div');
    item.className = 'isf-answer';

    const head = document.createElement('div');
    head.className = 'isf-answer-head';

    const question = document.createElement('div');
    question.className = 'isf-answer-q';
    question.textContent = entry.question;

    const actions = document.createElement('div');
    actions.className = 'isf-answer-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'isf-icon-btn';
    edit.setAttribute('aria-label', 'Edit answer for ' + entry.question);
    edit.title = 'Edit';
    edit.innerHTML = ICONS.pencil;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'isf-icon-btn isf-delete';
    remove.setAttribute('aria-label', 'Delete answer for ' + entry.question);
    remove.title = 'Delete';
    remove.innerHTML = ICONS.trash;

    actions.append(edit, remove);
    head.append(question, actions);

    const answer = document.createElement('div');
    answer.className = 'isf-answer-a';
    answer.textContent = answerPreview(entry);

    const meta = document.createElement('div');
    meta.className = 'isf-answer-meta';
    meta.textContent =
      entry.type +
      (entry.uses ? ' · used ' + entry.uses + ' time' + (entry.uses === 1 ? '' : 's') : '') +
      ' · saved ' + relativeTime(entry.updatedAt);

    edit.addEventListener('click', () => openAnswerEditor(entry, item));

    remove.addEventListener('click', async () => {
      if (!window.confirm('Delete the saved answer for "' + entry.question + '"?')) return;
      const saved = await deleteAnswer(entry.id);
      if (saved) {
        toast('Answer deleted');
      }
    });

    item.append(head, answer, meta);
    return item;
  }

  function renderAnswers() {
    if (!answersLoaded) {
      el.answerList.replaceChildren();
      el.answerEmpty.hidden = false;
      el.answerEmpty.textContent = 'Loading saved answers…';
      el.answerCount.textContent = '0';
      el.answerCount.hidden = true;
      el.answerCountLabel.textContent = 'Loading…';
      return;
    }

    const count = answersState.answers.length;
    el.answerCount.textContent = String(count);
    el.answerCount.hidden = count === 0;
    el.answerCountLabel.textContent =
      count + ' saved answer' + (count === 1 ? '' : 's');
    el.clearAnswers.disabled = count === 0;

    // The shadow root is open, so page scripts can read it. Keep saved answers
    // out of the DOM unless the user is actually looking at them.
    if (!panelOpen || activeTab !== 'answers') {
      el.answerList.replaceChildren();
      el.answerEmpty.hidden = true;
      return;
    }

    const query = el.answerSearch.value;
    const filtered = answersState.answers.filter((entry) => answerMatches(entry, query));

    el.answerList.replaceChildren();

    if (!filtered.length) {
      el.answerEmpty.hidden = false;
      el.answerEmpty.textContent = count
        ? 'No saved answers match that search.'
        : 'No saved answers yet. Fill an application question and choose “Save answer” to reuse it next time.';
      return;
    }

    el.answerEmpty.hidden = true;

    for (const entry of filtered) {
      el.answerList.appendChild(makeAnswerRow(entry));
    }
  }

  function renderTabs() {
    if (!uiReady) return;

    if (!listSection && activeTab === 'filters') {
      activeTab = detailSection || applicationPage ? 'apply' : 'answers';
    }

    const filtersActive = activeTab === 'filters';
    const applyActive = activeTab === 'apply';
    const answersActive = activeTab === 'answers';

    el.tabFilters.disabled = !listSection;
    el.tabFilters.classList.toggle('is-active', filtersActive);
    el.tabApply.classList.toggle('is-active', applyActive);
    el.tabAnswers.classList.toggle('is-active', answersActive);
    el.tabFilters.setAttribute('aria-selected', String(filtersActive));
    el.tabApply.setAttribute('aria-selected', String(applyActive));
    el.tabAnswers.setAttribute('aria-selected', String(answersActive));

    el.viewFilters.hidden = !filtersActive;
    el.viewApply.hidden = !applyActive;
    el.viewAnswers.hidden = !answersActive;

    if (listSection) {
      el.brandTitle.textContent = 'Saved filters';
      el.brandSub.textContent = 'search, apply, and answers';
      el.fabText.textContent = 'Saved filters';
    } else if (queueState.active) {
      el.brandTitle.textContent = queueState.paused ? 'Apply queue paused' : 'Apply queue';
      el.brandSub.textContent = queueState.paused
        ? 'your progress is saved'
        : 'one application at a time';
      el.fabText.textContent = queueState.paused ? 'Resume applications' : 'Apply queue';
    } else if (detailSection) {
      el.brandTitle.textContent = 'Apply helper';
      el.brandSub.textContent = 'one listing at a time';
      el.fabText.textContent = 'Apply helper';
    } else {
      el.brandTitle.textContent = 'Application answers';
      el.brandSub.textContent = 'saved on this device';
      el.fabText.textContent = 'Application answers';
    }

    if (applicationPage) {
      el.answersHint.textContent =
        'Answers are filled automatically on this application form. New questions appear in the card at the bottom right.';
    } else if (detailSection) {
      el.answersHint.textContent =
        'Saved answers will be filled when you open an application form. Manage them here.';
    } else {
      el.answersHint.textContent =
        'Answers are saved on this device and filled into matching application questions. Nothing is sent anywhere.';
    }
  }

  function appendApplyLine(parent, label, value, warn = false) {
    const row = document.createElement('div');
    row.className = 'isf-review-line' + (warn ? ' is-warn' : '');

    const key = document.createElement('b');
    key.textContent = label;

    const text = document.createElement('span');
    text.textContent = value;

    row.append(key, text);
    parent.appendChild(row);
  }

  function renderApply() {
    if (!uiReady) return;

    const items = queueState.items;
    const pending = items.filter((item) => item.status === 'pending');
    const done = items.filter((item) => item.status === 'done');
    const current = currentQueueItem();
    const listings = listSection && !queueState.active ? scanListingItems() : [];
    const capUsed = appliedInLastDay().length;

    el.applyMode.value = applySettings.mode || 'review';
    el.applyCount.hidden = pending.length === 0;
    if (pending.length) el.applyCount.textContent = String(pending.length);

    let headline = '';
    let detail = '';

    if (queueIsRunning()) {
      headline = 'Applying ' + Math.min(done.length + 1, items.length) +
        ' of ' + items.length;
      detail = current
        ? 'Reviewing “' + current.title + '”. One application at a time.'
        : 'Preparing the next application…';
    } else if (queueState.paused) {
      headline = 'Queue paused';
      detail = applyMessage || 'Press Resume to continue. Your progress is saved.';
    } else if (queueState.active) {
      headline = 'Apply queue';
      detail = applyMessage || 'Preparing the queue…';
    } else if (listSection) {
      headline = listings.length
        ? listings.length + ' listing' + (listings.length === 1 ? '' : 's') + ' on this page'
        : 'No listings found on this page';
      detail = pending.length
        ? pending.length + ' application' + (pending.length === 1 ? '' : 's') +
          ' waiting in the saved queue.'
        : 'Queue the listings, then review each application before submitting.';
    } else if (items.length && !pending.length) {
      headline = 'Queue finished';
      detail = applyMessage || 'Every queued listing has been processed.';
    } else if (pending.length) {
      headline = pending.length + ' application' + (pending.length === 1 ? '' : 's') + ' queued';
      detail = current
        ? 'Next: “' + current.title + '”. Press Resume to continue.'
        : 'Press Resume to continue the queue.';
    } else {
      headline = 'No apply queue';
      detail = 'Open an Internshala search page to queue listings.';
    }

    if (applyMessage && !queueState.paused) detail = applyMessage;

    const status = document.createElement('div');
    status.className = 'isf-apply-status';

    const strong = document.createElement('strong');
    strong.textContent = headline;

    const small = document.createElement('small');
    small.textContent = detail;

    status.appendChild(strong);
    status.appendChild(small);

    if (items.length) {
      const progress = document.createElement('div');
      progress.className = 'isf-progress';
      progress.setAttribute('role', 'progressbar');
      progress.setAttribute('aria-valuemin', '0');
      progress.setAttribute('aria-valuemax', String(items.length));
      progress.setAttribute('aria-valuenow', String(done.length));

      const bar = document.createElement('span');
      bar.style.width = Math.round((done.length / items.length) * 100) + '%';
      progress.appendChild(bar);
      status.appendChild(progress);
    }

    const cap = document.createElement('small');
    cap.style.marginTop = '6px';
    cap.textContent = capUsed + ' of ' + DAILY_APPLY_CAP +
      ' applications used in the last 24 hours.';
    status.appendChild(cap);

    el.applyStatus.replaceChildren(status);

    el.applyHint.textContent = applicationPage
      ? 'Review the filled form and press Submit application when you are ready. Nothing is submitted automatically.'
      : detailSection
        ? 'The assistant opens the application form for the current listing, then waits for your review.'
        : 'Queue the listings on this page. Each form opens for you to review before anything is submitted.';

    el.applyStart.hidden = !(listSection && !queueState.active);
    el.applyRescan.hidden = !(listSection && !queueState.active);
    el.applyResume.hidden = !(queueState.paused || (!queueState.active && pending.length > 0));
    el.applyStop.hidden = !(queueState.active && !queueState.paused);
    el.applySkip.hidden = !(
      queueIsRunning() && current && (detailSection || applicationPage)
    );
    el.applyReview.hidden = !(
      applicationPage && queueIsRunning() && current && reviewDismissed
    );
    el.applyClear.hidden = queueState.active || items.length === 0;
    el.applyHistory.hidden = queueState.active || appliedState.entries.length === 0;

    const preview = listSection && !queueState.active;

    el.applyListLabel.hidden = preview
      ? listings.length === 0
      : items.length === 0;

    if (preview) {
      el.applyListLabel.textContent =
        'Listings on this page (' + listings.length + ')';
    } else {
      el.applyListLabel.textContent =
        'Queue (' + done.length + ' of ' + items.length + ' done)';
    }

    const fragment = document.createDocumentFragment();
    const rows = preview
      ? listings.slice(0, 10).map((listing) => ({
          title: listing.title,
          url: listing.url,
          status: isAppliedUrl(listing.url)
            ? 'applied'
            : queueState.items.some(
                (item) =>
                  item.url === listing.url &&
                  (item.status === 'pending' || item.status === 'failed')
              )
              ? 'queued'
              : 'new'
        }))
      : items.slice(0, 12).map((item) => ({
          title: item.title,
          url: item.url,
          status: item.status,
          note: item.note,
          current: current && current.id === item.id
        }));

    for (const row of rows) {
      const entry = document.createElement('li');
      entry.className = 'isf-queue-item';

      const dot = document.createElement('span');
      dot.className = 'isf-queue-state';
      if (row.status === 'done' || row.status === 'applied') dot.classList.add('is-done');
      if (row.status === 'current' || row.current) dot.classList.add('is-current');
      if (row.status === 'failed') dot.classList.add('is-bad');
      dot.setAttribute('aria-hidden', 'true');

      const copy = document.createElement('span');
      copy.className = 'isf-queue-copy';

      const title = document.createElement('span');
      title.className = 'isf-queue-title';
      title.textContent = row.title;

      const meta = document.createElement('span');
      meta.className = 'isf-queue-meta';
      meta.textContent =
        row.status === 'done'
          ? (row.note || 'Submitted')
          : row.status === 'skipped'
            ? 'Skipped'
            : row.status === 'failed'
              ? (row.note || 'Needs attention')
              : row.status === 'applied'
                ? 'Already applied'
                : row.status === 'queued'
                  ? 'In queue'
                  : row.current
                    ? 'Current application'
                    : 'Ready to queue';

      copy.append(title, meta);
      entry.append(dot, copy);
      fragment.appendChild(entry);
    }

    if (!preview && items.length > 12) {
      const more = document.createElement('li');
      more.className = 'isf-queue-item';
      more.textContent = (items.length - 12) + ' more in the queue';
      fragment.appendChild(more);
    }

    el.applyList.replaceChildren(fragment);
  }

  function hideReviewCard() {
    if (!uiReady) return;
    el.review.hidden = true;
    el.review.classList.remove('is-busy');
    reviewSignature = '';
  }

  function renderReviewCard(readiness = null) {
    if (!uiReady) return;

    const item = currentQueueItem();
    if (!applicationPage || !queueIsRunning() || !item) {
      hideReviewCard();
      return;
    }

    if (reviewItemId !== item.id) {
      reviewItemId = item.id;
      reviewDismissed = false;
      showManualMark = false;
    }

    if (reviewDismissed) {
      hideReviewCard();
      return;
    }

    const state = readiness || applicationReadiness();

    const submitting = queueState.submittingId === item.id;

    // Page mutations retrigger this often; skip the DOM rebuild when nothing
    // the card shows has changed.
    const signature = [
      item.id,
      submitting ? '1' : '0',
      state.ready ? '1' : '0',
      String(state.required),
      String(state.answered),
      String(state.pending),
      state.blockers.join('|'),
      state.warnings.join('|')
    ].join('\u0000');

    if (signature === reviewSignature && !el.review.hidden) return;
    reviewSignature = signature;

    el.reviewTitle.textContent = submitting
      ? 'Submitting application…'
      : 'Review your application';

    const fragment = document.createDocumentFragment();

    appendApplyLine(fragment, 'Listing', item.title);
    appendApplyLine(
      fragment,
      'Questions',
      state.required
        ? state.answered + ' of ' + state.required + ' required answered'
        : 'No required questions detected'
    );

    if (state.pending) {
      appendApplyLine(
        fragment,
        'Open',
        state.pending + ' question' + (state.pending === 1 ? '' : 's') + ' in the card',
        true
      );
    }

    for (const blocker of state.blockers) {
      appendApplyLine(fragment, 'Before', blocker, true);
    }

    for (const warning of state.warnings) {
      appendApplyLine(fragment, 'Note', warning);
    }

    appendApplyLine(
      fragment,
      'Status',
      submitting
        ? 'Waiting for Internshala to confirm…'
        : state.ready
          ? 'Nothing has been sent yet. Submit only if everything looks right.'
          : 'Not ready. Finish the items above first.'
    );

    el.reviewLines.replaceChildren(fragment);
    el.reviewSubmit.disabled = submitting || !state.ready;
    el.reviewSubmit.textContent = submitting
      ? 'Submitting…'
      : state.ready
        ? 'Submit application'
        : 'Answer the items first';

    el.reviewSkip.disabled = submitting;
    el.reviewRecheck.disabled = submitting;
    el.reviewMark.hidden = !showManualMark;
    el.reviewMark.disabled = submitting;
    el.review.classList.toggle('is-busy', submitting);
    el.review.hidden = false;
  }

  function renderFilters() {
    if (!listSection) {
      el.current.hidden = true;
      hideSaveForm();
      el.hint.hidden = false;
      el.hint.textContent =
        'Open an Internshala internship or job search page to save and restore filters here.';
      el.autoRestore.checked = state.autoRestore;
      renderPresets();
      return;
    }

    const filtered = isFilteredSearch(listSection);
    const hasPresets = state.presets.length > 0;

    el.current.hidden = !filtered;
    if (filtered) {
      el.currentName.textContent = deriveName(listSection);
    } else {
      hideSaveForm();
    }

    el.hint.textContent =
      'Apply your filters on this page, then save the search here. Next time it is one click.';
    el.hint.hidden = filtered || hasPresets;

    renderPresets();
    el.autoRestore.checked = state.autoRestore;
  }

  function render() {
    if (!uiReady) return;

    renderTabs();
    renderFilters();
    renderApply();
    renderAnswers();

    const presetsForSection = listSection
      ? state.presets.filter((preset) => preset.section === listSection)
      : [];
    const last = listSection ? state.last[listSection] : null;

    if (activeTab === 'filters' && listSection) {
      if (last) {
        el.lastSaved.textContent = 'Last used ' + relativeTime(last.savedAt);
        el.clearLast.hidden = false;
      } else {
        el.lastSaved.textContent = 'No search saved yet';
        el.clearLast.hidden = true;
      }
    } else if (activeTab === 'apply') {
      const pending = pendingQueueItems().length;
      const done = queueState.items.filter((item) => item.status === 'done').length;

      el.lastSaved.textContent = queueState.items.length
        ? done + ' of ' + queueState.items.length + ' done · ' +
          pending + ' pending'
        : 'No apply queue';
      el.clearLast.hidden = true;
    } else {
      const count = answersState.answers.length;
      el.lastSaved.textContent =
        count + ' saved answer' + (count === 1 ? '' : 's');
      el.clearLast.hidden = true;
    }

    const canResume = Boolean(
      listSection &&
      !panelOpen &&
      last &&
      isBasePage(listSection) &&
      !state.autoRestore
    );

    el.resume.hidden = !canResume;
    if (canResume) {
      el.resumeName.textContent = last.name;
    }

    if (pendingQuestions.length) {
      el.fabCount.hidden = false;
      el.fabCount.textContent = String(pendingQuestions.length);
    } else {
      el.fabCount.hidden = true;
    }

    if (listSection) {
      el.fab.title = presetsForSection.length
        ? presetsForSection.length + ' saved search' +
          (presetsForSection.length === 1 ? '' : 'es')
        : 'Save and restore search filters';
    } else if (queueState.active) {
      el.fab.title = queueState.paused
        ? 'Apply queue paused'
        : 'Assisted apply queue';
    } else if (applicationPage) {
      el.fab.title = pendingQuestions.length
        ? pendingQuestions.length + ' application question' +
          (pendingQuestions.length === 1 ? '' : 's')
        : 'Saved application answers';
    } else {
      el.fab.title = 'Apply helper';
    }
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

  el.tabFilters.addEventListener('click', () => switchTab('filters'));
  el.tabApply.addEventListener('click', () => switchTab('apply'));
  el.tabAnswers.addEventListener('click', () => switchTab('answers'));

  el.applyStart.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    startApplyQueue().catch((error) => {
      console.warn('[Saved filters] Could not start the apply queue:', error);
      toast('Could not start the apply queue');
    });
  });

  el.applyRescan.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    rescanApplyQueue().catch(() => toast('Could not rescan this page'));
  });

  el.applyResume.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    resumeApplyQueue().catch(() => toast('Could not resume the apply queue'));
  });

  el.applyStop.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    stopApplyQueue().catch(() => toast('Could not stop the apply queue'));
  });

  el.applySkip.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    skipCurrentApplication().catch(() => toast('Could not skip this application'));
  });

  el.applyReview.addEventListener('click', () => {
    reviewDismissed = false;
    renderReviewCard();
  });

  el.applyClear.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (!queueState.items.length) return;
    if (!window.confirm('Clear the saved apply queue? Applied history is kept.')) return;
    clearApplyQueue().catch(() => toast('Could not clear the apply queue'));
  });

  el.applyHistory.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (!appliedState.entries.length) return;
    if (
      !window.confirm(
        'Clear applied history?\n\n' +
        'Listings will be offered again in future queues.'
      )
    ) {
      return;
    }

    persistApplied({ version: 1, entries: [] })
      .then((ok) => {
        if (!ok) return;
        applyMessage = '';
        render();
        toast('Applied history cleared');
      })
      .catch(() => toast('Could not clear applied history'));
  });

  el.applyMode.addEventListener('change', () => {
    persistApplySettings({
      version: 1,
      mode: el.applyMode.value === 'review' ? 'review' : 'review'
    }).catch(() => {});
  });

  el.resume.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const last = listSection ? state.last[listSection] : null;
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
    if (!listSection) return;
    delete state.last[listSection];
    const saved = persistOrRevert();
    render();

    if (saved) toast('Last search cleared');
  });

  el.groups.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
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

  el.exportData.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    exportBackup();
  });

  el.importData.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    el.importFile.click();
  });

  el.importFile.addEventListener('change', () => {
    const file = el.importFile.files && el.importFile.files[0];
    importBackup(file);
    el.importFile.value = '';
  });

  let answerSearchTimer = 0;

  el.answerSearch.addEventListener('input', () => {
    window.clearTimeout(answerSearchTimer);
    answerSearchTimer = window.setTimeout(renderAnswers, 150);
  });

  el.clearAnswers.addEventListener('click', async (event) => {
    if (!event.isTrusted) return;
    if (!answersState.answers.length) return;
    if (!window.confirm('Delete all saved application answers?')) return;

    const saved = await persistAnswers({ version: 1, answers: [] });
    if (saved) toast('Saved answers cleared');
  });

  el.qcardClose.addEventListener('click', () => {
    qcardDismissed = true;
    qcardSignature = '';
    el.qcard.hidden = true;
    render();
  });

  el.reviewClose.addEventListener('click', () => {
    reviewDismissed = true;
    hideReviewCard();
    toast('Review hidden. Use the Apply tab to bring it back.');
  });

  el.reviewRecheck.addEventListener('click', () => {
    scanApplicationForm({ force: true });
    showManualMark = false;

    if (queueState.submittingId && hasSubmissionSignal()) {
      const item = currentQueueItem();
      if (item) {
        completeApplication(item);
        return;
      }
    }

    renderReviewCard(applicationReadiness());
    renderApply();
    toast('Rechecked the form');
  });

  el.reviewSubmit.addEventListener('click', (event) => {
    // A page script can reach the open shadow root and call click(); only a
    // real press may submit an application.
    if (!event.isTrusted) return;
    submitCurrentApplication().catch((error) => {
      console.warn('[Saved filters] Could not submit the application:', error);
      toast('Could not submit the application');
    });
  });

  el.reviewSkip.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    skipCurrentApplication().catch(() => toast('Could not skip this application'));
  });

  el.reviewMark.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    const item = currentQueueItem();
    if (!item) return;
    if (
      !window.confirm(
        'Mark “' + item.title + '” as applied?\n\n' +
        'Only do this if you submitted it yourself.'
      )
    ) {
      return;
    }

    markApplicationApplied(item).catch(() => toast('Could not record the application'));
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
    } else if (!el.qcard.hidden) {
      qcardDismissed = true;
      qcardSignature = '';
      el.qcard.hidden = true;
      render();
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
    if (event.key === null) {
      state = loadState();
      loadAnswers();
      render();
      return;
    }

    if (event.key === STORAGE_KEY) {
      state = loadState();
      render();
      return;
    }

    if (!usesExtensionStorage && event.key === ANSWERS_KEY) {
      loadAnswers();
    }
  });

  if (extensionStorage && typeof chrome !== 'undefined' && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (Object.prototype.hasOwnProperty.call(changes, ANSWERS_KEY)) {
        // Our own save already updated memory; skip the extra read and render.
        if (Date.now() - answersWrittenAt < 500) return;
        loadAnswers();
      }
    });
  }

  if (!document.body) return;

  async function boot() {
    try {
      await loadAnswers();
    } catch (error) {
      console.warn('[Saved filters] Could not load saved answers:', error);
    }

    try {
      await loadApplyData();
    } catch (error) {
      console.warn('[Saved filters] Could not load the apply queue:', error);
    }

    if (applicationPage && queueState.active) activeTab = 'apply';

    uiReady = true;
    document.body.appendChild(host);
    render();

    startAnswerAssistant();
    startApplyAssistant();
  }

  boot().catch((error) => {
    console.warn('[Saved filters] Could not start the panel:', error);
  });
})();
