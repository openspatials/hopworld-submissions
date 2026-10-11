// hop-hook.js — Hopworld for Ember Hop. HOP
// The game is a classic script; its top-level names (hero, canvas) are read here by name.
import { createCanvas2DAdapter } from './hop/adapters/canvas2d/canvas2d.js'; // HOP
import { connectGame } from './hop/connect.js'; // HOP
const hopAdapter = createCanvas2DAdapter({ canvas }); // HOP
window.hopAdapter = hopAdapter; // HOP
connectGame({ // HOP
  adapter: hopAdapter,
  exitUrl: 'https://openspatials.com/hopworld/directory/',
  exitPortal: { x: 320, y: 338, w: 40, h: 72 },
  backPortal: { x: 20, y: 338, w: 40, h: 72 },
  getPlayerPosition: () => ({ x: hero.x, y: hero.y }),
});
