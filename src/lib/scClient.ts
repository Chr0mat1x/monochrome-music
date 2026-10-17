/**
 * Serverless SoundCloud client.
 *
 * The hosted build normally talks to `server/index.mjs`, which proxies the
 * catalogue and stitches HLS into one MP4. That server needs somewhere to run,
 * which a static host like GitHub Pages cannot provide. This module removes
 * that requirement:
 *
 *  - the *catalogue* (search, track metadata, the signed media URL) has no CORS
 *    headers, so those few small JSON calls go through a pool of public CORS
 *    proxies;
 *  - the *audio* itself is served with `Access-Control-Allow-Origin: *` by
 *    SoundCloud's playback CDN, so the manifest and every fragment are fetched
 *    straight from the browser and stitched into one Blob.
 *
 * Only the three small API calls depend on a proxy; the megabytes of audio do
 * not. That keeps the proxy load tiny, which is what makes the free pool
 * workable at all.
 */

const API = 'https://api-v2.soundcloud.com'
const SC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'

/**
 * A client_id is embedded at build time. It is a public value — SoundCloud
 * ships it inside their own web bundle — and it is what makes the API work
 * without any per-session setup. The id rotates on SoundCloud's schedule, so
 * the scrape below still runs when the embedded one stops being accepted, and
 * the value can be overridden with `VITE_SC_CLIENT_ID` at build time.
 *
 * Scraping alone is not enough to rely on: public CORS proxies frequently fail
 * on `soundcloud.com`'s HTML (Cloudflare answers them with a 5xx), whereas the
 * `api-v2` JSON endpoints go through fine. So the embedded id is the primary
 * path and the scrape is the repair path.
 */
const BAKED_CLIENT_ID =
  (import.meta.env.VITE_SC_CLIENT_ID as string | undefined) || 'tHVbSbDP4TaoMbPppngv6Tdry83vNbMQ'

/**
 * Public CORS proxies. None is individually reliable — they rate-limit, time
 * out, or start returning their own error page — so they are raced in parallel
 * and the first valid answer wins. Racing rather than trying them in sequence
 * matters: a dead proxy in the chain would otherwise burn its whole timeout
 * before the next one was even tried.
 *
 * `r.jina.ai` is first because it is the one that consistently returns the
 * upstream JSON. It prefixes the body with a short header (`Title: … Markdown
 * Content: {…}`), which `unwrap` skips past.
 */
const PROXIES: ((url: string) => string)[] = [
  (u) => `https://r.jina.ai/${u}`,
  (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
]

/**
 * Resolve with the first promise to fulfil, ignoring rejections. This is
 * `Promise.any`, reimplemented because the build targets ES2020 where it does
 * not exist. Rejects only if every promise rejects.
 */
function firstFulfilled<T>(promises: Promise<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let pending = promises.length
    if (!pending) return reject(new Error('no candidates'))
    for (const p of promises) {
      p.then(resolve, () => {
        if (--pending === 0) reject(new Error('all failed'))
      })
    }
  })
}

/**
 * Extract JSON from a proxy body. Proxies answer in several shapes: the raw
 * JSON, `{contents: "<json>"}` (allorigins), or a text-wrapped body with a
 * `Title: … Markdown Content: {…}` preamble (r.jina.ai). Anything that is not
 * JSON — an HTML error page, a rate-limit notice — is rejected so the race
 * moves on to the next proxy.
 */
function unwrap(text: string): unknown {
  let body = text.trim()
  if (body.startsWith('<')) throw new Error('proxy returned html')

  // allorigins/get: the payload is JSON-encoded inside `contents`.
  if (body.startsWith('{') && /"contents"\s*:/.test(body.slice(0, 400))) {
    try {
      const outer = JSON.parse(body)
      if (outer && typeof outer.contents === 'string') body = outer.contents.trim()
    } catch {
      /* fall through and try the body as-is */
    }
  }

  // r.jina.ai and similar: skip any prose preamble up to the first brace.
  if (!body.startsWith('{') && !body.startsWith('[')) {
    const start = body.search(/[[{]/)
    if (start < 0) throw new Error('no json in proxy body')
    body = body.slice(start)
  }
  return JSON.parse(body)
}

/**
 * GET a SoundCloud API path through the proxy pool.
 *
 * Every proxy is tried at once and the first usable JSON body is returned, so
 * a slow or dead proxy never delays the result. Returns null when they all
 * fail, which the callers treat as "no answer", not as an error.
 */
async function scApi<T = any>(path: string, timeoutMs = 20000): Promise<T | null> {
  // Transcoding URLs come back absolute (`https://api-v2.soundcloud.com/media/…`)
  // while every other call passes a path. Prepending the base unconditionally
  // produced `https://api-v2.soundcloud.comhttps://api-v2.soundcloud.com/…`,
  // which SoundCloud answers with 422.
  const url = path.startsWith('http') ? path : `${API}${path}`
  const controllers = PROXIES.map(() => new AbortController())
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), timeoutMs)

  const attempt = async (wrap: (u: string) => string, ctrl: AbortController): Promise<T> => {
    const res = await fetch(wrap(url), { signal: ctrl.signal })
    if (!res.ok) throw new Error(`proxy HTTP ${res.status}`)
    return unwrap(await res.text()) as T
  }

  try {
    // `any` rather than `allSettled`: the first fulfilled promise resolves the
    // race. Every loser's rejection is handled below so it is not unhandled.
    const racers = PROXIES.map((wrap, i) => attempt(wrap, controllers[i]))
    racers.forEach((p) => p.catch(() => {}))
    return await firstFulfilled(racers)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    controllers.forEach((c) => c.abort())
  }
}

let clientId = BAKED_CLIENT_ID
// Seeded as "just fetched" so the embedded id is used as-is. Leaving this at 0
// made every first call look stale and run the scrape, which costs tens of
// seconds against public proxies — and, because `searchAll` waits on all its
// sources, that stalled the whole search page until it gave up.
let clientIdAt = BAKED_CLIENT_ID ? Date.now() : 0

/**
 * Find a usable client_id. Scraping the public web bundle is the only
 * self-sufficient route: the v1 API that would hand one out now requires OAuth
 * and answers 401/403 anonymously.
 */
export async function ensureClientId(force = false): Promise<string | null> {
  if (!force && clientId && Date.now() - clientIdAt < 30 * 60 * 1000) return clientId
  const home = await scApiText('https://soundcloud.com/')
  if (!home) return clientId || null
  const scripts = [...home.matchAll(/src="(https:\/\/[^"]*sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
  for (const src of scripts.reverse()) {
    const js = await scApiText(src)
    if (!js) continue
    const m = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/.exec(js)
    if (m) {
      clientId = m[1]
      clientIdAt = Date.now()
      return clientId
    }
  }
  return clientId || null
}

/**
 * Fetch a plain-text URL through the pool (used for the client_id scrape).
 * Same race as `scApi`, but it accepts a document that merely *contains* the
 * value rather than requiring JSON.
 */
async function scApiText(url: string, timeoutMs = 20000): Promise<string | null> {
  const controllers = PROXIES.map(() => new AbortController())
  const timer = setTimeout(() => controllers.forEach((c) => c.abort()), timeoutMs)
  const attempt = async (wrap: (u: string) => string, ctrl: AbortController) => {
    const res = await fetch(wrap(url), { signal: ctrl.signal })
    if (!res.ok) throw new Error(`proxy HTTP ${res.status}`)
    const text = await res.text()
    // `allorigins/get` wraps the body in JSON; unwrap it when it does.
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && typeof parsed.contents === 'string') return parsed.contents as string
    } catch {
      /* plain body */
    }
    return text
  }
  try {
    const racers = PROXIES.map((wrap, i) => attempt(wrap, controllers[i]))
    racers.forEach((p) => p.catch(() => {}))
    return await firstFulfilled(racers)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    controllers.forEach((c) => c.abort())
  }
}

export interface ScSearchItem {
  id: string
  title: string
  duration: number
  channel: string
  thumbnail: string
  policy: string
}

/** True when the only streams on offer are DRM-encrypted. */
function hasOnlyEncryptedHls(t: any): boolean {
  const transcodings = (t?.media?.transcodings) || []
  if (!transcodings.length) return false
  return transcodings.every((x: any) => /encrypted-hls/.test(x?.format?.protocol || ''))
}

/** Search SoundCloud tracks, keeping only anonymously streamable uploads. */
export async function scSearch(query: string, limit = 25): Promise<ScSearchItem[]> {
  const cid = await ensureClientId()
  if (!cid) return []
  const fetchN = Math.min(Math.max(limit * 8, 30), 60)
  const page = (q: string) =>
    scApi<{ collection?: any[] }>(`/search/tracks?q=${encodeURIComponent(q)}&client_id=${cid}&limit=${fetchN}`)

  const keep = (collection: any[] | undefined): ScSearchItem[] =>
    (collection || [])
      .filter((t) => t && t.streamable !== false && !hasOnlyEncryptedHls(t))
      .map((t) => ({
        id: String(t.id),
        title: t.title || '',
        duration: (Number(t.duration) || 0) / 1000,
        channel: t.user?.username || '',
        thumbnail: t.artwork_url || t.user?.avatar_url || '',
        policy: t.policy || '',
      }))
      // Full-length uploads lead; 30-second SNIP clips fall to the bottom.
      .sort((a, b) => (a.policy === 'SNIP' ? 1 : 0) - (b.policy === 'SNIP' ? 1 : 0))

  let items = keep((await page(query))?.collection)
  // A broad query can be licensed end to end, so widen once before going blank.
  if (!items.length) {
    for (const widened of [`${query} mix`, `${query} beats`]) {
      items = keep((await page(widened))?.collection)
      if (items.length) break
    }
  }
  return items.slice(0, limit)
}

export interface ScMedia {
  /** Signed media URL. Short-lived: SoundCloud tokens expire in a few minutes. */
  url: string
  protocol: 'hls' | 'progressive'
  duration: number
}

/**
 * Resolve the signed media URL for a track. Prefers progressive (a plain MP3
 * the browser can play as-is) and falls back to HLS, which has to be stitched.
 */
export async function resolveScMedia(id: string): Promise<ScMedia | null> {
  const cid = await ensureClientId()
  if (!cid) return null
  const track = await scApi<any>(`/tracks/${id}?client_id=${cid}`)
  if (!track) return null
  const transcodings: any[] = track.media?.transcodings || []
  const progressive = transcodings.find((t) => t?.format?.protocol === 'progressive')
  const plainHls = transcodings.filter((t) => t?.format?.protocol === 'hls')
  const hls = plainHls.find((t) => t.preset === 'aac_160k') || plainHls[0]
  const pick = progressive || hls
  if (!pick) return null
  const mediaPath = pick.url.includes('?') ? `${pick.url}&client_id=${cid}` : `${pick.url}?client_id=${cid}`
  const resolved = await scApi<{ url?: string }>(mediaPath)
  if (!resolved?.url) return null
  return {
    url: resolved.url,
    protocol: progressive ? 'progressive' : 'hls',
    duration: (Number(track.duration) || 0) / 1000,
  }
}

export interface StitchProgress {
  (loaded: number, total: number): void
}

/** Parse a media playlist: the init segment and the fragment URLs. */
function parseMediaPlaylist(text: string) {
  const lines = text.split('\n').map((l) => l.trim())
  const mapLine = lines.find((l) => l.startsWith('#EXT-X-MAP'))
  const init = mapLine ? /URI="([^"]+)"/.exec(mapLine)?.[1] ?? null : null
  const segments = lines.filter((l) => l && !l.startsWith('#'))
  const encrypted = lines.some((l) => l.startsWith('#EXT-X-KEY') && !/METHOD=NONE/.test(l))
  return { init, segments, encrypted }
}

/**
 * Download an HLS playlist's fragments and concatenate them into one MP4 Blob.
 *
 * This is the browser-side twin of the server's `buildHls`. SoundCloud now
 * serves most uploads only as fMP4 HLS, which a plain <audio> element cannot
 * decode, so the fragments are fetched directly (the CDN allows it) and joined
 * into a single seekable file.
 */
export async function stitchScHls(manifestUrl: string, onProgress?: StitchProgress): Promise<Blob> {
  const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`)
  const text = await res.text()
  if (!text.startsWith('#EXTM3U')) throw new Error('not a media playlist')
  const { init, segments, encrypted } = parseMediaPlaylist(text)
  if (encrypted) throw new Error('hls stream is DRM-encrypted')
  if (!segments.length) throw new Error('empty hls playlist')

  const total = segments.length + (init ? 1 : 0)
  const parts: (ArrayBuffer | undefined)[] = new Array(segments.length)
  let initBytes: ArrayBuffer | undefined
  let done = 0

  if (init) {
    const r = await fetch(init, { signal: AbortSignal.timeout(20000) })
    if (!r.ok) throw new Error(`init segment HTTP ${r.status}`)
    initBytes = await r.arrayBuffer()
    onProgress?.(++done, total)
  }

  // A few fragments at a time: sequentially is far too slow for a two-hour mix,
  // while unbounded parallelism gets the CDN to throttle the whole download.
  let cursor = 0
  const worker = async () => {
    while (cursor < segments.length) {
      const i = cursor++
      const r = await fetch(segments[i], { signal: AbortSignal.timeout(30000) })
      if (!r.ok) throw new Error(`segment HTTP ${r.status}`)
      parts[i] = await r.arrayBuffer()
      onProgress?.(++done, total)
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, segments.length) }, worker))

  const ordered: BlobPart[] = initBytes ? [initBytes] : []
  for (const p of parts) if (p) ordered.push(p)
  return new Blob(ordered, { type: 'audio/mp4' })
}

/** Resolve a track all the way to something an <audio> element can play. */
export async function scPlayableUrl(
  id: string,
  onProgress?: StitchProgress,
): Promise<{ url: string; revoke: boolean } | null> {
  const media = await resolveScMedia(id)
  if (!media) return null
  if (media.protocol === 'progressive') return { url: media.url, revoke: false }
  const blob = await stitchScHls(media.url, onProgress)
  return { url: URL.createObjectURL(blob), revoke: true }
}
