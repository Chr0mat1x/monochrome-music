import type { Album, Artist, Source, Track } from '../types'

/* ------------------------------------------------------------------ *
 * Three live, CORS-enabled catalogues:
 *   - Deezer   → commercial tracks (Limp Bizkit, Coldplay…), 30s
 *                previews, real artist photos and XL album art.
 *   - iTunes   → commercial tracks, 30s official previews, artwork.
 *   - Audius   → decentralised, CC-licensed FULL-LENGTH streams.
 * Nothing is bundled; everything is queried live.
 *
 * Note on "full versions": mainstream labels only license 30-second
 * previews to third-party apps for free. Full streams are therefore
 * limited to Audius (independent / CC catalogue). Preview vs. full is
 * surfaced in the UI via the `preview` flag.
 * ------------------------------------------------------------------ */

const DEEZER = 'https://api.deezer.com'
const ITUNES = 'https://itunes.apple.com'
const AUDIUS_FALLBACK = 'https://discoveryprovider.audius.co'
const APP_NAME = 'MONOCHROME'

/**
 * Piped instances expose a keyless, CORS-enabled search over the YouTube
 * catalogue. We only use them to find a videoId; playback happens through the
 * official YouTube IFrame player, so nothing is scraped or proxied.
 * Instances go down often, hence the fallback list.
 */
const PIPED_HOSTS = [
  'https://api.piped.private.coffee',
  'https://pipedapi.ducks.party',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
]

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

async function jsonFetch<T = any>(url: string, timeout = 12000): Promise<T | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The Deezer REST API does not send CORS headers, so browser fetch() is
 * blocked. It does support JSONP, which sidesteps CORS entirely. We only use
 * this for Deezer; everything else goes through fetch().
 */
let jsonpSeq = 0
function jsonp<T = any>(url: string, timeout = 12000): Promise<T | null> {
  return new Promise((resolve) => {
    const name = `__mono_jsonp_${Date.now().toString(36)}_${jsonpSeq++}`
    const script = document.createElement('script')
    const finish = (value: T | null) => {
      window.clearTimeout(timer)
      try {
        delete (window as any)[name]
      } catch {
        ;(window as any)[name] = undefined
      }
      script.remove()
      resolve(value)
    }
    const timer = window.setTimeout(() => finish(null), timeout)
    ;(window as any)[name] = (data: T) => finish(data)
    script.onerror = () => finish(null)
    const sep = url.includes('?') ? '&' : '?'
    script.src = `${url}${sep}output=jsonp&callback=${name}`
    document.head.appendChild(script)
  })
}

/* ---------- Audius discovery host (cached) ---------- */
let audiusHostPromise: Promise<string> | null = null
async function audiusHost(): Promise<string> {
  if (!audiusHostPromise) {
    audiusHostPromise = jsonFetch<{ data: string[] }>('https://api.audius.co/')
      .then((d) => (Array.isArray(d?.data) && d.data[0]) || AUDIUS_FALLBACK)
      .catch(() => AUDIUS_FALLBACK)
  }
  return audiusHostPromise
}

/* ------------------------------------------------------------------ *
 * Attribute inference — neither catalogue exposes energy/valence/tempo,
 * so the mood engine's axes are derived from genre keywords.
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
  { keys: ['classical', 'orchestra', 'piano', 'soundtrack', 'score', 'instrumental', 'filmi'], energy: 30, valence: 48, bpm: 82, moods: ['кинематографично'] },
  { keys: ['jazz', 'blues', 'soul', 'easy listening', 'bossa'], energy: 42, valence: 52, bpm: 98, moods: ['нуар'] },
  { keys: ['folk', 'country', 'singer', 'acoustic', 'americana'], energy: 38, valence: 62, bpm: 92, moods: ['ностальгия'] },
  { keys: ['metal', 'hardcore', 'punk', 'industrial', 'grunge', 'nu metal'], energy: 95, valence: 24, bpm: 152, moods: ['агрессия', 'драйв'] },
  { keys: ['rock', 'alternative', 'emo'], energy: 78, valence: 47, bpm: 128, moods: ['драйв'] },
  { keys: ['techno', 'house', 'trance', 'edm', 'electronic', 'dance', 'club', 'drum & bass', 'dubstep', 'breakbeat', 'electro', 'dancehall'], energy: 91, valence: 70, bpm: 142, moods: ['клуб', 'движение'] },
  { keys: ['hip-hop', 'hip hop', 'rap', 'trap', 'drill', 'grime', 'r&b', 'rnb'], energy: 68, valence: 55, bpm: 96, moods: ['энергия'] },
  { keys: ['k-pop', 'j-pop', 'anime', 'cantopop', 'mandopop', 'kpop'], energy: 82, valence: 84, bpm: 130, moods: ['энергия'] },
  { keys: ['reggae', 'latin', 'afrobeat', 'afro', 'salsa'], energy: 64, valence: 80, bpm: 102, moods: ['лето'] },
  { keys: ['holiday', 'christmas', 'gospel', 'christian'], energy: 50, valence: 72, bpm: 104, moods: ['надежда'] },
  { keys: ['pop'], energy: 68, valence: 82, bpm: 118, moods: ['радость'] },
]

const DEFAULT_PROFILE: GenreProfile = { keys: [], energy: 56, valence: 58, bpm: 110, moods: ['музыка'] }

export function inferProfile(genre: string, seedInput: string) {
  const g = (genre || '').toLowerCase()
  const profile = GENRE_PROFILES.find((p) => p.keys.some((k) => g.includes(k))) ?? DEFAULT_PROFILE
  const jitter = (hash(seedInput) % 21) - 10
  return {
    energy: Math.max(2, Math.min(100, profile.energy + Math.round(jitter / 2))),
    valence: Math.max(2, Math.min(100, profile.valence + Math.round(jitter / 2))),
    bpm: Math.max(55, profile.bpm + jitter),
    moods: profile.moods,
    seed: hash(seedInput),
  }
}

/* ------------------------------------------------------------------ *
 * Deezer
 * ------------------------------------------------------------------ */
const DZ_GENRE: Record<number, string> = {
  52: 'Hip-Hop/Rap',
  116: 'Rap',
  132: 'Pop',
  152: 'Rock',
  165: 'R&B',
  85: 'Alternative',
  106: 'Electro',
  113: 'Dance',
  129: 'Jazz',
  144: 'Reggae',
  173: 'Classical',
  464: 'Metal',
  466: 'Folk',
}

/**
 * Track payloads embed the artist's portrait; remember it so artist pages can
 * show a real photo without a separate (rate-limited) artist lookup.
 */
const artistPictures = new Map<string, string>()
function rememberArtistPicture(name?: string, pic?: string | null) {
  if (name && pic) artistPictures.set(name.toLowerCase(), pic)
}

/** Portrait photo for an artist name, from cache or a live Deezer lookup. */
export async function deezerArtistPicture(name: string): Promise<string | null> {
  const cached = artistPictures.get(name.toLowerCase())
  if (cached) return cached
  const info = await deezerArtistInfo(name)
  return info?.picture ?? null
}

function mapDeezer(t: any): Track | null {
  if (!t || !t.id || !t.title) return null
  rememberArtistPicture(t.artist?.name, t.artist?.picture_xl || t.artist?.picture_big || t.artist?.picture_medium)
  const artist = t.artist?.name || t.artist?.id ? t.artist?.name || 'Unknown' : 'Unknown'
  const album = t.album?.title || `${artist} — синглы`
  const genre = (t.genre_id && DZ_GENRE[t.genre_id]) || inferGenreFromContext(t) || ''
  const year = t.release_date ? new Date(t.release_date).getFullYear() : new Date().getFullYear()
  const profile = inferProfile(genre, `${t.title}${artist}`)
  return {
    id: `dz-${t.id}`,
    title: t.title,
    artist,
    album,
    duration: t.duration ?? 30,
    genre,
    year,
    mood: profile.moods,
    energy: profile.energy,
    valence: profile.valence,
    bpm: profile.bpm,
    seed: profile.seed,
    source: 'deezer' as Source,
    streamUrl: null, // resolved lazily: Deezer previews are signed and expire
    artwork: t.album?.cover_xl || t.album?.cover_big || t.album?.cover_medium || null,
    preview: true,
    sourceId: String(t.id),
    permalink: t.link ?? null,
  }
}

/** Deezer only returns genre_id on some endpoints; guess otherwise. */
function inferGenreFromContext(t: any): string {
  const hay = `${t.title} ${t.album?.title ?? ''}`.toLowerCase()
  const guess = GENRE_PROFILES.find((p) => p.keys.some((k) => hay.includes(k)))
  return guess && guess.keys[0] ? guess.keys[0] : ''
}

export async function searchDeezer(term: string, limit = 25): Promise<Track[]> {
  if (!term.trim()) return []
  const data = await jsonp<{ data: any[] }>(`${DEEZER}/search/track?q=${encodeURIComponent(term)}&limit=${limit}`)
  return (data?.data ?? []).map(mapDeezer).filter(Boolean) as Track[]
}

export async function deezerTopTracks(artistId: string, limit = 50): Promise<Track[]> {
  const data = await jsonp<{ data: any[] }>(`${DEEZER}/artist/${artistId}/top?limit=${limit}`)
  return (data?.data ?? []).map(mapDeezer).filter(Boolean) as Track[]
}

export async function deezerAlbumTracks(albumId: string): Promise<Track[]> {
  const data = await jsonp<{ data: any[] }>(`${DEEZER}/album/${albumId}/tracks?limit=100`)
  return (data?.data ?? []).map(mapDeezer).filter(Boolean) as Track[]
}

export async function deezerChart(limit = 25): Promise<Track[]> {
  const data = await jsonp<{ data: any[] }>(`${DEEZER}/chart/0/tracks?limit=${limit}`)
  return (data?.data ?? []).map(mapDeezer).filter(Boolean) as Track[]
}

export interface DeezerArtistInfo {
  id: string
  name: string
  picture: string | null
  fans: number
  albums: number
}

export async function deezerArtistInfo(name: string): Promise<DeezerArtistInfo | null> {
  const data = await jsonp<{ data: any[] }>(`${DEEZER}/search/artist?q=${encodeURIComponent(name)}&limit=1`)
  const a = data?.data?.[0]
  if (!a) return null
  return {
    id: String(a.id),
    name: a.name,
    picture: a.picture_xl || a.picture_big || a.picture_medium || null,
    fans: a.nb_fan ?? 0,
    albums: a.nb_album ?? 0,
  }
}

export interface DeezerAlbumInfo {
  id: string
  title: string
  year: number
  artwork: string | null
  /** 'album' | 'single' | 'ep' | 'compile' — drives the artist page filters. */
  recordType: string
}

/**
 * Look an album up by name (not by id) so its real release year and cover
 * are available — the track payloads do not carry those.
 */
export async function deezerFindAlbum(artistName: string, albumTitle: string): Promise<{ info: DeezerAlbumInfo; tracks: Track[] } | null> {
  const q = `${artistName} ${albumTitle}`.trim()
  const data = await jsonp<{ data: any[] }>(`${DEEZER}/search/album?q=${encodeURIComponent(q)}&limit=8`)
  const wanted = albumTitle.toLowerCase()
  const candidate =
    (data?.data ?? []).find((a) => a?.title && a.title.toLowerCase() === wanted) ??
    (data?.data ?? []).find((a) => a?.title && (a.title.toLowerCase().includes(wanted) || wanted.includes(a.title.toLowerCase())))
  if (!candidate) return null
  const id = String(candidate.id)
  // the search payload omits release_date; the album detail endpoint has it
  const [tracks, detail] = await Promise.all([
    deezerAlbumTracks(id),
    jsonp<{ release_date?: string; cover_xl?: string; cover_big?: string; record_type?: string }>(`${DEEZER}/album/${id}`),
  ])
  return {
    info: {
      id,
      title: candidate.title,
      year: detail?.release_date ? new Date(detail.release_date).getFullYear() : 0,
      recordType: candidate.record_type || detail?.record_type || 'album',
      artwork:
        detail?.cover_xl ||
        detail?.cover_big ||
        candidate.cover_xl ||
        candidate.cover_big ||
        candidate.cover_medium ||
        null,
    },
    tracks,
  }
}

export async function deezerArtistAlbums(artistId: string, limit = 50): Promise<DeezerAlbumInfo[]> {
  const data = await jsonp<{ data: any[] }>(`${DEEZER}/artist/${artistId}/albums?limit=${limit}`)
  return (data?.data ?? [])
    .filter((a) => a?.title)
    .map((a) => ({
      id: String(a.id),
      title: a.title,
      year: a.release_date ? new Date(a.release_date).getFullYear() : 0,
      artwork: a.cover_xl || a.cover_big || a.cover_medium || null,
      recordType: a.record_type || 'album',
    }))
}

/** Resolve the (signed, expiring) Deezer preview URL at play time. */
export async function resolveDeezerStream(trackId: string): Promise<string | null> {
  const data = await jsonp<{ preview?: string }>(`${DEEZER}/track/${trackId}`)
  return data?.preview ?? null
}

/* ------------------------------------------------------------------ *
 * iTunes
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
    artwork: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '1000x1000bb') : null,
    preview: true,
    sourceId: String(r.trackId),
    permalink: r.trackViewUrl ?? null,
  }
}

export async function searchItunes(term: string, limit = 25): Promise<Track[]> {
  if (!term.trim()) return []
  const data = await jsonFetch<{ results: any[] }>(`${ITUNES}/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}`)
  return (data?.results ?? []).map(mapItunes).filter(Boolean) as Track[]
}

/* ------------------------------------------------------------------ *
 * Audius — full-length, CC-licensed streams
 * ------------------------------------------------------------------ */
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
    streamUrl: null,
    artwork: pickArtwork(t.artwork),
    preview: false,
    sourceId: String(t.id),
    permalink: t.permalink ? `https://audius.co${t.permalink}` : null,
  }
}

export async function searchAudius(query: string, limit = 25): Promise<Track[]> {
  if (!query.trim()) return []
  const host = await audiusHost()
  const data = await jsonFetch<{ data: any[] }>(`${host}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=${APP_NAME}`)
  return (data?.data ?? []).map(mapAudius).filter(Boolean) as Track[]
}

export async function audiusTrending(limit = 25, genre = ''): Promise<Track[]> {
  const host = await audiusHost()
  const data = await jsonFetch<{ data: any[] }>(
    `${host}/v1/tracks/trending?limit=${limit}&app_name=${APP_NAME}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`,
  )
  return (data?.data ?? []).map(mapAudius).filter(Boolean) as Track[]
}

export async function resolveAudiusStream(trackId: string): Promise<string | null> {
  const host = await audiusHost()
  return `${host}/v1/tracks/${trackId}/stream?app_name=${APP_NAME}`
}

/* ------------------------------------------------------------------ *
 * YouTube (via Piped) — FULL-LENGTH playback for mainstream music.
 * Piped is only asked for a videoId; the audio is played by the official
 * YouTube IFrame player, which is what keeps this on the right side of the
 * platform's terms (no stream extraction, no proxying).
 * ------------------------------------------------------------------ */
interface PipedItem {
  url?: string
  type?: string
  title?: string
  uploaderName?: string
  duration?: number
  thumbnail?: string
}

function pipedVideoId(item: PipedItem): string | null {
  const fromUrl = item.url?.match(/[?&]v=([\w-]{11})/)?.[1]
  if (fromUrl) return fromUrl
  const bare = item.url?.match(/^([\w-]{11})$/)
  return bare ? bare[1] : null
}

/** Rewrite a proxied Piped thumbnail to the original YouTube host. */
function pipedThumb(item: PipedItem): string | null {
  const id = pipedVideoId(item)
  if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  const thumb = item.thumbnail
  if (!thumb) return null
  try {
    const host = new URL(thumb).searchParams.get('host')
    const path = new URL(thumb).pathname.replace(/^\//, '')
    if (host) return `https://${host}/${path}`
  } catch {
    /* keep the original below */
  }
  return thumb
}

function mapYouTube(item: PipedItem): Track | null {
  const id = pipedVideoId(item)
  if (!id || !item.title) return null
  const artist = item.uploaderName || 'YouTube'
  const genre = inferGenreFromContext({ title: item.title })
  const profile = inferProfile(genre, `${item.title}${artist}`)
  return {
    id: `yt-${id}`,
    title: item.title,
    artist,
    album: `${artist} — YouTube`,
    duration: item.duration ?? 0,
    genre,
    year: new Date().getFullYear(),
    mood: profile.moods,
    energy: profile.energy,
    valence: profile.valence,
    bpm: profile.bpm,
    seed: profile.seed,
    source: 'youtube' as Source,
    streamUrl: null, // played through the IFrame player, not an audio element
    artwork: pipedThumb(item),
    preview: false,
    sourceId: id,
    permalink: `https://www.youtube.com/watch?v=${id}`,
  }
}

export async function searchYouTube(query: string, limit = 25): Promise<Track[]> {
  if (!query.trim()) return []
  for (const host of PIPED_HOSTS) {
    const data = await jsonFetch<{ items?: PipedItem[] }>(
      `${host}/search?q=${encodeURIComponent(query)}&filter=music_songs`,
      6000,
    )
    const items = (data?.items ?? []).filter((i) => i.type === 'stream')
    if (items.length) return items.slice(0, limit).map(mapYouTube).filter(Boolean) as Track[]
  }
  return []
}

/** Look up the full-length YouTube video that matches a Deezer/iTunes track. */
export async function findYouTubeTrack(artist: string, title: string): Promise<Track | null> {
  const query = `${artist} ${title}`
  const results = await searchYouTube(query, 8)
  if (!results.length) return null
  const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()
  const wantTitle = clean(title)
  const wantArtist = clean(artist)
  // Prefer an exact-ish title match, then anything by the same uploader.
  const scored = results
    .map((t) => {
      const ct = clean(t.title)
      const ca = clean(t.artist)
      let score = 0
      if (ct === wantTitle) score += 4
      else if (ct.includes(wantTitle) || wantTitle.includes(ct)) score += 2
      if (ca === wantArtist) score += 3
      else if (ca.includes(wantArtist) || wantArtist.includes(ca)) score += 1
      // official uploads name the channel after the artist
      if (/topic|official|vevo/i.test(t.artist)) score += 1
      return { t, score }
    })
    .sort((a, b) => b.score - a.score)
  return scored[0]?.score > 0 ? scored[0].t : results[0]
}

/* ------------------------------------------------------------------ *
 * Combined search — Deezer first (best coverage + images), then
 * interleave iTunes and Audius, deduped by title+artist.
 * ------------------------------------------------------------------ */
export async function searchAll(query: string, limit = 40): Promise<Track[]> {
  const per = Math.ceil(limit / 4)
  const [dz, it, yt, au] = await Promise.all([
    searchDeezer(query, per).catch(() => []),
    searchItunes(query, per).catch(() => []),
    searchYouTube(query, per).catch(() => []),
    searchAudius(query, per).catch(() => []),
  ])

  const seen = new Set<string>()
  const out: Track[] = []
  const push = (t?: Track) => {
    if (!t || out.length >= limit) return
    const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }

  const max = Math.max(dz.length, it.length, yt.length, au.length)
  for (let i = 0; i < max; i++) {
    push(dz[i])
    push(it[i])
    push(yt[i])
    push(au[i])
  }
  return out
}

/**
 * Swap a 30-second preview for the matching full-length YouTube video.
 * Deezer/iTunes give better metadata and artwork, so we keep the original
 * track (and its id) and only replace the playback source. Returns null when
 * there is no video, or the track is not a commercial preview.
 */
export async function upgradeToFullTrack(track: Track): Promise<Track | null> {
  if (track.source !== 'deezer' && track.source !== 'itunes') return null
  const match = await findYouTubeTrack(track.artist, track.title).catch(() => null)
  if (!match) return null
  return {
    ...track,
    source: 'youtube',
    sourceId: match.sourceId,
    streamUrl: null,
    preview: false,
    previewTrack: track,
    // the music video usually runs longer than the album cut
    duration: match.duration || track.duration,
  }
}

/* ------------------------------------------------------------------ *
 * Artist / album helpers
 * ------------------------------------------------------------------ */
function titleCase(s: string) {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export async function getArtist(name: string): Promise<{ artist: Artist; tracks: Track[]; albums: Album[] }> {
  const info = await deezerArtistInfo(name)
  let tracks: Track[] = []
  if (info) {
    tracks = await deezerTopTracks(info.id, 50)
  }
  if (!tracks.length) {
    const [it, au] = await Promise.all([searchItunes(name, 25).catch(() => []), searchAudius(name, 25).catch(() => [])])
    tracks = [...it, ...au]
  }
  const own = tracks.filter((t) => t.artist.toLowerCase() === name.toLowerCase())
  const pool = own.length >= 4 ? own : tracks

  const albumMap = new Map<string, Album>()
  for (const t of pool) {
    if (!t.album) continue
    if (!albumMap.has(t.album)) {
      albumMap.set(t.album, {
        id: `al-${t.source}-${hash(t.artist + t.album)}`,
        title: t.album,
        artist: t.artist,
        year: t.year,
        trackIds: [],
        artwork: t.artwork,
        genre: t.genre,
      })
    }
    albumMap.get(t.album)!.trackIds.push(t.id)
  }

  // real discography with release years and covers, straight from Deezer
  const realAlbums = info ? await deezerArtistAlbums(info.id, 50).catch(() => []) : []
  const albumArt = new Map<string, string>()
  for (const a of realAlbums) if (a.artwork) albumArt.set(a.title.toLowerCase(), a.artwork)

  const artist: Artist = {
    id: info?.id ? `ar-dz-${info.id}` : `ar-${hash(name)}`,
    name,
    genres: Array.from(new Set(pool.map((t) => t.genre).filter(Boolean))).slice(0, 3),
    bio: `${titleCase(name)} — реальный артист из каталогов Deezer, iTunes и Audius. Здесь собраны доступные треки и релизы, найденные вживую по запросу.`,
    monthly: info?.fans && info.fans > 0 ? info.fans : 100_000 + (hash(name) % 4_000_000),
    // prefer a real portrait; fall back to album art only if none exists
    picture: info?.picture ?? artistPictures.get(name.toLowerCase()) ?? pool.find((t) => t.artwork)?.artwork ?? null,
  }
  // Deezer lists re-issues and editions separately; collapse them by title
  const uniqueAlbums = realAlbums.filter(
    (a, i, all) => all.findIndex((b) => b.title.toLowerCase() === a.title.toLowerCase()) === i,
  )

  const albums: Album[] = uniqueAlbums.length
    ? uniqueAlbums.slice(0, 18).map((a) => {
        // link to the album page so its full tracklist is fetched on demand
        const known = pool.filter((t) => t.album.toLowerCase() === a.title.toLowerCase())
        return {
          id: `al-dz-${a.id}`,
          title: a.title,
          artist: name,
          year: a.year || pool.find((t) => t.album.toLowerCase() === a.title.toLowerCase())?.year || 0,
          trackIds: known.map((t) => t.id),
          artwork: a.artwork,
          genre: known[0]?.genre ?? pool[0]?.genre ?? '',
          recordType: a.recordType,
        }
      })
    : Array.from(albumMap.values()).filter((a) => a.trackIds.length >= 2)

  // backfill artwork for albums that only had a name from the track list
  for (const a of albums) if (!a.artwork) a.artwork = albumArt.get(a.title.toLowerCase()) ?? null

  return { artist, tracks: pool, albums }
}

export async function getAlbum(
  artistName: string,
  albumTitle: string,
): Promise<{ tracks: Track[]; artwork: string | null; year: number }> {
  // Prefer the real Deezer album: it yields the exact tracklist, cover and year.
  const dz = await deezerFindAlbum(artistName, albumTitle).catch(() => null)
  if (dz && dz.tracks.length) {
    const merged = mergeArtwork(dz.tracks, dz.info.artwork)
    return { tracks: merged, artwork: dz.info.artwork ?? merged.find((t) => t.artwork)?.artwork ?? null, year: dz.info.year }
  }

  const [it, au] = await Promise.all([
    searchItunes(`${artistName} ${albumTitle}`, 50).catch(() => []),
    searchAudius(`${artistName} ${albumTitle}`, 50).catch(() => []),
  ])
  const all = [...it, ...au]
  const exact = all.filter(
    (t) => t.album.toLowerCase().includes(albumTitle.toLowerCase()) || t.title.toLowerCase().includes(albumTitle.toLowerCase()),
  )
  const seen = new Set<string>()
  const list: Track[] = []
  for (const t of exact.length ? exact : all) {
    const key = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    list.push(t)
  }
  const artwork = list.find((t) => t.artwork)?.artwork ?? null
  return { tracks: list, artwork, year: list[0]?.year ?? 0 }
}

/** Give tracks without their own cover the album's cover. */
function mergeArtwork(tracks: Track[], artwork: string | null): Track[] {
  if (!artwork) return tracks
  return tracks.map((t) => (t.artwork ? t : { ...t, artwork }))
}
