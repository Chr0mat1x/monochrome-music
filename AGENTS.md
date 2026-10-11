# MONOCHROME — AGENTS.md

## Session snapshot (2026-10-08)
Work is committed on `master` (HEAD `b5e6a09`), working tree clean.
- Full-length playback: SoundCloud via the local yt-dlp proxy (`/api`), with a
  playability-checked matcher that skips DRM-protected label uploads; your
  machine's proxy handles it, the hosted site streams through `/api`.
- Artist pages pull up to 100 Deezer tracks, deduped to studio editions, 50 rows.
- Mood generator reads the description (`src/lib/moodPlanner.ts`) and composes
  queries; live profile preview as you type.
- `isPlayableTrack` (`src/lib/musicApi.ts`) strips catalogue filler — "Top 100
  Hits" compilations, hour-long DJ sets, `.wav` placeholders, sub-45s clips —
  on Home, Search and the mood generator.
- To resume locally: `npm run dev` (starts the yt-dlp proxy + Vite on :12000).
- A container restart wipes the toolchain, so reinstall before building the app:
  - `pip install yt-dlp` (full-length audio proxy needs it),
  - JDK 21 at `/home/openhands/jdk` (Temurin),
  - Android SDK at `/home/openhands/android-sdk` (cmdline-tools `latest`,
    platform-tools, platforms;android-35, build-tools;35.0.0).
  Then `JAVA_HOME=/home/openhands/jdk ANDROID_HOME=/home/openhands/android-sdk
  npm run build:apk`.
- Known limit on this host: YouTube returns "Sign in to confirm you're not a
  bot" for anonymous datacenter IPs; SoundCloud is the reliable full-song path.
  On a phone/home IP the YouTube IFrame player works.
- Live links: site https://work-1-bcnpsrwlxctxiqwy.prod-runtime.all-hands.dev/ ,
  APK at …/MONOCHROME.apk (served from `downloads/`).

## What this is
A Spotify-style music web app with a strict black-and-white design. There is
no backend of our own: the catalogue is fetched live from public music APIs
and streamed straight into the browser. It ships as an installable PWA so it
runs full-screen on a phone from the home screen.

## Stack
- Vite + React 18 + TypeScript
- Tailwind CSS (custom `ink` greyscale palette in `tailwind.config.js`)
- Zustand for state (`src/store/useStore.ts`)
- react-router-dom for routing
- PWA: `public/manifest.webmanifest`, `public/sw.js`, icons in `public/`

## Mobile / PWA
- Installable: manifest + service worker (`sw.js`, shell-only caching; `/api`
  and cross-origin calls always hit the network). The SW registers in
  production builds only, so `npm run dev` is never served stale.
- Layout is mobile-first: `MobileNav` (bottom tabs) on small screens, the
  desktop sidebar from `lg` up; the top-level shell is a column on phones.
- Safe areas: the app root, both players and the bottom nav use
  `env(safe-area-inset-*)`; the shell is `h-[100dvh]` so the URL bar cannot
  clip the player. The `Player` has a compact seek row on phones.
- `scripts/gen-icons.mjs` regenerates `public/*.png` (no image deps — writes
  PNGs via `zlib`). Run it after changing the brand mark.
- Full-length audio on a phone: open the app from the phone over the LAN at
  the Vite URL (e.g. `http://192.168.1.10:12000`) while `npm run dev` runs on
  the computer. The relative `/api` calls are then proxied by Vite to the
  yt-dlp server on that computer, so no extra config is needed and full songs
  come from SoundCloud (which streams from any IP). A static `dist` served
  without Vite has no proxy, so set `MONO_SERVER_URL` to the computer's LAN
  address at build time in that case. The bundled APK has no server of its
  own, so it falls back to the YouTube IFrame player for full tracks.

## Commands
- `npm run build:apk` — builds an installable, debug-signed Android APK
  (`scripts/build-apk.sh`). Requires JDK 17+ and `ANDROID_HOME`; it rebuilds the
  web bundle, copies `dist/` into `android/app/src/main/assets/`, runs
  `./gradlew assembleRelease`, and copies the result to `downloads/MONOCHROME.apk`.
  The audio proxy serves it at `/MONOCHROME.apk` (Vite proxies that path in dev),
  so it is downloadable from the running app. Keep the APK out of `public/`:
  Vite would bundle it into the web build, which the app then embeds, nesting
  each APK inside the next. The Android project is a thin WebView shell
  (`android/`): it serves the bundle over an https origin via WebViewAssetLoader
  so the YouTube IFrame full-track path works — do not move it back to `file://`.
  The APK is debug-signed for easy sideloading, not for store distribution.
- `npm run dev` — starts the local yt-dlp audio proxy *and* Vite together
  (`scripts/dev.mjs`); the app is on `0.0.0.0:12000`. Requires `yt-dlp` on the
  machine for full-length playback; without it the app still runs and falls
  back to YouTube's IFrame player.
- `npm run dev:web` — Vite only, no audio proxy.
- `npm run server` — the audio proxy alone (`server/index.mjs`, port 8787).
- `npm run build` — `tsc -b` type-check + production build
- Keep `allowedHosts: true` in `vite.config.ts` so the workspace proxy host is
  accepted, and keep the `/api` proxy entry pointing at the audio server.

## Data sources (`src/lib/musicApi.ts`)
- **Deezer** (`api.deezer.com`) — primary catalogue: mainstream artists, exact
  album tracklists, real release years, 1000×1000 artist portraits and XL
  covers, 30-second previews. `preview: true`.
- **iTunes Search API** (`itunes.apple.com`) — commercial tracks, 30-second
  official previews, artwork (upscaled to 1000×1000). `preview: true`.
- **Audius** (`api.audius.co` → discovery host) — decentralised, CC-licensed
  full-length streams. `preview: false`. Stream URLs are signed on demand, so
  they are resolved lazily at play time via `resolveAudiusStream`.
- **SoundCloud** (via the audio server) — full-length streams that work from
  any IP, including datacenter hosts where YouTube refuses anonymous playback.
  This is the primary full-song source. `preview: false`, `source:
  'soundcloud'`.
- **Deezer has no CORS headers** on `api.deezer.com`; a plain `fetch()` is
  blocked. We go through `jsonp()` instead, which injects a `<script>` with
  `output=jsonp&callback=…`. This is the one source that is not `fetch`-based;
  do not "fix" it back to `fetch` or Deezer silently returns nothing.
- iTunes and Audius send `Access-Control-Allow-Origin: *`. Do not proxy them.
- SoundCloud search/resolve runs server-side (yt-dlp `scsearch`); the browser
  never talks to SoundCloud directly. `http_mp3` is chosen because a browser
  `<audio>` element cannot play SoundCloud's HLS manifest.
- **SoundCloud calls are serialised and batched** (`scSerial`, `scSearchDirect`,
  `scResolveMany`, `/api/sc-resolve`). yt-dlp pays ~0.5s of Python startup per
  process, so one process per candidate dominated the wait; and SoundCloud
  answers a *burst* of extractor calls with HTTP 403 that can lock playback out
  for minutes. `/api/search?src=sc` therefore searches **and resolves** the
  results in one process, and `/api/sc-resolve?ids=a,b,c` resolves a whole batch
  in one. Every SoundCloud extraction goes through `scSerial`, so the server
  never fires two at once. The resulting direct URL is stored on the track
  (`streamUrl`), so clicking a search result plays instantly instead of
  triggering another lookup; `AudioEngine.urlFor` reuses it and re-resolves once
  if the URL has expired. A failed/rate-limited SoundCloud search returns an
  empty list rather than a 502, so Deezer/iTunes/Audius still fill the page.
- **Extractor backoff.** Both sources refuse anonymous datacenter IPs in bursts
  (SoundCloud: HTTP 403; YouTube: "Sign in to confirm you're not a bot" / "This
  video is not available"). `directUrl`/`scDirectUrl` set `ytBlockedUntil` /
  `scBlockedUntil` when they see it, so the server stops spawning doomed yt-dlp
  runs for the next few minutes instead of paying one failed process per
  candidate. `run()` also treats printed output as success even when yt-dlp
  exits non-zero, because `--ignore-errors` still exits 1 when one candidate is
  DRM-protected while the rest printed fine.
- `prefetchFullTracks` only warms the first 16 tracks: every SoundCloud lookup
  competes for the same serialised queue, so pre-resolving a whole 40-item list
  delays the tracks the listener is actually looking at.
- No API exposes energy/valence/tempo. `inferProfile(genre, seed)` derives
  those axes from genre keywords — this is the input the mood engine scores on.
- Track payloads embed the artist portrait; `mapDeezer` caches it in
  `artistPictures` so artist pages get a real photo without an extra lookup.

## Architecture notes
- `src/types.ts` — `Track` carries both musical metadata (`energy`, `valence`,
  `bpm`, `seed`) and playback info (`streamUrl`, `artwork`, `preview`,
  `source`, `sourceId`).
- `src/lib/audioEngine.ts` — streams real audio through an `<audio>` element
  routed via a Web Audio graph (`MediaElementSource → gain → analyser →
  destination`) so the visualiser gets a live spectrum. Audius URLs resolve
  lazily; `token` guards against out-of-order loads when skipping fast.
- `src/store/useStore.ts` — the APIs return new objects every call, so the
  store keeps a runtime `registry: Map<id, Track>`. Anything persisted (likes,
  recently-played, playlists) is stored as a full track snapshot. `reviveTrack`
  backfills profile fields on old saves.
- `src/lib/moodEngine.ts` — bilingual (RU/EN) keyword → energy/valence/bpm/
  genre rules. `parseMood` produces a profile, `buildSearchQuery`/`buildSearchQueries`
  turn it into live catalogue queries; the Generate page ranks results with
  `moodDistance`. Add low-level moods by extending `RULES`.
- `src/lib/moodPlanner.ts` — the understanding layer the Generate page uses.
  `planMoodLocal` reads the description as *concepts* across three axes
  (genre/mood/context), spots references ("как у Massive Attack"), and composes
  English queries (`<mood adj> <genre>`), a blended profile, a Russian "как я
  понял" summary and example artists. A free text model (Pollinations, no key)
  is raced against a short timeout to enrich the plan; the local planner is the
  source of truth, so it works offline (APK) and when the model is down. Add
  vocabulary by extending `CONCEPTS`.
- `src/components/Cover.tsx` — shows real artwork when present, otherwise
  deterministic monochrome generative SVG art from a seed string.
- `src/lib/format.ts` — duration / total-time / listener-count formatting.

## Conventions
- Monochrome only. Use the `ink-*` palette; never introduce colour.
- UI copy is Russian.
- Cards/tracks must show a source badge (`ПРЕВЬЮ 30С` vs `ПОЛНЫЙ ТРЕК`) so the
  distinction between 30s previews and full streams stays honest.
- The engine drives the store through `engine.setEvents` (onEnded, onPlaying-
  Change, onLoadingChange, onDuration, onError). Keep that wiring intact.
- Player keyboard shortcuts live in `Player.tsx` (space, ←/→ seek 5s, ↑/↓
  volume, N/B next/prev, S shuffle, R repeat, M mute). They ignore events
  whose target is an input/textarea.
- `downloadTrack` (`src/lib/download.ts`) fetches the CDN bytes into a Blob
  because the media hosts send permissive CORS headers; if that fetch is
  blocked it falls back to opening the raw URL.
- Full-length playback: commercial Deezer/iTunes tracks are 30s previews. On
  play, `startTrack` fires `upgradeToFullTrack` and hot-swaps in the full
  track, keeping the position; in-flight lookups are deduped in an `upgrades`
  Map. `upgradeToFullTrack` returns `null` when there is no match (do not treat
  an unchanged id as a miss — it keeps the original id on purpose). The swapped
  track carries `previewTrack` so `onError` can fall back to the preview and
  set `playbackNote` if the stream is refused (bot check / region block).
- `upgradeToFullTrack` tries sources in this order:
  1. **SoundCloud** (`findSoundCloudTrack` → `searchSoundCloud`, both via the
     audio server). Streams progressive MP3 from any IP, so it is the source
     that actually keeps full songs working in the hosted app. Matches are
     title/artist-checked, snippets under 65s are dropped and covers/remixes
     penalised; the Deezer/iTunes artwork is kept. `preview: false`,
     `source: 'soundcloud'`.
  2. **YouTube** (`findYouTubeTrack` → server yt-dlp search). With the local
     server it walks the ranked list for a video that actually resolves
     (time-bounded); without it, or when every probe is refused, it still
     returns the best match for the IFrame player (works from a residential
     IP). `preview: false`, `source: 'youtube'`.
  3. **Audius** (`findAudiusFull` → `searchAudius`). Whole-song streams, but
     the mainstream catalogue is mostly covers, so it is the last resort.
     Matches are title/artist-checked and covers/remixes are penalised; the
     Deezer/iTunes artwork is kept. `preview: false`, `source: 'audius'`.
  Returning `null` means nothing full-length exists, and the 30s preview stays.
- YouTube audio has two backends, tried in this order in `AudioEngine.load`:
  1. **Local yt-dlp server** (`server/index.mjs`, reached at `/api`): the
     listener's own machine resolves the direct audio URL and streams it, so
     full-length playback works and flows through the Web Audio analyser.
     `hasAudioServer()` probes `/api/health` once per session;
     `resolveFullAudio(id, src)` confirms a specific source via `/api/resolve`
     and returns the `/api/audio?src=…&id=…` URL (`src` is `'yt'` for YouTube,
     `'sc'` for SoundCloud). `upgradeToFullTrack` stores that
     URL on `streamUrl`, and the engine resolves it lazily for YouTube tracks
     that lack one. `directUrl` proves the URL with a one-byte ranged request
     before reporting success: `yt-dlp --get-url` prints a URL even when
     YouTube will refuse the stream, so without the probe a blocked video
     looked "available" and then failed silently. YouTube blocks anonymous
     stream access from datacenter IPs, so this backend is what makes it work
     on a home connection.
  2. **IFrame player** (`src/lib/youtube.ts`): fallback when the local server
     is absent or cannot pull the video. No analyser for these tracks.
- `onError` for a `source: 'youtube'` or `source: 'soundcloud'` track tries
  `findSoundCloudFull` first, then `findAudiusFull`, then the `previewTrack`
  (30s) as the final fallback.
- **Playability-aware matching.** `findSoundCloudTrack` walks its ranked
  candidates and returns the first one that actually streams, because
  SoundCloud's official label uploads are DRM-protected and never resolve.
  Inside the Android shell the URL is signed in Java (cheap), so it walks the
  list; through the companion server the top candidates are resolved in one
  batch (`warmSoundCloudTracks` → `/api/sc-resolve`) rather than one yt-dlp
  process each. `resolveFullTrack` skips SoundCloud/BT entirely when
  `hasAudioServer()` is false (the offline APK), going straight to the YouTube
  IFrame player.
- **Prefetch + broadcast.** `prefetchFullTracks(list)` resolves full versions
  in the background (4 at a time); `upgradeToFullTrack` memoises results in
  `fullTrackCache` and fires `subscribeFullTracks` listeners. Search/Artist/
  Home/Generate subscribe and swap previews in place, and `startTrack` starts
  an already-cached full version with no preview wait.
- **Artist completeness.** `getArtist` pulls Deezer `/top?limit=100` and
  `dedupeTracks` collapses live/remix/remaster editions to the studio original
  (`baseTitle`/`versionRank`); `ArtistPage` renders up to 50 rows.
- **Artist genres.** Deezer returns no genres on its artist or top-tracks
  endpoints, so `getArtist` reads the act's own genre from iTunes'
  `entity=musicArtist` result (`itunesArtistGenre`). Only the track *title* is
  inspected for a fallback guess — never the album name, which made every
  Queen track read as jazz (their album "Jazz").
- **Original recordings first.** `preferOriginals` drops lyric videos, covers,
  karaoke and sped-up edits from search/Home/generator results, but keeps the
  unfiltered list when fewer than 8 real songs remain (niche queries).
- **SoundCloud on the phone (native bridge).** SoundCloud streams full songs
  from any IP and its CDN sends `Access-Control-Allow-Origin: *`, but the API
  calls that search it and sign a media URL send no CORS headers — so the page
  cannot make them. The Android shell therefore exposes `window.MonoNative`
  (`SoundCloudBridge.java`, registered in `MainActivity`), which runs those
  calls in Java where no CORS rule applies. `src/lib/nativeBridge.ts` wraps it
  (async, callback id → `window.__monoNativeResult`); `searchSoundCloud` and
  `resolveFullAudio(id, 'sc')` use it when present. This gives the offline APK a
  second full-length source beside YouTube's IFrame player. The signed URL
  expires, so the native path deliberately bypasses `resolveCache`.
  Gotcha: SoundCloud serves a *script-free* page to mobile user-agents, which
  hides the client id — the bridge must scrape with a desktop UA.
- **Liquid glass UI.** Surfaces are frosted panes (`.glass`, `.glass-strong`,
  `.glass-menu`) with a hairline rim, an inner top highlight and a real
  `backdrop-filter` blur — plus `-webkit-backdrop-filter` for iOS. The top bar
  uses `.glass-bar` / `.glass-bar-scrolled` so it only fogs once content
  scrolls under it. A blur is invisible over a flat black page, so `.mono-ambient`
  paints slow-drifting grey light behind the app (App.tsx renders its three
  spans); the panes blur that light, which is what reads as glass. Everything
  stays strictly greyscale. `prefers-reduced-transparency` falls back to solid
  panels and hides the ambient layer; `prefers-reduced-motion` stops the drift.
- **"Моя волна" (src/lib/wave.ts + src/pages/Wave.tsx).** An endless personal
  stream. There is no account, so taste is inferred from `liked` (weight 2) and
  `recentlyPlayed` (weight fading with age) — a weighted mean of energy,
  valence and bpm plus tallied genres/artists. `nextWaveBatch` fans those out
  into search queries, ranks results by distance from the taste (recently
  liked artists score a bonus), caps each artist at two tracks and drops
  anything already queued. `waveMode` in the store makes `next()` treat the
  queue as endless (never auto-pause at the tail) and call `extendWave()` when
  fewer than five tracks remain, so the stream never stalls. A typed mood
  (`waveSeed`) blends into the profile via moodPlanner and outranks the
  inferred genres.
- **Search speed.** `searchAll` deliberately queries only Deezer, iTunes and
  Audius. YouTube and SoundCloud are reachable only through yt-dlp on the
  companion server, and each call spawns a fresh Python process (1.5-3s), so
  they are opt-in via `searchAll(q, n, true)` for pages that want them. Results
  are memoised for five minutes. The wave page calls `prewarmWave` on mount, so
  the opening batch is already fetched by the time the listener presses play;
  hovering a mood chip prewarms that mood too. The first wave batch favours
  whole songs (Audius streams directly, nothing to resolve) so playback starts
  without waiting on per-track lookups, and DJ sets are filtered out by length.


## yt-dlp on a fresh box

`pip install yt-dlp` puts the binary in `~/.local/bin`, which is **not** on PATH in this
environment. The proxy then logs `yt-dlp not found` and every resolve fails.
`scripts/dev.mjs` prepends `~/.local/bin` to the child PATH, and the server also
falls back to `python3 -m yt_dlp`, so `npm run dev` works either way. If nothing
plays after a rebuild, check `yt-dlp --version` first.
