# MONOCHROME — AGENTS.md

## What this is
A Spotify-style music web app with a strict black-and-white design. There is
no backend: the entire music catalogue is generated procedurally at load time
and audio is synthesised live in the browser with the Web Audio API.

## Stack
- Vite + React 18 + TypeScript
- Tailwind CSS (custom `ink` greyscale palette in `tailwind.config.js`)
- Zustand for state (`src/store/useStore.ts`)
- react-router-dom for routing

## Commands
- `npm run dev` — dev server on `0.0.0.0:12000` (must keep `allowedHosts: true`
  in `vite.config.ts` so the workspace proxy host is accepted)
- `npm run build` — type-check (`tsc -b`) + production build
- `npm start`/preview is not wired; use `dev` for local preview

## Architecture notes
- `src/data/library.ts` — deterministic PRNG (`mulberry32`, fixed seed) builds
  20 artists / ~40 albums / ~200 tracks. Every track carries musical metadata
  the rest of the app relies on: `energy` (0-100), `valence` (0-100), `bpm`,
  `key`, `mode`, `waveform`, `mood[]`. Change the seed there to reshuffle the
  whole catalogue; keep the metadata shape stable — the mood engine, covers and
  audio engine all read it.
- `src/lib/audioEngine.ts` — renders a 32-bar loop per track via
  `OfflineAudioContext` from the track's key/mode/tempo/energy, then loops it.
  Tracks are cached (max 6 rendered buffers). Exposes an `AnalyserNode` used by
  `Visualizer`. `OfflineAudioContext` can be slow on the first render of a
  dense track — that is expected, not a bug. No real audio files are shipped.
- `src/lib/moodEngine.ts` — bilingual (RU/EN) keyword → energy/valence/bpm/genre
  rules. `generatePlaylist(description)` scores every track and returns the top
  N. Add new moods by extending the `RULES` array.
- `src/components/Cover.tsx` — deterministic SVG cover art generated from a seed
  string; no image assets.

## Conventions
- Monochrome only. Use the `ink-*` palette; never introduce colour.
- UI copy is Russian.
- Keep the current-track UI in sync with the engine via the zustand store; the
  engine calls `onEnded` to advance the queue.
