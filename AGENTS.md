# MONOCHROME — AGENTS.md

## Session snapshot (2026-10-08)
Work is committed on `master` (HEAD `6279c9a`), pushed to `origin/main`.
- Full-length playback: SoundCloud via `api-v2.soundcloud.com` (server-side
  proxy at `/api`); a playability probe keeps only tracks that actually stream.
  Your machine's proxy handles it, the hosted site streams through `/api`.
- **SoundCloud HLS.** SoundCloud no longer serves progressive MP3 for most
  uploads — api-v2 hands out HLS manifests only, and even `policy: MONETIZE`
  (licensed) tracks now carry an anonymous stream. The server resolves a track
  to a *descriptor* (`{type:'progressive'|'hls', url}`), and for HLS it stitches
  the fMP4 segments (`init.mp4` + `dataNNN.m4s`) into one MP4 under
  `$TMPDIR/monochrome-hls/<id>.mp4`, served with byte ranges so seeking works
  without HLS.js. `resolve` only probes the first segment (cheap), while
  `audio` performs the build on first play. DRM renditions (`*-encrypted-hls`)
  are rejected. Do not reintroduce a `policy === 'MONETIZE'` filter in
  `playableFrom()` — it silently emptied the catalogue, since MONETIZE tracks
  lead nearly every query.
- Artist pages pull up to 100 Deezer tracks, deduped to studio editions, 50 rows.
- Mood generator reads the description (`src/lib/moodPlanner.ts`) and composes
  queries; live profile preview as you type.
- `isPlayableTrack` (`src/lib/musicApi.ts`) strips catalogue filler — "Top 100
  Hits" compilations, hour-long DJ sets, `.wav` placeholders, sub-45s clips —
  on Home, Search and the mood generator.
- To resume locally: `npm run dev` (starts the yt-dlp proxy + Vite on :12000).
- Mobile gestures: swipe left/right on the content to move between the five
  tabs (`lib/useSwipeTabs`, wired in `App.tsx`). The APK has no companion
  server, so SoundCloud goes through the native bridge, which now probes
  each result for a progressive stream before listing it.
- **Companion server address (`lib/serverConfig.ts`).** The APK has no
  server of its own, and on a network that blocks the music CDNs the phone
  cannot reach them either — so the app can be pointed at a deployment and
  will stream *through* it. The address is read on every call (so it takes
  effect without a reload) from `localStorage['mono.server']`, falling back
  to the build-time `VITE_MONO_SERVER`. Users set it in Настройки
  (`SettingsPanel`, also a `/settings` page and a Library tab); the panel
  probes `/api/health` on save and reports whether the server answers.
  `hasAudioServer()` no longer short-circuits to false inside the shell when
  an address is configured — that server is the whole point there. The
  build bakes one in via `MONO_SERVER_URL` (see `scripts/build-apk.sh`).
  Bare addresses are normalized to https, except private/LAN hosts
  (`localhost`, `10.*`, `192.168.*`, `172.16-31.*`, `*.local`), which get
  http — the usual way to run the server on your own computer. Non-http(s)
  schemes are rejected. The server already sends `access-control-allow-origin:
  *`, so the WebView (an `appassets.androidplatform.net` origin) can call it.
- A container restart wipes the toolchain. `scripts/bootstrap.sh` restores all
  of it in one shot — yt-dlp, JDK 21 at `/home/openhands/jdk` (Temurin),
  Android SDK at `/home/openhands/android-sdk` — and prints the exports to use.
  Run it, then `JAVA_HOME=/home/openhands/jdk ANDROID_HOME=/home/openhands/android-sdk
  npm run build:apk`. This box also has JDK 21 at
  `/usr/lib/jvm/java-21-openjdk-amd64` (apt `openjdk-21-jdk-headless`), which
  builds the APK too; `unzip` is absent, use Python's `zipfile`.
- Known limit on this host: YouTube returns "Sign in to confirm you're not a
  bot" for anonymous datacenter IPs; SoundCloud is the reliable full-song path.
  On a phone/home IP the YouTube IFrame player works.
- Live links: site https://work-1-bcnpsrwlxctxiqwy.prod-runtime.all-hands.dev/ ,
  APK at …/MONOCHROME.apk (served from `downloads/`, versionCode 5 / 1.4).

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
- Swipe navigation: a horizontal flick on the content moves one tab in
  bottom-nav order (`lib/useSwipeTabs`, wired in `App.tsx`; `TAB_PATHS` is the
  order). Only clearly horizontal gestures count — 60px minimum and the
  horizontal component must dominate — so vertical scrolling, horizontal
  carousels and the seek bar keep working. It is a no-op above `lg` (the
  sidebar is the navigation there) and on non-tab routes. The page wrapper's
  animation must end at `transform: none`: a lingering transform makes it the
  containing block for the `position: fixed` overlays rendered inside it
  (track menu, now-playing), which would then anchor to the page, not the
  screen.
- Safe areas: the app root, both players and the bottom nav use
  `env(safe-area-inset-*)`; the shell height comes from `.app-shell`
  (`100vh` then `100dvh`) so the URL bar cannot clip the player. The `Player`
  has a compact seek row on phones.
- **Scrolling:** the shell must have a *definite* height, and every flex item
  between it and `#main-scroll` needs `min-h-0`. A flex item's default
  `min-height:auto` lets `<main>` grow to its content; the shell is then
  overfull and `body{overflow:hidden}` clips the bottom — the page renders
  correctly but nothing scrolls. `.app-shell` keeps the `100vh` fallback for
  older Android WebViews that drop `100dvh`.
- `scripts/gen-icons.mjs` regenerates `public/*.png` (no image deps — writes
  PNGs via `zlib`). Run it after changing the brand mark.
- Full-length audio on a phone: open the app from the phone over the LAN at
  the Vite URL (e.g. `http://192.168.1.10:12000`) while `npm run dev` runs on
  the computer. The relative `/api` calls are then proxied by Vite to the
  yt-dlp server on that computer, so no extra config is needed and full songs
  come from SoundCloud (which streams from any IP). A static `dist` served
  without Vite has no proxy, so set `MONO_SERVER_URL` to the computer's LAN
  address at build time in that case. The bundled APK has no server of its
  own either, but it can be pointed at one: bake the address in with
  `MONO_SERVER_URL`, or type it in Настройки on the phone. Without that it
  falls back to the YouTube IFrame player for full tracks.

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
- SoundCloud search/resolve runs server-side; the browser never talks to
  SoundCloud directly. `http_mp3` is chosen because a browser `<audio>` element
  cannot play SoundCloud's HLS manifest.
- **SoundCloud goes through `api-v2.soundcloud.com` with a scraped `client_id`,
  not yt-dlp** (`scApiSearch`, `scGetClientId`, `scUrlFor`). yt-dlp is only a
  fallback now: from a datacenter IP it answers HTTP 403 in bursts, so routing
  normal traffic through it made search slow and playback flaky.
- **Three gates decide what a search may return**, and all three are needed
  because SoundCloud's anonymous policy is the opposite of what a listener
  expects:
  1. `policy === 'MONETIZE'` (licensed majors) has **no** anonymous stream at
     all — resolve returns 404. Dropped in `playableFrom`.
  2. Over-fetch, don't filter a short page: SoundCloud's first fifty hits for
     `"lofi"` are **all** MONETIZE, so a `limit=10` request filtered strictly
     returns nothing. `fetchN` asks for up to 60, then cuts back. A query that
     still yields nothing is broadened once to `"<q> mix"` / `"<q> beats"` so a
     broad one-word search is never a blank page.
  3. Many ALLOW uploads carry **only HLS** transcodings, which `<audio>` cannot
     play; the search response lists only HLS for everything, so it cannot be
     filtered by inspection. `probeProgressive` resolves the leading candidates
     and keeps the ones with a progressive stream. The probe also warms the
     resolve cache, so the clicked track starts instantly. If the probe finds
     nothing the API layer is likely degraded — trust the policy filter rather
     than blank the page.
- **`SNIP` uploads are playable 30-second clips, not junk.** Their progressive
  stream is served from `cf-preview-media`; rejecting URLs containing `preview`
  is what previously made every SNIP track fail to play. They are kept, flagged
  `policy: 'SNIP'`, labelled `ПРЕВЬЮ 30С` in the UI and sorted below full tracks.
- **yt-dlp failures never poison a track.** The fallback path only sets
  `scBlockedUntil` (a 60s throttle); it does not add the id to a permanent
  denial set. Marking ids denied on a 403/timeout is what previously made good
  tracks unplayable for the rest of the process.
- **SoundCloud calls are serialised and batched** (`scSerial`, `scSearchDirect`,
  `scResolveMany`, `/api/sc-resolve`). A *burst* of extractor calls gets HTTP
  403 that can lock playback out for minutes, so `/api/sc-resolve?ids=a,b,c`
  resolves a whole batch through one serialised queue. The resulting direct URL
  is stored on the track (`streamUrl`), so clicking a search result plays
  instantly; `AudioEngine.urlFor` reuses it and re-resolves once if expired. A
  failed/rate-limited SoundCloud search returns an empty list rather than a 502,
  so Deezer/iTunes/Audius still fill the page.
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
- Do NOT add a scroll-reveal / opacity-0-until-observed motion layer to lists
  and cards. A previous attempt (reverted in 1ed4fe9) left cards and rows at
  `opacity: 0` until an IntersectionObserver fired, which read as the page
  "not loading" and risked hiding content entirely. Entry motion that starts
  visible (CSS keyframes with `both` fill) is fine; motion that hides content
  until JS reveals it is not.
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
  The bridge must also run the same playability probe the server does, for
  the same reason: it may only list tracks it has confirmed carry a
  progressive stream, or the user taps a row that never plays. The search
  response cannot be filtered by inspection — it reports HLS for
  everything, including uploads that do have a progressive stream — so
  `probe()` fetches each leading candidate’s own `/tracks/{id}` record
  (which does list the progressive transcoding) in parallel. If the probe
  confirms nothing, fall back to the policy-filtered list, on the
  assumption that the API layer is degraded rather than the whole
  catalogue being HLS-only. `hasAudioServer()` returns false immediately
  inside the shell: there is no companion server, and `/api/health` would
  otherwise hit the asset loader.
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

## Permanent share links

`src/lib/share.ts` packs a track (or a whole playlist) into a URL segment under
`/s/<payload>`, opened by `src/pages/SharedPage.tsx`. The payload is
`JSON → deflate-raw → base64url` and carries the track metadata — never a
catalogue id and never a signed stream URL, both of which can expire or belong
to someone else's account. That is what makes the link permanent: it rebuilds
the same Track on any device, signed in or not. Keep new fields optional and
tolerate unknown ones, so links created by an older build keep opening.
`/playlist/<payload>` redirects to `/s/<payload>` for backwards compatibility.

## Playback pitfalls

* **The service worker must never cache dev modules.** `public/sw.js` used to
  cache every same-origin GET, including Vite's `/src/…` modules. A worker left
  over from an earlier build then served stale JavaScript: the page rendered but
  playback broke silently. It now caches only hashed build output (`/assets/`,
  icons, manifest). `index.html` also unregisters any stale worker and clears
  its caches once in dev, so an already-affected browser self-heals on reload.
* **A server-side YouTube block is not a browser-side block.** The companion
  server's datacenter IP is refused by YouTube, but the IFrame player embeds
  YouTube in the listener's own browser and streams from *their* IP. Never let
  `ytServerBlocked` stop a track from reaching the IFrame player — doing so
  turns every mainstream track into a 30-second preview.
* **The SoundCloud match deadline must clear a real extraction.** `resolveFullTrack`
  caps the SoundCloud lookup with `withDeadline(…, 8000)`. A flat search is
  ~1.5s and resolving a candidate's signed URL is ~2s cold, so the old 2s
  cut-off dropped the good match a few hundred ms before it landed and fell
  through to a YouTube id the datacenter IP cannot play — every mainstream track
  ended as a 30-second preview. When YouTube has *no* match, the wait is
  unbounded: SoundCloud is then the only playable source here.
* **Catalogue and uploads credit features differently.** Deezer says
  "Instant Crush (feat. Julian Casablancas)", SoundCloud says "Daft Punk -
  Instant Crush ft. Julian Casablancas (Official)". `cleanName` strips
  `feat/ft/featuring` and everything after it (`stripFeat`); without it the
  correct upload never matched and the track silently fell back to a preview.
* **The listener's network may block every catalogue, so the server proxies them.**
  Russia, for one, blocks Deezer, iTunes and Audius, and SoundCloud's CDN — none
  of the "live search" sources are reachable from the browser there, so the app
  plays nothing without a VPN. The server (unfiltered) now fetches them:
  `/api/proxy` streams an allow-listed URL (metadata + audio bytes, with range
  support), and `/api/audio-url` validates an Audius redirect and returns a
  proxied URL. The client routes every Deezer/iTunes/Audius call through
  `catalogueProxied()`/`proxied()` when the server is reachable. Do not widen
  `CATALOG_HOSTS` carelessly — the endpoint is only safe because it refuses
  anything not on the list.
* **Deezer media lives on `.dzcdn.net`, not on `api.deezer.com`.** Previews are
  served from `cdnt-preview.dzcdn.net` (and cover art from
  `e-cdns-images.dzcdn.net`). Leaving those hosts out of the allow-list made
  every Deezer preview 400 in the proxy, which surfaced to the listener as songs
  skipping themselves: each failure triggered the "find a full version" path and
  then `next()`. If tracks start auto-advancing, check the proxy allow-list
  first.
* **The proxy must ask for `accept-encoding: identity`.** Node transparently
  gunzips an upstream body, so forwarding the *compressed* `content-length`
  truncates the JSON. The header keeps the body uncompressed and the length
  truthful.
* **The APK has no server of its own.** Point it at a deployment with
  `VITE_MONO_SERVER=https://…/api` at build time (`npm run build:apk`), otherwise
  a phone on a blocking network has nothing to play. That is why the server
  sends CORS headers on every response.


## Release / hosting

Permanent download link comes from GitHub Releases, not from the sandbox:

```
git push origin master:main
gh release create v1.0 downloads/MONOCHROME.apk --repo Chr0mat1x/monochrome-music \
  --title "MONOCHROME 1.0" --notes "…"
```

The asset URL `https://github.com/Chr0mat1x/monochrome-music/releases/latest/download/MONOCHROME.apk`
is stable — bump the tag, not the filename, and re-upload the APK. The sandbox
link (`https://work-*/…/MONOCHROME.apk`) dies with the container, so never hand
it out as the primary link. Push the branch with the token inline
(`https://Chr0mat1x:$GITHUB_TOKEN@github.com/...`) — the sandbox git has no
credential helper and otherwise blocks on a username prompt.


## SoundCloud playability (the "ничего не играет" trap)

What an anonymous listener can stream from SoundCloud is decided by `policy`:

* `ALLOW`  → full-length progressive MP3, plays anywhere. **This is the goal.**
* `SNIP`   → the rights holder allows only a 30-second clip. Playable, but flag
  it `preview: true` so the UI says "ПРЕВЬЮ 30С".
* `MONETIZE` → no anonymous progressive stream at all; the signed endpoint
  404s. These must be **filtered out of search**, or every tap on them fails.

Two mistakes caused a total playback outage and are worth not repeating:

1. **Resolution went through yt-dlp.** On a datacenter IP yt-dlp gets burst
   403s from SoundCloud, and the 403 branch set `scBlockedUntil = now + 60s`
   for the *whole* catalogue — so one refusal silenced every later track.
   Resolution now uses `api-v2.soundcloud.com` with a scraped `client_id`
   (`scGetClientId`/`extractScViaApi`), which answers in ~0.3s and reports a
   dead upload per-track instead of globally. yt-dlp is only the fallback when
   the API layer itself fails (`scApiBrokenUntil`). The Android bridge always
   used this path.
2. **Search never asked SoundCloud.** `searchAll(q, 40)` defaulted to
   `soundcloud = false`, so the results were Deezer/iTunes 30s previews plus
   YouTube — nothing full-length. Search/Generate/Wave now pass `true`.

A second outage (an empty search page even though search *did* call SoundCloud)
had three more causes:

3. **A short page filtered down to nothing.** `limit=10` fetched ten results,
   dropped the MONETIZE ones, and often had zero left — SoundCloud's first
   *fifty* hits for `"lofi"` are all MONETIZE. Search now over-fetches up to 60
   and broadens a still-empty query to `"<q> mix"` / `"<q> beats"`.
4. **ALLOW was trusted without checking the stream.** Plenty of ALLOW uploads
   carry only HLS transcodings, which `<audio>` cannot play; the search response
   lists only HLS for *everything*, so it cannot be filtered by inspection.
   `probeProgressive` now resolves the leading candidates and keeps the ones
   with a real progressive stream.
5. **SNIP previews were rejected instead of played.** Their progressive stream
   lives on `cf-preview-media`, and the old `if (/preview/i.test(url)) return
   null` guard made every SNIP track fail. They are playable 30-second clips and
   are now kept and labelled. Related: the yt-dlp fallback used to add the id to
   a **permanent** denial set on any 403/timeout, so one transient failure made a
   good track unplayable until the process restarted. It only throttles now.

If playback breaks again, check in this order: does `/api/search?src=sc&q=…`
return items, does `/api/resolve?src=sc&id=…` return `{"ok":true}`, and does
`policy` filtering still match SoundCloud's current vocabulary.

