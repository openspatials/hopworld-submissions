// ownership/index.js — Hopworld ownership checks on Universal Manifest v0.4.
// One plain ES module for Node 22 and the browser. No dependencies: Ed25519 goes through
// WebCrypto (globalThis.crypto.subtle) in both.
//
// Option (b) of docs/package/M4-UNIVERSAL-MANIFEST-FIT.md: the character file stays plain, and
// its `ownership` link points to a signed Universal Manifest v0.4 manifest (Tier 0, Signature
// Profile A). With no link, everything is show-only.
//
// API used by the core (worker M5-A):
//   await verifyManifest(manifestOrText, { now })      -> { valid, reason, detail, ... }
//   checkPermission(manifest | null, { subjectId, facetId, use, now }) -> { allowed, reason, ... }
//
// Call verifyManifest first. checkPermission is synchronous and only trusts a manifest object
// that verifyManifest has checked and that has not changed since; anything else counts as an
// unreadable record. Pass the raw text to verifyManifest when you have it: only the text shows
// duplicate JSON keys, which Universal Manifest requires us to refuse.
//
// subjectId is the absolute URL of the character file the game loaded. facetId is "@character",
// an item id such as "hat-01", or a full facet @id. use is "show", "use" or "copy".
//
// Written defaults (04 section 5):
// - No manifest: "show" is allowed (reason no-ownership-show-only); "use" and "copy" are refused
//   with show-only.
// - A manifest that is unreadable, badly signed, expired, not yet valid or for another character
//   refuses every item with that reason. The character itself still arrives: "show" for
//   @character is allowed with reason character-arrives, and `recordProblem` names the problem.
// - In a good manifest, an item with no facet or no consent is refused with owner-no-right-listed.
//   The character may arrive when it has no facet; a character facet with no consent for "show"
//   refuses it (owner-forbids-show).
// Use per kind (04 section 5, B3-5): "show" for every item a game displays; "use" too when the
// game gives that kind behavior (profile accepts.useKinds); "copy" too when the game keeps items
// after the player leaves (accepts.keepsItems). See usesFor() and checkItem().

/** The product prefix, in one place (decision in force). */
export const PREFIX = 'hop';
/** Consent purpose for crossings. */
export const PURPOSE = `${PREFIX}:game-crossing`;
export const CHARACTER_TYPE = `${PREFIX}:Character`;
export const ITEM_TYPE = `${PREFIX}:Item`;
export const CHARACTER = '@character';
export const USES = Object.freeze(['show', 'use', 'copy']);
export const UM_CONTEXT = 'https://universalmanifest.net/ns/v0.4';
export const UM_VERSION = '0.4';
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const SKEW_MS = 60_000;

/** One plain sentence per reason code this module returns ({item} is filled in as plain text). */
export const REASON_TEXT = Object.freeze({
  'owner-allows': '{item} is allowed here by its owner\'s record.',
  'no-ownership-show-only': '{item} can be shown here: it has no ownership record.',
  'character-arrives': '{item} arrives; its ownership record does not stop the character itself.',
  'show-only': '{item} can be shown here but not used: it has no ownership record.',
  'unknown-use': 'The game asked about a use that does not exist.',
  'ownership-unreadable': '{item} stays behind: its ownership record could not be read.',
  'ownership-bad-signature': '{item} stays behind: its ownership record was changed after it was signed.',
  'ownership-expired': '{item} stays behind: its ownership record has expired.',
  'ownership-not-yet-valid': '{item} stays behind: its ownership record is not valid yet.',
  'ownership-wrong-character': '{item} stays behind: its ownership record is for another character.',
  'owner-no-right-listed': '{item} stays behind: its owner\'s record does not allow it here.',
  'owner-forbids-show': '{item} stays behind: its owner\'s record does not allow it here.',
  'owner-forbids-use': '{item} can be shown here but not used: its owner\'s record does not allow it.',
  'owner-forbids-copy': '{item} can be shown here but not kept: its owner\'s record does not allow it.',
});

// ---------------------------------------------------------------- small helpers

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const isTime = (s) => typeof s === 'string' && RFC3339.test(s) && Number.isFinite(Date.parse(s));
const typeIncludes = (t, want) => t === want || (Array.isArray(t) && t.includes(want));
const nonEmpty = (s) => typeof s === 'string' && s.length > 0;

function toDate(now) {
  if (now === undefined) return new Date();
  const d = now instanceof Date ? now : new Date(now);
  return Number.isFinite(d.getTime()) ? d : null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64 or base64url (padding optional) -> bytes, or null when malformed. */
export function base64ToBytes(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(t) || t.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((t.length * 3) / 4));
  let bits = 0, acc = 0, j = 0;
  for (const ch of t) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[j++] = (acc >> bits) & 0xff; }
  }
  return out;
}
/** bytes -> base64 (with padding). */
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}
export const bytesToBase64url = (b) => bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** base58btc -> bytes, or null. */
export function base58ToBytes(s) {
  if (typeof s !== 'string' || !s.length || s.length > 128) return null;
  let zeros = 0;
  while (s[zeros] === '1') zeros++;
  const bytes = [];
  for (let k = zeros; k < s.length; k++) {
    let carry = B58.indexOf(s[k]);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}
/** bytes -> base58btc. */
export function bytesToBase58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let k = zeros; k < bytes.length; k++) {
    let carry = bytes[k];
    for (let i = 0; i < digits.length; i++) { carry += digits[i] * 256; digits[i] = carry % 58; carry = Math.floor(carry / 58); }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => B58[d]).join('');
}

const ED25519_SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
const ED25519_MULTICODEC = [0xed, 0x01];
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Raw 32-byte Ed25519 key -> SPKI DER bytes. */
export function rawToSpki(raw) {
  const out = new Uint8Array(ED25519_SPKI_PREFIX.length + raw.length);
  out.set(ED25519_SPKI_PREFIX); out.set(raw, ED25519_SPKI_PREFIX.length);
  return out;
}
/** SPKI DER bytes -> raw 32-byte Ed25519 key, or null if not an Ed25519 SPKI. */
export function spkiToRaw(spki) {
  if (!spki || spki.length !== 44 || !sameBytes(spki.subarray(0, 12), ED25519_SPKI_PREFIX)) return null;
  return spki.subarray(12);
}
/** Raw Ed25519 key -> did:key (did:key:z6Mk...). */
export function didKeyFromRaw(raw) {
  return `did:key:z${bytesToBase58(Uint8Array.from([...ED25519_MULTICODEC, ...raw]))}`;
}
/**
 * did:key (with or without a #fragment) -> raw Ed25519 key, or null when it is not an Ed25519
 * did:key. Resolves locally, with no network (Universal Manifest Base 1.6.4).
 */
export function rawFromDidKey(ref) {
  const m = /^did:key:z([1-9A-HJ-NP-Za-km-z]+)(?:#(.*))?$/.exec(String(ref));
  if (!m) return null;
  const bytes = base58ToBytes(m[1]);
  if (!bytes || bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) return null;
  if (m[2] !== undefined && m[2] !== '' && m[2] !== `z${m[1]}`) return null; // fragment must name the same key
  return bytes.subarray(2);
}

// ---------------------------------------------------------------- JCS and parsing

/** RFC 8785 (JCS) canonical JSON. Throws on non-finite numbers and lone surrogates. */
export function canonicalize(value) {
  const wellFormed = (s) => {
    for (let i = 0; i < s.length; i++) {
      const u = s.charCodeAt(i);
      if (u >= 0xd800 && u <= 0xdbff) { const n = s.charCodeAt(i + 1); if (!(n >= 0xdc00 && n <= 0xdfff)) throw new Error('lone surrogate'); i++; }
      else if (u >= 0xdc00 && u <= 0xdfff) throw new Error('lone surrogate');
    }
    return s;
  };
  if (value === null) return 'null';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('non-finite number'); return JSON.stringify(value); }
  if (typeof value === 'string') return JSON.stringify(wellFormed(value));
  if (typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(wellFormed(k))}:${canonicalize(value[k])}`).join(',')}}`;
  }
  throw new Error(`cannot canonicalize a ${typeof value}`);
}

/** The Universal Manifest v0.4 signing input: the manifest without signature, presentationProof and postQuantumSignature, in JCS. */
export function signingInput(manifest) {
  const { signature: _s, presentationProof: _p, postQuantumSignature: _q, ...rest } = manifest;
  return canonicalize(rest);
}

/** Returns the first duplicate member name in JSON text, or null. The text must already parse. */
export function findDuplicateKey(text) {
  const frames = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      const f = frames[frames.length - 1];
      if (f && f.obj && f.awaitingKey) {
        const name = JSON.parse(text.slice(start, i));
        if (f.keys.has(name)) return name;
        f.keys.add(name);
        f.awaitingKey = false;
      }
      continue;
    }
    if (ch === '{' || ch === '[') frames.push({ obj: ch === '{', keys: new Set(), awaitingKey: ch === '{' });
    else if (ch === '}' || ch === ']') frames.pop();
    else if (ch === ',') { const f = frames[frames.length - 1]; if (f && f.obj) f.awaitingKey = true; }
    i++;
  }
  return null;
}

/**
 * Parses manifest text with the 64 KiB limit and the duplicate-key rule.
 * @returns {{ manifest: object|null, reason: string|null, detail: string }}
 */
export function parseManifest(text) {
  if (typeof text !== 'string') return { manifest: null, reason: 'ownership-unreadable', detail: 'not text' };
  const size = new TextEncoder().encode(text).length;
  if (size > MAX_MANIFEST_BYTES) return { manifest: null, reason: 'ownership-unreadable', detail: `too large: ${size} bytes, over the ${MAX_MANIFEST_BYTES}-byte limit` };
  let value;
  try { value = JSON.parse(text); } catch (e) { return { manifest: null, reason: 'ownership-unreadable', detail: `not valid JSON: ${e.message}` }; }
  const dup = findDuplicateKey(text);
  if (dup !== null) return { manifest: null, reason: 'ownership-unreadable', detail: `duplicate JSON key '${dup}'` };
  return { manifest: value, reason: null, detail: 'parsed' };
}

// ---------------------------------------------------------------- structure

const CODE_KEY = /^(?:script|scripts|eval|javascript|on[A-Z].*)$/;
const CODE_VALUE = /^\s*(?:javascript:|vbscript:|data:text\/html)/i;
function codeProblem(v, path = '$', depth = 0) {
  if (depth > 32) return `nesting deeper than 32 at ${path}`;
  if (typeof v === 'string') return CODE_VALUE.test(v) ? `code-like value at ${path}` : null;
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (!Array.isArray(v) && CODE_KEY.test(k)) return `code-like field '${k}' at ${path}`;
      const p = codeProblem(x, `${path}.${k}`, depth + 1);
      if (p) return p;
    }
  }
  return null;
}

/**
 * Structural problems, mirroring the Universal Manifest v0.4 schema for the parts we use plus
 * our conventions (src/spec/ownership.schema.json). Returns the first problem, or null.
 */
export function structureProblem(m) {
  if (!isObj(m)) return 'the manifest is not a JSON object';
  const code = codeProblem(m);
  if (code) return code;
  const ctx = m['@context'];
  if (!(ctx === UM_CONTEXT || (Array.isArray(ctx) && ctx.includes(UM_CONTEXT)))) return `@context must include ${UM_CONTEXT}`;
  if (!nonEmpty(m['@id'])) return 'missing @id';
  if (!typeIncludes(m['@type'], 'um:Manifest')) return '@type must include um:Manifest';
  if (m.manifestVersion !== UM_VERSION) return `manifestVersion must be "${UM_VERSION}"`;
  if (!nonEmpty(m.subject)) return 'missing subject';
  if (!isTime(m.issuedAt)) return 'issuedAt is missing or not an RFC 3339 time';
  if (!isTime(m.expiresAt)) return 'expiresAt is missing or not an RFC 3339 time';
  if (Date.parse(m.issuedAt) > Date.parse(m.expiresAt)) return 'issuedAt is after expiresAt';
  if (m.facets !== undefined) {
    if (!Array.isArray(m.facets) || m.facets.length > 64) return 'facets must be a list of at most 64';
    for (const [i, f] of m.facets.entries()) {
      if (!isObj(f) || !nonEmpty(f['@id'])) return `facets[${i}] has no @id`;
      if (!typeIncludes(f['@type'], 'um:Facet')) return `facets[${i}] @type must include um:Facet`;
      if (f.ref !== undefined && typeof f.ref !== 'string') return `facets[${i}].ref must be a string`;
      const et = isObj(f.entity) ? f.entity['@type'] : undefined;
      if (isObj(f.entity) && (!nonEmpty(f.entity['@id']) || !(nonEmpty(et) || (Array.isArray(et) && et.length && et.every(nonEmpty))))) return `facets[${i}].entity needs @id and @type`;
      if (typeIncludes(et, CHARACTER_TYPE)) {
        if (!/^https?:\/\/[^\s#]+$/.test(f['@id']) || (f.ref !== undefined && !/^https?:\/\/[^\s#]+$/.test(f.ref))) return `facets[${i}] (character) @id and ref must be the character file's absolute URL`;
      }
      if (typeIncludes(et, ITEM_TYPE) && !/^https?:\/\/[^\s#]+#item-[A-Za-z0-9._-]{1,64}$/.test(f['@id'])) return `facets[${i}] (item) @id must be <character URL>#item-<id>`;
    }
  }
  if (m.consents !== undefined) {
    if (!Array.isArray(m.consents) || m.consents.length > 256) return 'consents must be a list of at most 256';
    for (const [i, c] of m.consents.entries()) {
      if (!isObj(c) || !nonEmpty(c['@id'])) return `consents[${i}] has no @id`;
      if (!typeIncludes(c['@type'], 'um:Consent')) return `consents[${i}] @type must include um:Consent`;
      if (!nonEmpty(c.facetRef)) return `consents[${i}] has no facetRef`;
      if (!Array.isArray(c.scope) || !c.scope.length || !c.scope.every(nonEmpty)) return `consents[${i}].scope must be a non-empty list of words`;
      if (!nonEmpty(c.purpose)) return `consents[${i}] has no purpose`;
      if (!isTime(c.grantedAt) || !isTime(c.expiresAt)) return `consents[${i}] grantedAt and expiresAt must be RFC 3339 times`;
      if (c.withdrawnAt !== undefined && !isTime(c.withdrawnAt)) return `consents[${i}].withdrawnAt must be an RFC 3339 time`;
      if (c.grantor !== undefined && typeof c.grantor !== 'string') return `consents[${i}].grantor must be a string`;
      if (c.conditions !== undefined && (!Array.isArray(c.conditions) || !c.conditions.every((x) => typeof x === 'string'))) return `consents[${i}].conditions must be a list of strings`;
    }
  }
  for (const k of ['claims', 'pointers', 'devices']) if (m[k] !== undefined && !Array.isArray(m[k])) return `${k} must be a list`;
  const s = m.signature;
  if (!isObj(s)) return 'missing signature (a Universal Manifest must be signed)';
  if (s.algorithm !== 'Ed25519') return `unsupported signature algorithm '${s.algorithm}' (only Ed25519, Signature Profile A)`;
  if (s.canonicalization !== 'JCS-RFC8785') return `unsupported canonicalization '${s.canonicalization}'`;
  if (!nonEmpty(s.keyRef)) return 'signature.keyRef is missing';
  if (!nonEmpty(s.value)) return 'signature.value is missing';
  if (s.publicKeySpkiB64 !== undefined && !nonEmpty(s.publicKeySpkiB64)) return 'signature.publicKeySpkiB64 must be a non-empty string';
  if (s.created !== undefined && !isTime(s.created)) return 'signature.created must be an RFC 3339 time';
  return null;
}

// ---------------------------------------------------------------- verify

const VERIFIED = new WeakMap(); // manifest object -> { result, snapshot }

function subtle() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw new Error('WebCrypto (crypto.subtle) is not available here');
  return s;
}

function freshness(m, now) {
  const t = now.getTime();
  if (Date.parse(m.issuedAt) - t > SKEW_MS) return { reason: 'ownership-not-yet-valid', detail: `not valid until ${m.issuedAt}` };
  if (t > Date.parse(m.expiresAt)) return { reason: 'ownership-expired', detail: `expired at ${m.expiresAt}` };
  return null;
}

/**
 * Verifies a Universal Manifest v0.4 ownership manifest: size, duplicate keys (text input only),
 * structure and our conventions, the Ed25519 signature over the JCS signing input (WebCrypto),
 * did:key resolution with the key-substitution check, and freshness (60 s clock skew).
 * @param {object|string} input  the parsed manifest, or its raw text (preferred)
 * @param {{ now?: Date|string|number }} [opts]
 * @returns {Promise<{ valid: boolean, reason: string|null, detail: string, manifest: object|null,
 *   keyRefResolution: 'resolved'|'unresolved'|null, signer: string|null, signerIsSubject: boolean|null }>}
 */
export async function verifyManifest(input, { now } = {}) {
  let manifest = input;
  const result = (valid, reason, detail, extra = {}) => {
    const r = Object.freeze({ valid, reason, detail, manifest: isObj(manifest) ? manifest : null, keyRefResolution: null, signer: null, signerIsSubject: null, ...extra });
    if (isObj(manifest)) {
      let snapshot = null;
      try { snapshot = canonicalize(manifest); } catch { /* unreadable either way */ }
      VERIFIED.set(manifest, { result: r, snapshot });
    }
    return r;
  };
  if (typeof input === 'string') {
    const p = parseManifest(input);
    if (p.reason) { manifest = null; return result(false, p.reason, p.detail); }
    manifest = p.manifest;
  }
  const when = toDate(now);
  if (!when) return result(false, 'ownership-unreadable', 'the check time is not a valid date');
  if (isObj(manifest)) {
    let size = 0;
    try { size = new TextEncoder().encode(JSON.stringify(manifest)).length; } catch { size = Infinity; }
    if (size > MAX_MANIFEST_BYTES) return result(false, 'ownership-unreadable', `too large: over the ${MAX_MANIFEST_BYTES}-byte limit`);
  }
  const problem = structureProblem(manifest);
  if (problem) return result(false, 'ownership-unreadable', problem);

  const sig = manifest.signature;
  // Key: from a did:key keyRef (resolved locally) and/or the embedded SPKI. Both present -> must match.
  const didRaw = rawFromDidKey(sig.keyRef);
  let spki = null;
  if (sig.publicKeySpkiB64 !== undefined) {
    const bytes = base64ToBytes(sig.publicKeySpkiB64);
    if (!bytes || !spkiToRaw(bytes)) return result(false, 'ownership-bad-signature', 'signature.publicKeySpkiB64 is not an Ed25519 public key');
    spki = bytes;
  }
  if (/^did:key:/.test(sig.keyRef) && !didRaw) return result(false, 'ownership-bad-signature', 'signature.keyRef is a did:key that does not name an Ed25519 key');
  if (didRaw && spki && !sameBytes(spkiToRaw(spki), didRaw)) {
    return result(false, 'ownership-bad-signature', 'signature.keyRef (did:key) and publicKeySpkiB64 are different keys (key substitution)', { keyRefResolution: 'resolved' });
  }
  if (!didRaw && !spki) return result(false, 'ownership-unreadable', `no key: keyRef '${sig.keyRef}' cannot be resolved here and publicKeySpkiB64 is missing`, { keyRefResolution: 'unresolved' });
  const keyRefResolution = didRaw ? 'resolved' : 'unresolved';
  const signer = didRaw ? String(sig.keyRef).split('#')[0] : null;
  const signerIsSubject = signer ? signer === manifest.subject : null;

  const sigBytes = base64ToBytes(sig.value);
  if (!sigBytes || sigBytes.length !== 64) return result(false, 'ownership-bad-signature', 'signature.value is not a 64-byte base64url Ed25519 signature', { keyRefResolution, signer, signerIsSubject });
  let payload;
  try { payload = new TextEncoder().encode(signingInput(manifest)); } catch (e) { return result(false, 'ownership-unreadable', `cannot canonicalize: ${e.message}`); }
  let ok = false;
  try {
    const key = didRaw
      ? await subtle().importKey('raw', didRaw, { name: 'Ed25519' }, false, ['verify'])
      : await subtle().importKey('spki', spki, { name: 'Ed25519' }, false, ['verify']);
    ok = await subtle().verify({ name: 'Ed25519' }, key, sigBytes, payload);
  } catch (e) {
    return result(false, 'ownership-bad-signature', `signature could not be checked: ${e.message}`, { keyRefResolution, signer, signerIsSubject });
  }
  if (!ok) return result(false, 'ownership-bad-signature', 'signature does not match: the manifest was changed after signing', { keyRefResolution, signer, signerIsSubject });

  const fresh = freshness(manifest, when);
  if (fresh) return result(false, fresh.reason, fresh.detail, { keyRefResolution, signer, signerIsSubject });
  return result(true, null, `signature valid (keyRef ${keyRefResolution}), fresh until ${manifest.expiresAt}`, { keyRefResolution, signer, signerIsSubject });
}

// ---------------------------------------------------------------- permissions

/** The facet @id for "@character", an item id, or a full facet @id. */
export function facetIdFor(subjectId, facetId) {
  if (facetId === CHARACTER || facetId === subjectId) return subjectId;
  if (typeof facetId === 'string' && /^[a-z][a-z0-9+.-]*:/i.test(facetId)) return facetId;
  return `${subjectId}#item-${facetId}`;
}

/** Problem tying the manifest to this character, or null. */
function bindingProblem(m, subjectId) {
  const facets = Array.isArray(m.facets) ? m.facets : [];
  for (const f of facets) {
    const et = isObj(f.entity) ? f.entity['@type'] : undefined;
    if (typeIncludes(et, CHARACTER_TYPE) && (f['@id'] !== subjectId || (f.ref !== undefined && f.ref !== subjectId) || (isObj(f.entity) && f.entity['@id'] !== subjectId))) {
      return `the character facet is for ${f['@id']}, not ${subjectId}`;
    }
  }
  const ours = facets.some((f) => f['@id'] === subjectId || String(f['@id']).startsWith(`${subjectId}#item-`));
  return ours ? null : `no facet in the manifest is about ${subjectId}`;
}

const allow = (reason, extra = {}) => Object.freeze({ allowed: true, reason, ...extra });
const deny = (reason, extra = {}) => Object.freeze({ allowed: false, reason, ...extra });

/**
 * May the game do `use` with the character or one item, by the owner's manifest?
 * @param {object|null} manifest  a manifest passed to verifyManifest first, or null (no ownership link)
 * @param {{ subjectId: string, facetId: string, use: string, now?: Date|string|number }} q
 * @returns {{ allowed: boolean, reason: string, umStatus?: string, detail?: string, recordProblem?: string }}
 */
export function checkPermission(manifest, { subjectId, facetId = CHARACTER, use, now } = {}) {
  if (!USES.includes(use)) return deny('unknown-use', { detail: `'${use}' is not a use (uses are ${USES.join(', ')})` });
  const isCharacter = facetId === CHARACTER || facetId === subjectId;
  if (manifest === null || manifest === undefined) {
    return use === 'show'
      ? allow('no-ownership-show-only', { detail: 'no ownership record: show-only' })
      : deny('show-only', { detail: 'no ownership record: show-only' });
  }
  // Whole-record problems refuse every item; the character itself still arrives.
  const recordProblem = (() => {
    if (typeof subjectId !== 'string' || !/^https?:\/\/\S+$/.test(subjectId)) return ['ownership-unreadable', 'subjectId must be the absolute URL of the loaded character file'];
    const state = isObj(manifest) ? VERIFIED.get(manifest) : undefined;
    if (!state) return ['ownership-unreadable', 'the manifest was not checked with verifyManifest'];
    let snap = null;
    try { snap = canonicalize(manifest); } catch { /* changed into something unreadable */ }
    if (state.snapshot === null || snap !== state.snapshot) return ['ownership-unreadable', 'the manifest changed after verifyManifest'];
    if (!state.result.valid && state.result.reason !== 'ownership-expired' && state.result.reason !== 'ownership-not-yet-valid') return [state.result.reason, state.result.detail];
    const when = toDate(now);
    if (!when) return ['ownership-unreadable', 'the check time is not a valid date'];
    const fresh = freshness(manifest, when);
    if (fresh) return [fresh.reason, fresh.detail];
    const bind = bindingProblem(manifest, subjectId);
    if (bind) return ['ownership-wrong-character', bind];
    return null;
  })();
  if (recordProblem) {
    if (isCharacter && use === 'show') return allow('character-arrives', { recordProblem: recordProblem[0], detail: recordProblem[1] });
    return deny(recordProblem[0], { detail: recordProblem[1] });
  }

  const fid = facetIdFor(subjectId, facetId);
  const facet = (manifest.facets ?? []).find((f) => f['@id'] === fid);
  if (!facet) {
    if (isCharacter && use === 'show') return allow('character-arrives', { umStatus: 'not-listed', detail: 'the manifest does not list the character, so it may arrive' });
    return deny('owner-no-right-listed', { umStatus: 'consent-missing', detail: `no facet ${fid}` });
  }
  const consents = (manifest.consents ?? []).filter((c) => c.facetRef === fid);
  if (!consents.length) {
    if (isCharacter) return deny(`owner-forbids-${use}`, { umStatus: 'consent-missing', detail: 'the character is listed with no rights' });
    return deny('owner-no-right-listed', { umStatus: 'consent-missing', detail: `no consent for ${fid}` });
  }
  const t = toDate(now).getTime();
  // Universal Manifest Consent stage, in the reference evaluator's order. Every matching consent must pass.
  for (const c of consents) {
    if (c.withdrawnAt) return deny(`owner-forbids-${use}`, { umStatus: 'withdrawn', detail: `consent ${c['@id']} was withdrawn at ${c.withdrawnAt}` });
    if (Date.parse(c.expiresAt) < t) return deny('ownership-expired', { umStatus: 'expired', detail: `consent ${c['@id']} expired at ${c.expiresAt}` });
    if (Array.isArray(c.conditions) && c.conditions.length) return deny(`owner-forbids-${use}`, { umStatus: 'condition-violated', detail: `consent ${c['@id']} has conditions this checker cannot enforce: ${c.conditions.join(', ')}` });
    if (!c.scope.includes(use)) return deny(`owner-forbids-${use}`, { umStatus: 'scope-mismatch', detail: `the owner allows ${c.scope.join(', ')}, not ${use}` });
    if (c.purpose !== PURPOSE) return deny('owner-no-right-listed', { umStatus: 'purpose-mismatch', detail: `consent purpose is '${c.purpose}', not '${PURPOSE}'` });
  }
  return allow('owner-allows', { umStatus: 'processed', detail: `the owner allows ${use} until ${manifest.expiresAt}` });
}

/**
 * Which uses a game must check for an item of this kind (04 section 5, use per kind).
 * @param {string} kind  cosmetic, tool or collectible
 * @param {{ useKinds?: string[], keepsItems?: boolean }} [accepts]  the game profile's accepts block
 */
export function usesFor(kind, accepts = {}) {
  const uses = ['show'];
  if (Array.isArray(accepts.useKinds) && accepts.useKinds.includes(kind)) uses.push('use');
  if (accepts.keepsItems === true) uses.push('copy');
  return uses;
}

/**
 * Checks every use one item needs in this game. Returns the first refusal, or an allowed result
 * listing the uses checked. The game's own policy (accepts.itemKinds) is the core's other half.
 */
export function checkItem(manifest, { subjectId, itemId, kind, accepts = {}, now } = {}) {
  const uses = usesFor(kind, accepts);
  let last = null;
  for (const use of uses) {
    last = checkPermission(manifest, { subjectId, facetId: itemId, use, now });
    if (!last.allowed) return Object.freeze({ ...last, use, uses });
  }
  return Object.freeze({ ...last, uses });
}
