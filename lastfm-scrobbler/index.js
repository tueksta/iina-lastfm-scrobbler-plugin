const { core, event, mpv, preferences, console, http, menu, utils } = iina;
const { LastFm } = require("./lastfm.js");

const emit = (method, level, m) => {
  try { (typeof console[method] === "function" ? console[method] : console.log).call(console, `[lastfm] ${level}: ${m}`); } catch (_) {}
};
const log = {
  debug: (m) => { if (preferences.get("debug_logging") === true) emit("log", "DEBUG", m); },
  info: (m) => emit("log", "INFO", m),
  warn: (m) => emit("warn", "WARN", m),
  error: (m) => emit("error", "ERROR", m),
};
const osd = (m) => { log.debug("OSD: " + m); try { core.osd("last.fm: " + m); } catch (_) {} };

log.info("plugin loaded");
log.info(`prefs: api_key=${(preferences.get("api_key") || "").length ? "set" : "EMPTY"}, ` +
    `api_secret=${(preferences.get("api_secret") || "").length ? "set" : "EMPTY"}, ` +
    `session_key=${preferences.get("session_key") ? "set" : "EMPTY (run Plugin menu > Authorize)"}`);

const lfm = new LastFm(http, () => ({
  key: (preferences.get("api_key") || "").trim(),
  secret: (preferences.get("api_secret") || "").trim(),
  session: preferences.get("session_key") || "",
}), log);

// ---------- offline queue (persisted in preferences) ----------
function loadQueue() {
  try { return JSON.parse(preferences.get("queue") || "[]"); } catch (_) { return []; }
}
function saveQueue(q) {
  preferences.set("queue", JSON.stringify(q));
  preferences.sync();
}
let flushing = false;
async function flushQueue() {
  if (flushing) return;
  const n = loadQueue().length;
  if (!n) return;
  if (!preferences.get("session_key")) { log.warn(`${n} scrobble(s) queued but not authorized yet`); return; }
  flushing = true;
  log.info(`sending ${n} queued scrobble(s): ` + loadQueue().slice(0, 3).map((t) => `${t.artist} - ${t.title}`).join("; ") + (n > 3 ? ", ..." : ""));
  try {
    let q = loadQueue();
    while (q.length) {
      const batch = q.slice(0, 50);
      try {
        await lfm.scrobble(batch);
        log.debug(`sent ${batch.length} track(s)`);
        if (preferences.get("show_osd") !== false) osd(`scrobbled ${batch[batch.length - 1].artist} - ${batch[batch.length - 1].title}`);
        q = q.slice(batch.length);
        saveQueue(q);
      } catch (e) {
        log.error("scrobble failed: " + e.message + (e.code ? ` (code ${e.code})` : ""));
        if (e.code === 9) { // invalid session
          preferences.set("session_key", "");
          preferences.sync();
          osd("session expired, please re-authorize");
        }
        if (e.code === 6) { // invalid params: drop the batch so it can't block the queue
          q = q.slice(batch.length);
          saveQueue(q);
          continue;
        }
        break;
      }
    }
  } finally { flushing = false; }
}

// ---------- track state ----------
let cur = null;
let curPath = null;
let warnedNoMeta = false;
let trackTicks = 0;

const str = (prop) => { try { return mpv.getString(prop); } catch (_) { return null; } };
const num = (prop) => { const v = parseFloat(str(prop)); return isNaN(v) ? 0 : v; };

function readMetadata() {
  const raw = str("metadata");
  let md = null;
  try { md = JSON.parse(raw); } catch (_) {}
  if (!md) {
    if (!warnedNoMeta) { log.debug(`metadata unavailable (raw=${String(raw).slice(0, 100)})`); warnedNoMeta = true; }
    return null;
  }
  const lower = {};
  for (const k of Object.keys(md)) lower[k.toLowerCase()] = md[k];
  const title = lower["title"], artist = lower["artist"] || lower["album_artist"] || lower["albumartist"];
  if (!title || !artist) {
    if (!warnedNoMeta) { log.info(`skipping: need artist+title tags, found keys: ${Object.keys(md).join(", ") || "(none)"}`); warnedNoMeta = true; }
    return null;
  }
  return {
    title, artist,
    album: lower["album"] || "",
    albumArtist: lower["album_artist"] || lower["albumartist"] || "",
    mbid: lower["musicbrainz_trackid"] || "",
  };
}

function tryStart() {
  if (cur) return;
  const md = readMetadata();
  if (!md) return;
  const duration = num("duration");
  cur = {
    ...md, duration,
    startedAt: Math.floor(Date.now() / 1000),
    played: 0, lastPos: null, scrobbled: false,
  };
  log.info(`track: ${cur.artist} - ${cur.title} (${Math.round(duration)}s); will scrobble after ` +
      `${Math.round(Math.min(duration / 2, 240))}s played`);
  if (duration && duration <= 30) log.warn("track is 30s or shorter: last.fm won't accept it, skipping");
  if (preferences.get("now_playing") === false) {
    log.debug("now playing updates are disabled in preferences");
  } else if (!preferences.get("session_key")) {
    log.warn("NOT AUTHORIZED: no session key, so nothing is sent. Use Plugin menu > Authorize... then Finish authorization");
  } else {
    lfm.updateNowPlaying(cur).catch((e) => log.error("nowplaying failed: " + e.message));
  }
  flushQueue();
}

// Polling loop: also detects track changes itself, so it doesn't depend on events firing.
function tick() {
  const path = str("path");
  if (!path) return;
  if (path !== curPath) {
    curPath = path;
    cur = null;
    warnedNoMeta = false;
    trackTicks = 0;
    log.debug(`new file: ${path}`);
  }
  if (!cur) { tryStart(); if (!cur) return; }
  if (cur.scrobbled) return;

  const pos = parseFloat(str("time-pos"));
  if (isNaN(pos)) return;
  if (cur.lastPos !== null) {
    const d = pos - cur.lastPos;
    if (d > 0 && d < 5) cur.played += d; // ignore seeks
  }
  cur.lastPos = pos;

  if (!cur.duration) cur.duration = num("duration");
  trackTicks++;
  if (trackTicks % 15 === 0) log.debug(`progress: played ${Math.round(cur.played)}s of ${Math.round(cur.duration)}s`);
  if (cur.duration <= 30) return;
  const threshold = Math.min(cur.duration / 2, 240);
  if (cur.played >= threshold) {
    cur.scrobbled = true;
    log.info(`scrobbling "${cur.artist} - ${cur.title}": played ${Math.round(cur.played)}s of ${Math.round(cur.duration)}s (threshold ${Math.round(threshold)}s)`);
    const q = loadQueue();
    q.push({
      artist: cur.artist, title: cur.title, album: cur.album,
      albumArtist: cur.albumArtist, mbid: cur.mbid, duration: cur.duration, timestamp: cur.startedAt,
    });
    saveQueue(q);
    flushQueue();
  }
}

setInterval(tick, 1000);
log.debug("polling started");

// events are only used for logging / a quicker start
event.on("mpv.file-loaded", () => { log.debug("event: mpv.file-loaded"); });

// ---------- auth (via menu) ----------
async function authorize() {
  try {
    const { token } = await lfm.getToken();
    preferences.set("pending_token", token);
    preferences.sync();
    const key = (preferences.get("api_key") || "").trim();
    utils.open(`https://www.last.fm/api/auth/?api_key=${key}&token=${token}`);
    osd("Please approve the authorization request on the last.fm webpage, then choose '…finish authorization' from the menu");
  } catch (e) { osd("authorize failed: " + e.message); }
}

async function finishAuth() {
  const token = preferences.get("pending_token");
  if (!token) return osd("run 'Start authorization…' first");
  try {
    const r = await lfm.getSession(token);
    preferences.set("session_key", r.session.key);
    preferences.set("pending_token", "");
    preferences.sync();
    osd("connected as " + r.session.name);
    flushQueue();
  } catch (e) { osd("authorization failed: " + e.message); }
}

function status() {
  const n = loadQueue().length;
  osd((preferences.get("session_key") ? "connected" : "NOT connected") + `, ${n} queued`);
}

menu.addItem(menu.item("Start authorization…", authorize));
menu.addItem(menu.item("…finish authorization", finishAuth));
menu.addItem(menu.item("Status / retry queue", () => { status(); flushQueue(); }));
log.debug("menu items added");
