import type { Album, Artist, Source, Track } from '../types'

/* ------------------------------------------------------------------ *
 * Two real, CORS-enabled catalogues:
 *   - iTunes Search API  → commercial tracks, 30s official previews
 *   - Audius             → decentralised, CC-licensed full-length streams
 * Both are queried live; nothing is bundled.
 * ------------------------------------------------------------------ */

const ITUNES = 'https://itunes.apple.com'
const AUDIUS_FALLBACK = 'https://discoveryprovider.audius.co'
const APP_NAME = 'MONOCHROME'

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/* ---------- Audius discovery host (cached) ---------- */
let audiusHostPromise: Promise<string> | null = null
async function audiusHost(): Promise<string> {
  if (!audiusHostPromise) {
    audiusHostPromise = fetch('https://api.audius.co/')
      .then((r) => r.json())
      .then((d) => (Array.isArray(d?.data) && d.data[0]) || AUDIUS_FALLBACK)
      .catch(() => AUDIUS_FALLBACK)
  }
  return audiusHostPromise
}

/* ------------------------------------------------------------------ *
 * Attribute inference
 * Neither API exposes energy/valence/tempo, so the mood engine's inputs
 * are derived from genre keywords — the same axes the generator uses.
 * ------------------------------------------------------------------ */
interface GenreProfile {
  keys: string[]
  energy: number
  valence: number
  bpm: number
  moods: string[]
}

const GENRE_PROFILES: GenreProfile[] = [
  { keys: ['ambient', 'drone', 'new age', 'meditation', 'sleep', 'chillout'], energy: 14, valence: 54, bpm: 72, moods: ['спокойствие', 'медитация'] },
  { keys: ['lo-fi', 'lofi', 'chillhop', 'chill'], energy: 28, valence: 66, bpm: 84, moods: ['уют', 'учёба'] },
  { keys: ['classical', 'orchestra', 'piano', 'soundtrack', 'score', 'instrumental'], energy: 30, valence: 48, bpm: 82, moods: ['кинематографично'] },
  { keys: ['jazz', 'blues', 'soul', 'easy listening', 'bossa'], energy: 42, valence: 52, bpm: 98, moods: ['нуар'] },
  { keys: ['folk', 'country', 'singer', 'acoustic', 'americana'], energy: 38, valence: 62, bpm: 92, moods: ['ностальгия'] },
  { keys: ['metal', 'hardcore', 'punk', 'industrial', 'grunge'], energy: 95, valence: 24, bpm: 152, moods: ['агрессия', 'драйв'] },
  { keys: ['rock', 'alternative', 'emo'], energy: 78, valence: 47, bpm: 128, moods: ['драйв'] },
  { keys: ['techno', 'house', 'trance', 'edm', 'electronic', 'dance', 'club', 'drum & bass', 'dubstep', 'breakbeat', 'edm'], energy: 91, valence: 70, bpm: 142, moods: ['клуб', 'движение'] },
  { keys: ['hip-hop', 'hip hop', 'rap', 'trap', 'drill', 'grime'], energy: 70, valence: 52, bpm: 96, moods: ['энергия'] },
  { keys: ['r&b', 'rnb', 'neo soul'], energy: 52, valence: 64, bpm: 100, moods: ['романтика'] },
  { keys: ['k-pop', 'j-pop', 'anime', 'cantopop', 'mandopop'], energy: 82, valence: 84, bpm: 130, moods: ['энергия'] },
  { keys: ['reggae', 'dancehall', 'latin', 'afrobeat', 'afro'], energy: 64, valence: 80, bpm: 102, moods: ['лето'] },
  { keys: ['holiday', 'christmas', 'gospel', 'christian'], energy: 50, valence: 72, bpm: 104, moods: ['надежда'] },
  { keys: ['pop'], energy: 68, valence: 82, bpm: 118, moods: ['радость'] },
]

const DEFAULT_PROFILE: GenreProfile = { keys: [], energy: 56, valence: 58, bpm: 110, moods: ['музыка'] }

export function inferProfile(genre: string, seedInput: string) {
  const g = (genre || '').toLowerCase()
  const profile = GENRE_PROFILES.find((p) => p.keys.some((k) => g.includes(k))) ?? DEFAULT_PROFILE
  const h = hash(seedInput)
  const jitter = ((h % 21) - 10) // -10..+10
  return {
    energy: Math.max(2, Math.min(100, profile.energy + Math.round(jitter / 2))),
    valence: Math.max(2, Math.min(100, profile.valence + Math.round(jitter / 2))),
    bpm: Math.max(55, profile.bpm + jitter),
    moods: profile.moods,
    seed: h,
  }
}

/* ------------------------------------------------------------------ *
 * Mappers
 * ------------------------------------------------------------------ */
function mapItunes(r: any): Track | null {
  if (!r || r.wrapperType !== 'track' || !r.previewUrl) return null
  const genre: string = r.primaryGenreName || ''
  const year = r.releaseDate ? new Date(r.releaseDate).getFullYear() : 2020
  const profile = inferProfile(genre, `${r.trackName}${r.artistName}`)
  return {
    id: `it-${r.trackId}`,
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName ?? '',
    duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 30,
    genre,
    year,
    mood: profile.moods,
    energy: profile.energy,
    valence: profile.valence,
    bpm: profile.bpm,
    seed: profile.seed,
    source: 'itunes' as Source,
    streamUrl: r.previewUrl,
    artwork: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : null,
    preview: true,
    sourceId: String(r.trackId),
    permalink: r.trackViewUrl ?? null,
  }
}

function pickArtwork(art: any): string | null {
  if (!art) return null
  return art['1000x1000'] || art['480x480'] || art['150x150'] || null
}

function mapAudius(t: any): Track | null {
  if (!t || !t.id) return null
  const genre: string = t.genre || ''
  const year = t.release_date ? new Date(t.release_date).getFullYear() : 2020
  const artistName: string = t.user?.name || t.user?.handle || 'Unknown'
  const profile = inferProfile(genre, `${t.title}${artistName}`)
  return {
    id: `au-${t.id}`,
    title: t.title,
    artist: artistName,
    album: t.album_name || `${artistName} — синглы`,
    duration: t.duration ?? 0,
    genre,
    year,
    mood: profile.moods,
    energy: profile.energy,
    valence: profile.valence,
    bpm: profile.bpm,
    seed: profile.seed,
    source: 'audius' as Source,
    streamUrl: null, // resolved lazily on play
    artwork: pickArtwork(t.artwork),
    preview: false,
    sourceId: String(t.id),
    permalink: t.permalink ? `https://audius.co${t.permalink}` : null,
  }
}

/* ------------------------------------------------------------------ *
 * iTunes
 * ------------------------------------------------------------------ */
export async function searchItunes(term: string, limit = 25): Promise<Track[]> {
  if (!term.trim()) return []
  const url = `${ITUNES}/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.results ?? []).map(mapItunes).filter(Boolean) as Track[]
}

export async function itunesAlbumTracks(collectionId: string): Promise<Track[]> {
  const url = `${ITUNES}/lookup?id=${collectionId}&entity=song&limit=200`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  return (data.results ?? []).map(mapItunes).filter(Boolean) as Track[]
}

/* ------------------------------------------------------------------ *
 * Audius
 * ------------------------------------------------------------------ */
export async function searchAudius(query: string, limit = 25): Promise<Track[]> {
  if (!query.trim()) return []
  const host = await audiusHost()
  const url = `${host}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=${APP_NAME}`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data.data ?? []).map(mapAudius).filter(Boolean) as Track[]
  } catch {
    return []
  }
}

export async function audiusTrending(limit = 25, genre = ''): Promise<Track[]> {
  const host = await audiusHost()
  const url = `${host}/v1/tracks/trending?limit=${limit}&app_name=${APP_NAME}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return (data.data ?? []).map(mapAudius).filter(Boolean) as Track[]
  } catch {
    return []
  }
}

export async function resolveAudiusStream(trackId: string): Promise<string | null> {
  const host = await audiusHost()
  return `${host}/v1/tracks/${trackId}/stream?app_name=${APP_NAME}`
}

/* ------------------------------------------------------------------ *
 * Combined search — interleave both catalogues, dedupe by title+artist
 * ------------------------------------------------------------------ */
export async function searchAll(query: string, limit = 40): Promise<Track[]> {
  const [it, au] = await Promise.all([
    searchItunes(query, Math.ceil(limit / 2)).catch(() => []),
    searchAudius(query, Math.ceil(limit / 2)).catch(() => []),
  ])
  const seen = new Set<string>()
  const out: Track[] = []
  const max = Math.max(it.length, au.length)
  for (let i = 0; i < max && out.length < limit; i++) {
    for (const t of [it[i], au[i]]) {
      if (!t) continue
      const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Artist / album lookups
 * ------------------------------------------------------------------ */
function titleCase(s: string) {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export async function getArtist(name: string): Promise<{ artist: Artist; tracks: Track[]; albums: Album[] }> {
  const tracks = await searchAll(name, 40)
  const own = tracks.filter((t) => t.artist.toLowerCase() === name.toLowerCase())
  const pool = own.length >= 4 ? own : tracks

  const albumMap = new Map<string, Album>()
  for (const t of pool) {
    if (!t.album) continue
    const key = t.album
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        id: `al-${t.source}-${hash(t.artist + t.album)}`,
        title: t.album,
        artist: t.artist,
        year: t.year,
        trackIds: [],
        artwork: t.artwork,
        genre: t.genre,
      })
    }
    albumMap.get(key)!.trackIds.push(t.id)
  }

  const profile = pool[0] ? inferProfile(pool[0].genre, name) : inferProfile('', name)
  const artist: Artist = {
    id: `ar-${hash(name)}`,
    name,
    genres: Array.from(new Set(pool.map((t) => t.genre).filter(Boolean))).slice(0, 3),
    bio: `${titleCase(name)} — реальный артист из каталогов iTunes и Audius. Здесь собраны доступные треки и релизы, найденные вживую по запросу.`,
    monthly: 100_000 + (hash(name) % 4_000_000),
    picture: pool.find((t) => t.artwork)?.artwork ?? null,
  }
  return { artist, tracks: pool, albums: Array.from(albumMap.values()).filter((a) => a.trackIds.length >= 2) }
}

export async function getAlbum(albumId: string): Promise<{ album: Album; tracks: Track[] } | null> {
  // albumId format: al-{source}-{hash}
  const [, source] = albumId.split('-')
  return null // albums are resolved from live search context instead
}

export function albumKeyFor(track: Track): string {
  return `al-${track.source}-${hash(track.artist + track.album)}`
}

export function albumIdFromTrack(track: Track): string {
  return albumKeyFor(track)
}
