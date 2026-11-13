const { md5 } = require("./md5.js");

const API = "https://ws.audioscrobbler.com/2.0/";
const HEADERS = { "User-Agent": "iina-lastfm/0.1.0" };

// last.fm signature: sort params by name, concat name+value (excluding `format`/`callback`), append secret, md5.
function sign(params, secret) {
  const base = Object.keys(params)
    .filter((k) => k !== "format" && k !== "callback")
    .sort()
    .map((k) => k + params[k])
    .join("");
  return md5(base + secret);
}


const clip = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}... (${s.length} chars total)` : s);

// A last.fm field is either a string or {"#text": "...", "corrected": "0|1"}.
const txt = (v) => (v && typeof v === "object" ? v["#text"] || "" : v || "");
const wasCorrected = (v) => v && typeof v === "object" && String(v.corrected) === "1";

function describeTrack(t) {
  let s = `${txt(t.artist)} - ${txt(t.track)}`;
  const fixes = ["artist", "track", "album", "albumArtist"].filter((k) => wasCorrected(t[k])).map((k) => `${k} -> "${txt(t[k])}"`);
  if (fixes.length) s += ` (corrected: ${fixes.join(", ")})`;
  const ign = t.ignoredMessage;
  if (ign && String(ign.code) !== "0") s += ` [IGNORED code ${ign.code}: ${ign["#text"] || "no reason given"}]`;
  return s;
}

function summarize(method, body) {
  try {
    if (method === "track.updateNowPlaying" && body.nowplaying) return "now playing: " + describeTrack(body.nowplaying);
    if (method === "track.scrobble" && body.scrobbles) {
      const attr = body.scrobbles["@attr"] || {};
      const list = [].concat(body.scrobbles.scrobble || []);
      const lines = list.slice(0, 5).map(describeTrack);
      const more = list.length > 5 ? `, +${list.length - 5} more` : "";
      return `scrobbles: ${attr.accepted ?? "?"} accepted, ${attr.ignored ?? "?"} ignored: ${lines.join("; ")}${more}`;
    }
    if (method === "auth.getToken") return "got token";
    if (method === "auth.getSession") return `got session for user ${body.session && body.session.name}`;
  } catch (_) {}
  return clip(JSON.stringify(body));
}

// Error replies can come back as XML even when JSON was requested.
function parseErrorText(text) {
  if (!text) return null;
  try { const b = JSON.parse(text); if (b && b.error) return { code: b.error, message: b.message }; } catch (_) {}
  const m = /<error code="(\d+)">([\s\S]*?)<\/error>/.exec(text);
  return m ? { code: Number(m[1]), message: m[2].trim() } : null;
}

class LastFm {
  constructor(http, getCreds, log) {
    const noop = () => {};
    this.log = Object.assign({ debug: noop, info: noop, warn: noop, error: noop }, log);
    this.http = http;
    this.getCreds = getCreds; // () => { key, secret, session }
  }

  async call(method, params = {}, { post = false, needSession = false } = {}) {
    const { key, secret, session } = this.getCreds();
    if (!key || !secret) throw new Error("API key/secret not set");
    const p = { ...params, method, api_key: key };
    if (needSession) {
      if (!session) throw new Error("Not authorized");
      p.sk = session;
    }
    for (const k of Object.keys(p)) p[k] = String(p[k]);
    p.api_sig = sign(p, secret);
    p.format = "json";

    this.log.debug(`-> ${method} (post=${post}) params: ${Object.keys(p).join(",")}`);
    let res;
    try {
      res = post ? await this.http.post(API, { params: p, headers: HEADERS }) : await this.http.get(API, { params: p, headers: HEADERS });
    } catch (e) {
      const status = e && e.statusCode ? `HTTP ${e.statusCode} ${e.reason || ""}`.trim() : "no response";
      const parsed = parseErrorText(e && e.text);
      if (parsed) {
        this.log.error(`<- ${method} ${status}: last.fm error ${parsed.code}: ${parsed.message}`);
        const err = new Error(parsed.message || "last.fm error " + parsed.code);
        err.code = parsed.code;
        throw err;
      }
      let detail;
      try { detail = typeof e === "string" ? e : JSON.stringify(e, Object.getOwnPropertyNames(Object(e))); } catch (_) { detail = String(e); }
      this.log.error(`<- ${method} ${status}: ${clip(detail)}`);
      throw new Error("Network error: " + clip(detail, 120));
    }
    let body = res.data;
    if (!body || typeof body !== "object") {
      try { body = JSON.parse(res.text); } catch (_) { body = null; }
    }
    if (!body) {
      this.log.error(`<- ${method} HTTP ${res.statusCode}: unreadable reply: ${clip(String(res.text), 200)}`);
      throw new Error("Bad response (HTTP " + res.statusCode + ")");
    }
    if (body.error) {
      this.log.error(`<- ${method} HTTP ${res.statusCode}: last.fm error ${body.error}: ${body.message}`);
      const err = new Error(body.message || "last.fm error " + body.error);
      err.code = body.error;
      throw err;
    }
    const summary = summarize(method, body);
    // ignored scrobbles are a warning; everything else that succeeded is informational
    (summary.includes("[IGNORED") ? this.log.warn : this.log.info).call(this.log, `<- ${method} HTTP ${res.statusCode}: ${summary}`);
    return body;
  }

  getToken() { return this.call("auth.getToken"); }
  getSession(token) { return this.call("auth.getSession", { token }); }

  updateNowPlaying(t) {
    const p = { artist: t.artist, track: t.title };
    if (t.album) p.album = t.album;
    if (t.albumArtist) p.albumArtist = t.albumArtist;
    if (t.duration) p.duration = Math.round(t.duration);
    return this.call("track.updateNowPlaying", p, { post: true, needSession: true });
  }

  // tracks: [{artist,title,album,albumArtist,duration,timestamp}] (max 50)
  scrobble(tracks) {
    const p = {};
    tracks.forEach((t, i) => {
      p[`artist[${i}]`] = t.artist;
      p[`track[${i}]`] = t.title;
      p[`timestamp[${i}]`] = String(t.timestamp);
      if (t.album) p[`album[${i}]`] = t.album;
      if (t.albumArtist) p[`albumArtist[${i}]`] = t.albumArtist;
      if (t.mbid) p[`mbid[${i}]`] = t.mbid;
      if (t.duration) p[`duration[${i}]`] = String(Math.round(t.duration));
    });
    return this.call("track.scrobble", p, { post: true, needSession: true });
  }
}

module.exports = { LastFm, sign };
