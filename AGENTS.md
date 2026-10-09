# MONOCHROME — AGENTS.md

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
  yt-dlp server on that computer, so no extra config is needed. A static
  `dist` served without Vite has no proxy, so set `MONO_SERVER_URL` to the
  computer's LAN address at build time in that case. Carriers that block
  YouTube are covered by the IFrame fallback.

## Commands
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
- **Deezer has no CORS headers** on `api.deezer.com`; a plain `fetch()` is
  blocked. We go through `jsonp()` instead, which injects a `<script>` with
  `output=jsonp&callback=…`. This is the one source that is not `fetch`-based;
  do not "fix" it back to `fetch` or Deezer silently returns nothing.
- iTunes and Audius send `Access-Control-Allow-Origin: *`. Do not proxy them.
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
  genre rules. `parseMood` produces a profile, `buildSearchQuery` turns it into
  a live catalogue query; the Generate page then ranks results with
  `moodDistance`. Add moods by extending `RULES`.
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
  play, `startTrack` fires `upgradeToFullTrack` (Piped → YouTube search) and
  hot-swaps in the full video, keeping the position; in-flight lookups are
  deduped in an `upgrades` Map. `upgradeToFullTrack` returns `null` when there
  is no match (do not treat an unchanged id as a miss — it keeps the original
  id on purpose). The swapped track carries `previewTrack` so `onError` can
  fall back to the preview and set `playbackNote` if the embed is refused
  (bot check / region block).
- YouTube audio has two backends, tried in this order in `AudioEngine.load`:
  1. **Local yt-dlp server** (`server/index.mjs`, reached at `/api`): the
     listener's own machine resolves the direct audio URL and streams it, so
     full-length playback works and flows through the Web Audio analyser.
     `hasAudioServer()` probes `/api/health` once per session;
     `resolveFullAudio(videoId)` confirms a specific video via `/api/resolve`
     and returns the `/api/audio?id=…` URL. `upgradeToFullTrack` stores that
     URL on `streamUrl`, and the engine resolves it lazily for YouTube tracks
     that lack one. YouTube blocks anonymous stream access from datacenter
     IPs, so this backend is what makes it work on a home connection.
  2. **IFrame player** (`src/lib/youtube.ts`): fallback when the local server
     is absent or cannot pull the video. No analyser for these tracks.
