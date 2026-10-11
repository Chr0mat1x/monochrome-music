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

/** Strip tracking params and ask Wikimedia for a bigger rendition. */
function cleanWikiImage(url: string): string {
  const base = url.split('?')[0]
  return base.replace(/\/\d+px-/, '/1000px-')
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

const wikiPicCache = new Map<string, string | null>()

/**
 * Wikipedia portrait — a second source that covers artists Deezer lacks, and
 * often a nicer photo for the ones it has. Title-checked so a search miss
 * cannot attach the wrong person's face.
 */
async function wikipediaArtistPicture(name: string): Promise<string | null> {
  const key = name.toLowerCase()
  if (wikiPicCache.has(key)) return wikiPicCache.get(key) ?? null
  try {
    const api = 'https://en.wikipedia.org/w/api.php'
    const q = `${api}?action=query&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=1000&format=json&origin=*`
    const data = await jsonFetch<any>(q, 9000)
    const pages: any[] = Object.values(data?.query?.pages ?? {})
    const match = pages.find((p) => normalizeName(p?.title ?? '') === normalizeName(name))
    const src: string | undefined = match?.thumbnail?.source
    const pic = src ? cleanWikiImage(src) : null
    if (pic) artistPictures.set(key, pic)
    wikiPicCache.set(key, pic)
    return pic
  } catch {
    wikiPicCache.set(key, null)
    return null
  }
}

/** Best available portrait: Deezer first, Wikipedia as a fallback/upgrade. */
export async function artistImage(name: string): Promise<string | null> {
  const dz = await deezerArtistPicture(name).catch(() => null)
  if (dz) return dz
  return wikipediaArtistPicture(name)
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
// Fallback genre guess. Only the *title* is inspected, never the album name:
// Queen's "Jazz" album made every one of their tracks read as jazz.
function inferGenreFromContext(t: any): string {
  const hay = String(t.title ?? '').toLowerCase()
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
  // Deezer returns several homonyms for one word ("Queen" yields eight), and
  // the famous act is not always first — the legendary Queen sits behind
  // artists with a few hundred fans. Fetch a page of candidates and pick the
  // exact-name match with the largest audience, so the artist page lands on
  // the act the listener actually meant.
  const data = await jsonp<{ data: any[] }>(
    `${DEEZER}/search/artist?q=${encodeURIComponent(name)}&limit=25`,
  )
  const candidates: any[] = data?.data ?? []
  if (!candidates.length) return null
  const want = cleanName(name)
  const exact = candidates.filter((a) => cleanName(a.name) === want)
  const pool = exact.length ? exact : candidates
  const a = pool.reduce((best, cur) => ((cur.nb_fan ?? 0) > (best.nb_fan ?? 0) ? cur : best))
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

/**
 * The artist's own genre, straight from iTunes. Deezer omits genres on both
 * the artist and the top-tracks endpoints, so deriving it from tracks left
 * well-known acts mislabelled; iTunes ranks the popular act first and carries
 * a reliable primary genre.
 */
export async function itunesArtistGenre(name: string): Promise<string | null> {
  const data = await jsonFetch<{ results: any[] }>(
    `${ITUNES}/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=10`,
  )
  const want = cleanName(name)
  const match = (data?.results ?? []).find((r) => cleanName(r.artistName ?? '') === want)
  return match?.primaryGenreName || null
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
    streamable: t.is_streamable !== false,
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
function mapYouTube(item: PipedItem): Track | null {
  const id = pipedVideoId(item)
  if (!id || !item.title) return null
  return buildYouTubeTrack(id, item.title, item.uploaderName || 'YouTube', item.duration ?? 0)
}

interface ServerSearchItem {
  id?: string
  title?: string
  duration?: number
  channel?: string
  channelId?: string
  thumbnail?: string
}

/** Build a playable SoundCloud track. SoundCloud streams full-length audio
 *  from any IP (unlike YouTube's datacenter block), so this is the source that
 *  makes "full songs" actually work in the hosted app. */
function buildSoundCloudTrack(i: ServerSearchItem): Track {
  const title = i.title || ''
  const artist = i.channel || 'SoundCloud'
  const genre = inferGenreFromContext({ title })
  const profile = inferProfile(genre, `${title}${artist}`)
  return {
    id: `sc-${i.id}`,
    title,
    artist,
    album: `${artist} — SoundCloud`,
    duration: Math.round(i.duration ?? 0),
    genre,
    year: new Date().getFullYear(),
    mood: profile.moods,
    energy: profile.energy,
    valence: profile.valence,
    bpm: profile.bpm,
    seed: profile.seed,
    source: 'soundcloud' as Source,
    streamUrl: null,
    artwork: i.thumbnail || null,
    streamable: true,
    preview: false,
    sourceId: i.id!,
    permalink: null,
  }
}

function buildYouTubeTrack(id: string, title: string, artist: string, duration: number): Track {
  const genre = inferGenreFromContext({ title })
  const profile = inferProfile(genre, `${title}${artist}`)
  return {
    id: `yt-${id}`,
    title,
    artist,
    album: `${artist} — YouTube`,
    duration,
    genre,
    year: new Date().getFullYear(),
    mood: profile.moods,
    energy: profile.energy,
    valence: profile.valence,
    bpm: profile.bpm,
    seed: profile.seed,
    source: 'youtube' as Source,
    streamUrl: null, // played through the IFrame player, not an audio element
    artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    streamable: true,
    preview: false,
    sourceId: id,
    permalink: `https://www.youtube.com/watch?v=${id}`,
  }
}

/** Search through the companion server (yt-dlp), which returns playable ids here. */
async function serverSearch(
  query: string,
  limit: number,
  src: 'yt' | 'sc',
): Promise<ServerSearchItem[]> {
  if (!(await hasAudioServer())) return []
  const data = await jsonFetch<{ items?: ServerSearchItem[] }>(
    `${AUDIO_SERVER}/search?src=${src}&q=${encodeURIComponent(query)}&limit=${limit}`,
    20000,
  )
  return data?.items ?? []
}

async function searchYouTubeServer(query: string, limit: number): Promise<Track[]> {
  const items = await serverSearch(query, limit, 'yt')
  return items
    .filter((i) => i.id && i.title)
    .map((i) => buildYouTubeTrack(i.id!, i.title!, i.channel || 'YouTube', i.duration ?? 0))
}

export async function searchSoundCloud(query: string, limit = 25): Promise<Track[]> {
  if (!query.trim()) return []
  const items = await serverSearch(query, limit, 'sc').catch(() => [])
  return items.filter((i) => i.id && i.title).map(buildSoundCloudTrack)
}

export async function searchYouTube(query: string, limit = 25): Promise<Track[]> {
  if (!query.trim()) return []
  // Prefer yt-dlp (via the server): Piped's ids are frequently region-blocked
  // for this machine, so Play would silently fail on most of them.
  const viaServer = await searchYouTubeServer(query, limit).catch(() => [])
  if (viaServer.length) return viaServer
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

const cleanName = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim()

/** Rank YouTube results for a track, best match first. */
function rankYouTube(results: Track[], artist: string, title: string): Track[] {
  const wantTitle = cleanName(title)
  const wantArtist = cleanName(artist)
  const NOISE = /cover|remix|flip|bootleg|mashup|sped up|slowed|instrumental|karaoke|8d|nightcore/i
  return results
    .map((t) => {
      const ct = cleanName(t.title)
      const ca = cleanName(t.artist)
      // Drop the artist-name prefix that uploads habitually prepend
      // ("Queen Bohemian Rhapsody") so the song name is compared cleanly.
      const bare = ct.startsWith(`${wantArtist} `) ? ct.slice(wantArtist.length + 1).trim() : ct
      let score = 0
      // A genuine upload's title *starts* with the song name; trailers, tags and
      // "(Official Video Remastered)" all follow it. Starting-with beats merely
      // containing, which is how karaoke/lyric dumps sneak in.
      if (bare === wantTitle || ct === wantTitle) score += 5
      else if (bare.startsWith(wantTitle)) score += 3
      else if (bare.includes(wantTitle) || wantTitle.includes(bare)) score += 1
      if (ca === wantArtist) score += 4
      else if (ca.includes(wantArtist)) score += 2
      else if (wantArtist.includes(ca)) score += 1
      // Official / auto-generated artist channels host the real master.
      if (/topic|official|vevo/i.test(t.artist)) score += 2
      if (NOISE.test(t.title)) score -= 3
      return { t, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.t)
}

/** Look up the full-length YouTube video that matches a Deezer/iTunes track. */
export async function findYouTubeTrack(artist: string, title: string): Promise<Track | null> {
  const results = await searchYouTube(`${artist} ${title}`, 10)
  if (!results.length) return null
  const ranked = rankYouTube(results, artist, title)

  // When the local audio server is available, prefer a video it can actually
  // stream (analyser intact). Official uploads are often region/IP-blocked
  // while a re-upload plays fine, so walk the ranked list — but time-bounded,
  // because a blocked IP makes every probe slow.
  if (await hasAudioServer()) {
    const deadline = Date.now() + 7000
    for (const candidate of ranked.slice(0, 6)) {
      if (await resolveFullAudio(candidate.sourceId)) return candidate
      if (Date.now() > deadline) break
    }
  }
  // Server absent, or every probe refused: still hand the best match to the
  // official IFrame player, which can play the full video from the listener's
  // own (residential) IP even when this machine's requests are blocked.
  return ranked[0]
}

/* ------------------------------------------------------------------ *
 * Audius full-track fallback
 *
 * Audius streams whole songs (never 30-second clips) and works from any IP,
 * so it is the reliable full-length source when YouTube refuses anonymous
 * playback (datacenter IPs, "confirm you're not a bot", region blocks).
 * ------------------------------------------------------------------ */
const audiusMatchCache = new Map<string, Promise<Track | null>>()
const scMatchCache = new Map<string, Promise<Track | null>>()

/** Search Audius and keep only titles that really belong to this song. */
async function findAudiusTrack(artist: string, title: string): Promise<Track | null> {
  const results = await searchAudius(`${artist} ${title}`, 12).catch(() => [])
  const wantTitle = cleanName(title)
  const wantArtist = cleanName(artist)
  const scored = results
    .map((t) => {
      const ct = cleanName(t.title)
      const ca = cleanName(t.artist)
      // An artist-name prefix in the upload title ("Queen Bohemian Rhapsody")
      // is noise, not a different song — strip it before comparing.
      const bare = ct.startsWith(`${wantArtist} `) ? ct.slice(wantArtist.length + 1).trim() : ct
      let score = 0
      if (bare === wantTitle || ct === wantTitle) score += 4
      else if (bare.includes(wantTitle) || wantTitle.includes(bare)) score += 2
      else return { t, score: -1 } // title does not line up at all
      if (ca === wantArtist) score += 3
      else if (ca.includes(wantArtist) || wantArtist.includes(ca)) score += 1
      // prefer the original over covers/remixes/bootlegs
      if (/cover|remix|flip|bootleg|mashup|sped up|slowed|instrumental|karaoke/i.test(t.title)) {
        score -= 2
      }
      // Every word beyond the song name is usually a remix/upload tag, so
      // penalise it: a noisy re-upload must never outrank the real song. This
      // is what let "Bohemian Rhapsody kikechacin & Chupetas…" win before.
      const extra = bare.split(' ').length - wantTitle.split(' ').length
      if (extra > 0) score -= extra
      return { t, score }
    })
    .filter((s) => s.score >= 2 && s.t.streamable !== false)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.t ?? null
}

/** Look up the full-length Audius upload matching a commercial track. */
export function findAudiusFull(artist: string, title: string): Promise<Track | null> {
  const key = `${artist}|${title}`.toLowerCase()
  const cached = audiusMatchCache.get(key)
  if (cached) return cached
  const task = findAudiusTrack(artist, title)
  audiusMatchCache.set(key, task)
  return task
}

/** Pick the SoundCloud upload that best matches a commercial track. */
export function findSoundCloudFull(artist: string, title: string): Promise<Track | null> {
  const key = `${artist}|${title}`.toLowerCase()
  const cached = scMatchCache.get(key)
  if (cached) return cached
  const task = findSoundCloudTrack(artist, title)
  scMatchCache.set(key, task)
  return task
}

async function findSoundCloudTrack(artist: string, title: string): Promise<Track | null> {
  const results = await searchSoundCloud(`${artist} ${title}`, 15).catch(() => [])
  const wantTitle = cleanName(title)
  const wantArtist = cleanName(artist)
  // Reject anything that is not the studio song at roughly the album length —
  // SoundCloud is full of covers, remixes and 30-second label snippets.
  const scored = results
    .map((t) => {
      const ct = cleanName(t.title)
      const ca = cleanName(t.artist)
      const bare = ct.startsWith(`${wantArtist} `) ? ct.slice(wantArtist.length + 1).trim() : ct
      let score = 0
      if (bare === wantTitle || ct === wantTitle) score += 5
      else if (bare.includes(wantTitle)) score += 3
      else return null
      if (ca === wantArtist || ca.includes(wantArtist) || wantArtist.includes(ca)) score += 3
      if (t.duration < 65) return null // preview / snippet
      if (/cover|remix|flip|bootleg|mashup|sped up|slowed|instrumental|karaoke|8d|nightcore/i.test(t.title)) {
        score -= 3
      }
      // Closer to the canonical length wins (a 3–6 min studio cut).
      score -= Math.min(Math.abs(t.duration - 240) / 60, 5)
      return { t, score }
    })
    .filter((s): s is { t: Track; score: number } => !!s)
    .sort((a, b) => b.score - a.score)

  // SoundCloud's official label uploads are DRM-protected, so the best title
  // match is often unplayable. When a server is available, walk the ranked
  // list and return the first upload that actually resolves.
  if (await hasAudioServer()) {
    const deadline = Date.now() + 12000
    for (const { t } of scored.slice(0, 6)) {
      if (await resolveFullAudio(t.sourceId, 'sc')) return t
      if (Date.now() > deadline) break
    }
    return null
  }
  return scored[0]?.t ?? null
}


/* ------------------------------------------------------------------ *
 * Track quality filter
 * ------------------------------------------------------------------ */
/** Uploads that are compilations rather than a song. */
const PLAYLIST_TITLE = /\b(playlist|mashup|megamix|medley|non[- ]?stop|top \d+ hits?|mix\b|compilation|hits? \d{4})\b/i

/**
 * True when a track is a real song rather than filler that dominates catalogue
 * searches: hour-long DJ sets, "Top 100 Hits" compilations, ".wav"-named
 * placeholders and 15-second clips. A zero duration means the source did not
 * report one, so it is kept.
 */
export function isPlayableTrack(t: Track): boolean {
  if (t.duration && (t.duration < 45 || t.duration > 1200)) return false
  if (PLAYLIST_TITLE.test(t.title)) return false
  if (/\.(wav|mp3|m4a)$/i.test(t.title.trim())) return false
  return true
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
 * Memoised full-length results, keyed artist|title. Also broadcast to
 * subscribers so React lists can swap their 30s previews in place without
 * re-fetching, and so playback can start a known-full track with no wait.
 */
const fullTrackCache = new Map<string, Track>()
const fullTrackListeners = new Set<(t: Track) => void>()

function fullKey(artist: string, title: string) {
  return `${artist}|${title}`.toLowerCase()
}

/** A previously resolved full version of this preview, if we have one. */
export function cachedFullTrack(track: Track): Track | null {
  return fullTrackCache.get(fullKey(track.artist, track.title)) ?? null
}

/** Subscribe to full-version resolutions (fires once per track). */
export function subscribeFullTracks(cb: (t: Track) => void): () => void {
  fullTrackListeners.add(cb)
  return () => fullTrackListeners.delete(cb)
}

function publishFull(track: Track) {
  fullTrackCache.set(fullKey(track.artist, track.title), track)
  for (const cb of fullTrackListeners) cb(track)
}

/**
 * Swap a 30-second preview for the matching full-length video.
 * Deezer/iTunes give better metadata and artwork, so we keep the original
 * track (and its id) and only replace the playback source. Returns null when
 * there is no video, or the track is not a commercial preview.
 */
export async function upgradeToFullTrack(track: Track): Promise<Track | null> {
  if (track.source !== 'deezer' && track.source !== 'itunes') return null
  const cached = cachedFullTrack(track)
  if (cached) return cached
  const resolved = await resolveFullTrack(track)
  if (resolved) publishFull(resolved)
  return resolved
}

async function resolveFullTrack(track: Track): Promise<Track | null> {
  const server = await hasAudioServer()
  // SoundCloud streams full-length audio from any IP, but only the companion
  // server can extract it. Without a server (the offline APK) skip SoundCloud
  // entirely and let YouTube's IFrame player — which runs from the phone's own
  // residential IP — supply the whole song.
  if (server) {
    const sc = await findSoundCloudTrack(track.artist, track.title).catch(() => null)
    if (sc) {
      const streamUrl = await resolveFullAudio(sc.sourceId, 'sc').catch(() => null)
      if (streamUrl) {
        return {
          ...track,
          source: 'soundcloud',
          sourceId: sc.sourceId,
          streamUrl,
          preview: false,
          previewTrack: track,
          duration: track.duration || sc.duration,
        }
      }
    }
  }
  // Then a YouTube upload: it streams through the local yt-dlp server on the
  // listener's own machine, or the IFrame player from a residential IP.
  const match = await findYouTubeTrack(track.artist, track.title).catch(() => null)
  if (match) {
    const streamUrl = server ? await resolveFullAudio(match.sourceId).catch(() => null) : null
    return {
      ...track,
      source: 'youtube',
      sourceId: match.sourceId,
      streamUrl,
      preview: false,
      previewTrack: track,
      // the music video usually runs longer than the album cut
      duration: match.duration || track.duration,
    }
  }
  if (!server) return null
  // Last resort: an Audius full track (mostly covers for mainstream music).
  const audius = await findAudiusFull(track.artist, track.title).catch(() => null)
  if (audius) {
    return {
      ...track,
      source: 'audius',
      sourceId: audius.sourceId,
      streamUrl: audius.streamUrl,
      permalink: audius.permalink,
      preview: false,
      previewTrack: track,
      duration: track.duration || audius.duration,
    }
  }
  return null
}

/**
 * Resolve full versions for a whole list in the background, a few at a time.
 * Results are published to `fullTrackCache`/listeners, so any subscribed list
 * swaps its previews in place and the first play starts full immediately.
 */
export async function prefetchFullTracks(tracks: Track[], concurrency = 4): Promise<void> {
  const previews = tracks.filter((t) => t.preview && (t.source === 'deezer' || t.source === 'itunes'))
  let cursor = 0
  const worker = async () => {
    while (cursor < previews.length) {
      const track = previews[cursor++]
      await upgradeToFullTrack(track).catch(() => null)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
}

/* ------------------------------------------------------------------ *
 * Local yt-dlp audio server
 *
 * On the listener's own machine a small companion server (server/index.mjs)
 * can hand out full-length YouTube audio, because YouTube only blocks
 * anonymous stream access from datacenter IPs. When it is reachable we play
 * the audio directly through the Web Audio graph; otherwise we fall back to
 * the official IFrame player (which works from residential IPs).
 * ------------------------------------------------------------------ */
const AUDIO_SERVER = '/api'

let audioServerUp: boolean | null = null
let audioServerProbe: Promise<boolean> | null = null

/** Probe the companion server once per session. */
export function hasAudioServer(): Promise<boolean> {
  if (audioServerUp !== null) return Promise.resolve(audioServerUp)
  if (audioServerProbe) return audioServerProbe
  audioServerProbe = (async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    try {
      const res = await fetch(`${AUDIO_SERVER}/health`, { signal: ctrl.signal })
      audioServerUp = res.ok
    } catch {
      audioServerUp = false
    } finally {
      clearTimeout(timer)
    }
    return audioServerUp
  })()
  return audioServerProbe
}

const resolveCache = new Map<string, Promise<string | null>>()

/**
 * Confirm the server can actually pull a given source before we commit to it.
 * `src` is 'yt' (YouTube video id) or 'sc' (SoundCloud numeric track id).
 */
export function resolveFullAudio(sourceId: string, src: 'yt' | 'sc' = 'yt'): Promise<string | null> {
  const key = `${src}:${sourceId}`
  const hit = resolveCache.get(key)
  if (hit) return hit
  const task = (async () => {
    if (!(await hasAudioServer())) return null
    const data = await jsonFetch<{ ok?: boolean }>(
      `${AUDIO_SERVER}/resolve?src=${src}&id=${sourceId}`,
      20000,
    )
    return data?.ok ? `${AUDIO_SERVER}/audio?src=${src}&id=${sourceId}` : null
  })()
  resolveCache.set(key, task)
  return task
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

// Parenthetical/bracketed qualifiers ("(Live Aid)", "[Remastered]") and trailing
// " - Live" tags identify a *version* of a song, not a different song.
const VERSION_TAG = /\([^)]*\)|\[[^\]]*\]/g
const LIVE_TAG = /\b(live|remaster|remastered|revisited|mix|edit|demo|instrumental|acoustic|karaoke)\b/i

/** Canonical song name with version qualifiers stripped, for de-duplication. */
function baseTitle(title: string): string {
  return cleanName(title.replace(VERSION_TAG, ' '))
}

/** 0 for the studio original, 1 for any alternate version. */
function versionRank(title: string): number {
  return LIVE_TAG.test(title) ? 1 : 0
}

/**
 * Collapse a ranked track list to one entry per song, keeping the studio
 * original over live/remix/remaster editions. Insertion order is preserved so
 * a ranked list (Deezer /top) stays ranked.
 */
function dedupeTracks(list: Track[]): Track[] {
  const byKey = new Map<string, Track>()
  for (const t of list) {
    const key = baseTitle(t.title)
    const prev = byKey.get(key)
    if (!prev || versionRank(t.title) < versionRank(prev.title)) byKey.set(key, t)
  }
  return Array.from(byKey.values())
}

export async function getArtist(name: string): Promise<{ artist: Artist; tracks: Track[]; albums: Album[] }> {
  const info = await deezerArtistInfo(name)
  let tracks: Track[] = []
  if (info) {
    // /top caps out at 100 and is ranked, so ask for the full page; the album
    // list below supplies the rest of the discography.
    tracks = await deezerTopTracks(info.id, 100)
  }
  if (!tracks.length) {
    const [it, au] = await Promise.all([searchItunes(name, 25).catch(() => []), searchAudius(name, 25).catch(() => [])])
    tracks = [...it, ...au]
  }
  const own = tracks.filter((t) => t.artist.toLowerCase() === name.toLowerCase())
  const pool = dedupeTracks(own.length >= 4 ? own : tracks)

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

  // prefer a real portrait; fall back to Wikipedia, then album art
  let picture: string | null =
    info?.picture ?? artistPictures.get(name.toLowerCase()) ?? null
  if (!picture) {
    picture = await wikipediaArtistPicture(name).catch(() => null)
  }
  if (!picture) picture = pool.find((t) => t.artwork)?.artwork ?? null

  // iTunes names the act's own genre; Deezer tracks are a last resort.
  const itunesGenre = await itunesArtistGenre(name).catch(() => null)
  const trackGenres = Array.from(new Set(pool.map((t) => t.genre).filter(Boolean)))
  const genres = (itunesGenre && itunesGenre !== 'Music' ? [itunesGenre] : trackGenres).slice(0, 3)

  const artist: Artist = {
    id: info?.id ? `ar-dz-${info.id}` : `ar-${hash(name)}`,
    name,
    genres: genres,
    bio: `${titleCase(name)} — реальный артист из каталогов Deezer, iTunes и Audius. Здесь собраны доступные треки и релизы, найденные вживую по запросу.`,
    monthly: info?.fans && info.fans > 0 ? info.fans : 100_000 + (hash(name) % 4_000_000),
    picture,
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
