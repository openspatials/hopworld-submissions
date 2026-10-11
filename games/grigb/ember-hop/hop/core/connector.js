// connector.js — the connector (04 section 2) built from the core modules.
//
//   import { createConnector } from './core/index.js';
//   const hop = createConnector().init(profile, adapter, { pageUrl: location.href });
//   await hop.readArrival(new URL(location.href));   // null when the page has no arrival
//   await hop.depart('https://game-b.example/play');  // builds the link and goes there
//   window.hop.status                                  // read-only snapshot for checks
//
// Everything in a character file, a link or an ownership record is untrusted input.
import { GLOBAL_NAME, LIMITS, PREFIX, SPEC_VERSION, VISITOR_COLOR, VISITOR_NAME } from './constants.js';
import { HopError, decodeText, now as clock } from './util.js';
import { checkUrl, fetchLimited } from './net.js';
import { isKnownVersion, resolveCharacterUrls, unsafeUrls, validateCharacter, validateProfile } from './validate.js';
import { addVibeJam, buildLink, linkHash, readParams, selfUrl } from './crossing.js';
import { decideItems, defaultDecodeImage, ladder, predictRung, tryRung } from './looks.js';
import { evaluateRecord, isLegacyRecord, loadOwnership, permit } from './ownership-bridge.js';
import { message } from './reasons.js';
import { createStatusStore } from './status.js';
import { activeElement, defaultFocusGame } from './focus.js';

export function createConnector() {
  let profile = null, engine = null, opts = {}, own = null, ownReady = null;
  let characterBytes = null;      // bytes of the arrived character file (for the outgoing hash)
  let arrivedCharacter = null;    // the validated character in hand
  let params = null;              // the parsed arrival (status.arrival holds the raw parameters)
  const st = createStatusStore();
  const handlers = {};
  const emit = (ev, data) => (handlers[ev] || []).forEach((h) => { try { h(data); } catch (e) { st.warn(`handler for ${ev} failed: ${e.message}`); } });
  const pageUrl = () => opts.pageUrl || globalThis.location?.href || 'about:blank';
  const fetchOpts = () => ({ timeoutMs: opts.fetchTimeoutMs || LIMITS.fetchTimeoutMs, ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}) });
  const nowDate = () => (opts.now ? new Date(opts.now) : new Date());
  const gameName = () => profile?.name || 'This game';

  /** The sending game's address: its profile `play`, else `url`, else this page without arrival parameters. */
  function fromUrl() {
    if (opts.from) return opts.from;
    if (profile?.play) return new URL(profile.play, pageUrl()).href;
    if (profile?.url) return new URL(profile.url, pageUrl()).href;
    return selfUrl(pageUrl());
  }

  function focus() {
    let r;
    try {
      if (typeof engine.focusGame === 'function') {
        engine.focusGame();
        r = { called: true, by: 'adapter', element: activeElement() };
      } else {
        const d = defaultFocusGame(opts.gameElement);
        r = { called: true, by: 'default', element: d.element, focused: d.focused };
      }
    } catch (e) {
      r = { called: true, by: 'adapter', error: e.message };
      st.warn(`focusGame failed: ${e.message}`);
    }
    st.patch({ focus: r });
  }

  async function fetchJson(url, limit, reasonIfBad = 'invalid-file') {
    const { bytes } = await fetchLimited(url, limit, fetchOpts());
    try { return { json: JSON.parse(decodeText(bytes)), bytes }; } catch { throw new HopError(reasonIfBad, `${url} is not valid JSON`); }
  }

  async function loadCharacter(characterUrl, { expectHash } = {}) {
    let u;
    try { u = checkUrl(characterUrl, { pageUrl: pageUrl() }); } catch (e) { throw new HopError('unsafe-file', `character address: ${e.detail}`); }
    const { bytes } = await fetchLimited(u.href, LIMITS.characterFileBytes, fetchOpts());
    if (expectHash) await expectHash(bytes);
    let c;
    try { c = JSON.parse(decodeText(bytes)); } catch { throw new HopError('invalid-file', 'not valid JSON'); }
    const v = validateCharacter(c, { pageUrl: pageUrl(), base: u.href });
    if (v.reason) throw new HopError(v.reason, v.problems.join('; '));
    c = resolveCharacterUrls(c, u.href);
    if (c.id !== u.href) st.warn(`character id ${c.id} differs from the address it was fetched from (${u.href})`);
    return { character: c, bytes };
  }

  async function fetchOwnership(c) {
    if (!c.ownership) return { record: null, text: null };
    try {
      const u = checkUrl(c.ownership, { pageUrl: pageUrl() }).href;
      const { json, bytes } = await fetchJson(u, LIMITS.ownershipFileBytes, 'ownership-unreadable');
      // the old small record names its character relative to itself
      if (isLegacyRecord(json) && typeof json.character === 'string') json.character = new URL(json.character, u).href;
      return { record: json, text: decodeText(bytes) };
    } catch (e) {
      st.warn(`ownership record not usable: ${e.reason || ''} ${e.detail || e.message}`);
      return { record: { _unreadable: true, detail: e.detail || e.message }, text: null };
    }
  }

  function summary(c) {
    return {
      ...(c.id ? { id: c.id } : {}), name: c.name, color: c.color ?? null,
      looks: Object.fromEntries(Object.entries(c.looks || {}).map(([k, v]) => [k, typeof v?.url === 'string' ? v.url : null])),
      items: (c.items || []).map((i) => ({ id: i.id, ...(typeof i.name === 'string' ? { name: i.name } : {}), kind: i.kind })),
    };
  }

  function refuse(reason, detail, t0) {
    const msg = message(reason, { game: gameName(), item: reason === 'too-large' ? 'This character file' : undefined });
    const result = { status: 'refused', acceptedItems: [], refusedItems: [], reason, message: msg };
    st.patch({ state: 'refused', reason, message: msg, result, arrivalMs: Math.round(clock() - t0) });
    st.error(`${reason}${detail ? ': ' + detail : ''}`);
    st.log(`refused reason=${reason}${detail ? ' (' + detail + ')' : ''}`);
    try { engine.setIdentity?.(VISITOR_NAME, VISITOR_COLOR); engine.spawnNameTag(VISITOR_NAME, VISITOR_COLOR); st.patch({ rung: 4, look: 'nametag' }); }
    catch (e) { st.warn(`visitor name tag failed: ${e.message}`); }
    focus();
    emit('refused', result);
    return result;
  }

  function vibeJamCharacter(params) {
    const name = String(params.username || VISITOR_NAME).replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, LIMITS.nameChars).trim() || VISITOR_NAME;
    const color = /^#?[0-9a-fA-F]{6}$/.test(params.color || '') ? '#' + params.color.replace('#', '').toLowerCase() : undefined;
    const looks = {};
    if (params.avatarUrl) {
      // no declared size in Vibe Jam: the real-size limit applies while downloading
      if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(params.avatarUrl)) looks.portrait = { url: params.avatarUrl };
      else looks.gltf = { url: params.avatarUrl };
    }
    return { hop: SPEC_VERSION, id: null, name, updated: new Date(0).toISOString(), color, looks, items: [] };
  }

  const api = {
    get status() { return st.snapshot(); },

    /**
     * init(profile, adapter, options)
     * options: pageUrl (default location.href), gameElement (for the default focus), fetchTimeoutMs,
     * ownership (inject an ownership module), decodeImage, now (fixed clock for tests), from (override),
     * expose (default true: sets window.hop to this connector when a window exists).
     */
    init(gameProfile, engineAdapter, options = {}) {
      profile = gameProfile; engine = engineAdapter; opts = options;
      for (const p of validateProfile(profile)) st.warn(`game profile: ${p}`);
      st.patch({ state: 'ready', game: { name: profile?.name ?? null, url: profile?.url ?? null, play: profile?.play ?? null }, ladder: ladder(engine, profile) });
      ownReady = loadOwnership(options.ownership).then((m) => { own = m; st.patch({ permissionsSource: m.source }); });
      if (options.expose !== false && globalThis.window && typeof globalThis.window === 'object') {
        try { Object.defineProperty(globalThis.window, GLOBAL_NAME, { value: api, configurable: true, writable: false }); } catch { /* ignore */ }
      }
      return api;
    },

    on(event, handler) { (handlers[event] ||= []).push(handler); return api; },

    /** 04 section 3, receiver steps 1 to 9. Returns an ArrivalResult, or null when the URL has no arrival. */
    async readArrival(location = globalThis.location?.href) {
      await ownReady;
      const t0 = clock();
      let url;
      try { url = location instanceof URL ? location : new URL(String(location)); } catch { st.patch({ state: 'no-arrival' }); return null; }
      params = readParams(url);
      if (!params) { st.patch({ state: 'no-arrival' }); return null; }
      st.patch({ state: 'loading', mode: params.mode, arrival: Object.fromEntries([...url.searchParams].map(([k, v]) => [k, String(v)])) });
      let c, bytes = null;
      try {
        if (params.mode === PREFIX) {
          // (1) parameters
          if (!isKnownVersion(params.hop)) throw new HopError('unknown-version', `link ${PREFIX}=${params.hop}`);
          if (!params.character) throw new HopError('invalid-link', 'no character parameter');
          try { new URL(params.character); } catch { throw new HopError('invalid-link', 'character is not an absolute URL'); }
          if (!params.from) throw new HopError('invalid-link', 'no from parameter');
          const back = params.ret || params.from; // return defaults to from
          let returnUrl = null;
          try { returnUrl = checkUrl(back, { pageUrl: pageUrl() }).href; } catch { st.warn(`return address refused as unsafe: ${String(back).slice(0, 80)}`); }
          st.patch({ returnUrl });
          // (2) blocked sources
          if ((profile.blockedSources || []).some((b) => params.from.startsWith(b))) throw new HopError('blocked-source', params.from);
          // (3) fetch, (4) hash, (5) validate
          ({ character: c, bytes } = await loadCharacter(params.character, {
            expectHash: async (b) => {
              if (params.hash) {
                const expect = await linkHash({ hop: params.hop, character: params.character, from: params.from, ret: params.ret ?? '' }, b);
                if (expect !== params.hash) { st.patch({ integrity: 'mismatch' }); throw new HopError('tampered-link', 'hash does not match the link and the file'); }
                st.patch({ integrity: 'checked' });
              } else {
                st.patch({ integrity: 'missing' });
                if (profile.requireIntegrity) throw new HopError('missing-integrity', 'this game requires a hash parameter');
              }
            },
          }));
        } else {
          // Vibe Jam arrival: an in-memory character from the loose parameters
          if (profile.accepts?.vibejam === false) throw new HopError('vibejam-not-accepted', 'the game profile turns Vibe Jam arrivals off');
          let returnUrl = null;
          if (params.ref) { try { returnUrl = checkUrl(params.ref, { pageUrl: pageUrl() }).href; } catch { st.warn('ref refused as unsafe'); } }
          st.patch({ returnUrl, integrity: 'n/a' });
          if (params.ref && (profile.blockedSources || []).some((b) => params.ref.startsWith(b))) throw new HopError('blocked-source', params.ref);
          c = vibeJamCharacter(params);
          const unsafe = unsafeUrls(c, pageUrl());
          if (unsafe.length) throw new HopError('unsafe-file', unsafe.join('; '));
        }
        st.patch({ character: summary(c) });
        characterBytes = bytes; arrivedCharacter = c;
        // (6) ownership record
        const now = nowDate();
        const { record, text } = c.id ? await fetchOwnership(c) : { record: null, text: null };
        const ownEval = await evaluateRecord(own, record, text, c.id, now);
        st.patch({ ownership: { kind: ownEval.kind, usable: ownEval.usable, reason: ownEval.reason }, permissionsSource: ownEval.kind === 'none' ? 'none' : `${ownEval.kind} via ${own.source}` });
        if (ownEval.kind !== 'none' && !ownEval.usable) st.warn(`ownership record not usable (${ownEval.reason}${ownEval.detail ? ': ' + ownEval.detail : ''}): every item is refused`);
        const cp = permit(own, ownEval, c.id, '@character', 'show', now);
        if (!cp.allowed) throw new HopError('owner-forbids-show', cp.reason);
        // (7) policy and rung, (8) spawn, items, focus
        engine.setIdentity?.(c.name, c.color);
        const attempts = [];
        const ctx = { engine, profile, pageUrl: pageUrl(), fetchOpts: fetchOpts(), decodeImage: opts.decodeImage || defaultDecodeImage, attempts, log: st.log, warn: st.warn, own, ownEval, now };
        let rung = null, look = null;
        for (const r of ladder(engine, profile)) { look = await tryRung(r, c, ctx); if (look) { rung = r; break; } }
        const { accepted, refused, uses } = await decideItems(c, ctx, { attach: true });
        for (const r of refused) { st.log(`item refused: ${r.id} (${r.reason})`); emit('itemRefused', r); }
        const result = { status: 'arrived', rung, look, acceptedItems: accepted, refusedItems: refused };
        st.patch({ state: 'arrived', rung, look, lookAttempts: attempts, acceptedItems: accepted, refusedItems: refused, itemUses: uses, result, arrivalMs: Math.round(clock() - t0) });
        focus();
        // (9) events
        st.log(`arrived rung=${rung} look=${look} from=${params.from || params.ref || 'unknown'}`);
        emit('arrived', result);
        return result;
      } catch (e) {
        const err = e instanceof HopError ? e : new HopError('error', e?.message);
        const reason = err.reason === 'unsafe-url' ? 'unsafe-file' : err.reason;
        return refuse(reason, err.detail, t0);
      }
    },

    /** Ask first (04 section 3): fetch the destination profile and predict the result without leaving. */
    async preview(destinationProfileUrl, characterUrl) {
      await ownReady;
      try {
        const u = checkUrl(destinationProfileUrl, { pageUrl: pageUrl() }).href;
        const { json: dest } = await fetchJson(u, LIMITS.profileFileBytes);
        if (!isKnownVersion(dest?.hop)) return { status: 'refused', reason: 'unknown-version', message: message('unknown-version', { game: dest?.name }), acceptedItems: [], refusedItems: [], predicted: true };
        const cu = characterUrl || (params?.mode === PREFIX ? params.character : null) || st.get('character')?.id;
        if (!cu) throw new HopError('no-character', 'nothing to preview');
        const { character: c } = await loadCharacter(cu);
        const now = nowDate();
        const { record, text } = await fetchOwnership(c);
        const ownEval = await evaluateRecord(own, record, text, c.id, now);
        if (!permit(own, ownEval, c.id, '@character', 'show', now).allowed) return { status: 'refused', reason: 'owner-forbids-show', message: message('owner-forbids-show', { item: c.name }), acceptedItems: [], refusedItems: [], predicted: true };
        const rungs = [...[1, 2, 3].filter((r) => (dest.accepts?.rungs || [1, 2, 3, 4]).includes(r)), 4];
        const rung = predictRung(c, rungs);
        const { accepted, refused } = await decideItems(c, { engine, profile: dest, pageUrl: pageUrl(), own, ownEval, now, warn: st.warn, log: st.log }, { attach: false });
        return { status: 'arrived', rung, acceptedItems: accepted, refusedItems: refused, predicted: true, game: dest.name };
      } catch (e) {
        const reason = e.reason || 'error';
        return { status: 'refused', reason, message: message(reason), detail: e.detail || e.message, acceptedItems: [], refusedItems: [], predicted: true };
      }
    },

    /**
     * Builds the outgoing link (04 section 3) and, in a browser, goes there unless navigate: false.
     * opts.returnUrl: where the next game's back portal goes; left out by default (it defaults to from).
     * opts.vibejam: true adds Vibe Jam parameters; 'only' sends Vibe Jam parameters only.
     * opts.characterUrl: send this character instead of the arrived one (for example the game's own).
     * With no character, or after a refusal, the link is the plain destination (B1-5).
     */
    async depart(destinationUrl, o = {}) {
      const from = fromUrl();
      const dest = new URL(destinationUrl, pageUrl());
      const refused = st.get('state') === 'refused';
      const vibejam = o.vibejam;
      if (vibejam && profile?.accepts?.vibejam === false) throw new HopError('vibejam-not-accepted', 'the game profile turns Vibe Jam links off');
      const arrival = params;
      const characterUrl = refused ? null : (o.characterUrl || (arrival?.mode === PREFIX ? arrival.character : null) || profile?.character || null);
      const ret = o.returnUrl ?? null;
      let link;
      if (vibejam !== 'only' && characterUrl) {
        let bytes = characterBytes;
        if (!bytes || characterUrl !== arrival?.character) {
          ({ bytes } = await fetchLimited(checkUrl(characterUrl, { pageUrl: pageUrl() }).href, LIMITS.characterFileBytes, fetchOpts()));
        }
        link = new URL(await buildLink(dest.href, { hop: SPEC_VERSION, character: characterUrl, from, ret }, bytes));
      } else {
        link = dest;
        if (!characterUrl && vibejam !== 'only' && !vibejam) st.log('departing with no character: plain link');
      }
      if (vibejam && !refused) {
        const ch = st.get('character') || {};
        const lu = ch.looks || {};
        addVibeJam(link, {
          username: ch.name || VISITOR_NAME,
          color: ch.color,
          ref: ret || from,
          avatarUrl: o.avatarUrl || (arrival?.mode === 'vibejam' ? arrival.avatarUrl : null) || lu.vrm || lu.gltf || lu.portrait || null,
          extra: arrival?.mode === 'vibejam' ? arrival.ignored : {},
        });
      }
      const href = link.href;
      st.patch({ lastDepartLink: href });
      st.log(`departing to ${href}`);
      emit('departing', { link: href });
      if (o.navigate !== false && globalThis.location?.assign && !opts.noNavigate) globalThis.location.assign(href);
      return href;
    },

    /** The way back to where the player came from, carrying the same character. Null when there is none. */
    async returnLink(o = {}) {
      const back = st.get('returnUrl');
      if (!back) return null;
      const a = params;
      if (st.get('state') === 'refused') {
        // we do not vouch for a character we refused: a plain way back
        st.patch({ lastDepartLink: back });
        if (o.navigate !== false && globalThis.location?.assign && !opts.noNavigate) globalThis.location.assign(back);
        return back;
      }
      if (st.get('mode') === 'vibejam') {
        const u = new URL(back);
        addVibeJam(u, { username: a.username || VISITOR_NAME, color: a.color, ref: fromUrl(), avatarUrl: a.avatarUrl, extra: a.ignored || {} });
        st.patch({ lastDepartLink: u.href });
        emit('departing', { link: u.href });
        if (o.navigate !== false && globalThis.location?.assign && !opts.noNavigate) globalThis.location.assign(u.href);
        return u.href;
      }
      return api.depart(back, o);
    },

    /** The validated character in hand (a copy), or null. */
    character() { return arrivedCharacter ? JSON.parse(JSON.stringify(arrivedCharacter)) : null; },
  };
  return api;
}

