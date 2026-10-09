import type { Track } from '../types'
import { resolveAudiusStream, resolveDeezerStream, resolveFullAudio } from './musicApi'

/** Resolve the freshest playable URL for a track (same rules as the engine). */
export async function resolveStreamUrl(track: Track): Promise<string | null> {
  if (track.source === 'audius') return resolveAudiusStream(track.sourceId)
  if (track.source === 'deezer') return resolveDeezerStream(track.sourceId)
  if (track.source === 'soundcloud') return resolveFullAudio(track.sourceId, 'sc')
  return track.streamUrl
}

function fileName(track: Track): string {
  const safe = `${track.artist} - ${track.title}`
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safe || 'track'}.mp3`
}

/**
 * Save the audio file the browser is actually allowed to stream. The CDNs send
 * permissive CORS headers, so we can pull the bytes and hand them to the user
 * as a real file. If that is blocked we fall back to opening the raw URL.
 */
export async function downloadTrack(track: Track): Promise<void> {
  // YouTube audio cannot be extracted without breaking the platform's terms,
  // so the honest action is to open the video on YouTube instead.
  if (track.source === 'youtube') {
    if (track.permalink) window.open(track.permalink, '_blank', 'noopener')
    return
  }
  const url = await resolveStreamUrl(track)
  if (!url) throw new Error('Не удалось получить ссылку на аудио')

  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = fileName(track)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  } catch {
    // CORS or network blocked the fetch — open the source instead of failing.
    window.open(url, '_blank', 'noopener')
  }
}
