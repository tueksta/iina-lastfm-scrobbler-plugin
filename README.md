# IINA last.fm Scrobbler

A plugin for [IINA](https://iina.io) that scrobbles the music you play to [last.fm](https://www.last.fm).

With the new IINA plugin system the old mpv script solutions needed a replacement. This is a first draft of a plugin for last.fm scrobbling with its own settings and authorization flow. The [iina-listenbrainz](https://git.notfire.cc/notfire/iina-listenbrainz) plugin was a useful reference for how IINA plugins are put together.

## Features

- Scrobbles tracks to last.fm and sends "now playing" updates (can be turned off)
- Follows last.fm's rules: a track must be longer than 30 seconds, and is scrobbled after you have played half of it or 4 minutes, whichever comes first
- Counts time actually played. Seeking and pausing don't count towards the threshold
- Signs in through last.fm's browser-based flow, so your password is never entered into or stored by the plugin
- Keeps scrobbles in a queue and retries them if you are offline or last.fm is unreachable
- Sends the MusicBrainz track ID if the file has one, which helps last.fm match the track

## Requirements

- macOS with an IINA version that supports plugins (1.4.0 or later).
- A last.fm account.
- A last.fm API key and shared secret (see below). Each user creates their own.

## Installation

**From GitHub:** in IINA, open Settings → Plugins, choose to install from GitHub, and enter `tueksta/iina-lastfm-scrobbler-plugin`.

**From a release file:** download `lastfm-scrobbler.iinaplgz` from the [Releases](../../releases) page and double click it.

## Authorization with last.fm

You only need to do this once:

0. Login to your last.fm account in your browser
1. Create an API account at <https://www.last.fm/api/account/create>.
   - Fill in the name and description however you like.
   - Leave **Callback URL** blank. The plugin uses last.fm's desktop authentication, which doesn't use a callback.
2. Copy the **API key** and **Shared secret** that last.fm shows you (the secret will disappear once you close that page).
3. In IINA, open Settings → Plugins → last.fm Scrobbler → click on the ⓘ and paste both values in the respective fields.
4. Start playing some music, then from the menubar select **Plugin → last.fm Scrobbler → Start authorization…**. Your browser opens the last.fm authorization page to allow access for IINA to scrobble to last.fm. Click **Yes, allow access**.
5. Back in IINA, from the menubar select **...f inish authorization**. An on-screen message confirms the connection. You can also go to <https://www.last.fm/settings/applications> and confirm that the IINA player plugin is listed in the **Connected Applications** section of the webpage with the name and description you entered in Step 1.

That's it, a playing track should now immediately show up at last.fm as "Currently playing" and after the midpoint of the track or after 4 minutes (whichever comes first) the track should be scrobbled at last.fm.

If your session ever expires, the plugin will tell you to authorize again (only Step 4 & 5).

## How it works

- A file is only scrobbled if it has **artist** and **title** tags. If there is no `artist` tag, it falls back to `album artist`. `album` is sent when present. Tag names are matched case-insensitively.
- A track starts counting when IINA opens it. When the track has been played long enough, the scrobble is added to a queue and sent right away. Anything that fails stays in the queue and is retried automatically on the next track or manually from the **Status / retry queue** menu item.
- The scrobble timestamp is the moment playback of the track started, as last.fm expects.

### Menu items

| Item | What it does |
| --- | --- |
| Start authorization…  | Requests a token and opens the last.fm authorization page. |
| …finish authorization | Exchanges the approved token for a session key. |
| Status / retry queue  | Shows whether you are connected and how many scrobbles are waiting, and retries the queue. |

## Troubleshooting

Open the plugin's log: **Plugin menu → Developer Tool** for last.fm Scrobbler. All messages start with `[lastfm]`.

| Symptom | Likely cause |
| --- | --- |
| No `[lastfm]` lines at all | The plugin isn't loaded. Reinstall it and check that it is enabled in Settings → Plugins. |
| `session_key=EMPTY` | You haven't authorized yet. Run **Authorize…** and **Finish authorization**. |
| `skipping: need artist+title tags` | The file lacks an artist or title tag. The log lists the tag names it did find. |
| `track is 30s or shorter` | last.fm doesn't accept tracks of 30 seconds or less. |
| `scrobble failed ... (code 9)` | Your session is invalid. Authorize again. |
| `scrobble failed ... (code 26)` | Your API key is suspended or invalid. |

## Limitations

- Any file with artist and title tags is scrobbled, including tagged video files. There is currently no audio-only mode.
- Your API key, shared secret and session key are stored in IINA's plugin preferences on your Mac, not in the keychain.

## Uninstallation

If you ever decide to not scrobble from IINA anymore, open Settings → Plugins → Click on the ⋯ and select **Uninstall**. Then go to <https://www.last.fm/settings/applications> look for the IINA plugin with the name and description you used during installation and click on **Disconnect**.


## Development

Feel free to open Pull Requests for changes to the plugin - there is definitely a lot that can be improved, it's rather at a proof-of-concept stage right now. To build the plugin from source, go to lastfm-scrobbler folder and use `zip -r ../lastfm-scrobbler.iinaplgz . -x ".*" -x "__MACOSX/*"`.
