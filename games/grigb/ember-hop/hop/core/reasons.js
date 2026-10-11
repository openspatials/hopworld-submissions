// reasons.js — the refusal text table: one plain sentence per reason code (04 section 2).
// {item}, {game}, {kind} and {kinds} are filled in as plain text. Adapters must show the
// result as text (textContent, a Label, Kaplay plain text), never as HTML or markup.

const T = Object.freeze({
  // arrival
  'invalid-file': 'This character file could not be read.',
  'invalid-link': 'This link is not a valid crossing link.',
  'unknown-version': 'This character uses a newer format than {game} knows.',
  'fetch-failed': 'The character file could not be fetched.',
  'unsafe-file': 'This character file was refused for safety.',
  'too-large': '{item} is too big to load here.',
  'blocked-source': '{game} does not accept visitors from that game.',
  'tampered-link': 'This link was changed after it was made.',
  'missing-integrity': '{game} needs a checked link.',
  'vibejam-not-accepted': '{game} does not accept Vibe Jam visitors.',
  // ownership (arrival or item)
  'owner-forbids-show': '{item} stays behind: its owner\'s record does not allow it here.',
  'owner-forbids-use': '{item} can be shown here but not used: its owner\'s record does not allow it.',
  'owner-forbids-copy': '{item} can be shown here but not kept: its owner\'s record does not allow it.',
  'owner-no-right-listed': '{item} stays behind: its owner\'s record does not allow it here.',
  'ownership-wrong-character': '{item} stays behind: its ownership record is for another character.',
  'ownership-expired': '{item} stays behind: its ownership record has expired.',
  'ownership-not-yet-valid': '{item} stays behind: its ownership record is not valid yet.',
  'ownership-unreadable': '{item} stays behind: its ownership record could not be read.',
  'ownership-bad-signature': '{item} stays behind: its ownership record was changed after it was signed.',
  'show-only': '{item} can be shown here but not used: it has no ownership record.',
  'ownership-unverified': '{item} can be shown here but not used: its ownership record cannot be checked here.',
  'unknown-use': 'The game asked about a use that does not exist.',
  // item policy (prefix codes)
  'game-policy': '{item} stays behind: {game} accepts {kinds} items only, and this is a {kind}.',
  'unknown-kind': '{item} stays behind: {game} does not know what a {kind} is.',
  // look level: logged in status.lookAttempts, never shown to the player
  'bad-format': '{item} is not in a format this game can load.',
  'content-type': '{item} was served with the wrong content type.',
  'content-length': '{item} did not match its declared size.',
  'external-reference': '{item} points to files outside itself, so it was not loaded.',
  'unsafe-url': '{item} has an address that is not allowed.',
  // departure and other
  'no-character': 'There is no character to send.',
  'error': 'Something went wrong while bringing this character in.',
});

/** The table, read-only. Keys are reason codes; prefix codes are "game-policy" and "unknown-kind". */
export const REASON_TEXT = T;

/** Every reason code the core can emit, for tests. Prefix codes are listed by their prefix. */
export const REASON_CODES = Object.freeze(Object.keys(T));

/** The table key for a code: "game-policy:tool-not-accepted" -> "game-policy". */
export function reasonKey(code) {
  const c = String(code || '');
  if (c.startsWith('game-policy:')) return 'game-policy';
  if (c.startsWith('unknown-kind:')) return 'unknown-kind';
  return c;
}

/** True when the table has a sentence for this code. */
export function hasMessage(code) {
  return Object.prototype.hasOwnProperty.call(T, reasonKey(code));
}

/** Plain text only: strip control characters. Escaping for HTML is the adapter's job (textContent). */
const plain = (s, max = 80) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);

function listKinds(kinds) {
  const k = (kinds || []).map((x) => plain(x, 20));
  if (k.length <= 1) return k.join('');
  return `${k.slice(0, -1).join(', ')} and ${k[k.length - 1]}`;
}

/**
 * The plain sentence for a reason code.
 *   message('game-policy:tool-not-accepted', { item: 'Wooden sword', game: 'Pixel Princess', kinds: ['cosmetic'] })
 *   -> "Wooden sword stays behind: Pixel Princess accepts cosmetic items only, and this is a tool."
 */
export function message(code, { item, game, kinds, kind } = {}) {
  const c = String(code || 'error');
  let k = kind;
  if (k === undefined) {
    const m = /^game-policy:(.+)-not-accepted$/.exec(c) || /^unknown-kind:(.*)$/.exec(c);
    if (m) k = m[1];
  }
  const tpl = T[reasonKey(c)] ?? T.error;
  const out = tpl
    .replaceAll('{item}', plain(item || 'This item'))
    .replaceAll('{game}', plain(game || 'This game'))
    .replaceAll('{kinds}', listKinds(kinds))
    .replaceAll('{kind}', plain(k || 'thing', 20));
  return out.charAt(0).toUpperCase() + out.slice(1);
}
