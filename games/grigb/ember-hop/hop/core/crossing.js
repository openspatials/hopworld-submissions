// crossing.js — the crossing link reader and builder (04 section 3).
//
//   readParams(url)                 -> { mode: 'hop', ... } | { mode: 'vibejam', ... } | null
//   buildLink(dest, fields, bytes)  -> link string with hop, character, from, return?, hash
//   linkHash(fields, fileBytes)     -> "sha256-..." (shows edits; keyless, not protection)
//   addVibeJam(url, fields)         -> adds portal=true, username, color, ref, avatar_url
//   selfUrl(pageUrl)                -> this page's address without arrival parameters
//   readLinkFromArgs(argv)          -> link from --hop-link <url> or --uri=<url> (desktop contract)
//
// Encoding (B4-8): application/x-www-form-urlencoded, as URLSearchParams writes it. The hash
// covers decoded values. `return` defaults to `from`: the builder leaves it out when equal.
import { ARRIVAL_PARAMS, LINK_PARAMS, PREFIX, VIBEJAM_PARAMS } from './constants.js';
import { sha256, toB64url, toHex } from './util.js';

const P = LINK_PARAMS;

/** sha256- + base64url(SHA-256(hop \n character \n from \n return \n hex(SHA-256(file bytes)))). */
export async function linkHash({ hop, character, from, ret }, fileBytes) {
  const fileHex = toHex(await sha256(fileBytes));
  return 'sha256-' + toB64url(await sha256([hop ?? '', character ?? '', from ?? '', ret ?? '', fileHex].join('\n')));
}

/** Reads arrival parameters. The hop convention wins when a link carries both. */
export function readParams(url) {
  const u = url instanceof URL ? url : new URL(String(url));
  const p = u.searchParams;
  if (p.has(P.version)) {
    return {
      mode: PREFIX,
      hop: p.get(P.version),
      character: p.get(P.character),
      from: p.get(P.from),
      ret: p.get(P.return),          // raw value: null when absent (the hash uses an empty line)
      hash: p.get(P.hash),
    };
  }
  if (p.get('portal') === 'true') {
    const ignored = {};
    for (const [k, v] of p) if (!VIBEJAM_PARAMS.includes(k)) ignored[k] = v;
    return { mode: 'vibejam', username: p.get('username'), color: p.get('color'), ref: p.get('ref'), avatarUrl: p.get('avatar_url'), ignored };
  }
  return null;
}

/** This game's own address without arrival parameters or fragment. */
export function selfUrl(pageUrl) {
  const u = new URL(pageUrl);
  for (const k of ARRIVAL_PARAMS) u.searchParams.delete(k);
  u.hash = '';
  return u.href;
}

/** Builds a hop crossing link. `ret` is left out when it is empty or equal to `from`. */
export async function buildLink(destination, { hop, character, from, ret }, fileBytes) {
  const d = new URL(destination);
  const r = ret && ret !== from ? ret : '';
  d.searchParams.set(P.version, hop);
  d.searchParams.set(P.character, character);
  d.searchParams.set(P.from, from);
  if (r) d.searchParams.set(P.return, r); else d.searchParams.delete(P.return);
  d.searchParams.set(P.hash, await linkHash({ hop, character, from, ret: r }, fileBytes));
  return d.href;
}

/** Adds Vibe Jam portal parameters to a URL object (in place). `extra` passes speed, hp and the like through. */
export function addVibeJam(u, { username, color, ref, avatarUrl, extra = {} }) {
  u.searchParams.set('portal', 'true');
  u.searchParams.set('username', username || 'Visitor');
  if (color) u.searchParams.set('color', String(color).replace(/^#/, ''));
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  if (ref) u.searchParams.set('ref', ref);
  if (avatarUrl) u.searchParams.set('avatar_url', avatarUrl);
  return u;
}

/** Desktop contract (04 section 2): --hop-link <url>, --hop-link=<url> or --uri=<url>. Returns a URL string or null. */
export function readLinkFromArgs(argv = []) {
  const flag = `--${PREFIX}-link`;
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === flag && i + 1 < argv.length) return String(argv[i + 1]);
    if (a.startsWith(flag + '=')) return a.slice(flag.length + 1);
    if (a.startsWith('--uri=')) return a.slice('--uri='.length);
  }
  return null;
}
