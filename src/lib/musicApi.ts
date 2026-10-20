import type { Album, Artist, Source, Track } from '../types'
import { hasNativeBridge, nativeResolveSoundCloud, nativeSearchSoundCloud } from './nativeBridge'
import { scPlayableUrl, scSearch, stitchScHls } from './scClient'
import { audioServerBase, serverConfigured } from './serverConfig'

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
 * Where catalogue and media requests should go. When the companion server is
 * reachable, Deezer/iTunes/Audius are fetched *through* it: the server has
 * unfiltered access, while the listener's own network may block those hosts
 * entirely (Russia blocks all three). Falls back to the browser's direct
 * fetch when no server is present, e.g. the bundled APK.
 */
const CATALOG_VIA_PROXY = true
let proxyMode: Promise<boolean> | null = null
export function catalogueProxied(): Promise<boolean> {
  if (!proxyMode) proxyMode = CATALOG_VIA_PROXY ? hasAudioServer() : Promise.resolve(false)
  return proxyMode
}

function proxied(url: string): string {
  return `${AUDIO_SERVER()}/proxy?url=${encodeURIComponent(url)}`
}

/**
 * Deezer's REST API sends no CORS headers, so browser fetch() is blocked. It
 * does support JSONP, which sidesteps CORS entirely. Through the companion
 * server neither problem exists, so a plain fetch is used instead — that path
 * also works in regions where Deezer is unreachable directly.
 */
async function deezerJson<T = any>(url: string): Promise<T | null> {
  if (await catalogueProxied()) return jsonFetch<T>(proxied(url))
  return jsonp<T>(url)
}

async function catalogueJson<T = any>(url: string, timeout = 12000): Promise<T | null> {
  if (await catalogueProxied()) return jsonFetch<T>(proxied(url), timeout)
  return jsonFetch<T>(url, timeout)
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
    audiusHostPromise = catalogueJson<{ data: string[] }>('https://api.audius.co/')
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
  const data = await deezerJson<{ data: any[] }>(`${DEEZER}/search/track?q=${encodeURIComponent(term)}&limit=${limit}`)
  return (data?.data ?? []).map(mapDeezer).filter(Boolean) as Track[]
}

export async function deezerTopTracks(artistId: string, limit = 50): Promise<Track[]> {
  const data = await deezerJson<{ data: any[] }>(`${DEEZER}/artist/${artistId}/top?limit=${limit}`)
  return (data?.data ?? []).map(mapDeezer).filter(Boolean) as Track[]
}

export async function deezerAlbumTracks(albumId: string): Promise<Track[]> {
  const data = await deezerJson<{ data: any[] }>(`${DEEZER}/album/${albumId}/tracks?limit=100`)
  return (data?.data ?? []).map(mapDeezer).filter(Boolean) as Track[]
}

export async function deezerChart(limit = 25): Promise<Track[]> {
  const data = await deezerJson<{ data: any[] }>(`${DEEZER}/chart/0/tracks?limit=${limit}`)
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
  const data = await deezerJson<{ data: any[] }>(
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
  const data = await deezerJson<{ data: any[] }>(`${DEEZER}/search/album?q=${encodeURIComponent(q)}&limit=8`)
  const wanted = albumTitle.toLowerCase()
  const candidate =
    (data?.data ?? []).find((a) => a?.title && a.title.toLowerCase() === wanted) ??
    (data?.data ?? []).find((a) => a?.title && (a.title.toLowerCase().includes(wanted) || wanted.includes(a.title.toLowerCase())))
  if (!candidate) return null
  const id = String(candidate.id)
  // the search payload omits release_date; the album detail endpoint has it
  const [tracks, detail] = await Promise.all([
    deezerAlbumTracks(id),
    deezerJson<{ release_date?: string; cover_xl?: string; cover_big?: string; record_type?: string }>(`${DEEZER}/album/${id}`),
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
  const data = await deezerJson<{ data: any[] }>(`${DEEZER}/artist/${artistId}/albums?limit=${limit}`)
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
  const data = await deezerJson<{ preview?: string }>(`${DEEZER}/track/${trackId}`)
  return resolveMediaUrl(data?.preview ?? null)
}

/**
 * Wrap a direct media URL so its bytes are fetched through the companion
 * server. The 30-second commercial previews live on CDNs that are also blocked
 * in some regions, so the request has to originate from a machine that can
 * reach them.
 */
export async function resolveMediaUrl(direct: string | null): Promise<string | null> {
  if (!direct) return null
  if (!(await catalogueProxied())) return direct
  return proxied(direct)
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
  const data = await catalogueJson<{ results: any[] }>(`${ITUNES}/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}`)
  return (data?.results ?? []).map(mapItunes).filter(Boolean) as Track[]
}

/**
 * The artist's own genre, straight from iTunes. Deezer omits genres on both
 * the artist and the top-tracks endpoints, so deriving it from tracks left
 * well-known acts mislabelled; iTunes ranks the popular act first and carries
 * a reliable primary genre.
 */
export async function itunesArtistGenre(name: string): Promise<string | null> {
  const data = await catalogueJson<{ results: any[] }>(
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
  const data = await catalogueJson<{ data: any[] }>(`${host}/v1/tracks/search?query=${encodeURIComponent(query)}&limit=${limit}&app_name=${APP_NAME}`)
  return (data?.data ?? []).map(mapAudius).filter(Boolean) as Track[]
}

export async function audiusTrending(limit = 25, genre = ''): Promise<Track[]> {
  const host = await audiusHost()
  const data = await catalogueJson<{ data: any[] }>(
    `${host}/v1/tracks/trending?limit=${limit}&app_name=${APP_NAME}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`,
  )
  return (data?.data ?? []).map(mapAudius).filter(Boolean) as Track[]
}

/**
 * Audius stream URLs redirect to a rotating content node, which a region that
 * blocks Audius cannot reach. Asking the server to validate the redirect and
 * hand back a proxied URL keeps full Audius playback working there.
 */
export async function resolveAudiusStream(trackId: string): Promise<string | null> {
  const host = await audiusHost()
  const direct = `${host}/v1/tracks/${trackId}/stream?app_name=${APP_NAME}`
  if (!(await catalogueProxied())) return direct
  const data = await jsonFetch<{ url?: string }>(`${AUDIO_SERVER()}/audio-url?url=${encodeURIComponent(direct)}`, 9000)
  return data?.url ?? null
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
  /** Present when the server resolved the direct audio URL during the search. */
  streamUrl?: string
  /** SoundCloud rights policy: 'SNIP' uploads are 30-second clips. */
  policy?: string
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
    streamUrl: i.streamUrl ?? null,
    artwork: i.thumbnail || null,
    streamable: true,
    // A SNIP upload is the 30-second clip the rights holder allows; flag it so
    // the UI shows "ПРЕВЬЮ" and the player tries to upgrade to a full version.
    preview: i.policy === 'SNIP',
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
    `${AUDIO_SERVER()}/search?src=${src}&q=${encodeURIComponent(query)}&limit=${limit}`,
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
  // Prefer the server: it can reach SoundCloud where the device cannot, and it
  // resolves the direct URL while searching. The native bridge (Java) is the
  // offline fallback for the APK when no server is configured.
  if (await hasAudioServer()) {
    const items = await serverSearch(query, limit, 'sc').catch(() => [])
    if (items.length) return items.filter((i) => i.id && i.title).map(buildSoundCloudTrack)
  }
  if (hasNativeBridge()) {
    const native = await nativeSearchSoundCloud(query)
    if (native.length) {
      return native
        .filter((i) => i.id && i.title)
        .map((i) =>
          buildSoundCloudTrack({
            id: i.id,
            title: i.title,
            channel: i.artist,
            duration: i.duration,
            thumbnail: i.artwork,
            policy: i.policy,
          }),
        )
    }
  }
  // Static build (GitHub Pages): no server and no bridge, so the browser talks
  // to SoundCloud itself through the proxy pool. See scClient.ts.
  if (!hasNativeBridge()) {
    const items = await scSearch(query, limit).catch(() => [])
    if (items.length) return items.map(buildSoundCloudTrack)
  }
  return []
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

/**
 * Drop a featured-artist credit ("feat.", "ft.", "featuring") and everything
 * after it. Catalogues and uploads credit features differently — Deezer says
 * "Instant Crush (feat. Julian Casablancas)" while SoundCloud says
 * "Daft Punk - Instant Crush ft. Julian Casablancas (Official)" — so without
 * this the correct upload never matches and the track falls back to a preview.
 */
const stripFeat = (s: string) => s.replace(/\b(?:feat|featuring|ft)\b.*$/i, '').trim()

const cleanName = (s: string) =>
  stripFeat(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )

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

  // Hand the best match to the player. Probing candidates here would mean one
  // extraction run each — and on a datacenter IP every one of them is refused,
  // so the probe only ever cost time. The IFrame player decides for itself what
  // is playable from the listener's own IP, and it can retry far more cheaply.
  return ranked[0] ?? null
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
const ytMatchCache = new Map<string, Promise<Track | null>>()

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
  return matchOnce(scMatchCache, 'sc', artist, title)
}

/** Pick the YouTube upload that best matches a commercial track. */
export function findYouTubeFull(artist: string, title: string): Promise<Track | null> {
  return matchOnce(ytMatchCache, 'yt', artist, title)
}

/**
 * Memoise a match lookup by artist|title. Prefetch asks for the same track
 * from several lists at once (home rows overlap with search), and without this
 * every duplicate pays a fresh SoundCloud search on the serialised queue.
 */
function matchOnce(
  cache: Map<string, Promise<Track | null>>,
  kind: string,
  artist: string,
  title: string,
): Promise<Track | null> {
  const key = `${kind}:${artist}|${title}`.toLowerCase()
  const hit = cache.get(key)
  if (hit) return hit
  const task = (
    kind === 'yt' ? findYouTubeTrack(artist, title) : findSoundCloudTrack(artist, title)
  ).catch(() => null)
  cache.set(key, task)
  return task
}

async function findSoundCloudTrack(artist: string, title: string): Promise<Track | null> {
  const results = await searchSoundCloud(`${artist} ${title}`, 4).catch(() => [])
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
  // match is often unplayable. Which candidates are playable depends on how the
  // URL is obtained:
  //  - inside the Android shell the URL is signed in Java, which is cheap, so
  //    walking the ranked list is fine;
  //  - through the companion server each check is a yt-dlp process, so the top
  //    candidates are resolved in one batch instead of a walk of up to six.
  if (hasNativeBridge()) {
    for (const { t } of scored.slice(0, 6)) {
      if (await resolveFullAudio(t.sourceId, 'sc')) return t
    }
    return null
  }
  if (await hasAudioServer()) {
    const top = scored.slice(0, 6)
    // A search hit that already carries a signed URL is playable as-is. The
    // rest are resolved individually — `warmSoundCloudTracks` only asks the
    // server to start, it does not report readiness, so its result cannot be
    // used to decide playability here.
    for (const { t } of top) {
      if (t.streamUrl) return t
    }
    for (const { t } of top) {
      if (await resolveFullAudio(t.sourceId, 'sc').catch(() => null)) return t
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

/**
 * Uploads that are not the song the user asked for. Catalogue search is full
 * of re-uploads — lyric videos, covers, karaoke and sped-up edits — that crowd
 * out the original when you look for a well-known track.
 */
const JUNK_TITLE = /\b(covers?|karaoke|lyric video|lyrics?|instrumental version|8d audio|sped up|slowed(\s*\+?\s*reverb)?|nightcore|ai cover|ai music|tribute|in the style of|made famous by|full album)\b/i

export function isOriginalTrack(t: Track): boolean {
  return !JUNK_TITLE.test(t.title)
}

/**
 * Drop re-uploads, but only when enough real songs remain: a niche query whose
 * results all look like covers should still return something.
 */
export function preferOriginals(tracks: Track[], min = 8): Track[] {
  const clean = tracks.filter(isOriginalTrack)
  return clean.length >= min ? clean : tracks
}

/* ------------------------------------------------------------------ *
 * Combined search — Deezer first (best coverage + images), then
 * interleave iTunes and Audius, deduped by title+artist.
 * ------------------------------------------------------------------ */
/**
 * Fan a query out across the catalogues. Deezer and iTunes answer in ~300ms
 * and Audius streams whole songs, so those three carry the default path.
 * YouTube and SoundCloud both go through yt-dlp — a fresh Python process per
 * call, 1.5-3s each — so they are only worth the wait when a search page
 * explicitly wants their content (`soundcloud: true`).
 *
 * Results are memoised for a few minutes: the wave re-asks the same handful of
 * queries on every batch, and the home rows and search page overlap with them.
 */
const searchCache = new Map<string, { tracks: Track[]; at: number }>()
const SEARCH_TTL = 5 * 60 * 1000

export async function searchAll(query: string, limit = 40, soundcloud = false): Promise<Track[]> {
  const key = `${query}|${limit}|${soundcloud ? 'sc' : ''}`
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.tracks

  const fast = [searchDeezer(query, limit), searchItunes(query, limit), searchAudius(query, limit)]
  const batches = await Promise.all(fast.map((p) => p.catch(() => [])))
  const out = mergeBatches(batches, limit)
  if (out.length) searchCache.set(key, { tracks: out, at: Date.now() })

  // SoundCloud and YouTube answer through third-party proxies / an extractor
  // and can take many seconds, so they are not awaited here. Publishing the
  // catalogue hits first keeps the search page instant; the slower sources are
  // merged in when they arrive and announced so the list grows in place.
  if (soundcloud) {
    void Promise.all([
      searchSoundCloud(query, limit).catch(() => []),
      searchYouTube(query, limit).catch(() => []),
    ]).then((extra) => {
      const merged = mergeBatches([out, ...extra], limit)
      // Compare by identity, not by length: the catalogue usually already fills
      // `limit`, so an interleaved list can be the same length while containing
      // tracks the page has never seen. A length check silently dropped every
      // SoundCloud result in exactly that case.
      const known = new Set(out.map((t) => t.id))
      if (!merged.some((t) => !known.has(t.id))) return
      searchCache.set(key, { tracks: merged, at: Date.now() })
      for (const cb of searchExtraListeners) cb(query, merged)
    })
  }
  return out
}

/** Interleave source batches, dropping duplicates, up to `limit` tracks. */
function mergeBatches(batches: Track[][], limit: number): Track[] {
  const seen = new Set<string>()
  const out: Track[] = []
  const max = Math.max(0, ...batches.map((b) => b.length))
  for (let i = 0; i < max && out.length < limit; i++) {
    for (const batch of batches) {
      if (out.length >= limit) break
      const t = batch[i]
      if (!t) continue
      const dedupe = `${t.title.toLowerCase()}|${t.artist.toLowerCase()}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      out.push(t)
    }
  }
  return out
}

const searchExtraListeners = new Set<(query: string, tracks: Track[]) => void>()

/**
 * Subscribe to the late-arriving search sources (SoundCloud, YouTube). Fires
 * once per search with the query and the re-merged list.
 */
export function subscribeSearchExtra(cb: (query: string, tracks: Track[]) => void): () => void {
  searchExtraListeners.add(cb)
  return () => searchExtraListeners.delete(cb)
}

/**
 * Whole songs that are playable the instant they arrive (Audius streams
 * directly, so nothing has to be resolved first). Used to top up a result set
 * so a stream can start without waiting on any per-track resolution.
 */
export async function audiusTopUp(term: string, limit: number): Promise<Track[]> {
  if (limit <= 0) return []
  return searchAudius(term, Math.min(limit, 25)).catch(() => [])
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

/**
 * Swap a 30-second preview for the matching full-length upload.
 *
 * Order matters and is deliberate:
 *  1. SoundCloud, when a resolver is available (companion server or the
 *     Android bridge). It streams whole songs from any IP, so it is the only
 *     source that is both full-length and actually playable here.
 *  2. YouTube. With no resolver the track is handed to the official IFrame
 *     player, which plays the full video from the listener's own (residential)
 *     IP — no extraction, no wait, and it cannot fail on a bot check.
 *
 * The old order probed YouTube extraction first and only then fell back, so on
 * a datacenter IP every track paid several failed yt-dlp runs before landing
 * where it was always going to land. That is what made full versions slow.
 */
/**
 * Resolve to null if `p` has not settled within `ms`. The underlying work is
 * left running, so a slow lookup still lands in its cache for the next caller
 * instead of being thrown away.
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

async function resolveFullTrack(track: Track): Promise<Track | null> {
  const server = await hasAudioServer()
  const hasResolver = server || hasNativeBridge()

  if (hasResolver) {
    // SoundCloud gives a real file the <audio> element can stream, which keeps
    // the visualiser working, so it is tried first. Its lookup is not instant:
    // a flat search is ~1.5s and resolving a candidate's signed URL is ~2s on a
    // cold cache. It is also memoised, so the wait is paid once per track.
    const scMatch = findSoundCloudFull(track.artist, track.title).catch(() => null)
    const ytMatch = server
      ? await findYouTubeFull(track.artist, track.title).catch(() => null)
      : null
    // When YouTube can serve as a fallback, cap the SoundCloud wait so a track
    // it does not have does not stall playback. When YouTube has no match,
    // SoundCloud is the only playable source here, so wait for it in full
    // rather than timing out and dropping the listener to a 30s preview.
    const sc = ytMatch ? await withDeadline(scMatch, 8000) : await scMatch
    if (sc) {
      // `findSoundCloudFull` only returns a hit whose URL the server already
      // resolved, so there is nothing to wait for here.
      const streamUrl = sc.streamUrl ?? (await resolveFullAudio(sc.sourceId, 'sc').catch(() => null))
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
    // Nothing streamable on SoundCloud. Hand the YouTube match to the player
    // without probing it: the IFrame player decides for itself what plays, and
    // probing only ever costs a refused extraction on a datacenter IP.
    if (ytMatch) {
      return {
        ...track,
        source: 'youtube',
        sourceId: ytMatch.sourceId,
        streamUrl: null,
        preview: false,
        previewTrack: track,
        duration: ytMatch.duration || track.duration,
      }
    }
  }

  // The companion server cannot hand out a direct YouTube stream, but the
  // IFrame player embeds YouTube in the listener's own browser and streams
  // from their IP, which is usually fine even when the server's IP is refused.
  // So keep looking for a video id and let the player try.

  // No usable server. Search for the video id — that endpoint answers fine even
  // when extraction is refused — and let the IFrame player stream it from the
  // listener's own residential IP.
  const match = await findYouTubeTrack(track.artist, track.title).catch(() => null)
  if (match) {
    return {
      ...track,
      source: 'youtube',
      sourceId: match.sourceId,
      streamUrl: null,
      preview: false,
      previewTrack: track,
      duration: match.duration || track.duration,
    }
  }
  return null
}

/**
 * Resolve full versions for a whole list in the background, a few at a time.
 * Results are published to `fullTrackCache`/listeners, so any subscribed list
 * swaps its previews in place and the first play starts full immediately.
 */
export async function prefetchFullTracks(tracks: Track[], concurrency = 2): Promise<void> {
  // Only the first screenful is worth pre-resolving: playback almost always
  // starts at the top of a list, and each extra lookup competes for the same
  // serialised extractor queue. Six covers the visible rows on any screen.
  const head = tracks.slice(0, 6)
  const previews = head.filter((t) => t.preview && (t.source === 'deezer' || t.source === 'itunes'))
  void warmSoundCloudTracks(head.filter((t) => t.source === 'soundcloud'))
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
/**
 * Base URL of the companion server, re-read on every call so a server entered
 * in Settings takes effect without a reload. On the web it is usually a
 * same-origin `/api` (Vite proxies it in dev); the bundled Android app has no
 * server of its own, so it is pointed at a real deployment — without that, a
 * phone on a network that blocks SoundCloud and the catalogues has nothing to
 * play at all. See `serverConfig.ts`.
 */
const AUDIO_SERVER = () => audioServerBase()

let audioServerUp: boolean | null = null
let audioServerProbe: Promise<boolean> | null = null

/**
 * Forget the remembered server verdict. Called after the user changes the
 * server address in Settings: the old probe (and its cached result) describes
 * the previous server, not the new one.
 */
export function resetAudioServerCache(): void {
  audioServerUp = null
  audioServerProbe = null
  ytServerBlocked = false
}

/** Probe the companion server once per session. */
export function hasAudioServer(): Promise<boolean> {
  // The offline APK has no server of its own; the native bridge covers
  // SoundCloud instead. Probing anyway would hit the asset loader (a 404 for
  // /api/health) and cost a pointless round trip on every start. But if the
  // user (or the build) pointed the app at a real deployment, probe it — that
  // server is what makes full-length playback work where the CDNs are blocked.
  if (hasNativeBridge() && !serverConfigured()) {
    audioServerUp = false
    return Promise.resolve(false)
  }
  if (audioServerUp !== null) return Promise.resolve(audioServerUp)
  if (audioServerProbe) return audioServerProbe
  audioServerProbe = (async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    try {
      const res = await fetch(`${AUDIO_SERVER()}/health`, { signal: ctrl.signal })
      // A static host answers *any* unknown path with index.html and a 200, so
      // `res.ok` alone would report a server that is not there and send every
      // catalogue call to a page of HTML. Require the health payload itself.
      const body = res.ok ? await res.json().catch(() => null) : null
      audioServerUp = Boolean(body && body.ok === true)
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
  // Once the server's IP is refused by YouTube, every further probe is a
  // guaranteed failure that costs seconds. Skip straight to the IFrame player.
  if (src === 'yt' && ytServerBlocked) return Promise.resolve(null)

  // SoundCloud in a static build (e.g. GitHub Pages): there is no companion
  // server, so the browser resolves the signed URL and stitches HLS itself.
  // See scClient.ts.
  if (src === 'sc' && !hasNativeBridge()) {
    return hasAudioServer().then((up) => (up ? resolveCached(sourceId, src) : resolveScServerless(sourceId)))
  }

  // The server signs *and* proxies SoundCloud audio, so it plays even where
  // SoundCloud's CDN is blocked; the native bridge hands back a signed CDN URL
  // that the page stitches itself, so it needs the CDN to be reachable. Prefer
  // the server when present.
  if (hasNativeBridge()) {
    return hasAudioServer().then((up) => {
      if (up) return resolveViaServer(sourceId, src)
      if (src === 'sc') return resolveScNative(sourceId)
      return null
    })
  }

  return resolveCached(sourceId, src)
}

/**
 * The one stitched SoundCloud file kept alive in the browser. Each is
 * megabytes, and a new load means the previous track is done with.
 */
let serverlessScBlob: string | null = null

/** Resolve SoundCloud entirely in the browser, with no companion server. */
async function resolveScServerless(sourceId: string): Promise<string | null> {
  const playable = await scPlayableUrl(sourceId).catch(() => null)
  if (!playable) return null
  if (playable.revoke) {
    if (serverlessScBlob) URL.revokeObjectURL(serverlessScBlob)
    serverlessScBlob = playable.url
  }
  return playable.url
}

/**
 * Resolve SoundCloud through the Android bridge, which signs the URL in Java
 * (no CORS applies there) but cannot make an <audio>-playable file: the full
 * songs are HLS-only, so the fragments are fetched and stitched here. The CDN
 * sends `Access-Control-Allow-Origin: *`, so the WebView may read them.
 */
async function resolveScNative(sourceId: string): Promise<string | null> {
  const media = await nativeResolveSoundCloud(sourceId).catch(() => null)
  if (!media) return null
  if (media.protocol === 'progressive') return media.url
  const blob = await stitchScHls(media.url).catch(() => null)
  if (!blob) return null
  if (serverlessScBlob) URL.revokeObjectURL(serverlessScBlob)
  serverlessScBlob = URL.createObjectURL(blob)
  return serverlessScBlob
}

/** Resolve through the companion server, memoising only successes. */
function resolveCached(sourceId: string, src: 'yt' | 'sc'): Promise<string | null> {
  const key = `${src}:${sourceId}`
  const hit = resolveCache.get(key)
  if (hit) return hit
  const task = resolveViaServer(sourceId, src)
  // A miss usually just means the server's background extraction has not
  // finished yet, so caching it would make the track permanently unplayable
  // for the rest of the session.
  task.then((url) => {
    if (!url) resolveCache.delete(key)
  })
  resolveCache.set(key, task)
  return task
}

/**
 * Set once the server reports that YouTube extraction is blocked (datacenter
 * bot check). From then on every YouTube track goes straight to the IFrame
 * player, which streams from the listener's own IP, instead of paying a
 * doomed extraction probe per track.
 */
let ytServerBlocked = false

async function resolveViaServer(sourceId: string, src: 'yt' | 'sc', attempts = 4): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    if (!(await hasAudioServer())) return null
    const data = await jsonFetch<{ ok?: boolean; denied?: boolean; blocked?: boolean }>(
      `${AUDIO_SERVER()}/resolve?src=${src}&id=${sourceId}`,
      8000,
    )
    if (data?.ok) return `${AUDIO_SERVER()}/audio?src=${src}&id=${sourceId}`
    // `denied` is permanent for this upload and `blocked` is a property of the
    // whole server, so neither is worth retrying. Anything else means the
    // extractor is still working — give it a moment and ask again.
    if (data?.denied) return null
    if (data?.blocked) {
      if (src === 'yt') ytServerBlocked = true
      return null
    }
    // A plain failure is ambiguous — the extractor may still be working, so wait
    // and ask once more. `blocked`/`denied` above are already final answers.
    await new Promise((r) => setTimeout(r, 700))
  }
  return null
}

/**
 * Resolve many SoundCloud ids in one server round trip. Used to pre-warm a
 * queue: the server runs a single yt-dlp process for the whole batch instead of
 * one per track, so a queue of full songs is ready before it is played.
 */
export async function warmSoundCloudTracks(tracks: Track[]): Promise<Set<string>> {
  if (!tracks.length || hasNativeBridge()) return new Set()
  // Tracks that already carry a URL (search resolved them) need no warming.
  const pending = tracks.filter((t) => !t.streamUrl)
  return warmSoundCloudIds(pending.map((t) => t.sourceId).filter(Boolean))
}

/**
 * Warm a batch of SoundCloud ids, coalescing calls that land close together.
 * A search page upgrades a whole screenful of previews at once; without this
 * each upgrade would queue its own serialised yt-dlp run on the server and the
 * later ones would never finish.
 */
let warmBatch: Set<string> | null = null
let warmTimer: ReturnType<typeof setTimeout> | null = null

export function warmSoundCloudIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length || hasNativeBridge()) return Promise.resolve(new Set())
  warmBatch ??= new Set()
  ids.forEach((id) => warmBatch!.add(id))
  if (warmTimer) clearTimeout(warmTimer)
  warmTimer = setTimeout(flushWarmBatch, 40)
  // Readiness is polled per id, so the caller does not have to wait for the
  // extraction itself — only for the batch to be handed to the server.
  return Promise.resolve(new Set())
}

async function flushWarmBatch() {
  const batch = warmBatch
  warmBatch = null
  warmTimer = null
  if (!batch?.size || !(await hasAudioServer())) return
  const ids = [...batch].slice(0, 12)
  // Ask the server to start resolving and return immediately. The old call
  // waited for the whole batch (up to 40s), which is exactly the stall the
  // upgrade path was meant to avoid.
  void fetch(`${AUDIO_SERVER()}/warm?ids=${ids.join(',')}`).catch(() => {})
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
