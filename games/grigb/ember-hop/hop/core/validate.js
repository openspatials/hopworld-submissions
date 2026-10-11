// validate.js — the version rule and validation of character files and game profiles.
//
// The structure is checked against worker M5-B's schemas (src/spec/*.schema.json) through
// M5-B's validator (src/spec/documents.js, src/spec/validate.js), using the generated copy of
// the schemas in core/schemas.js. This file adds the rules a schema cannot know:
//  - URL rules that depend on the game page (loopback only while the game is on loopback);
//  - declared sizes of one look or one item over a limit are not a file refusal: that look
//    moves down the ladder and that item stays behind (09 C3, the A2 cases C3-too-big and
//    C3-a1-oversize, and 04 section 1 "or the profile's limit if lower");
//  - GLB and image checks on downloaded bytes.
// When a file has several problems, the most serious reason wins:
// unknown-version > unsafe-file > too-large > invalid-file (src/spec/validate.js).
import { KNOWN_VERSIONS } from './constants.js';
import { checkUrl } from './net.js';
import { SCHEMAS } from './schemas.js';
import { checkDocument, describeErrors } from '../spec/documents.js';
import { REASON_PRIORITY, worstReason } from '../spec/validate.js';

export { REASON_PRIORITY };

/** 04 section 0: exact known versions while the major version is 0; from 1.0, any minor of a known major. */
export function isKnownVersion(v, known = KNOWN_VERSIONS) {
  if (typeof v !== 'string' || !v) return false;
  if (known.includes(v)) return true;
  const major = v.split('.')[0];
  if (major === '0' || !/^\d+$/.test(major)) return false;
  return known.some((k) => k.split('.')[0] === major);
}

// 04 section 1 "no code" rule, closed list (the schema checks it too; this is used for
// in-memory Vibe Jam characters and in unit tests).
const CODE_KEYS = new Set(['script', 'scripts', 'eval', 'javascript']);
const ON_KEY = /^on[A-Z]/;
const CODE_VALUE = /^\s*(javascript:|vbscript:|data:text\/html)/i;

/** Returns the list of "no code" problems at any depth (empty when clean). */
export function scanForCode(value) {
  const found = [];
  (function walk(v, p, depth) {
    if (depth > 64) { found.push(`nesting deeper than 64 at ${p}`); return; }
    if (typeof v === 'string') { if (CODE_VALUE.test(v)) found.push(`script-like value at ${p}`); return; }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (CODE_KEYS.has(k) || ON_KEY.test(k)) found.push(`script-like field "${k}" at ${p}`);
        walk(x, Array.isArray(v) ? `${p}[${k}]` : `${p}.${k}`, depth + 1);
      }
    }
  })(value, '$', 0);
  return found;
}

const iconUrl = (icon) => (typeof icon === 'string' ? icon : icon && typeof icon === 'object' ? icon.url : undefined);

/** Every URL in a character file, with its path. */
export function characterUrls(c) {
  const out = [];
  const looks = c && typeof c.looks === 'object' && c.looks ? c.looks : {};
  for (const [k, look] of Object.entries(looks)) if (look && typeof look.url === 'string') out.push([`looks.${k}.url`, look.url]);
  for (const [i, it] of (Array.isArray(c?.items) ? c.items : []).entries()) {
    if (it?.model && typeof it.model.url === 'string') out.push([`items[${i}].model.url`, it.model.url]);
    const ic = iconUrl(it?.icon);
    if (typeof ic === 'string') out.push([`items[${i}].icon`, ic]);
  }
  if (typeof c?.ownership === 'string') out.push(['ownership', c.ownership]);
  return out;
}

/** Make every URL in a character file absolute, against the address it was fetched from (04 section 1). */
export function resolveCharacterUrls(c, base) {
  const abs = (u) => { try { return typeof u === 'string' ? new URL(u, base).href : u; } catch { return u; } };
  const out = JSON.parse(JSON.stringify(c));
  if (typeof out.id === 'string') out.id = abs(out.id);
  if (typeof out.ownership === 'string') out.ownership = abs(out.ownership);
  if (out.looks && typeof out.looks === 'object') for (const look of Object.values(out.looks)) if (look && typeof look.url === 'string') look.url = abs(look.url);
  for (const it of Array.isArray(out.items) ? out.items : []) {
    if (it?.model && typeof it.model.url === 'string') it.model.url = abs(it.model.url);
    if (typeof it?.icon === 'string') it.icon = abs(it.icon);
    else if (it?.icon && typeof it.icon.url === 'string') it.icon.url = abs(it.icon.url);
  }
  return out;
}

/** URL rules that depend on the game page: returns a list of problems (empty when every URL is allowed). */
export function unsafeUrls(c, pageUrl, base) {
  const out = [];
  for (const [p, u] of characterUrls(c)) {
    try { checkUrl(u, { base, pageUrl }); } catch (e) { out.push(`${p}: ${e.detail}`); }
  }
  return out;
}

// A declared size over a limit inside one look or one item is handled at that look or item.
const LOCAL_SIZE = /^\/(looks\/[^/]+|items\/\d+\/(model|icon))\/bytes$/;

/**
 * Validates a parsed character file as fetched (URLs may be relative to `base`).
 * Returns { reason, problems } where reason is null (usable), or 'unknown-version', 'unsafe-file',
 * 'too-large' or 'invalid-file'.
 */
export function validateCharacter(c, { pageUrl, base } = {}) {
  const r = checkDocument('character', c, SCHEMAS);
  const errors = (r.errors || []).filter((e) => !(e.reason === 'too-large' && LOCAL_SIZE.test(e.instancePath)));
  const problems = describeErrors(errors, 20);
  const reasons = errors.length ? [worstReason(errors)] : [];
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const u = unsafeUrls(c, pageUrl, base);
    if (u.length) { reasons.push('unsafe-file'); problems.push(...u.map((x) => `unsafe-file: ${x}`)); }
  }
  const reason = reasons.length ? REASON_PRIORITY.find((p) => reasons.includes(p)) || reasons[0] : null;
  return { reason, problems };
}

/** Validates a game profile (04 section 2). Returns { reason, problems }. */
export function checkProfile(p) {
  const r = checkDocument('profile', p, SCHEMAS);
  return { reason: r.reason, problems: describeErrors(r.errors || [], 20) };
}

/** Problems with a game profile as a list of lines (empty when fine). */
export const validateProfile = (p) => checkProfile(p).problems;

/** Validates a status object against the status schema (for tests and self-checks). */
export function checkStatus(s) {
  const r = checkDocument('status', JSON.parse(JSON.stringify(s)), SCHEMAS);
  return { valid: r.valid, problems: describeErrors(r.errors || [], 20) };
}

/** Self-contained GLB check (04 section 1, B4-3). Returns null when fine, or a reason code. */
export function checkGlb(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.byteLength < 20) return 'bad-format';
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) return 'bad-format';        // "glTF"
  if (dv.getUint32(4, true) !== 2) return 'bad-format';                 // version 2
  const chunkLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + chunkLen > b.byteLength) return 'bad-format'; // "JSON"
  let gltf;
  try { gltf = JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + chunkLen))); } catch { return 'bad-format'; }
  const outside = (u) => typeof u === 'string' && !/^data:/i.test(u);
  for (const buf of gltf.buffers || []) if (outside(buf.uri)) return 'external-reference';
  for (const img of gltf.images || []) if (outside(img.uri)) return 'external-reference';
  return null;
}

/** Image check by signature bytes: PNG, JPEG, GIF or WebP. Returns null when fine, or 'bad-format'. */
export function checkImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const starts = (sig, off = 0) => sig.every((x, i) => b[off + i] === x);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  if (starts([0xff, 0xd8, 0xff])) return null;
  if (starts([0x47, 0x49, 0x46, 0x38])) return null;
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return null;
  return 'bad-format';
}
