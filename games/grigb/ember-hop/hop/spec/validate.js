// validate.js — a small JSON Schema (2020-12 subset) validator that runs in Node and in the
// browser with no build step, plus the reason-code rule for Hopworld documents.
//
// Why not Ajv: the connector must validate in the browser from plain ES modules. This file
// supports exactly the keywords our schemas and the copied Universal Manifest v0.4 schema use.
// The Node tests cross-check every fixture against Ajv (read in place from the Universal
// Manifest repository) so the two cannot drift silently.
//
// Supported keywords: $ref (local "#/..." and by $id), $defs, type, enum, const, required,
// properties, additionalProperties, propertyNames, items, prefixItems, contains, minItems,
// maxItems, minLength, maxLength, pattern, minimum, maximum, exclusiveMinimum, allOf, anyOf,
// oneOf, not, if/then/else, format (date-time, uri). Unknown keywords are ignored, as JSON
// Schema says. An unknown "format" is ignored too.
//
// Reason codes: a schema node may carry "x-hop-reason". An error takes the reason of the
// deepest node on its path that has one; errors with none get "invalid-file". When a
// document has several errors, the most serious reason wins:
//   unknown-version > unsafe-file > too-large > invalid-file.

export const REASON_PRIORITY = Object.freeze(['unknown-version', 'unsafe-file', 'too-large', 'invalid-file']);
const DEFAULT_REASON = 'invalid-file';

const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v; // string, boolean, object
}

function typeMatches(want, v) {
  const t = typeOf(v);
  if (want === t) return true;
  if (want === 'number' && t === 'integer') return true;
  return false;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

const ptrEscape = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');

function resolvePointer(root, pointer) {
  if (pointer === '' || pointer === '#') return root;
  const parts = pointer.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = root;
  for (const p of parts) {
    if (node == null || typeof node !== 'object' || !(p in node)) return undefined;
    node = node[p];
  }
  return node;
}

/**
 * Compiles a validator for one root schema.
 * @param {object} schema  the root schema
 * @param {object} [opts]
 * @param {object[]} [opts.schemas]  other schemas that may be referenced by their $id
 * @returns {(data: unknown) => { valid: boolean, reason: string|null, errors: object[] }}
 */
export function compile(schema, { schemas = [] } = {}) {
  const byId = new Map();
  for (const s of [schema, ...schemas]) if (s && typeof s.$id === 'string') byId.set(s.$id.replace(/#$/, ''), s);

  function deref(ref, docRoot) {
    const hash = ref.indexOf('#');
    const base = hash === -1 ? ref : ref.slice(0, hash);
    const frag = hash === -1 ? '' : ref.slice(hash);
    let root = docRoot;
    if (base !== '') {
      let abs = base;
      try { abs = new URL(base, docRoot.$id).href; } catch { /* keep as written */ }
      root = byId.get(abs) ?? byId.get(base);
    }
    if (!root) throw new Error(`schema reference not found: ${ref}`);
    const node = resolvePointer(root, frag);
    if (node === undefined) throw new Error(`schema reference not found: ${ref}`);
    return { node, root, path: `${base ? base : ''}${frag || '#'}` };
  }

  // Returns a list of errors. Each error: { instancePath, schemaPath, keyword, message, reason }.
  function v(node, data, inst, spath, root, reason) {
    if (node === true || node === undefined) return [];
    if (node === false) return [{ instancePath: inst, schemaPath: spath, keyword: 'false', message: 'is not allowed', reason }];
    if (typeof node['x-hop-reason'] === 'string') reason = node['x-hop-reason'];
    const errs = [];
    const err = (keyword, message, extra = {}) => errs.push({ instancePath: inst, schemaPath: `${spath}/${keyword}`, keyword, message, reason, ...extra });

    if (typeof node.$ref === 'string') {
      const t = deref(node.$ref, root);
      errs.push(...v(t.node, data, inst, t.path, t.root, reason));
    }
    if (node.type !== undefined) {
      const types = Array.isArray(node.type) ? node.type : [node.type];
      if (!types.some((t) => typeMatches(t, data))) { err('type', `must be ${types.join(' or ')}`); return errs; }
    }
    if (node.enum !== undefined && !node.enum.some((e) => deepEqual(e, data))) err('enum', `must be one of ${node.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    if (node.const !== undefined && !deepEqual(node.const, data)) err('const', `must be ${JSON.stringify(node.const)}`);

    const t = typeOf(data);
    if (t === 'string') {
      if (node.minLength !== undefined && [...data].length < node.minLength) err('minLength', `must have at least ${node.minLength} characters`);
      if (node.maxLength !== undefined && [...data].length > node.maxLength) err('maxLength', `must have at most ${node.maxLength} characters`);
      if (node.pattern !== undefined && !new RegExp(node.pattern, 'u').test(data)) err('pattern', `does not match the required pattern`);
      if (node.format === 'date-time' && !(RFC3339.test(data) && Number.isFinite(Date.parse(data)))) err('format', 'must be an RFC 3339 date-time');
      if (node.format === 'uri' && !URI.test(data)) err('format', 'must be an absolute URI');
    }
    if (t === 'number' || t === 'integer') {
      if (node.minimum !== undefined && data < node.minimum) err('minimum', `must be at least ${node.minimum}`, { limit: node.minimum });
      if (node.maximum !== undefined && data > node.maximum) err('maximum', `must be at most ${node.maximum}`, { limit: node.maximum });
      if (node.exclusiveMinimum !== undefined && data <= node.exclusiveMinimum) err('exclusiveMinimum', `must be more than ${node.exclusiveMinimum}`);
    }
    if (t === 'array') {
      if (node.minItems !== undefined && data.length < node.minItems) err('minItems', `must have at least ${node.minItems} entries`);
      if (node.maxItems !== undefined && data.length > node.maxItems) err('maxItems', `must have at most ${node.maxItems} entries`);
      if (node.uniqueItems === true && data.some((x, i) => data.findIndex((y) => deepEqual(x, y)) !== i)) err('uniqueItems', 'has repeated entries');
      const pre = Array.isArray(node.prefixItems) ? node.prefixItems : [];
      pre.forEach((s, i) => { if (i < data.length) errs.push(...v(s, data[i], `${inst}/${i}`, `${spath}/prefixItems/${i}`, root, reason)); });
      if (node.items !== undefined) for (let i = pre.length; i < data.length; i++) errs.push(...v(node.items, data[i], `${inst}/${i}`, `${spath}/items`, root, reason));
      if (node.contains !== undefined && !data.some((x) => v(node.contains, x, inst, `${spath}/contains`, root, reason).length === 0)) err('contains', 'has no entry of the required kind');
    }
    if (t === 'object') {
      for (const k of node.required ?? []) if (!Object.prototype.hasOwnProperty.call(data, k)) err('required', `is missing required field '${k}'`, { missingProperty: k });
      const props = node.properties ?? {};
      for (const [k, s] of Object.entries(props)) if (Object.prototype.hasOwnProperty.call(data, k)) errs.push(...v(s, data[k], `${inst}/${ptrEscape(k)}`, `${spath}/properties/${ptrEscape(k)}`, root, reason));
      if (node.propertyNames !== undefined) for (const k of Object.keys(data)) {
        const sub = v(node.propertyNames, k, inst, `${spath}/propertyNames`, root, reason);
        if (sub.length) err('propertyNames', `has a field named '${k}' that is not allowed`, { propertyName: k, reason: sub[0].reason });
      }
      if (node.additionalProperties !== undefined) for (const k of Object.keys(data)) {
        if (Object.prototype.hasOwnProperty.call(props, k)) continue;
        errs.push(...v(node.additionalProperties, data[k], `${inst}/${ptrEscape(k)}`, `${spath}/additionalProperties`, root, reason));
      }
    }
    if (Array.isArray(node.allOf)) node.allOf.forEach((s, i) => errs.push(...v(s, data, inst, `${spath}/allOf/${i}`, root, reason)));
    if (Array.isArray(node.anyOf)) {
      const branches = node.anyOf.map((s, i) => v(s, data, inst, `${spath}/anyOf/${i}`, root, reason));
      if (!branches.some((b) => b.length === 0)) errs.push(...pickBranch(branches, () => err('anyOf', 'does not match any allowed form')));
    }
    if (Array.isArray(node.oneOf)) {
      const branches = node.oneOf.map((s, i) => v(s, data, inst, `${spath}/oneOf/${i}`, root, reason));
      const passing = branches.filter((b) => b.length === 0).length;
      if (passing === 0) errs.push(...pickBranch(branches, () => err('oneOf', 'does not match any allowed form')));
      else if (passing > 1) err('oneOf', 'matches more than one form');
    }
    if (node.not !== undefined && v(node.not, data, inst, `${spath}/not`, root, reason).length === 0) err('not', 'has a form that is not allowed');
    if (node.if !== undefined) {
      const ok = v(node.if, data, inst, `${spath}/if`, root, reason).length === 0;
      if (ok && node.then !== undefined) errs.push(...v(node.then, data, inst, `${spath}/then`, root, reason));
      if (!ok && node.else !== undefined) errs.push(...v(node.else, data, inst, `${spath}/else`, root, reason));
    }
    return errs;
  }

  // For a failed anyOf/oneOf: report the errors of the branch that got furthest (fewest
  // errors), keeping a reason a branch marked. Falls back to one summary error.
  function pickBranch(branches, summary) {
    const marked = branches.find((b) => b.some((e) => e.reason && e.reason !== DEFAULT_REASON));
    if (marked) return marked;
    const best = branches.slice().sort((a, b) => a.length - b.length)[0];
    if (best && best.length) return best;
    summary();
    return [];
  }

  return function validate(data) {
    const errors = v(schema, data, '', '#', schema, undefined).map((e) => ({ ...e, reason: e.reason ?? DEFAULT_REASON }));
    return { valid: errors.length === 0, reason: errors.length ? worstReason(errors) : null, errors };
  };
}

/** The most serious reason among errors (see REASON_PRIORITY). */
export function worstReason(errors) {
  let best = null;
  for (const e of errors) {
    const r = e.reason ?? DEFAULT_REASON;
    if (best === null || rank(r) < rank(best)) best = r;
  }
  return best;
}
const rank = (r) => { const i = REASON_PRIORITY.indexOf(r); return i === -1 ? REASON_PRIORITY.length : i; };

/** One short plain line per error, for logs and command-line output. */
export function describeErrors(errors, max = 8) {
  const at = (p) => (p ? p.slice(1).replace(/\/(\d+)(?=\/|$)/g, '[$1]').replace(/\//g, '.') : 'the document');
  const seen = new Set();
  const out = [];
  for (const e of errors) {
    const line = `${e.reason}: ${at(e.instancePath)} ${e.message}`;
    if (!seen.has(line)) { seen.add(line); out.push(line); }
    if (out.length >= max) break;
  }
  return out;
}
