// ownership-bridge.js — how the core asks about ownership.
//
// Ownership is worker M5-B's module, src/ownership/index.js (Universal Manifest v0.4, option (b)):
//   await verifyManifest(manifestOrText, { now }) -> { valid, reason, detail, manifest }
//   checkPermission(manifest | null, { subjectId, facetId, use, now }) -> { allowed, reason, recordProblem? }
//   usesFor(kind, accepts) -> ['show', 'use'?, 'copy'?]
// subjectId is the absolute URL of the character file; facetId is '@character' or an item id.
// A null manifest means show-only. checkPermission only trusts the object verifyManifest returned.
//
// When src/ownership/index.js cannot be loaded, the core uses OWNERSHIP_STUB, which has the same
// API. THE STUB DOES NOT CHECK SIGNATURES and refuses every Universal Manifest as unreadable, so a
// missing module never grants anything. It exists so the core runs while the module is absent.
//
// Transition (M4-UNIVERSAL-MANIFEST-FIT section 5, item 4): for one milestone the core also reads
// the old small record (no "@type", a "rights" list), with the rules of 04 section 5. The old
// record proves nothing about who wrote it. Remove this path after M5.
import { USES } from './constants.js';

const CHARACTER_KEY = '@character';
const t = (s) => Date.parse(s);

/** The old small record: no "@type" and a "rights" list. */
export const isLegacyRecord = (rec) => !!rec && typeof rec === 'object' && !Array.isArray(rec) && !('@type' in rec) && Array.isArray(rec.rights);

/** Uses a game must check for an item kind: show always, use for accepts.useKinds, copy when accepts.keepsItems. */
export function localUsesFor(kind, accepts = {}) {
  const uses = ['show'];
  if (Array.isArray(accepts.useKinds) && accepts.useKinds.includes(kind)) uses.push('use');
  if (accepts.keepsItems === true) uses.push('copy');
  return uses;
}

export const OWNERSHIP_STUB = Object.freeze({
  source: 'STUB in src/core/ownership-bridge.js (src/ownership/index.js not loaded): Universal Manifests are refused as unreadable',
  isStub: true,
  async verifyManifest() { return { valid: false, reason: 'ownership-unreadable', detail: 'no ownership module loaded', manifest: null }; },
  checkPermission(m, { use } = {}) {
    if (!USES.includes(use)) return { allowed: false, reason: 'unknown-use' };
    if (m === null || m === undefined) return use === 'show' ? { allowed: true, reason: 'no-ownership-show-only' } : { allowed: false, reason: 'show-only' };
    return { allowed: false, reason: 'ownership-unreadable' };
  },
  usesFor: localUsesFor,
});

/** Loads src/ownership/index.js (or `override`), falling back to the stub. */
export async function loadOwnership(override) {
  const wrap = (m, source) => ({
    source,
    isStub: !!m.isStub,
    verifyManifest: m.verifyManifest.bind(m),
    checkPermission: m.checkPermission.bind(m),
    usesFor: typeof m.usesFor === 'function' ? m.usesFor.bind(m) : localUsesFor,
  });
  if (override) return wrap(override, override.source || 'injected module');
  try {
    const m = await import(new URL('../ownership/index.js', import.meta.url).href);
    if (typeof m.checkPermission === 'function' && typeof m.verifyManifest === 'function') return wrap(m, 'src/ownership/index.js');
  } catch { /* fall through to the stub */ }
  return OWNERSHIP_STUB;
}

/**
 * Decides what a fetched record can grant for this character.
 *   record: the parsed record, null (no ownership link) or { _unreadable: true } (fetch or parse failed)
 *   text:   the raw text when available (the ownership module refuses duplicate JSON keys from it)
 * Returns { kind: 'none'|'universal-manifest'|'legacy'|'unreadable', usable, reason, detail, manifest, record }.
 */
export async function evaluateRecord(mod, record, text, characterId, now = new Date()) {
  if (record === null || record === undefined) return { kind: 'none', usable: false, reason: null, manifest: null };
  if (record._unreadable) return { kind: 'unreadable', usable: false, reason: 'ownership-unreadable', detail: record.detail, manifest: null };
  if (isLegacyRecord(record)) {
    const n = now.getTime();
    const out = (usable, reason) => ({ kind: 'legacy', usable, reason, record, manifest: null });
    if (record.character !== characterId) return out(false, 'ownership-wrong-character');
    if (record.expiresAt && !(t(record.expiresAt) > n)) return out(false, 'ownership-expired');
    if (record.issuedAt && t(record.issuedAt) > n + 60000) return out(false, 'ownership-not-yet-valid');
    return out(true, null);
  }
  let v;
  try { v = await mod.verifyManifest(text ?? record, { now }); } catch (e) { v = { valid: false, reason: 'ownership-unreadable', detail: e.message }; }
  if (!v?.valid || !v.manifest) {
    const reason = /^ownership-/.test(v?.reason || '') ? v.reason : 'ownership-unreadable';
    return { kind: v?.manifest ? 'universal-manifest' : 'unreadable', usable: false, reason, detail: v?.detail, manifest: null };
  }
  // binding and freshness are part of checkPermission: ask about the character itself
  const c = mod.checkPermission(v.manifest, { subjectId: characterId, facetId: CHARACTER_KEY, use: 'show', now });
  if (c.recordProblem) return { kind: 'universal-manifest', usable: false, reason: c.recordProblem, detail: c.detail, manifest: null };
  return { kind: 'universal-manifest', usable: true, reason: null, detail: v.detail, manifest: v.manifest, characterShow: c };
}

/** May the character ('@character') or an item be used this way? Returns { allowed, reason }. */
export function permit(mod, ev, characterId, itemId, use = 'show', now = new Date()) {
  if (!USES.includes(use)) return { allowed: false, reason: 'unknown-use' };
  if (ev.kind === 'none') {
    const r = mod.checkPermission(null, { subjectId: characterId, facetId: itemId, use, now });
    return { allowed: !!r?.allowed, reason: r?.reason || 'show-only' };
  }
  if (!ev.usable) return itemId === CHARACTER_KEY && use === 'show' ? { allowed: true, reason: 'character-arrives' } : { allowed: false, reason: ev.reason };
  if (ev.kind === 'legacy') {
    const right = ev.record.rights.find((r) => r?.item === itemId);
    if (!right) return itemId === CHARACTER_KEY ? { allowed: true, reason: 'character-arrives' } : { allowed: false, reason: 'owner-no-right-listed' };
    return (right.allow || []).includes(use) ? { allowed: true, reason: 'right-listed' } : { allowed: false, reason: `owner-forbids-${use}` };
  }
  if (itemId === CHARACTER_KEY && use === 'show' && ev.characterShow) return { allowed: !!ev.characterShow.allowed, reason: ev.characterShow.reason };
  const r = mod.checkPermission(ev.manifest, { subjectId: characterId, facetId: itemId, use, now });
  return { allowed: !!r?.allowed, reason: r?.reason || (r?.allowed ? 'owner-allows' : `owner-forbids-${use}`) };
}
