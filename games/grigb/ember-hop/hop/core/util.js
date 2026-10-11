// util.js — small helpers shared by the core modules. Works in Node 22 and in browsers.

export class HopError extends Error {
  constructor(reason, detail) {
    super(`${reason}${detail ? ': ' + detail : ''}`);
    this.name = 'HopError';
    this.reason = reason;
    this.detail = detail;
  }
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function toB64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return crypto.subtle.digest('SHA-256', bytes);
}

export const now = () => (globalThis.performance ? performance.now() : Date.now());

export const decodeText = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
