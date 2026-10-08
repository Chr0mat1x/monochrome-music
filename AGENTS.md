# MONOCHROME — AGENTS.md

## What this is
A Spotify-style music web app with a strict black-and-white design. There is
no backend of our own: the catalogue is fetched live from two public, CORS-
enabled music APIs and streamed straight into the browser.

## Stack
- Vite + React 18 + TypeScript
- Tailwind CSS (custom `ink` greyscale palette in `tailwind.config.js`)
- Zustand for state (`src/store/useStore.ts`)
- react-router-dom for routing

## Commands
- `npm run dev` — dev server on `0.0.0.0:12000` (keep `allowedHosts: true` in
  `vite.config.ts` so the workspace proxy host is accepted)
- `npm run build` — `tsc -b` type-check + production build

## Data sources (`src/lib/musicApi.ts`)
- **iTunes Search API** (`itunes.apple.com`) — commercial tracks, 30-second
  official previews, real artwork. `preview: true`.
- **Audius** (`api.audius.co` → discovery host) — decentralised, CC-licensed
  full-length streams. `preview: false`. Stream URLs are signed on demand, so
  they are resolved lazily at play time via `resolveAudiusStream`.
- Both send `Access-Control-Allow-Origin: *`, which is what makes in-browser
  playback and the Web Audio analyser possible. Do not proxy them.
- Neither API exposes energy/valence/tempo. `inferProfile(genre, seed)` derives
  those axes from genre keywords — this is the input the mood engine scores on.

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
- Cards/tracks must show a source badge (PREVIEW vs AUDIUS · FULL) so the
  distinction between 30s previews and full streams stays honest.
- The engine drives the store through `engine.setEvents` (onEnded, onPlaying-
  Change, onLoadingChange, onDuration, onError). Keep that wiring intact.
