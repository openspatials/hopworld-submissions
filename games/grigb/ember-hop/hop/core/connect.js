// connect.js — one call that wires Hopworld into any web game.
// Moved here from src/adapters/three/connect.js by worker M5-G (M5-C and M5-F asked for it): the call
// has no engine code, it only uses the adapter's addPortal() and getPlayerTransform(), so the Three.js,
// Kaplay and canvas layers share it. src/adapters/three/connect.js re-exports it as connectThreeGame.
//
//   import { connectGame } from './hop/core/connect.js';
//   const { hop, arrival } = await connectGame({
//     adapter,                                          // any engine layer (Three.js, Kaplay, canvas)
//     exitUrl: 'https://other-game.example/',          // where the exit portal leads; default: the profile's `exit`
//     exitPortal: { position: [0, 1.2, -4] },           // position may be an array or an (async) function
//     backPortal: { position: [-4, 1.2, 2] },           // added when the visitor brought a return address
//   });
//   // in the game loop: adapter.update(dt, moving);
//
// What it does:
//   1. loads the game's profile (next to the page: ./hop.json, then ./.well-known/hop.json;
//      then the site-wide /.well-known/hop.json);
//   2. starts the shared web core with this adapter;
//   3. reads an arriving character from the page address; the core spawns the look and items,
//      then calls adapter.focusGame();
//   4. adds the exit portal (to exitUrl, else the profile's `exit`), and a back portal when the
//      visitor has a return address (also after a refusal, so a refused visitor can go back);
//   5. exposes window.hop (from the core) and a frozen window.hopTest (04 section 6).
import { createConnector } from './connector.js';
import { loadProfile } from './profile.js';
import { DIRECTORY_URL, DIRECTORY_NAME } from './constants.js';

function plainName(s, max = 48) {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

/**
 * The display name of the game at `url`, from its profile; falls back to the host name. The hosted
 * game directory (DIRECTORY_URL, the default exit) is named without a lookup: it has no profile.
 */
export async function gameNameAt(url) {
  try {
    const u = new URL(url);
    if (`${u.origin}${u.pathname}`.replace(/index\.html$/, '') === DIRECTORY_URL) return DIRECTORY_NAME;
  } catch { /* not an address: fall through */ }
  try {
    const { profile } = await loadProfile(new URL(url).href, { timeoutMs: 3000 });
    return plainName(profile?.name) || new URL(url).host;
  } catch {
    try { return new URL(url).host; } catch { return 'the other game'; }
  }
}

async function resolvePosition(p) {
  const v = typeof p === 'function' ? await p() : await p;
  return v;
}

/**
 * connectGame(options) -> { hop, arrival, profile, profileUrl, portals: { exit, back }, ready }
 *   adapter        from createThreeAdapter (required)
 *   exitUrl        where the exit portal leads; default: the profile's `exit`; no exit portal when neither is set
 *   exitLabel      label for the exit portal (default "To <destination name>")
 *   exitPortal     { position, color, radius }; position may be a function or a promise
 *   backLabel      label for the back portal (default "Back to <origin name>")
 *   backPortal     { position, color, radius }
 *   gameElement    the element focusGame's default would focus (passed to the core)
 *   profile        use this profile instead of loading one (tests)
 *   onArrived, onRefused, onPortal(kind, handle)
 *   getPlayerPosition  () => { x, y, z } for window.hopTest.player(); default: the adapter's transform
 */
export async function connectGame(options = {}) {
  const { adapter } = options;
  if (!adapter) throw new Error('connectGame: adapter is required');
  let profile = options.profile || null, profileUrl = null;
  if (!profile) {
    const loaded = await loadProfile(location.href);
    profile = loaded.profile; profileUrl = loaded.url;
    for (const p of loaded.problems || []) console.warn('[hop] game profile:', p);
  }
  const exitUrl = options.exitUrl ?? (typeof profile?.exit === 'string' ? profile.exit : null);
  const hop = createConnector().init(profile, adapter, { gameElement: options.gameElement });
  if (options.onArrived) hop.on('arrived', options.onArrived);
  if (options.onRefused) hop.on('refused', options.onRefused);

  const arrival = await hop.readArrival(new URL(location.href));
  const portals = { exit: null, back: null };

  const leave = () => {
    if (!exitUrl) return Promise.resolve(null);
    return hop.depart(new URL(exitUrl, location.href).href);
  };
  const back = () => hop.returnLink();

  const getPlayer = options.getPlayerPosition || (() => {
    const t = adapter.getPlayerTransform?.();
    return t ? { x: t.position[0], y: t.position[1], z: t.position[2] } : null;
  });

  window.hopTest = Object.freeze({
    profileLoadedFrom: profileUrl,
    exitUrl: exitUrl ? new URL(exitUrl, location.href).href : null,
    get hasExitPortal() { return !!portals.exit; },
    get hasBackPortal() { return !!portals.back; },
    exit: () => leave(),   // the same function the exit portal calls
    back: () => back(),    // the same function the back portal calls
    player: () => getPlayer(),
  });

  // portals: placed after the arrival, so a position function may wait (for example for a landing)
  const placing = [];
  if (exitUrl) {
    placing.push((async () => {
      const label = options.exitLabel || `To ${await gameNameAt(new URL(exitUrl, location.href).href)}`;
      const position = await resolvePosition(options.exitPortal?.position);
      portals.exit = adapter.addPortal(label, () => { leave().catch((e) => console.error('[hop] cannot leave:', e.message)); }, { ...options.exitPortal, position });
      options.onPortal?.('exit', portals.exit);
    })());
  }
  const returnUrl = hop.status.returnUrl;
  if (returnUrl && arrival) {
    placing.push((async () => {
      const label = options.backLabel || `Back to ${await gameNameAt(returnUrl)}`;
      const position = await resolvePosition(options.backPortal?.position);
      portals.back = adapter.addPortal(label, () => { back().catch((e) => console.error('[hop] cannot go back:', e.message)); }, { color: '#ff8a3d', ...options.backPortal, position });
      options.onPortal?.('back', portals.back);
    })());
  }
  const ready = Promise.all(placing).catch((e) => console.error('[hop] portal not placed:', e.message));
  return { hop, arrival, profile, profileUrl, portals, ready };
}

/** The same call under the Three.js layer's earlier name. */
export const connectThreeGame = connectGame;
