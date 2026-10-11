/**
 * Bridge to the Android shell's native SoundCloud support.
 *
 * SoundCloud's CDN serves full-length audio with permissive CORS, but the API
 * calls that search it and sign a media URL send no CORS headers, so the page
 * cannot make them itself. The offline APK exposes `window.MonoNative` (a
 * JavaScript interface backed by {@code SoundCloudBridge.java}) which performs
 * those calls in Java, where no CORS rule applies.
 *
 * Every call is asynchronous: it is handed a callback id, and the native side
 * returns the answer by calling `window.__monoNativeResult(id, value)`.
 */

export interface NativeSoundCloudItem {
  id: string
  title: string
  artist: string
  duration: number
  artwork: string
}

interface MonoNative {
  searchSoundCloud: (query: string, callback: string) => void
  resolveSoundCloud: (id: string, callback: string) => void
}

declare global {
  interface Window {
    MonoNative?: MonoNative
    __monoNativeResult?: (id: string, value: string | null) => void
  }
}

const pending = new Map<string, (value: string | null) => void>()
let seq = 0

function install() {
  if (typeof window === 'undefined' || window.__monoNativeResult) return
  window.__monoNativeResult = (id, value) => {
    const resolve = pending.get(id)
    if (!resolve) return
    pending.delete(id)
    resolve(value)
  }
}
install()

/** True when running inside the Android shell that provides the bridge. */
export function hasNativeBridge(): boolean {
  return typeof window !== 'undefined' && !!window.MonoNative
}

function call(method: 'searchSoundCloud' | 'resolveSoundCloud', arg: string, timeout = 20000) {
  return new Promise<string | null>((resolve) => {
    const native = window.MonoNative
    if (!native) {
      resolve(null)
      return
    }
    const id = `n${Date.now().toString(36)}${seq++}`
    const timer = window.setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, timeout)
    pending.set(id, (value) => {
      window.clearTimeout(timer)
      resolve(value)
    })
    try {
      native[method](arg, id)
    } catch {
      window.clearTimeout(timer)
      pending.delete(id)
      resolve(null)
    }
  })
}

/** Search SoundCloud through the native bridge. */
export async function nativeSearchSoundCloud(query: string): Promise<NativeSoundCloudItem[]> {
  if (!hasNativeBridge()) return []
  const raw = await call('searchSoundCloud', query)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as NativeSoundCloudItem[]) : []
  } catch {
    return []
  }
}

/** Resolve a SoundCloud track id to a direct, seekable audio URL. */
export async function nativeResolveSoundCloud(id: string): Promise<string | null> {
  if (!hasNativeBridge()) return null
  return call('resolveSoundCloud', id)
}
