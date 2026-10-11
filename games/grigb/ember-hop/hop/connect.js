// connect.js — Hopworld: one call that wires the connector into a web game.
// Source: src/skill/source/hop/connect.js. Games get a GENERATED copy under hop/; do not edit the copy.
//
//   import { connectGame } from './hop/connect.js';
//   await connectGame({ adapter, exitUrl, exitPortal, backPortal, getPlayerPosition });
//
// connectGame is the shared connect call of the web core (src/core/connect.js). It only uses the
// adapter's addPortal() and getPlayerTransform(), so it works with every web layer (Three.js, Kaplay,
// canvas). With no exitUrl, the exit portal leads to the profile's `exit`. It loads the game profile, starts the shared core, reads an arrival,
// adds the exit and back portals, and sets window.hop and window.hopTest.
export { connectGame, gameNameAt } from './core/connect.js';
