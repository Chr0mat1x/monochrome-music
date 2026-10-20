import type { Track } from '../types'
import { resolveStreamUrl } from './download'

/* ------------------------------------------------------------------ *
 * Offline library: tracks kept as real audio blobs in IndexedDB, so they
 * play with no network at all. The APK is the main consumer — on a phone
 * that drops in and out of coverage, a downloaded song should still play.
 * IndexedDB (not CacheStorage) is used because blobs there survive a
 * service-worker version bump and are readable from the page without a
 * fetch round trip.
 * ------------------------------------------------------------------ */

const DB_NAME = 'monochrome-offline'
const STORE = 'tracks'

interface OfflineRecord {
  id: string
  track: Track
  blob: Blob
  bytes: number
  mime: string
  savedAt: number
}

let db: IDBDatabase | null = null

/** Ids of every saved track, kept in memory so `isOffline` is synchronous. */
const ids = new Set<string>()

/** Object URLs handed out for playback, so one track does not leak many. */
const urls = new Map<string, string>()

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((cb) => cb())
}

/** Re-render hook for the library and the track menu. */
export function subscribeOffline(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function conn(): Promise<IDBDatabase> {
  if (!db) db = await open()
  return db
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const ready: Promise<void> = (async () => {
  const d = await conn()
  const keys = (await request(d.transaction(STORE).objectStore(STORE).getAllKeys())) as IDBValidKey[]
  keys.forEach((k) => ids.add(String(k)))
})().catch(() => {})

/** Resolves once the in-memory index matches the database. */
export function offlineReady(): Promise<void> {
  return ready
}

export function isOffline(id: string): boolean {
  return ids.has(id)
}

/** Every saved track, newest first. */
export async function listOffline(): Promise<Track[]> {
  await ready
  const d = await conn()
  const rows = (await request(d.transaction(STORE).objectStore(STORE).getAll())) as OfflineRecord[]
  return rows.sort((a, b) => b.savedAt - a.savedAt).map((r) => r.track)
}

export async function offlineStats(): Promise<{ count: number; bytes: number }> {
  await ready
  const d = await conn()
  const rows = (await request(d.transaction(STORE).objectStore(STORE).getAll())) as OfflineRecord[]
  return { count: rows.length, bytes: rows.reduce((n, r) => n + (r.bytes || 0), 0) }
}

/**
 * Download a track's audio into the offline library. `onProgress` gets 0..1
 * when the source reports a length. Throws when the source cannot be fetched.
 */
export async function saveOffline(track: Track, onProgress?: (p: number) => void): Promise<void> {
  const url = await resolveStreamUrl(track)
  if (!url) throw new Error('Не удалось получить ссылку на аудио')
  const res = await fetch(url)
  if (!res.ok) throw new Error(String(res.status))
  // Stream it so a long mix shows progress instead of a frozen bar.
  const total = Number(res.headers.get('content-length')) || 0
  let blob: Blob
  if (res.body && total) {
    const reader = res.body.getReader()
    const chunks: BlobPart[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
      onProgress?.(Math.min(1, got / total))
    }
    blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' })
  } else {
    blob = await res.blob()
    onProgress?.(1)
  }
  // A signed `streamUrl` expires, so the stored snapshot drops it; playback
  // always goes through the blob.
  const snapshot: Track = { ...track, streamUrl: null }
  const d = await conn()
  const record: OfflineRecord = {
    id: track.id,
    track: snapshot,
    blob,
    bytes: blob.size,
    mime: blob.type,
    savedAt: Date.now(),
  }
  await request(d.transaction(STORE, 'readwrite').objectStore(STORE).put(record))
  ids.add(track.id)
  emit()
}

export async function removeOffline(id: string): Promise<void> {
  const d = await conn()
  await request(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
  ids.delete(id)
  const u = urls.get(id)
  if (u) {
    URL.revokeObjectURL(u)
    urls.delete(id)
  }
  emit()
}

/** A playable blob URL for an offline track, or null if it is not saved. */
export async function offlineUrl(id: string): Promise<string | null> {
  const cached = urls.get(id)
  if (cached) return cached
  await ready
  if (!ids.has(id)) return null
  const d = await conn()
  const row = (await request(d.transaction(STORE).objectStore(STORE).get(id))) as OfflineRecord | undefined
  if (!row) return null
  const url = URL.createObjectURL(row.blob)
  urls.set(id, url)
  return url
}
