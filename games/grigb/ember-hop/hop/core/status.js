// status.js — the read-only status object (04 section 6).
// Field names are the same in every engine, so one conformance runner can compare engines.
// On the web, window.hop.status returns a deep-frozen copy.
import { SPEC_VERSION } from './constants.js';
import { clone, deepFreeze } from './util.js';

/** The fields every connector exposes, with their starting values. */
export function initialStatus() {
  return {
    spec: SPEC_VERSION,
    state: 'idle',            // idle | ready | loading | arrived | refused | no-arrival
    mode: null,               // hop | vibejam
    game: null,               // { name, url, play }
    ladder: [],               // rungs this game will try, best first
    arrival: null,            // the raw link parameters
    character: null,          // { id, name, color, looks, lookUrls, items }
    rung: null,
    look: null,
    lookAttempts: [],         // { rung, look, ok, reason?, detail? }
    acceptedItems: [],
    refusedItems: [],         // { id, name, reason, message }
    itemUses: {},             // item id -> { allowed, reason } when the game gives items behavior
    integrity: 'n/a',         // checked | missing | mismatch | n/a
    returnUrl: null,
    reason: null,
    message: null,            // the plain sentence for `reason`
    ownership: null,          // { kind, usable, reason }
    permissionsSource: null,
    focus: null,              // { called, by, focused, element } after spawning
    errors: [],
    warnings: [],
    log: [],
    lastDepartLink: null,
    arrivalMs: null,
  };
}

/** A small store: patch() merges, snapshot() returns a frozen deep copy. */
export function createStatusStore({ quiet = false, logPrefix = '[hop] ' } = {}) {
  let s = initialStatus();
  return {
    patch(p) { s = { ...s, ...p }; },
    get(k) { return s[k]; },
    warn(text) { s = { ...s, warnings: [...s.warnings, text] }; },
    error(text) { s = { ...s, errors: [...s.errors, text] }; },
    log(text) {
      s = { ...s, log: [...s.log, text] };
      if (!quiet) try { console.log(logPrefix + text); } catch { /* ignore */ }
    },
    snapshot() { return deepFreeze(clone(s)); },
  };
}
