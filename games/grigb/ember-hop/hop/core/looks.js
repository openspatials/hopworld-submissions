// looks.js — the four looks (rungs) and the item decisions.
//
// Rung 1 full model (vrm, gltf), rung 2 simple model, rung 3 sprite then portrait, rung 4 name tag.
// The ladder is the rungs both the engine and the game profile accept, best first; rung 4 is always
// allowed. A look that fails moves down the ladder; its reason goes in status.lookAttempts only.
//
// Item order of checks: known kind -> game policy -> owner's record (show) -> declared size.
import { ITEM_KINDS, LIMITS, RUNG_LOOKS } from './constants.js';
import { checkUrl, fetchLimited } from './net.js';
import { checkGlb, checkImage } from './validate.js';
import { permit } from './ownership-bridge.js';
import { message } from './reasons.js';
import { HopError } from './util.js';

export function ladder(engine, profile) {
  const supported = new Set(engine.supportedRungs ? engine.supportedRungs() : [1, 2, 3]);
  const accepted = new Set(profile?.accepts?.rungs || [1, 2, 3, 4]);
  return [...[1, 2, 3].filter((r) => supported.has(r) && accepted.has(r)), 4];
}

/** Default image decoder: ImageBitmap in browsers; in Node, the checked bytes themselves. */
export async function defaultDecodeImage(bytes) {
  if (typeof globalThis.createImageBitmap === 'function') {
    try { return await createImageBitmap(new Blob([bytes])); } catch { throw new HopError('bad-format', 'not a decodable image'); }
  }
  return { bytes, width: null, height: null };
}

const iconUrlOf = (icon) => (typeof icon === 'string' ? icon : icon?.url);

/**
 * Tries one rung. Returns the look name that spawned, or null.
 * ctx: { engine, profile, pageUrl, fetchOpts, decodeImage, attempts, log }
 */
export async function tryRung(rung, c, ctx) {
  const { engine, profile, pageUrl, fetchOpts, decodeImage, attempts, log } = ctx;
  const maxBytes = Math.min(profile?.accepts?.maxBytes || LIMITS.characterModelBytes, LIMITS.characterModelBytes);
  const looks = c.looks || {};
  for (const look of RUNG_LOOKS[rung]) {
    if (look === 'nametag') {
      engine.spawnNameTag(c.name, c.color);
      attempts.push({ rung, look, ok: true });
      return look;
    }
    const spec = looks[look];
    if (!spec) continue;
    try {
      const url = checkUrl(spec.url, { pageUrl }).href;
      if (rung <= 2) {
        if (spec.bytes > maxBytes) throw new HopError('too-large', `declared ${spec.bytes} bytes, game limit ${maxBytes}`);
        let bytes;
        try { ({ bytes } = await fetchLimited(url, spec.bytes ? Math.min(spec.bytes, maxBytes) : maxBytes, fetchOpts)); }
        catch (e) { if (e.reason === 'too-large' && spec.bytes && spec.bytes < maxBytes) throw new HopError('content-length', `larger than its declared ${spec.bytes} bytes`); throw e; }
        const bad = checkGlb(bytes);
        if (bad) throw new HopError(bad, bad === 'bad-format' ? 'not a glTF 2.0 binary (.glb)' : 'the GLB points to files outside itself');
        try { await engine.spawnModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'spawn', { heightMeters: spec.heightMeters, look }); }
        catch (e) { throw new HopError('bad-format', `engine could not load the model: ${e.message}`); }
      } else {
        const { bytes } = await fetchLimited(url, LIMITS.imageBytes, fetchOpts);
        if (checkImage(bytes)) throw new HopError('bad-format', 'not a PNG, JPEG, GIF or WebP image');
        const image = await decodeImage(bytes);
        const frames = look === 'sprite' ? { frameWidth: spec.frameWidth, frameHeight: spec.frameHeight, animations: spec.animations } : undefined;
        try { await engine.spawnSprite(image, frames, { look }); }
        catch (e) { throw new HopError('bad-format', `engine could not show the image: ${e.message}`); }
      }
      attempts.push({ rung, look, ok: true });
      return look;
    } catch (e) {
      const reason = e.reason || 'bad-format';
      attempts.push({ rung, look, ok: false, reason, detail: e.detail || e.message });
      log(`look ${look} (rung ${rung}) failed: ${reason}${e.detail ? ' ' + e.detail : ''}`);
    }
  }
  return null;
}

/** Predicts the rung without downloading (ask-first preview). */
export function predictRung(c, rungs) {
  const has = { 1: c.looks?.vrm || c.looks?.gltf, 2: c.looks?.simple, 3: c.looks?.sprite || c.looks?.portrait };
  for (const r of rungs) if (r === 4 || has[r]) return r;
  return 4;
}

/**
 * Decides every item. With attach: true, fetches and attaches the accepted ones.
 * ctx: { engine, profile, pageUrl, fetchOpts, decodeImage, own, ownEval, warn, log, now }
 * Returns { accepted: [id], refused: [{ id, name, reason, message }], uses: { id: { use?: { allowed, reason }, copy?: {...} } } }.
 */
export async function decideItems(c, ctx, { attach }) {
  const { engine, profile, pageUrl, fetchOpts, decodeImage, own, ownEval, warn, now } = ctx;
  const accepted = [], refused = [], uses = {};
  const kinds = profile?.accepts?.itemKinds || ['cosmetic'];
  const itemMax = Math.min(profile?.accepts?.itemMaxBytes || LIMITS.itemModelBytes, LIMITS.itemModelBytes);
  const game = profile?.name;
  const refuse = (it, reason) => refused.push({ id: it.id, ...(typeof it.name === 'string' ? { name: it.name } : {}), reason, message: message(reason, { item: it.name || it.id, game, kinds }) });
  for (const it of c.items || []) {
    if (!ITEM_KINDS.includes(it.kind)) { refuse(it, `unknown-kind:${String(it.kind).slice(0, 40)}`); continue; }
    if (!kinds.includes(it.kind)) { refuse(it, `game-policy:${it.kind}-not-accepted`); continue; }
    const p = await permit(own, ownEval, c.id, it.id, 'show', now);
    if (!p.allowed) { refuse(it, p.reason || 'owner-forbids-show'); continue; }
    if (it.model?.bytes > itemMax) { refuse(it, 'too-large'); continue; }
    accepted.push(it.id);
    // use per kind (04 section 5): the item is shown; 'use' and 'copy' answers tell the game what else it may do
    const more = {};
    for (const u of own.usesFor(it.kind, profile?.accepts || {}).filter((x) => x !== 'show')) {
      const r = permit(own, ownEval, c.id, it.id, u, now);
      more[u] = { allowed: r.allowed, reason: r.reason };
    }
    if (Object.keys(more).length) uses[it.id] = more;
    if (!attach) continue;
    let model = null, icon = null;
    try {
      if (it.model?.url) {
        const { bytes } = await fetchLimited(checkUrl(it.model.url, { pageUrl }).href, Math.min(it.model.bytes || itemMax, itemMax), fetchOpts);
        const bad = checkGlb(bytes);
        if (bad) throw new HopError(bad, 'item model is not a self-contained GLB');
        model = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    } catch (e) { warn(`item ${it.id} model not loaded: ${e.reason || ''} ${e.detail || e.message}`); }
    try {
      const iu = iconUrlOf(it.icon);
      if (iu) {
        const { bytes } = await fetchLimited(checkUrl(iu, { pageUrl }).href, LIMITS.imageBytes, fetchOpts);
        if (checkImage(bytes)) throw new HopError('bad-format', 'icon is not an image');
        icon = await decodeImage(bytes);
      }
    } catch (e) { warn(`item ${it.id} icon not loaded: ${e.reason || ''} ${e.detail || e.message}`); }
    const allowedUses = ['show', ...Object.entries(more).filter(([, r]) => r.allowed).map(([u]) => u)];
    try { await engine.attachItem(it.slot || 'none', model, icon, { id: it.id, name: it.name, kind: it.kind, slot: it.slot || 'none', uses: allowedUses }); }
    catch (e) { warn(`item ${it.id} not attached: ${e.message}`); }
  }
  return { accepted, refused, uses };
}
