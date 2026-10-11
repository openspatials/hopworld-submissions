// index.js — the shared web core of Hopworld. One import for games and adapters.
//   import { createConnector, message, loadProfile } from './core/index.js';
export * from './constants.js';
export { createConnector } from './connector.js';
export { message, hasMessage, reasonKey, REASON_TEXT, REASON_CODES } from './reasons.js';
export { checkUrl, fetchLimited, isLoopbackHost, isPrivateHost, pageIsLoopback } from './net.js';
export { isKnownVersion, validateCharacter, validateProfile, checkProfile, checkStatus, scanForCode, resolveCharacterUrls, unsafeUrls, checkGlb, checkImage } from './validate.js';
export { readParams, buildLink, linkHash, addVibeJam, selfUrl, readLinkFromArgs } from './crossing.js';
export { ladder, predictRung } from './looks.js';
export { defaultFocusGame, findGameElement } from './focus.js';
export { initialStatus } from './status.js';
export { loadOwnership, evaluateRecord, permit, isLegacyRecord, localUsesFor, OWNERSHIP_STUB } from './ownership-bridge.js';
export { loadProfile, profileUrls } from './profile.js';
export { HopError } from './util.js';
export { connectGame, connectThreeGame, gameNameAt } from './connect.js';
