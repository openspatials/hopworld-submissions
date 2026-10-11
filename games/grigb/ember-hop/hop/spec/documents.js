// documents.js — checks one Hopworld document (character file, game profile,
// directory list, status object or ownership manifest) against its schema in src/spec/, with
// the byte limit and the reason code. Runs in Node and in the browser with no build step.
//
//   const schemas = await loadSchemas((name) => fetch(new URL(name, base)).then((r) => r.json()));
//   checkDocument('character', textOrObject, schemas) -> { valid, reason, errors, value }
//
// reason is null when valid. Otherwise it is a reason code from 04 section 2:
// unknown-version, unsafe-file, too-large or invalid-file; for an ownership manifest it is
// always ownership-unreadable (the manifest's own reason is kept in `detail`).
// An ownership manifest is only structurally checked here. Its signature, freshness and
// rights are checked by src/ownership/index.js (verifyManifest, checkPermission).
import { compile, describeErrors } from './validate.js';

const KiB = 1024;

/** Each document kind: its schema file, any schema it refers to by $id, and its byte limit. */
export const DOCUMENTS = Object.freeze({
  character: { schema: 'character.schema.json', maxBytes: 256 * KiB },
  profile: { schema: 'game-profile.schema.json', maxBytes: 64 * KiB },
  directory: { schema: 'directory.schema.json', maxBytes: 256 * KiB },
  status: { schema: 'status.schema.json', maxBytes: 256 * KiB },
  ownership: { schema: 'ownership.schema.json', refs: ['universal-manifest-v0.4.schema.json'], maxBytes: 64 * KiB },
});

/** Every schema file name, for loaders. */
export const SCHEMA_FILES = Object.freeze([...new Set(Object.values(DOCUMENTS).flatMap((d) => [d.schema, ...(d.refs ?? [])]))]);

/**
 * Loads every schema with a reader you supply (fs in Node, fetch in the browser).
 * @param {(fileName: string) => Promise<object>} readJson
 * @returns {Promise<Record<string, object>>} file name -> schema
 */
export async function loadSchemas(readJson) {
  const out = {};
  for (const f of SCHEMA_FILES) out[f] = await readJson(f);
  return out;
}

const compiled = new WeakMap();
function validatorFor(kind, schemas) {
  let perSet = compiled.get(schemas);
  if (!perSet) { perSet = new Map(); compiled.set(schemas, perSet); }
  if (!perSet.has(kind)) {
    const d = DOCUMENTS[kind];
    if (!d) throw new Error(`unknown document kind '${kind}'`);
    const main = schemas[d.schema];
    if (!main) throw new Error(`schema ${d.schema} is not loaded`);
    perSet.set(kind, compile(main, { schemas: (d.refs ?? []).map((f) => schemas[f]) }));
  }
  return perSet.get(kind);
}

/** UTF-8 byte length of a string. */
export const byteLength = (text) => new TextEncoder().encode(text).length;

/**
 * Checks one document.
 * @param {'character'|'profile'|'directory'|'status'|'ownership'} kind
 * @param {string|object} input  the raw text (preferred: the byte limit is checked) or a parsed value
 * @param {Record<string, object>} schemas  from loadSchemas
 */
export function checkDocument(kind, input, schemas) {
  const d = DOCUMENTS[kind];
  if (!d) throw new Error(`unknown document kind '${kind}'`);
  const finish = (r) => (kind === 'ownership' && !r.valid ? { ...r, detail: r.reason, reason: 'ownership-unreadable' } : r);
  let value = input;
  if (typeof input === 'string') {
    const size = byteLength(input);
    if (size > d.maxBytes) return finish({ valid: false, reason: 'too-large', errors: [{ instancePath: '', keyword: 'maxBytes', message: `is ${size} bytes, over the ${d.maxBytes}-byte limit`, reason: 'too-large' }] });
    try { value = JSON.parse(input); } catch (e) {
      return finish({ valid: false, reason: 'invalid-file', errors: [{ instancePath: '', keyword: 'json', message: `is not valid JSON (${e.message})`, reason: 'invalid-file' }] });
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return finish({ valid: false, reason: 'invalid-file', errors: [{ instancePath: '', keyword: 'type', message: 'is not a JSON object', reason: 'invalid-file' }] });
  }
  const r = validatorFor(kind, schemas)(value);
  return finish({ ...r, value });
}

export { describeErrors };
