// net.js — URL rules and fetching with size and time limits (04 section 1, 06 rules 2 and 4).
import { HopError } from './util.js';
import { LIMITS } from './constants.js';

const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const PRIVATE = [
  /^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^\[?::1?\]?$/, /^\[?f[cd][0-9a-f]{2}:/i, /^\[?fe[89ab][0-9a-f]:/i, /^\[?::ffff:/i,
  /^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i,
];

export const isLoopbackHost = (host) => LOOPBACK.test(String(host || ''));
export const isPrivateHost = (host) => PRIVATE.some((r) => r.test(String(host || '')));

/** True when the page itself is served from a loopback address (local testing). */
export function pageIsLoopback(pageUrl) {
  try {
    const u = new URL(pageUrl);
    return (u.protocol === 'http:' || u.protocol === 'https:') && isLoopbackHost(u.hostname);
  } catch { return false; }
}

/**
 * 04 section 1 URL rules. Returns the absolute URL or throws HopError('unsafe-url').
 *  - https only, to public hosts;
 *  - http (or https) to a loopback address only while the game page itself is on loopback
 *    (a runtime rule for local testing, not a profile field);
 *  - no file:, data:, ftp:, javascript: and no private network addresses.
 */
export function checkUrl(raw, { base, pageUrl } = {}) {
  let u;
  try { u = new URL(raw, base); } catch { throw new HopError('unsafe-url', `not a URL: ${String(raw).slice(0, 80)}`); }
  if (u.username || u.password) throw new HopError('unsafe-url', 'addresses with a user name or password are not allowed');
  const local = pageIsLoopback(pageUrl);
  if (local && isLoopbackHost(u.hostname) && (u.protocol === 'http:' || u.protocol === 'https:')) return u;
  if (u.protocol !== 'https:') throw new HopError('unsafe-url', `only https is allowed: ${u.href.slice(0, 80)}`);
  if (isPrivateHost(u.hostname)) throw new HopError('unsafe-url', `private or local address: ${u.hostname}`);
  return u;
}

/**
 * Fetch with a hard byte limit and a time limit. Redirects are refused (06 rule 4).
 * Checks Content-Length first, then counts the real (decompressed) bytes while reading.
 * Returns { bytes: Uint8Array, contentType }.
 */
export async function fetchLimited(url, limit, { timeoutMs = LIMITS.fetchTimeoutMs, fetchImpl = globalThis.fetch } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    try {
      res = await fetchImpl(url, { redirect: 'error', credentials: 'omit', signal: ctl.signal, cache: 'no-store' });
    } catch (e) {
      const why = ctl.signal.aborted ? `timed out after ${timeoutMs} ms` : (e?.message || 'network error');
      throw new HopError('fetch-failed', `${url} (${why})`);
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) throw new HopError('fetch-failed', `${url} redirected; redirects are refused`);
    if (!res.ok) throw new HopError('fetch-failed', `${url} HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length'));
    const encoded = (res.headers.get('content-encoding') || 'identity') !== 'identity';
    if (!encoded && declared && declared > limit) {
      res.body?.cancel?.().catch(() => {});
      throw new HopError('too-large', `${url} is ${declared} bytes, limit ${limit}`);
    }
    const parts = [];
    let total = 0;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      for (;;) {
        let chunk;
        try { chunk = await reader.read(); } catch (e) {
          const why = ctl.signal.aborted ? `timed out after ${timeoutMs} ms` : e.message;
          throw new HopError('fetch-failed', `${url} (${why})`);
        }
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > limit) { reader.cancel().catch(() => {}); throw new HopError('too-large', `${url} exceeded ${limit} bytes while downloading`); }
        parts.push(chunk.value);
      }
    } else {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > limit) throw new HopError('too-large', `${url} exceeded ${limit} bytes`);
      parts.push(buf); total = buf.byteLength;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.byteLength; }
    return { bytes: out, contentType: res.headers.get('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}
