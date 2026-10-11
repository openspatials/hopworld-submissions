// canvas2d.js — the immediate-mode canvas engine layer for the shared web core (src/core/).
// Spec: docs/package/04-INTERFACE-SPECS.md section 2 (EngineAdapter). Built from the M2 proof
// poc/ai-skill/templates/2d-web/igc/adapters/canvas2d.js (worker B1; the M2 proofs keep the prefix
// igc the product had before it was renamed Hopworld). Owner: worker M5-D.
//
// For flat games that draw on an HTML canvas every frame with their own loop. The game keeps
// its own player, controls and physics. This layer holds the arriving character's look (sprite
// frames, or the game's own body in the visitor's color with a name tag), the accepted items,
// the portals and short messages. The game calls it from its own loop:
//
//   const adapter = createCanvas2DAdapter({ canvas });
//   createConnector().init(profile, adapter);
//   // every frame, after moving the player:
//   adapter.update(dt, playerRect, moving);      // animation frames and portal touches
//   // where the game draws (inside its camera transform):
//   adapter.draw(ctx, playerRect, drawOwnBody);  // portals, then the player, then items and name
//   // after the camera transform, in screen space:
//   adapter.drawMessages(ctx);
//
// playerRect is { x, y, w, h } in the units the game draws with. drawOwnBody(color) draws the
// game's usual player (color is the visitor's color, or null). Keyboard listeners stay on window;
// focusGame() gives the canvas focus after an arrival. 3D models are not drawn: rungs 3 and 4.

/** Plain text for canvas fillText: no control characters, bounded length. */
export function plainText(s, max = 40) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

const validAnim = (v) => Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= 0 && v[1] >= v[0];

export function createCanvas2DAdapter({
  canvas = null,             // the game canvas (for focusGame); default the first canvas on the page
  supports = [3, 4],
  animMap = { moving: 'walk', still: 'idle' },
  fps = 8,                   // sprite animation speed, frames per second
} = {}) {
  const portals = [];
  const items = [];
  const messages = [];
  let identity = { name: '', color: null };
  let look = null;           // { image, fw, fh, cols, count, anims, t, frame, anim }
  let clock = 0;
  const canvasEl = () => canvas || globalThis.document?.querySelector('canvas') || null;

  function frameRect(i) {
    return [(i % look.cols) * look.fw, Math.floor(i / look.cols) * look.fh, look.fw, look.fh];
  }

  function drawTag(ctx, rect, text, color) {
    const label = plainText(text || 'Visitor', 24);
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    const w = ctx.measureText(label).width + 12;
    const x = rect.x + rect.w / 2 - w / 2, y = rect.y - 22;
    ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x, y, w, 16);
    if (color) { ctx.fillStyle = color; ctx.fillRect(x, y, 4, 16); }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2 + 2, y + 8);
    ctx.restore();
  }

  function drawItems(ctx, rect) {
    const size = Math.max(10, Math.round(rect.h / 3));
    let slotIndex = 0;
    for (const it of items) {
      if (!it.icon) continue;
      let x, y;
      if (it.slot === 'head') { x = rect.x + rect.w / 2 - size / 2; y = rect.y - size + size / 4; }
      else if (it.slot === 'hand') { x = rect.x + rect.w - size / 3; y = rect.y + rect.h / 2 - size / 2; }
      else if (it.slot === 'back') { x = rect.x - size * 2 / 3; y = rect.y + rect.h / 4; }
      else { x = rect.x + rect.w + 2 + slotIndex * (size + 2); y = rect.y + rect.h - size; slotIndex += 1; }
      ctx.drawImage(it.icon, x, y, size, size);
    }
  }

  const adapter = {
    supportedRungs: () => supports.slice(),
    setIdentity(name, color) { identity = { name: plainText(name, 64), color: color || null }; },

    async spawnModel() { throw new Error('this 2D game does not draw 3D models'); },

    async spawnSprite(image, frames) {
      const fw = frames?.frameWidth || image.width, fh = frames?.frameHeight || image.height;
      if (!fw || !fh) throw new Error('image has no size');
      const cols = Math.max(1, Math.floor(image.width / fw)), rows = Math.max(1, Math.floor(image.height / fh));
      const anims = Object.fromEntries(Object.entries(frames?.animations || {}).filter(([, v]) => validAnim(v) && v[1] < cols * rows));
      look = { image, fw, fh, cols, count: cols * rows, anims, t: 0, frame: anims.idle?.[0] ?? 0, anim: null };
    },

    spawnNameTag(name, color) { identity = { name: plainText(name, 64), color: color || null }; look = null; },

    /** meta: { id, name, kind, slot, uses }. Flat games show the item's icon; 3D item models are ignored. */
    async attachItem(slot, _model, icon, meta = {}) {
      items.push({ ...meta, slot: slot || meta.slot || 'none', icon: icon && icon.width ? icon : null });
    },

    /** Gives the game canvas keyboard focus. Keyboard listeners stay on window. */
    focusGame() {
      const el = canvasEl();
      if (!el) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      try { globalThis.window?.focus(); } catch { /* ignore */ }
    },

    /** opts: { x, y, w, h, color } in game units. onEnter fires once each time the player rectangle starts touching it. */
    addPortal(label, onEnter, opts = {}) {
      const p = { label: plainText(label, 40), onEnter, used: false, x: opts.x ?? 0, y: opts.y ?? 0, w: opts.w ?? 32, h: opts.h ?? 48, color: opts.color || '#8a5cff' };
      portals.push(p);
      return p;
    },

    /** Call every frame after the game moves its player. */
    update(dt, playerRect, moving = false) {
      clock += dt;
      if (look) {
        const want = moving ? animMap.moving : animMap.still;
        const name = look.anims[want] ? want : look.anims.idle ? 'idle' : Object.keys(look.anims)[0];
        if (name) {
          const a = look.anims[name];
          if (look.anim !== name) { look.anim = name; look.t = 0; }
          look.t += dt * fps;
          look.frame = a[0] + (Math.floor(look.t) % (a[1] - a[0] + 1));
        }
      }
      if (!playerRect) return;
      for (const p of portals) {
        const touching = playerRect.x < p.x + p.w && playerRect.x + playerRect.w > p.x && playerRect.y < p.y + p.h && playerRect.y + playerRect.h > p.y;
        if (touching && !p.used) { p.used = true; p.onEnter(); }
        if (!touching) p.used = false;
      }
    },

    drawPortals(ctx) {
      for (const p of portals) {
        ctx.save();
        const pulse = 0.25 + 0.15 * Math.abs(Math.sin(clock * 3));
        ctx.fillStyle = p.color; ctx.globalAlpha = pulse; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.globalAlpha = 1; ctx.strokeStyle = p.color; ctx.lineWidth = 3; ctx.strokeRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(p.label, p.x + p.w / 2, p.y - 6);
        ctx.restore();
      }
    },

    /**
     * Draws the player. With a visitor's sprite, that sprite fills the player's height, feet on the
     * player's feet. Otherwise drawOwnBody(color) draws the game's usual body. Then the items and
     * the name tag (only when someone arrived).
     */
    drawPlayer(ctx, rect, drawOwnBody, { facing = 1 } = {}) {
      if (look) {
        const h = rect.h, w = h * (look.fw / look.fh);
        const [sx, sy, sw, sh] = frameRect(look.frame);
        ctx.save(); ctx.imageSmoothingEnabled = false;
        const cx = rect.x + rect.w / 2;
        if (facing < 0) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
        ctx.drawImage(look.image, sx, sy, sw, sh, cx - w / 2, rect.y + rect.h - h, w, h);
        ctx.restore();
      } else if (drawOwnBody) {
        drawOwnBody(identity.color);
      }
      drawItems(ctx, rect);
      if (identity.name) drawTag(ctx, rect, identity.name, identity.color);
    },

    /** Portals, then the player. Call inside the game's camera transform. */
    draw(ctx, rect, drawOwnBody, opts) {
      adapter.drawPortals(ctx);
      if (rect) adapter.drawPlayer(ctx, rect, drawOwnBody, opts);
    },

    /** Short on-screen messages. Call in screen space, after the camera transform is undone. */
    drawMessages(ctx) {
      const live = messages.filter((m) => m.until > clock);
      if (!live.length) return;
      const w = ctx.canvas.width;
      ctx.save();
      ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      live.forEach((m, i) => {
        const y = 40 + i * 28;
        ctx.fillStyle = 'rgba(20,20,30,0.82)'; ctx.fillRect(16, y - 12, w - 32, 24);
        ctx.fillStyle = '#ffecaa'; ctx.fillText(m.text, w / 2, y);
      });
      ctx.restore();
    },

    /** Short message, shown for `seconds` of game time. Plain text only. */
    message(text, seconds = 8) { messages.push({ text: plainText(text, 120), until: clock + seconds }); },

    get look() { return look ? 'sprite' : identity.name ? 'nametag' : 'own-body'; },
    get identity() { return { ...identity }; },
    get frame() { return look ? look.frame : null; },
    get items() { return items.map(({ icon, ...rest }) => ({ ...rest, hasIcon: !!icon })); },
    get portals() { return portals.map(({ label, x, y, w, h, used }) => ({ label, x, y, w, h, used })); },
    get messages() { return messages.filter((m) => m.until > clock).map((m) => m.text); },
  };
  return adapter;
}
