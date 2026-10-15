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
import { createReadStream, createWriteStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getLibrary, login, logout, publicUser, register, setLibrary, userForToken } from './auth.mjs'

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

/**
 * Catalogue hosts this server is allowed to proxy. The browser in some regions
 * (Russia, for one) cannot reach Deezer, iTunes or Audius at all, while this
 * machine can — so metadata and audio for those sources are fetched here and
 * streamed back. Only these exact hosts are accepted, never an arbitrary URL,
 * so the endpoint cannot be used as an open proxy.
 */
const CATALOG_HOSTS = new Set([
  'api.deezer.com',
  'itunes.apple.com',
  'audio-ssl.itunes.apple.com',
  'api.audius.co',
  'discoveryprovider.audius.co',
])
/** Deezer serves previews and cover art from rotating CDN subdomains
 * (`cdnt-preview.dzcdn.net`, `e-cdns-images.dzcdn.net`, …). All are Deezer's,
 * and all are blocked in the same regions as the API, so the whole zone is
 * allowed rather than an ever-changing host list. */
const DEEZER_MEDIA_SUFFIX = '.dzcdn.net'
/** Audius content nodes serve the actual audio; their hostnames vary, so match
 * the suffixes the network uses rather than an exhaustive list. */
const AUDIUS_MEDIA_SUFFIXES = ['.audius.co', '.staked.cloud', '.figment.io', '.theblueprint.xyz', '.monophonic.digital', '.rickyrombo.com', '.open-audio-validator.com']

function isAllowedProxyUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false
  if (CATALOG_HOSTS.has(u.hostname)) return true
  if (u.hostname.endsWith(DEEZER_MEDIA_SUFFIX)) return true
  return AUDIUS_MEDIA_SUFFIXES.some((s) => u.hostname.endsWith(s))
}

// A progressive HTTP MP3 is the only thing a browser <audio> element can stream
// here: SoundCloud's other formats are HLS manifests it cannot play. The
// `format_id!*=preview` guard matters more than it looks — SoundCloud hands out
// `http_mp3_1_0_preview` entries that are exactly 30 seconds long, and without
// the guard yt-dlp happily selects one as the "best" MP3, so a full song would
// play as a 30-second clip and look like a broken preview.
const SC_FORMAT =
  'http_mp3[format_id!*=preview]/bestaudio[protocol^=http][format_id!*=preview]'

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

/**
 * Flat SoundCloud searches get their own queue. They are a single fast request
 * each and are what every keystroke waits on, while the extraction queue above
 * holds multi-second yt-dlp runs. Sharing one queue meant a background warm
 * could park a search behind several extractions, which is exactly the "search
 * takes forever" symptom. Flat searches do not trip SoundCloud's burst limit,
 * so running them separately is safe.
 */
let scSearchChain = Promise.resolve()
function scSearchSerial(task) {
  const run = scSearchChain.then(task, task)
  scSearchChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

// SoundCloud also refuses a burst outright (HTTP 403). Back off for a while
// instead of retrying every candidate and keeping the block alive.
let scBlockedUntil = 0

// Uploads that came back DRM-protected or region-locked. SoundCloud refuses
// these permanently, so remembering them stops every later search from paying a
// fresh yt-dlp run to rediscover the same refusal. This is what made search feel
// frozen: a handful of dead candidates, re-probed on every keystroke, each
// costing a full process before the queue drained.
const scDenied = new Set()

// One extraction per id at a time. The background warm, the readiness poll and
// the player all ask for the same track within a second of each other; without
// this they would queue three identical yt-dlp runs behind each other.
const scInflight = new Map()

/* ------------------------------------------------------------------ *
 * Direct SoundCloud API resolver.
 *
 * yt-dlp is the long-standing way to turn a SoundCloud id into audio, but it
 * is fragile and, on a datacenter IP, returns HTTP 403 in bursts. That 403 was
 * being read as a rate limit and put the *whole* catalogue on a 60-second
 * timeout, so every track after the first few played nothing at all — the exact
 * "ничего не играет" report.
 *
 * SoundCloud's own API is what the Android bridge already uses and it is far
 * more reliable: scrape a client_id from the public bundle once, then ask
 * api-v2 for the track and its progressive MP3. A major-label upload (policy
 * MONETIZE) has no anonymous progressive stream and answers 404, which is a
 * clean, per-track "unavailable" instead of a global outage — so playable
 * tracks no longer get poisoned by their unplayable neighbours.
 * ------------------------------------------------------------------ */
const SC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let scClientId = null
let scClientIdAt = 0

async function scHttp(url, ms = 8000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { headers: { 'user-agent': SC_UA, accept: 'application/json' } , signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Scrape and cache a public client_id from SoundCloud's web bundle. */
async function scGetClientId(refresh = false) {
  if (!refresh && scClientId && Date.now() - scClientIdAt < 30 * 60 * 1000) return scClientId
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const home = await (await fetch('https://soundcloud.com/', {
      headers: { 'user-agent': SC_UA },
      signal: ctrl.signal,
    })).text()
    const scripts = [...home.matchAll(/src="(https:\/\/[^"]*sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
    for (const src of scripts.reverse()) {
      const js = await (await fetch(src, { headers: { 'user-agent': SC_UA }, signal: ctrl.signal })).text()
      const m = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/.exec(js)
      if (m) {
        scClientId = m[1]
        scClientIdAt = Date.now()
        return scClientId
      }
    }
  } catch {
    /* fall through — caller falls back to yt-dlp */
  } finally {
    clearTimeout(timer)
  }
  return null
}

/** Resolve one id through api-v2; null means "cannot stream anonymously". */
async function extractScViaApi(id, refresh = false) {
  const cid = await scGetClientId(refresh)
  if (!cid) throw new Error('no client id')
  const track = await scHttp(`https://api-v2.soundcloud.com/tracks/${id}?client_id=${cid}`)
  const transcodings = (track.media && track.media.transcodings) || []
  const endpoint = transcodings.find((t) => t.format && t.format.protocol === 'progressive')
  if (endpoint) {
    const resolved = await scHttp(`${endpoint.url}?client_id=${cid}`)
    const url = resolved && resolved.url
    if (url) return { type: 'progressive', url }
  }
  // Most uploads now carry only HLS transcodings — the progressive MP3 that a
  // plain <audio> element needs is simply gone. The HLS rendition is fMP4
  // (an init segment plus numbered .m4s fragments), which this server stitches
  // back into one MP4 and serves with byte ranges, so playback and seeking keep
  // working without the browser having to speak HLS.
  //
  // Only `protocol === 'hls'` qualifies: the `*-encrypted-hls` renditions are
  // DRM and cannot be stitched. Within the plain ones the fixed-bitrate
  // `aac_160k` is preferred — the adaptive `abr_sq` manifest sometimes resolves
  // to nothing.
  const plainHls = transcodings.filter((t) => t.format && t.format.protocol === 'hls')
  const hls = plainHls.find((t) => t.preset === 'aac_160k') || plainHls[0]
  if (hls) {
    const resolved = await scHttp(`${hls.url}?client_id=${cid}`)
    if (resolved && resolved.url) return { type: 'hls', url: resolved.url }
  }
  return null
}

// The API path can itself fail (rotated client_id, transient network). Do not
// deny the whole catalogue on that — remember when to fall back and let the
// per-track yt-dlp path try instead.
let scApiBrokenUntil = 0

/**
 * Ask for the direct URL of a single SoundCloud upload.
 * Returns null when the upload cannot be streamed (DRM, region lock).
 */
function scUrlFor(id) {
  if (scDenied.has(id)) return Promise.resolve(null)
  const cached = urlCache.get(`sc:${id}`)
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.desc)
  const flying = scInflight.get(id)
  if (flying) return flying
  const task = resolveScUrl(id).finally(() => scInflight.delete(id))
  scInflight.set(id, task)
  return task
}

async function resolveScUrl(id) {
  if (Date.now() >= scApiBrokenUntil) {
    try {
      const desc = await extractScViaApi(id)
      if (desc) {
        urlCache.set(`sc:${id}`, { desc, expires: Date.now() + URL_TTL })
        return desc
      }
      // No progressive *and* no HLS: genuinely unplayable anonymously.
      scDenied.add(id)
      return null
    } catch {
      // The API layer, not the track, is at fault. Back off briefly and let the
      // extractor have a turn rather than failing the listener's track.
      scApiBrokenUntil = Date.now() + 60 * 1000
    }
  }
  return extractScUrl(id)
}

async function extractScUrl(id) {
  let out = ''
  try {
    out = await scSerial(() =>
      ytdlp([
        '--no-warnings',
        '--ignore-errors',
        '-f',
        SC_FORMAT,
        '--print',
        '%(url)s\t%(format_id)s',
        `https://api.soundcloud.com/tracks/${id}`,
      ]),
    )
  } catch (e) {
    const message = String(e.message || e)
    // yt-dlp is only the fallback now, and its failures say nothing durable
    // about the upload: a 403 is a burst limit, a timeout is the network. Never
    // mark the id denied here — that is what previously poisoned good tracks
    // for the rest of the process. Throttle and move on.
    if (/403|forbidden|rate limit|temporarily unavailable/i.test(message)) {
      scBlockedUntil = Date.now() + 60 * 1000
    }
    return null
  }
  const [url, formatId] = out.split('\n').map((l) => l.trim()).find(Boolean)?.split('\t') ?? []
  if (!url || /preview/i.test(formatId || '')) return null
  const desc = /\.m3u8(\?|$)/i.test(url) ? { type: 'hls', url } : { type: 'progressive', url }
  urlCache.set(`sc:${id}`, { desc, expires: Date.now() + URL_TTL })
  return desc
}

/* ------------------------------------------------------------------ *
 * HLS → MP4 stitcher.
 *
 * SoundCloud now serves almost everything as HLS only: a media playlist whose
 * segments are fMP4 (one `init.mp4` plus numbered `dataNNN.m4s` fragments, each
 * self-contained). A plain <audio> element cannot read an m3u8, so the segments
 * are concatenated here into one ordinary MP4. That keeps the client unchanged
 * — no HLS.js, no MSE — and, because the result is a real file on disk, byte
 * ranges work, so seeking is instant instead of forcing a re-download.
 * ------------------------------------------------------------------ */

/** Cache directory for stitched tracks. Cleared on start and on exit. */
const HLS_DIR = join(tmpdir(), 'monochrome-hls')
/** Stitched tracks are large (a two-hour mix is ~50 MB), so keep the cache bounded. */
const HLS_MAX_FILES = 40

function hlsPath(id) {
  return join(HLS_DIR, `${id}.mp4`)
}

function hlsReady(id) {
  try {
    return statSync(hlsPath(id)).size > 0
  } catch {
    return false
  }
}

/** Drop the oldest stitched files once the cache outgrows its cap. */
function pruneHls() {
  try {
    const files = readdirSync(HLS_DIR)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => ({ f, at: statSync(join(HLS_DIR, f)).mtimeMs }))
      .sort((a, b) => a.at - b.at)
    for (const { f } of files.slice(0, Math.max(0, files.length - HLS_MAX_FILES))) {
      try {
        unlinkSync(join(HLS_DIR, f))
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* directory not created yet */
  }
}

/**
 * Parse a media playlist into its init segment and media segment URLs.
 * `encrypted` marks a rendition whose segments are AES-encrypted: the stitcher
 * cannot decrypt them without the key exchange, so they are treated as
 * unplayable rather than served as an MP4 that decodes to noise.
 */
function parseMediaPlaylist(text) {
  const lines = text.split('\n').map((l) => l.trim())
  const mapLine = lines.find((l) => l.startsWith('#EXT-X-MAP'))
  const init = mapLine ? /URI="([^"]+)"/.exec(mapLine)?.[1] : null
  const segments = lines.filter((l) => l && !l.startsWith('#'))
  const encrypted = lines.some((l) => l.startsWith('#EXT-X-KEY') && !/METHOD=NONE/.test(l))
  return { init, segments, encrypted }
}

const hlsBuilds = new Map()

/**
 * Download a playlist's fragments and write them out as one MP4. Concurrent
 * callers for the same id share a single build. Returns the finished path.
 */
function buildHls(id, playlistUrl) {
  const flying = hlsBuilds.get(id)
  if (flying) return flying
  const task = (async () => {
    mkdirSync(HLS_DIR, { recursive: true })
    const pl = await (await fetch(playlistUrl, { headers: { 'user-agent': SC_UA } })).text()
    const { init, segments, encrypted } = parseMediaPlaylist(pl)
    if (encrypted) throw new Error('hls stream is DRM-encrypted')
    if (!segments.length) throw new Error('empty hls playlist')
    const tmp = `${hlsPath(id)}.part`
    const out = createWriteStream(tmp)
    const write = (buf) =>
      new Promise((resolve, reject) => {
        if (out.write(buf)) resolve()
        else out.once('drain', resolve)
        out.once('error', reject)
      })
    try {
      if (init) {
        const r = await fetch(init, { headers: { 'user-agent': SC_UA } })
        if (!r.ok) throw new Error(`init segment HTTP ${r.status}`)
        await write(Buffer.from(await r.arrayBuffer()))
      }
      // Fragments are fetched a few at a time: sequential fetching of a
      // two-hour mix's 244 fragments takes far too long, while unbounded
      // parallelism gets the CDN to throttle the whole build.
      let cursor = 0
      const worker = async () => {
        while (cursor < segments.length) {
          const url = segments[cursor++]
          const r = await fetch(url, { headers: { 'user-agent': SC_UA } })
          if (!r.ok) throw new Error(`segment HTTP ${r.status}`)
          await write(Buffer.from(await r.arrayBuffer()))
        }
      }
      await Promise.all(Array.from({ length: Math.min(8, segments.length) }, worker))
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())))
      renameSync(tmp, hlsPath(id))
      pruneHls()
      return hlsPath(id)
    } catch (e) {
      out.destroy()
      try {
        unlinkSync(tmp)
      } catch {
        /* nothing to clean up */
      }
      throw e
    }
  })().finally(() => hlsBuilds.delete(id))
  hlsBuilds.set(id, task)
  return task
}

/** Make sure a SoundCloud HLS track is stitched and ready to serve. */
async function ensureHls(id, url) {
  if (hlsReady(id)) return
  await buildHls(id, url)
}

/**
 * Cheap readiness check for the HLS path. Building the whole file just to
 * answer "can this play?" would make every search result cost a download, so
 * only the first fragment is fetched — it proves the signed URL is still valid
 * and that the CDN will serve us.
 */
async function hlsPlayable(playlistUrl) {
  const pl = await (await fetch(playlistUrl, { headers: { 'user-agent': SC_UA } })).text()
  const { segments, encrypted } = parseMediaPlaylist(pl)
  if (encrypted || !segments.length) return false
  const r = await fetch(segments[0], { headers: { 'user-agent': SC_UA, range: 'bytes=0-1023' } }).catch(() => null)
  if (r && r.body) r.body.cancel().catch(() => {})
  return Boolean(r && r.ok)
}

/**
 * Search SoundCloud through api-v2. Unlike the yt-dlp flat search this also
 * exposes each track's `policy`, so licensed (MONETIZE) uploads — which have no
 * anonymous stream and would only ever fail on click — can be dropped before
 * they ever reach the UI. Artwork and the uploader name come along for free,
 * which yt-dlp's flat listing does not provide.
 */
async function scApiSearch(query, n) {
  const cid = await scGetClientId()
  if (!cid) throw new Error('no client id')
  // Ask for far more than we return. Licensed uploads dominate the head of
  // most result sets — "lofi" answers MONETIZE for its first three — so
  // filtering a short page leaves nothing at all. Over-fetch, then keep the
  // playable subset and cut it back to what the caller wanted.
  const fetchN = Math.min(Math.max(n * 8, 30), 60)
  const page = async (q) => {
    const data = await scHttp(
      `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&client_id=${cid}&limit=${fetchN}`,
    )
    return (data && data.collection) || []
  }
  let kept = playableFrom(await page(query))
  // A broad one-word query can be licensed end to end: SoundCloud's own first
  // fifty hits for "lofi" are all MONETIZE, so a strict filter would show an
  // empty page for a word that clearly has music behind it. Broaden once or
  // twice — the same search the listener would have typed next — before
  // giving up, so the page is never blank when a playable answer exists.
  if (!kept.length) {
    for (const widened of [`${query} mix`, `${query} beats`]) {
      kept = playableFrom(await page(widened))
      if (kept.length) break
    }
  }
  // Even an ALLOW upload is not guaranteed to play: many carry only HLS
  // transcodings, which a plain <audio> element cannot decode. The search
  // response does not say which is which, so probe the leading candidates and
  // keep only the ones with a progressive stream. The probe doubles as a warm
  // cache, so the track a listener clicks is already resolved.
  if (kept.length && Date.now() >= scApiBrokenUntil) {
    const candidates = kept.slice(0, 15)
    const playable = await probeProgressive(candidates.map((i) => i.id))
    // If the probe found nothing the API layer is probably having a bad day,
    // not the whole catalogue; trust the policy filter rather than go blank.
    if (playable.size) kept = kept.filter((i) => playable.has(i.id))
  }
  return kept.slice(0, n)
}

/** Resolve up to `limit` ids at a time, returning the set that has audio. */
async function probeProgressive(ids, limit = 6) {
  const ok = new Set()
  let cursor = 0
  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor++]
      const desc = await scUrlFor(id).catch(() => null)
      if (desc && (await probeDescriptor(desc).catch(() => false))) ok.add(id)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker))
  return ok
}

/** Confirm a resolved SoundCloud descriptor is actually streamable right now. */
async function probeDescriptor(desc) {
  if (desc.type === 'hls') return hlsPlayable(desc.url)
  await requirePlayable(desc.url)
  return true
}

/**
 * Filter a raw api-v2 page down to what an anonymous listener may stream.
 *
 * This used to drop `policy === 'MONETIZE'` on the belief that licensed uploads
 * have no anonymous stream. They now do: api-v2 hands out a signed HLS manifest
 * for them too, and the stitcher plays it. Keeping that filter is what emptied
 * the catalogue — SoundCloud's head results for most queries are MONETIZE, so
 * a search for "lofi" returned a single track. What genuinely cannot be played
 * is a DRM-protected rendition (`cbc/ctr-encrypted-hls`), which is excluded
 * here by protocol, and anything the player probe later rejects.
 */
function playableFrom(collection) {
  return collection
    .filter((t) => t && t.streamable !== false && !hasOnlyEncryptedHls(t))
    .map((t) => ({
      id: String(t.id),
      title: t.title || '',
      duration: (Number(t.duration) || 0) / 1000,
      channel: (t.user && t.user.username) || '',
      thumbnail: t.artwork_url || (t.user && t.user.avatar_url) || '',
      // 'SNIP' uploads are the 30-second clips the rights holders allow
      // anonymously; the UI labels them as previews instead of pretending they
      // are full songs. 'ALLOW' uploads are genuine full-length streams.
      policy: t.policy || '',
      streamUrl: '',
    }))
    .filter((i) => SC_ID.test(i.id))
    // Full-length uploads first, so the top of a search is playable in full and
    // the 30-second clips fall to the bottom rather than leading the list.
    .sort((a, b) => (a.policy === 'SNIP' ? 1 : 0) - (b.policy === 'SNIP' ? 1 : 0))
}

/** True when the only streams on offer are DRM-encrypted. */
function hasOnlyEncryptedHls(t) {
  const transcodings = (t.media && t.media.transcodings) || []
  if (!transcodings.length) return false
  return transcodings.every(
    (x) => x.format && /encrypted-hls/.test(x.format.protocol || ''),
  )
}

async function scSearchDirect(prefix, query, n, need = 4) {
  let listed = []
  try {
    listed = await scApiSearch(query, n)
  } catch (e) {
    // api-v2 unavailable (client_id scrape failed) — fall back to the extractor.
    console.log(`[monochrome]   ↳ sc api search failed: ${String((e && e.message) || e).slice(0, 80)}`)
    listed = await scFlatSearch(prefix, query, n)
  }
  if (listed.length && Date.now() >= scBlockedUntil) {
    // Resolve in the background and return the listing now. The frontend polls
    // /api/resolve per id, so the page renders in about a second instead of
    // waiting on extraction, and by the time a track is clicked its URL is
    // usually already cached.
    // Warm only the leading candidates. SoundCloud rate-limits a burst of
    // extractions, and pre-resolving the whole page both trips that limit and
    // delays the searches the user is waiting on; one or two keeps the likely
    // first click instant without provoking a block.
    const targets = listed.slice(0, Math.min(Math.max(need, 1), 2))
    void Promise.all(targets.map((i) => scUrlFor(i.id))).catch(() => {})
  }
  return listed
}

// YouTube refuses anonymous extraction from datacenter IPs ("Sign in to confirm
// you're not a bot", "This video is not available"). Once failures pile up, skip
// YouTube extraction for a while instead of paying a failed run per candidate.
let ytBlockedUntil = 0
let ytFailStreak = 0

/**
 * Flat SoundCloud search (no direct URL): the metadata-only listing.
 * `--flat-playlist` is the fast path — one request, no per-track extraction —
 * which is what keeps a search snappy even when several results are DRM-locked.
 */
async function scFlatSearch(prefix, query, n) {
  const out = await scSearchSerial(() =>
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

/** Resolve several SoundCloud ids, reusing the cache and skipping known-dead ones. */
async function scResolveMany(ids) {
  const want = ids.filter((id) => {
    const hit = urlCache.get(`sc:${id}`)
    return SC_ID.test(id) && !scDenied.has(id) && !(hit && hit.expires > Date.now())
  })
  if (!want.length || Date.now() < scBlockedUntil) return
  await Promise.all(want.map((id) => scUrlFor(id)))
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

/** Does this failure look like a datacenter refusal rather than a bad id? */
function isBlockedError(message) {
  return /stream unavailable|not a bot|Sign in to confirm|not available|unavailable|HTTP Error 4/i.test(
    String(message || ''),
  )
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
  try {
    const out = await ytdlp([
      '--no-warnings',
      '--no-playlist',
      '-f',
      'bestaudio[ext=m4a]/bestaudio/best',
      '--get-url',
      `https://www.youtube.com/watch?v=${videoId}`,
    ])
    const url = firstUrl(out)
    await requirePlayable(url)
    ytFailStreak = 0
    urlCache.set(key, { url, expires: Date.now() + URL_TTL })
    return url
  } catch (e) {
    // A 403 on the stream probe is the same datacenter refusal as the bot check,
    // so count both and skip YouTube once they pile up.
    if (isBlockedError(e.message) && ++ytFailStreak >= 3) {
      ytBlockedUntil = Date.now() + 3 * 60 * 1000
      ytFailStreak = 0
    }
    throw e
  }
}

/**
 * Resolve (and cache) the direct audio URL for a SoundCloud track id. YouTube
 * refuses anonymous streams from datacenter IPs, so SoundCloud — which serves
 * full-length audio anywhere — is what actually keeps playback working here.
 */
async function scDirectUrl(trackId) {
  const key = `sc:${trackId}`
  const hit = urlCache.get(key)
  if (hit && hit.expires > Date.now()) return hit.desc
  if (Date.now() < scBlockedUntil) throw new Error('soundcloud temporarily unavailable (rate limit)')
  const desc = await scUrlFor(trackId)
  if (!desc) throw new Error('soundcloud track is not streamable')
  // Only a freshly extracted URL needs the playability probe. A cached URL was
  // probed when it was first obtained, and re-probing it here would add a round
  // trip to every single play before the audio even starts.
  if (!(await probeDescriptor(desc).catch(() => false))) {
    throw new Error('soundcloud stream unavailable')
  }
  return desc
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const SC_ID = /^\d{1,14}$/

/**
 * Stream a stitched HLS track from disk with byte-range support, so the client
 * can seek without the server re-downloading anything.
 */
function serveLocalAudio(req, res, filePath) {
  const size = statSync(filePath).size
  const range = req.headers.range
  const base = { 'content-type': 'audio/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' }
  if (!range) {
    res.writeHead(200, { ...base, 'content-length': size })
    createReadStream(filePath).pipe(res)
    return
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range)
  const start = m && m[1] ? Number(m[1]) : 0
  const end = m && m[2] ? Number(m[2]) : size - 1
  if (start >= size || end >= size || start > end) {
    res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
    return
  }
  res.writeHead(206, {
    ...base,
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': end - start + 1,
  })
  createReadStream(filePath, { start, end }).pipe(res)
}

async function handleAudio(req, res, videoId, source) {
  if (source === 'sc' ? !SC_ID.test(videoId) : !VIDEO_ID.test(videoId)) {
    res.writeHead(400).end('bad id')
    return
  }
  // SoundCloud now hands out HLS, which no <audio> element can read. The
  // fragments are stitched into a local MP4 once, then served from disk.
  if (source === 'sc') {
    if (hlsReady(videoId)) {
      serveLocalAudio(req, res, hlsPath(videoId))
      return
    }
    let desc
    try {
      desc = await scDirectUrl(videoId)
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(String(e.message || e))
      return
    }
    if (desc.type === 'progressive') {
      streamUpstream(req, res, desc.url)
      return
    }
    try {
      await ensureHls(videoId, desc.url)
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`hls build failed: ${String(e.message || e)}`)
      return
    }
    serveLocalAudio(req, res, hlsPath(videoId))
    return
  }

  let url
  try {
    url = await directUrl(videoId)
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' }).end(String(e.message || e))
    return
  }
  streamUpstream(req, res, url, () => urlCache.delete(`yt:${videoId}`))
}

/** Proxy an upstream audio URL, forwarding the range request for seeking. */
async function streamUpstream(req, res, url, onStale) {
  // Forward the range request so seeking works without downloading everything.
  // A cached URL can expire or get rejected, so drop it and resolve once more.
  const range = req.headers.range
  let upstream = await fetch(url, { headers: range ? { range } : {} }).catch(() => null)
  if ((!upstream || !upstream.ok || !upstream.body) && onStale) {
    onStale()
    upstream = null
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
  // A SoundCloud upload that is DRM-protected or region-locked can never play,
  // so say so outright. The client then stops polling instead of retrying a
  // resolution that is guaranteed to fail.
  if (source === 'sc' && scDenied.has(id)) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":false,"denied":true}')
    return
  }
  // SoundCloud is rate-limiting us right now. Say so distinctly: otherwise the
  // client reads a plain failure as "still extracting" and re-asks several
  // times, and every one of those asks re-enters the extractor queue.
  if (source === 'sc' && Date.now() < scBlockedUntil) {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":false,"blocked":true}')
    return
  }
  try {
    await resolve(id)
    console.log(`[monochrome]   ↳ ok ${source === 'sc' ? 'sc:' : ''}${id}`)
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  } catch (e) {
    const message = String(e.message || e)
    console.log(`[monochrome]   ↳ fail ${source === 'sc' ? 'sc:' : ''}${id}: ${message.slice(0, 80)}`)
    // YouTube refuses this machine's IP entirely. Report that as a server-wide
    // condition so the client stops asking and uses the IFrame player instead.
    if (source === 'yt' && isBlockedError(message)) {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":false,"blocked":true}')
      return
    }
    res
      .writeHead(502, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: message }))
  }
}

/**
 * Proxy an allow-listed catalogue/media URL. Some regions (Russia, for one)
 * cannot reach Deezer, iTunes or Audius directly, but this machine can, so the
 * browser asks here instead. Byte ranges are forwarded so audio can seek, and
 * CORS is opened up because the Android shell and any other origin may call it.
 */
async function handleProxy(req, res, target, raw) {
  if (!target || !isAllowedProxyUrl(target)) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('url not allowed')
    return
  }
  const headers = { 'accept-encoding': 'identity' }
  if (raw) headers.range = raw
  const upstream = await fetch(target, { headers, redirect: 'follow' }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) {
    res.writeHead(upstream ? upstream.status : 502, { 'content-type': 'text/plain' }).end('upstream failed')
    return
  }
  const out = {
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=300',
  }
  // `accept-encoding: identity` keeps the upstream body uncompressed, so its
  // content-length still describes the bytes being forwarded. Without it Node
  // transparently gunzips while the compressed length is passed on, and the
  // client truncates the JSON.
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h)
    if (v) out[h] = v
  }
  res.writeHead(upstream.status, out)
  Readable.fromWeb(upstream.body).pipe(res)
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

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(body))
}

/** Read a small JSON request body (capped, so a huge upload can't exhaust RAM). */
function readJson(req, limit = 1_000_000) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        req.destroy()
        resolve(null)
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function bearer(req) {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  // The bundled Android app (and any other origin) calls this server directly
  // with a full URL, so every response has to be CORS-readable.
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'range,content-type')
  res.setHeader('access-control-expose-headers', 'content-length,content-range,accept-ranges')
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  if (url.pathname !== '/api/health') {
    console.log(`[monochrome] ${req.method} ${url.pathname}${url.search}`)
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    return
  }

  // ---- accounts ----
  if (url.pathname.startsWith('/api/auth/')) {
    const action = url.pathname.slice('/api/auth/'.length)
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method not allowed' })
      return
    }
    const body = (await readJson(req)) || {}

    if (action === 'register') {
      const out = register(body)
      json(res, out.error ? 400 : 200, out)
      return
    }
    if (action === 'login') {
      const out = login(body)
      json(res, out.error ? 401 : 200, out)
      return
    }
    if (action === 'logout') {
      json(res, 200, logout(bearer(req)))
      return
    }
    json(res, 404, { error: 'unknown auth action' })
    return
  }

  if (url.pathname === '/api/me') {
    const user = userForToken(bearer(req))
    if (!user) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    json(res, 200, { user: publicUser(user) })
    return
  }

  if (url.pathname === '/api/library') {
    const user = userForToken(bearer(req))
    if (!user) {
      json(res, 401, { error: 'unauthorized' })
      return
    }
    if (req.method === 'GET') {
      json(res, 200, { library: getLibrary(user.id) })
      return
    }
    if (req.method === 'PUT') {
      const body = await readJson(req, 8_000_000)
      if (!body) {
        json(res, 400, { error: 'invalid body' })
        return
      }
      json(res, 200, { library: setLibrary(user.id, body) })
      return
    }
    json(res, 405, { error: 'method not allowed' })
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
  if (url.pathname === '/api/warm') {
    const ids = (url.searchParams.get('ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => SC_ID.test(s))
      .slice(0, 12)
    // Fire and forget: the caller polls /api/resolve for readiness, so the
    // request returns at once instead of holding a connection open for the
    // whole extraction. That keeps a list upgrade from stalling the UI.
    void scResolveMany(ids).catch(() => {})
    json(res, 202, { accepted: ids.length })
    return
  }
  if (url.pathname === '/api/proxy') {
    await handleProxy(
      req,
      res,
      url.searchParams.get('url') || '',
      req.headers.range,
    )
    return
  }
  if (url.pathname === '/api/audio-url') {
    const target = url.searchParams.get('url') || ''
    const meta = await fetch(target, { redirect: 'follow' }).catch(() => null)
    if (!target || !isAllowedProxyUrl(target) || !meta || !meta.ok) {
      json(res, 400, { error: 'not allowed' })
      return
    }
    json(res, 200, { url: `/api/proxy?url=${encodeURIComponent(target)}` })
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

// Stitched HLS tracks are disposable: clear them on start so a stale file from
// a previous run cannot be served in place of a fresh one, and on exit so the
// tmp directory does not keep megabytes around.
function clearHls() {
  try {
    for (const f of readdirSync(HLS_DIR)) {
      if (f.endsWith('.mp4') || f.endsWith('.part')) {
        try {
          unlinkSync(join(HLS_DIR, f))
        } catch {
          /* already gone */
        }
      }
    }
  } catch {
    /* directory not created yet */
  }
}
clearHls()
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearHls()
    process.exit(0)
  })
}
