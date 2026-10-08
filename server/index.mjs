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

const PORT = Number(process.env.MONO_SERVER_PORT || 8787)

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
      if (code === 0) resolve(out.trim())
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

/** Resolve (and cache) the direct audio URL for a video id. */
async function directUrl(videoId) {
  const hit = urlCache.get(videoId)
  if (hit && hit.expires > Date.now()) return hit.url
  const out = await ytdlp([
    '--no-warnings',
    '--no-playlist',
    '-f',
    'bestaudio[ext=m4a]/bestaudio/best',
    '--get-url',
    `https://www.youtube.com/watch?v=${videoId}`,
  ])
  const url = out.split('\n').map((l) => l.trim()).find(Boolean)
  if (!url) throw new Error('yt-dlp returned no URL')
  urlCache.set(videoId, { url, expires: Date.now() + URL_TTL })
  return url
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

async function handleAudio(req, res, videoId) {
  if (!VIDEO_ID.test(videoId)) {
    res.writeHead(400).end('bad video id')
    return
  }
  let url
  try {
    url = await directUrl(videoId)
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' }).end(String(e.message || e))
    return
  }
  // Forward the range request so seeking works without downloading everything.
  // A cached URL can expire or get rejected, so drop it and resolve once more.
  const range = req.headers.range
  let upstream = await fetch(url, { headers: range ? { range } : {} }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) {
    urlCache.delete(videoId)
    try {
      url = await directUrl(videoId)
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

async function handleResolve(res, videoId) {
  if (!VIDEO_ID.test(videoId)) {
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"bad video id"}')
    return
  }
  try {
    await directUrl(videoId)
    console.log(`[monochrome]   ↳ ok ${videoId}`)
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
  } catch (e) {
    console.log(`[monochrome]   ↳ fail ${videoId}: ${String(e.message || e).slice(0, 80)}`)
    res
      .writeHead(502, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: String(e.message || e) }))
  }
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
    await handleAudio(req, res, url.searchParams.get('id') || '')
    return
  }
  if (url.pathname === '/api/resolve') {
    await handleResolve(res, url.searchParams.get('id') || '')
    return
  }
  res.writeHead(404).end('not found')
})

server.listen(PORT, () => {
  console.log(`[monochrome] audio proxy on http://127.0.0.1:${PORT}`)
})
