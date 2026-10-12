import type { Track } from '../types'
import { planMoodLocal, planToQuery } from './moodPlanner'
import { searchAll, audiusTopUp, isPlayableTrack, preferOriginals } from './musicApi'

/**
 * "Моя волна" — an endless personal stream. There is no user account and no
 * server-side recommender, so the taste is inferred from what the listener has
 * liked and played, then used both to pick search queries and to rank what
 * those queries return.
 */

export interface Taste {
  energy: number
  valence: number
  bpm: number
  genres: string[]
  artists: string[]
  /** True once there is enough history to call the stream personal. */
  personal: boolean
}

/** Broad queries used to keep the stream fresh and to seed a brand-new listener. */
const DISCOVERY = [
  'indie electronic',
  'chill house',
  'synthwave retro',
  'lofi hip hop',
  'alternative rock',
  'ambient electronic',
  'nu disco',
  'neo soul',
  'deep house',
  'post rock',
  'dream pop',
  'trip hop',
]

const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, Math.round(v)))

function tally(items: string[]): string[] {
  const counts = new Map<string, number>()
  for (const raw of items) {
    const key = raw.trim().toLowerCase()
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
}

/**
 * Weighted average of the listener's profile: a liked song counts double, and
 * recent plays fade with age so the last few songs steer the stream more.
 */
export function buildTaste(liked: Track[], recent: Track[]): Taste {
  const samples: { t: Track; w: number }[] = []
  for (const t of liked) samples.push({ t, w: 2 })
  recent.forEach((t, i) => samples.push({ t, w: Math.max(0.35, 1 - i * 0.06) }))

  if (!samples.length) {
    return { energy: 55, valence: 55, bpm: 100, genres: [], artists: [], personal: false }
  }

  let ew = 0
  let vw = 0
  let bw = 0
  let tw = 0
  for (const { t, w } of samples) {
    ew += t.energy * w
    vw += t.valence * w
    if (t.bpm) {
      bw += t.bpm * w
      tw += w
    }
  }
  const total = samples.reduce((a, s) => a + s.w, 0)

  const genres = tally(samples.map((s) => s.t.genre).filter(Boolean)).slice(0, 4)
  const artists = tally(samples.map((s) => s.t.artist)).slice(0, 8)

  return {
    energy: clamp(ew / total),
    valence: clamp(vw / total),
    bpm: tw ? Math.round(bw / tw) : 100,
    genres,
    artists,
    personal: samples.length >= 3,
  }
}

/** Blend the inferred taste with an explicit mood the listener typed. */
function withSeed(taste: Taste, seed?: string): { taste: Taste; seedGenres: string[] } {
  if (!seed || !seed.trim()) return { taste, seedGenres: [] }
  const q = planToQuery(planMoodLocal(seed))
  const blended: Taste = {
    energy: clamp((taste.energy + q.energy) / 2),
    valence: clamp((taste.valence + q.valence) / 2),
    bpm: q.bpm || taste.bpm,
    // The typed mood should win over the inferred genres.
    genres: [...q.genres, ...taste.genres].slice(0, 4),
    artists: taste.artists,
    personal: true,
  }
  return { taste: blended, seedGenres: q.genres }
}

function pickQueries(taste: Taste, seed?: string): string[] {
  const out: string[] = []
  const seedPlan = seed?.trim() ? planMoodLocal(seed) : null
  if (seedPlan) {
    out.push(...seedPlan.queries.slice(0, 3))
    out.push(...seedPlan.artists.slice(0, 2))
  }
  out.push(...taste.genres.slice(0, 2))
  // An artist the listener keeps returning to is the strongest signal there is.
  out.push(...taste.artists.slice(0, 3))
  const shuffled = [...DISCOVERY].sort(() => Math.random() - 0.5)
  out.push(...shuffled.slice(0, taste.personal ? 1 : 3))
  return [...new Set(out.filter(Boolean))].slice(0, 5)
}

function textOf(t: Track): string {
  return `${t.title} ${t.artist} ${t.album} ${t.genre}`.toLowerCase()
}

/** Lower is better: how far a track sits from the listener's centre of gravity. */
function distance(t: Track, taste: Taste): number {
  let d = Math.abs(t.energy - taste.energy) + Math.abs(t.valence - taste.valence) * 0.7
  if (taste.bpm && t.bpm) d += Math.abs(t.bpm - taste.bpm) * 0.12

  const hay = textOf(t)
  if (taste.genres.length && !taste.genres.some((g) => hay.includes(g))) d += 14
  if (taste.artists.some((a) => hay.includes(a))) d -= 18
  // DJ sets and mixes are technically songs to the catalogues, not to a wave.
  if (t.duration && (t.duration > 900 || t.duration < 60)) d += 40
  return d
}

/**
 * Build the next batch of the wave. `exclude` holds ids already in the queue so
 * the stream never repeats itself, and one artist may appear at most twice.
 *
 * The first batch is biased toward tracks that play the instant they arrive
 * (Audius whole songs) so the wave starts immediately; later batches can take
 * in the commercial catalogues, whose previews are upgraded in the background.
 */
export async function nextWaveBatch(
  liked: Track[],
  recent: Track[],
  exclude: Set<string>,
  count = 20,
  seed?: string,
  instant = false,
): Promise<{ tracks: Track[]; taste: Taste }> {
  const { taste, seedGenres } = withSeed(buildTaste(liked, recent), seed)
  const queries = pickQueries(taste, seed)

  const batches = await Promise.all(
    queries.map((q) => searchAll(q, 30, true).catch(() => [])),
  )

  const seen = new Set<string>()
  const pool: Track[] = []
  for (const batch of batches) {
    for (const t of batch) {
      if (exclude.has(t.id) || seen.has(t.id)) continue
      seen.add(t.id)
      pool.push(t)
    }
  }

  // Whole songs first, so the opening of the wave needs no per-track resolve.
  if (instant) {
    // Audius is full of DJ sets and mixes; keep the instant pool to real songs.
    const playableLength = (t: Track) => !t.duration || (t.duration >= 90 && t.duration <= 900)
    const live = pool.filter((t) => !t.preview && t.streamable !== false && playableLength(t))
    const extra = await audiusTopUp(queries[0] ?? taste.genres[0] ?? 'electronic', count)
    for (const t of extra) {
      if (exclude.has(t.id) || seen.has(t.id) || t.preview || !playableLength(t)) continue
      seen.add(t.id)
      live.push(t)
    }
    if (live.length >= 8) {
      return { tracks: takeVaried(rank(live, taste, seedGenres), count), taste }
    }
    // Not enough whole songs in this mood: mix them in front of the previews.
    const rest = pool.filter((t) => t.preview)
    const mixed = [...live, ...rest]
    return { tracks: takeVaried(rank(mixed, taste, seedGenres), count), taste }
  }

  const usable = preferOriginals(pool.filter(isPlayableTrack))
  return { tracks: takeVaried(rank(usable, taste, seedGenres), count), taste }
}

function rank(tracks: Track[], taste: Taste, seedGenres: string[]): Track[] {
  return tracks
    .map((t) => ({ t, score: distance(t, taste) + seedBonus(t, seedGenres) }))
    .sort((a, b) => a.score - b.score)
    .map((s) => s.t)
}

/** Best-ranked first, but no artist may take more than two slots. */
function takeVaried(ranked: Track[], count: number): Track[] {
  const byArtist = new Map<string, number>()
  const tracks: Track[] = []
  for (const t of ranked) {
    if (tracks.length >= count) break
    const key = t.artist.toLowerCase()
    const n = byArtist.get(key) ?? 0
    if (n >= 2) continue
    byArtist.set(key, n + 1)
    tracks.push(t)
  }
  return tracks
}

/** A typed mood should surface first, so its own genres get a small nudge. */
function seedBonus(t: Track, seedGenres: string[]): number {
  if (!seedGenres.length) return 0
  const hay = textOf(t)
  return seedGenres.some((g) => hay.includes(g)) ? -12 : 0
}
