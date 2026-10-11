import type { Playlist, Track } from '../types'
import { inferProfile } from './musicApi'

/**
 * Permanent share links.
 *
 * Catalogue ids are not portable: Deezer/iTunes ids belong to the upstream API,
 * SoundCloud ids to someone else's upload, and a locally created playlist only
 * exists in the creator's account. So a link carries the track itself — the
 * stable metadata needed to rebuild it — rather than a database id. The result
 * opens for anyone, signed in or not, and never expires.
 *
 * The payload is deflated and base64url-encoded so a whole playlist still fits
 * comfortably in a URL path segment.
 */

export type SharedKind = 'track' | 'playlist'

interface SharedTrack {
  /** title */
  t: string
  /** artist */
  a: string
  /** album */
  al?: string
  /** duration, seconds */
  d?: number
  /** genre */
  g?: string
  /** year */
  y?: number
  /** source */
  s: Track['source']
  /** sourceId */
  i: string
  /** preview flag */
  p?: 1
  /** artwork url */
  art?: string
  /** upstream permalink */
  pl?: string
}

export interface SharedTrackPayload {
  v: 1
  k: 'track'
  t: SharedTrack
}

export interface SharedPlaylistPayload {
  v: 1
  k: 'playlist'
  n: string
  d: string
  ts: SharedTrack[]
}

export type SharePayload = SharedTrackPayload | SharedPlaylistPayload

/** A share link never carries a signed stream URL — those expire. */
function packTrack(track: Track): SharedTrack {
  const out: SharedTrack = { t: track.title, a: track.artist, s: track.source, i: track.sourceId }
  if (track.album) out.al = track.album
  if (track.duration) out.d = track.duration
  if (track.genre) out.g = track.genre
  if (track.year) out.y = track.year
  if (track.preview) out.p = 1
  if (track.artwork) out.art = track.artwork
  if (track.permalink) out.pl = track.permalink
  return out
}

/** Rebuild a playable Track from a link, re-deriving the mood profile. */
export function unpackTrack(shared: SharedTrack): Track {
  const profile = inferProfile(shared.g ?? '', `${shared.t}${shared.a}`)
  return {
    id: `${shared.s}-${shared.i}`,
    title: shared.t,
    artist: shared.a,
    album: shared.al ?? `${shared.a} — ${shared.s}`,
    duration: shared.d ?? 0,
    genre: shared.g ?? '',
    year: shared.y ?? new Date().getFullYear(),
    mood: profile.moods,
    energy: profile.energy,
    valence: profile.valence,
    bpm: profile.bpm,
    seed: profile.seed,
    source: shared.s,
    streamUrl: null,
    artwork: shared.art ?? null,
    preview: !!shared.p,
    sourceId: shared.i,
    permalink: shared.pl ?? null,
  }
}

/* ------------------------------------------------------------------ *
 * Encoding
 * ------------------------------------------------------------------ */

const URL_SAFE = /[+/=]/g

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(URL_SAFE, (c) => (c === '+' ? '-' : c === '/' ? '_' : ''))
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** deflate-raw keeps the URL short; the plain fallback keeps old browsers working. */
async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const CS = (globalThis as any).CompressionStream
  if (!CS) return bytes
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return bytes
  }
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as any).DecompressionStream
  if (!DS) return bytes
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DS('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return bytes
  }
}

/** A payload is prefixed with `~` so a route can tell it apart from a local id. */
export async function encodeShare(payload: SharePayload): Promise<string> {
  const json = encoder.encode(JSON.stringify(payload))
  const packed = await compress(json)
  return `~${toBase64Url(packed)}`
}

export async function decodeShare(raw: string): Promise<SharePayload | null> {
  if (!raw || !raw.startsWith('~')) return null
  const body = raw.slice(1)
  try {
    const bytes = await decompress(fromBase64Url(body))
    const parsed = JSON.parse(decoder.decode(bytes))
    if (!parsed || parsed.v !== 1) return null
    if (parsed.k === 'track' && parsed.t?.t && parsed.t?.a) return parsed as SharedTrackPayload
    if (parsed.k === 'playlist' && Array.isArray(parsed.ts)) return parsed as SharedPlaylistPayload
    return null
  } catch {
    return null
  }
}

/** True when a route param carries an encoded payload rather than a local id. */
export function isSharePayload(id: string | undefined): boolean {
  return !!id && id.startsWith('~')
}

/* ------------------------------------------------------------------ *
 * Link helpers
 * ------------------------------------------------------------------ */

export async function trackShareLink(track: Track): Promise<string> {
  const payload = await encodeShare({ v: 1, k: 'track', t: packTrack(track) })
  return `${window.location.origin}/s/${payload}`
}

export async function playlistShareLink(playlist: Playlist): Promise<string> {
  const payload = await encodeShare({
    v: 1,
    k: 'playlist',
    n: playlist.name,
    d: playlist.description,
    ts: playlist.tracks.map(packTrack),
  })
  return `${window.location.origin}/s/${payload}`
}

/** Copy text to the clipboard, with a fallback for non-secure contexts. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}
