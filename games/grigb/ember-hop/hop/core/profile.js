// profile.js — finding and loading a game's own profile (04 section 4).
// Connectors look next to the page first (./hop.json, then ./.well-known/hop.json) and at the site
// root last (/.well-known/hop.json), so games in sibling folders of one shared site each find their own.
import { LIMITS, PROFILE_FILE, PROFILE_PATH } from './constants.js';
import { fetchLimited } from './net.js';
import { decodeText } from './util.js';
import { validateProfile } from './validate.js';

/**
 * The places a profile may live, in the order they are tried (04 section 4):
 * the game's own folder (`hop.json`, then `.well-known/hop.json`), then the site root
 * (`/.well-known/hop.json`). The folder is the page address up to its last `/`, so a game's
 * address should end with `/` or name its page (`.../my-game/` or `.../my-game/index.html`).
 * Duplicates are dropped: for a page at the site root, the last two are the same address.
 */
export function profileUrls(pageUrl) {
  const out = [];
  for (const rel of [PROFILE_FILE, PROFILE_PATH, '/' + PROFILE_PATH]) {
    const u = new URL(rel, pageUrl);
    u.search = ''; u.hash = '';
    if (!out.includes(u.href)) out.push(u.href);
  }
  return out;
}

/**
 * Loads the profile. Returns { profile, url, problems, tried }. Throws when neither place has a
 * readable JSON profile. A profile is the game's own file, so it is fetched from the page's own host.
 * A place that answers with something that is not JSON (a static host's HTML page for every path)
 * is skipped, and the next place is tried.
 */
export async function loadProfile(pageUrl = globalThis.location?.href, { timeoutMs = LIMITS.fetchTimeoutMs } = {}) {
  const tried = [];
  for (const url of profileUrls(pageUrl)) {
    try {
      const { bytes } = await fetchLimited(url, LIMITS.profileFileBytes, { timeoutMs });
      const profile = JSON.parse(decodeText(bytes));
      return { profile, url, problems: validateProfile(profile), tried: [...tried, { url, ok: true }] };
    } catch (e) {
      tried.push({ url, ok: false, reason: e.reason || 'invalid-file', detail: e.detail || e.message });
    }
  }
  const err = new Error(`no game profile found: ${tried.map((t) => `${t.url} (${t.reason})`).join(', ')}`);
  err.tried = tried;
  throw err;
}
