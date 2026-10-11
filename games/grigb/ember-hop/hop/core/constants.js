// constants.js — every name, version and limit of the shared web core in one place.
// Spec: docs/package/04-INTERFACE-SPECS.md (0.2-draft).
//
// The product prefix lives in PREFIX only. Renaming the product is a one-line change here
// (decision in force: "keep the prefix in one constant per language").

export const PREFIX = 'hop';

/** The version this core writes. */
export const SPEC_VERSION = '0.2-draft';

/** 04 section 0: in 0.x a reader lists the exact versions it knows and refuses any other. */
export const KNOWN_VERSIONS = Object.freeze(['0.1-draft', '0.2-draft']);

/** 04 section 1: closed list of item kinds. */
export const ITEM_KINDS = Object.freeze(['cosmetic', 'tool', 'collectible']);

/** 04 section 5: closed list of uses. */
export const USES = Object.freeze(['show', 'use', 'copy']);

/** Rung 1 full model, 2 simple model, 3 sprite or portrait, 4 name tag. */
export const RUNGS = Object.freeze([1, 2, 3, 4]);
export const RUNG_LOOKS = Object.freeze({ 1: ['vrm', 'gltf'], 2: ['simple'], 3: ['sprite', 'portrait'], 4: ['nametag'] });
export const MODEL_LOOKS = Object.freeze(['vrm', 'gltf', 'simple']);
export const IMAGE_LOOKS = Object.freeze(['sprite', 'portrait']);

/** 04 section 1 size limits (real, decompressed bytes) plus the fetch time limit. */
export const LIMITS = Object.freeze({
  characterFileBytes: 256 * 1024,
  ownershipFileBytes: 64 * 1024,
  profileFileBytes: 64 * 1024,
  characterModelBytes: 20 * 1024 * 1024,
  itemModelBytes: 2 * 1024 * 1024,
  imageBytes: 2 * 1024 * 1024,
  nameChars: 64,
  fetchTimeoutMs: 10000,
});

/** Universal Manifest purpose token for crossings (M4-UNIVERSAL-MANIFEST-FIT section 2). */
export const UM_PURPOSE = `${PREFIX}:game-crossing`;

/** Crossing link parameter names (04 section 3). */
export const LINK_PARAMS = Object.freeze({
  version: PREFIX,
  character: 'character',
  from: 'from',
  return: 'return',
  hash: 'hash',
});

/** Vibe Jam portal parameters (04 section 3, compatibility mode). */
export const VIBEJAM_PARAMS = Object.freeze(['portal', 'username', 'color', 'ref', 'avatar_url']);

/** Every parameter that is part of an arrival; removed when a game names its own address. */
export const ARRIVAL_PARAMS = Object.freeze([
  ...Object.values(LINK_PARAMS), ...VIBEJAM_PARAMS, 'speed', 'hp', 'team', 'speed_x', 'speed_y', 'speed_z', 'rotation_x', 'rotation_y', 'rotation_z',
]);

/**
 * Where a game serves its profile (04 section 4). Looked up in this order (profileUrls in profile.js):
 *   1. PROFILE_FILE next to the page (`./hop.json`, in the game's own folder);
 *   2. PROFILE_PATH next to the page (`./.well-known/hop.json`, the 0.2 page-relative place, still read);
 *   3. PROFILE_PATH at the site root (`/.well-known/hop.json`), the site-wide fallback.
 * A game hosted under a shared site (several games on one origin, such as
 * openspatials.com/hopworld/games/<owner>/<game>/) is found by its own folder first.
 */
export const PROFILE_FILE = `${PREFIX}.json`;
export const PROFILE_PATH = `.well-known/${PREFIX}.json`;

/**
 * The hosted game directory, the default exit (M7-D). A portal to it is labelled DIRECTORY_NAME
 * without looking up a profile: the directory is a page, not a game, and has no profile.
 */
export const DIRECTORY_URL = 'https://openspatials.com/hopworld/directory/';
export const DIRECTORY_NAME = 'Hopworld directory';

/** Global names on the web page (04 section 6). */
export const GLOBAL_NAME = PREFIX;            // window.hop
export const TEST_HOOK_NAME = `${PREFIX}Test`; // window.hopTest

/** Name shown when a visitor is refused. */
export const VISITOR_NAME = 'Visitor';
export const VISITOR_COLOR = '#888888';
