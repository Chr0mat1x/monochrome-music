/**
 * Local audio proxy backed by yt-dlp.
 *
 * YouTube refuses anonymous stream access from datacenter IPs, so the official
 * IFrame embed fails in the cloud. Running on the listener's own machine, this
 * tiny server asks yt-dlp for the direct audio URL and streams it back with
 * byte-range support, which lets the frontend play full-length tracks through
 * a plain <audio> element (and therefore through the Web Audio analyser).
 *
 * It only ever runs locally; nothing is uploaded anywhere.
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { createReadStream, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = Number(process.env.MONO_SERVER_PORT || 8787)

// The APK lives outside public/ so Vite never bundles it into the web build
// (which would make each APK contain the previous one). It is served here and
// proxied by Vite at /MONOCHROME.apk.
const APK_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'downloads', 'MONOCHROME.apk')

/**
 * yt-dlp can be installed several ways, so try the common invocations. The
 * first one that runs successfully is remembered for the process lifetime.
 */
const CANDIDATES = [
  process.env.YTDLP_PATH && { cmd: process.env.YTDLP_PATH, base: [] },
  { cmd: 'yt-dlp', base: [] },
  { cmd: 'python3', base: ['-m', 'yt_dlp'] },
  { cmd: 'python', base: ['-m', 'yt_dlp'] },
].filter(Boolean)

let ytdlpChoice = null

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      // `--ignore-errors` still exits non-zero when any entry fails (a
      // DRM-protected SoundCloud upload, say) while printing usable results for
      // the rest. Treat printed output as success; only a silent failure is one.
      if (code === 0 || out.trim()) resolve(out.trim())
      else reject(new Error(err.trim() || `${cmd} exited with ${code}`))
    })
  })
}

/** Run yt-dlp with the first working invocation. */
async function ytdlp(args) {
  if (ytdlpChoice) return run(ytdlpChoice.cmd, [...ytdlpChoice.base, ...args])
  let lastErr
  for (const c of CANDIDATES) {
    try {
      const out = await run(c.cmd, [...c.base, '--version'])
      if (out) {
        ytdlpChoice = c
        return run(c.cmd, [...c.base, ...args])
      }
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`yt-dlp not found (${lastErr?.message || 'no candidate worked'})`)
}

/** Cache of resolved direct URLs: videoId → { url, expires }. */
const urlCache = new Map()
const URL_TTL = 20 * 60 * 1000
const SC_FORMAT = 'http_mp3/bestaudio[protocol^=http]/bestaudio/best'

/**
 * SoundCloud answers a burst of extractor calls with HTTP 403, which would
 * break playback for minutes. Every SoundCloud extraction therefore goes
 * through this queue, so the server runs one at a time and stays under the
 * limit; the batch endpoints already fold many tracks into a single run.
 */
let scChain = Promise.resolve()
function scSerial(task) {
  const run = scChain.then(task, task)
  scChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// SoundCloud also refuses a burst outright (HTTP 403). Back off for a while
// instead of retrying every candidate and keeping the block alive.
let scBlockedUntil = 0

// YouTube refuses anonymous extraction from datacenter IPs ("Sign in to confirm
// you're not a bot", "This video is not available"). Once failures pile up, skip
// YouTube extraction for a while instead of paying a failed run per candidate.
let ytBlockedUntil = 0
let ytFailStreak = 0
const YT_BLOCK_RE = /not a bot|Sign in to confirm|not available|unavailable|HTTP Error 4/i

/**
 * Search SoundCloud and resolve the results in a single yt-dlp run.
 *
 * Searching and then resolving each candidate separately costs one Python
 * process per step, and a fresh process takes ~0.5s before yt-dlp does any
 * work at all. Asking yt-dlp for the direct URL during the search itself means
 * one process yields every playable candidate, DRM-protected uploads drop out
 * on their own, and the URLs land in the cache so playback is immediate.
 */
async function scSearchDirect(prefix, query, n) {
  // While resolve is rate-limited, still return the flat listing: searching is
  // a different endpoint and keeps SoundCloud results on the page.
  if (Date.now() < scBlockedUntil) return scFlatSearch(prefix, query, n)
  const items = []
  try {
    const out = await scSerial(() =>
      ytdlp([
        '--no-warnings',
        '--ignore-errors',
        '-f',
        SC_FORMAT,
        '--print',
        '%(id)s\t%(title)s\t%(duration)s\t%(uploader)s\t%(url)s',
        `${prefix}${n}:${query}`,
      ]),
    )
    for (const line of out.split('\n')) {
      const [id, title, duration, channel, url] = line.split('\t')
      if (!id || !url || !SC_ID.test(id)) continue
      urlCache.set(`sc:${id}`, { url, expires: Date.now() + URL_TTL })
      items.push({
        id,
        title: title || '',
        duration: Number(duration) || 0,
        channel: channel || '',
        thumbnail: '',
        streamUrl: url,
      })
    }
  } catch (e) {
    if (!/403|Forbidden/i.test(String(e.message || e))) throw e
    // The resolve half is rate-limited, but search itself still answers (the
    // flat listing is a different endpoint). Return the candidates without a
    // URL: playback then resolves lazily, and a burst is not retried.
    scBlockedUntil = Date.now() + 60 * 1000
    console.log('[monochrome]   ↳ sc resolve rate-limited; returning search results only')
    return scFlatSearch(prefix, query, n)
  }
  return items
}

/** Flat SoundCloud search (no direct URL): the metadata-only listing. */
async function scFlatSearch(prefix, query, n) {
  const out = await scSerial(() =>
    ytdlp(['--no-warnings', '--ignore-errors', '--flat-playlist', '-j', `${prefix}${n}:${query}`]),
  ).catch(() => '')
  return out
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .map((i) => ({
      id: String(i.id ?? ''),
      title: i.title || '',
      duration: Number(i.duration) || 0,
      channel: i.uploader || i.channel || '',
      thumbnail: i.thumbnail || '',
      streamUrl: '',
    }))
    .filter((i) => SC_ID.test(i.id))
}

/** Resolve several SoundCloud ids in one yt-dlp run, reusing the cache. */
async function scResolveMany(ids) {
  const want = ids.filter((id) => {
    const hit = urlCache.get(`sc:${id}`)
    return SC_ID.test(id) && !(hit && hit.expires > Date.now())
  })
  if (!want.length) return
  if (Date.now() < scBlockedUntil) return
  const out = await scSerial(() =>
    ytdlp([
      '--no-warnings',
      '--ignore-errors',
      '-f',
      SC_FORMAT,
      '--print',
      '%(id)s\t%(url)s',
      ...want.map((id) => `https://api.soundcloud.com/tracks/${id}`),
    ]),
  ).catch((e) => {
    if (/403|Forbidden/i.test(String(e.message || e))) scBlockedUntil = Date.now() + 60 * 1000
    return ''
  })
  for (const line of out.split('\n')) {
    const [id, url] = line.split('\t')
    if (id && url) urlCache.set(`sc:${id}`, { url, expires: Date.now() + URL_TTL })
  }
}

/**
 * Some CDNs refuse a plain fetch of the URLs yt-dlp hands out (YouTube ties
 * them to the extracting session; SoundCloud serves them freely). Confirm the
 * URL actually plays with a one-byte ranged request before caching, so a
 * blocked source reports "unavailable" instead of failing silently later.
 */
async function requirePlayable(url) {
  const probe = await fetch(url, { headers: { range: 'bytes=0-1' } }).catch(() => null)
  if (!probe || !probe.ok || !probe.body) {
    throw new Error(`stream unavailable (HTTP ${probe ? probe.status : 'network error'})`)
  }
  probe.body.cancel().catch(() => {})
}

function firstUrl(out) {
  const url = out.split('\n').map((l) => l.trim()).find(Boolean)
  if (!url) throw new Error('yt-dlp returned no URL')
  return url
}

/** Resolve (and cache) the direct audio URL for a YouTube video id. */
async function directUrl(videoId) {
  const key = `yt:${videoId}`
  const hit = urlCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.url
  // When YouTube answers "confirm you're not a bot", every further extractor
  // run is refused too. Stop spawning processes for a while instead of paying a
  // failed yt-dlp run per candidate; SoundCloud is the working source anyway.
  if (Date.now() < ytBlockedUntil) throw new Error('youtube temporarily unavailable (bot check)')
  let out
  try {
    out = await ytdlp([
      '--no-warnings',
      '--no-playlist',
      '-f',
      'bestaudio[ext=m4a]/bestaudio/best',
      '--get-url',
      `https://www.youtube.com/watch?v=${videoId}`,
    ])
  } catch (e) {
    if (YT_BLOCK_RE.test(String(e.message || e)) && ++ytFailStreak >= 3) {
      ytBlockedUntil = Date.now() + 3 * 60 * 1000
      ytFailStreak = 0
    }
    throw e
  }
  ytFailStreak = 0
  const url = firstUrl(out)
  await requirePlayable(url)
  urlCache.set(key, { url, expires: Date.now() + URL_TTL })
  return url
}

/**
 * Resolve (and cache) the direct audio URL for a SoundCloud track id. YouTube
 * refuses anonymous streams from datacenter IPs, so SoundCloud — which serves
 * full-length audio anywhere — is what actually keeps playback working here.
 */
async function scDirectUrl(trackId) {
  const key = `sc:${trackId}`
  const hit = urlCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.url
  if (Date.now() < scBlockedUntil) throw new Error('soundcloud temporarily unavailable (rate limit)')
  const out = await scSerial(() =>
    ytdlp([
      '--no-warnings',
      '--no-playlist',
      // Prefer the progressive HTTP MP3: a browser <audio> element cannot play
      // SoundCloud's HLS manifest, and range requests give us seeking for free.
      '-f',
      SC_FORMAT,
      '--get-url',
      `https://api.soundcloud.com/tracks/${trackId}`,
    ]),
  ).catch((e) => {
    if (/403|Forbidden/i.test(String(e.message || e))) scBlockedUntil = Date.now() + 60 * 1000
    throw e
  })
  const url = firstUrl(out)
  await requirePlayable(url)
  urlCache.set(key, { url, expires: Date.now() + URL_TTL })
  return url
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const SC_ID = /^\d{1,14}$/

async function handleAudio(req, res, videoId, source) {
  const resolve = source === 'sc' ? scDirectUrl : directUrl
  if (source === 'sc' ? !SC_ID.test(videoId) : !VIDEO_ID.test(videoId)) {
    res.writeHead(400).end('bad id')
    return
  }
  let url
  try {
    url = await resolve(videoId)
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' }).end(String(e.message || e))
    return
  }
  // Forward the range request so seeking works without downloading everything.
  // A cached URL can expire or get rejected, so drop it and resolve once more.
  const range = req.headers.range
  let upstream = await fetch(url, { headers: range ? { range } : {} }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) {
    urlCache.delete(source === 'sc' ? `sc:${videoId}` : `yt:${videoId}`)
    try {
      url = await resolve(videoId)
      upstream = await fetch(url, { headers: range ? { range } : {} }).catch(() => null)
    } catch {
      upstream = null
    }
  }
  if (!upstream || !upstream.ok || !upstream.body) {
    res.writeHead(502).end('upstream fetch failed')
    return
  }
  const headers = {
    'content-type': upstream.headers.get('content-type') || 'audio/mp4',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }
  const len = upstream.headers.get('content-length')
  if (len) headers['content-length'] = len
  const cr = upstream.headers.get('content-range')
  if (cr) headers['content-range'] = cr
  res.writeHead(upstream.status, headers)
  Readable.fromWeb(upstream.body).pipe(res)
}

async function handleResolve(res, id, source) {
  const resolve = source === 'sc' ? scDirectUrl : directUrl
  if (source === 'sc' ? !SC_ID.test(id) : !VIDEO_ID.test(id)) {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad id"}')
    return
  }
  try {
    await resolve(id)
    console.log(`[monochrome]   ↳ ok ${source === 'sc' ? 'sc:' : ''}${id}`)
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  } catch (e) {
    console.log(`[monochrome]   ↳ fail ${source === 'sc' ? 'sc:' : ''}${id}: ${String(e.message || e).slice(0, 80)}`)
    res
      .writeHead(502, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: String(e.message || e) }))
  }
}

/** Search through a yt-dlp provider, returning a normalised item list. */
async function ytdlpSearch(prefix, query, n) {
  const out = await ytdlp(['--no-warnings', '--flat-playlist', '-j', `${prefix}${n}:${query}`])
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .map((d) => ({
      id: d.id,
      title: d.title || '',
      duration: Number(d.duration) || 0,
      channel: d.channel || d.uploader || '',
      channelId: d.channel_id || '',
      thumbnail:
        d.thumbnail ||
        (d.thumbnails?.length ? d.thumbnails[d.thumbnails.length - 1].url : ''),
    }))
    .filter((i) => i.id)
}

async function handleSearch(res, query, limit, provider) {
  const n = Math.min(Math.max(Number(limit) || 10, 1), 25)
  if (!query.trim()) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"items":[]}')
    return
  }
  try {
    // SoundCloud is searched with resolution folded in: the frontend needs a
    // playable URL anyway, and doing both in one process is far cheaper than
    // searching and then probing each candidate.
    const items =
      provider === 'sc'
        ? await scSearchDirect('scsearch', query, n)
        : await ytdlpSearch('ytsearch', query, n)
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items }))
  } catch (e) {
    // A blocked or rate-limited SoundCloud must not fail the whole search:
    // Deezer, iTunes and Audius still answer. Report an empty SoundCloud list.
    if (provider === 'sc') {
      console.log(`[monochrome]   ↳ sc search unavailable: ${String(e.message || e).slice(0, 60)}`)
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"items":[]}')
      return
    }
    res
      .writeHead(502, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: String(e.message || e) }))
  }
}

/**
 * Resolve a batch of SoundCloud ids to direct URLs in a single yt-dlp run.
 * Walking candidates one at a time costs a process per candidate; asking for
 * all of them together costs one, and the URLs are cached for playback.
 */
async function handleScResolve(res, idsParam) {
  const ids = String(idsParam || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => SC_ID.test(s))
    .slice(0, 12)
  if (!ids.length) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":{}}')
    return
  }
  try {
    await scResolveMany(ids)
  } catch {
    /* report whatever is cached below */
  }
  const ok = {}
  for (const id of ids) {
    const hit = urlCache.get(`sc:${id}`)
    if (hit && hit.expires > Date.now()) ok[id] = true
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok }))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/api/health') {
    console.log(`[monochrome] ${req.method} ${url.pathname}${url.search}`)
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    return
  }
  if (url.pathname === '/api/audio') {
    await handleAudio(req, res, url.searchParams.get('id') || '', url.searchParams.get('src') || 'yt')
    return
  }
  if (url.pathname === '/api/resolve') {
    await handleResolve(res, url.searchParams.get('id') || '', url.searchParams.get('src') || 'yt')
    return
  }
  if (url.pathname === '/api/sc-resolve') {
    await handleScResolve(res, url.searchParams.get('ids') || '')
    return
  }
  if (url.pathname === '/api/search') {
    await handleSearch(
      res,
      url.searchParams.get('q') || '',
      url.searchParams.get('limit'),
      url.searchParams.get('src') || 'yt',
    )
    return
  }
  if (url.pathname === '/MONOCHROME.apk' || url.pathname === '/monochrome.apk') {
    try {
      const { size } = statSync(APK_PATH)
      res.writeHead(200, {
        'content-type': 'application/vnd.android.package-archive',
        'content-length': size,
        'content-disposition': 'attachment; filename="MONOCHROME.apk"',
      })
      createReadStream(APK_PATH).pipe(res)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('APK not built yet')
    }
    return
  }
  res.writeHead(404).end('not found')
})

server.listen(PORT, () => {
  console.log(`[monochrome] audio proxy on http://127.0.0.1:${PORT}`)
})
