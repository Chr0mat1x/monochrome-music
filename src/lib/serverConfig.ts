/**
 * Where the companion audio server lives.
 *
 * The hosted site talks to its own origin (`/api`, proxied by Vite in dev).
 * The bundled APK has no origin of its own, so it needs an absolute URL — and
 * that URL is what makes full-length playback work on networks that block the
 * music CDNs directly: the server fetches and re-streams the audio, so the
 * phone only ever talks to the server.
 *
 * Resolution order: a URL the user typed (persisted), then the one baked in at
 * build time via `VITE_MONO_SERVER`. Empty means "same origin".
 */

const KEY = 'mono.server'

/**
 * A bare address on the private network: `localhost`, `*.local`, or a literal
 * private IP. Those almost always mean a plain-http server on the same LAN.
 */
function looksLocal(host: string): boolean {
  const name = host.split('/')[0].split(':')[0].toLowerCase()
  if (name === 'localhost' || name.endsWith('.local')) return true
  if (/^127\./.test(name)) return true
  if (/^10\./.test(name)) return true
  if (/^192\.168\./.test(name)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(name)) return true
  return false
}

/**
 * Accept what a person would actually type — `host`, `https://host`,
 * `https://host/`, even a full `…/api` — and reduce it to a bare origin.
 */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  let url = trimmed
  // Anything that already carries a scheme must be http(s); a stray
  // `ftp://host` would otherwise be read as `https://ftp://host` and parse
  // into nonsense instead of being rejected.
  const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return ''
  } else {
    // A bare address is https, except on a LAN where the companion server is
    // usually plain http (see AGENTS.md: run it on the computer and open the
    // app from the phone at http://192.168.x.x:port).
    url = `${looksLocal(trimmed) ? 'http' : 'https'}://${url}`
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    // Drop a trailing `/api` (and anything after it) so the caller can append
    // its own path without doubling it up.
    let path = parsed.pathname.replace(/\/+$/, '')
    if (path.toLowerCase().endsWith('/api')) path = path.slice(0, -4)
    return `${parsed.origin}${path}`
  } catch {
    return ''
  }
}

/** The configured origin, or '' for same-origin. */
export function readServerUrl(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(KEY)
    if (stored !== null) return normalizeServerUrl(stored)
  }
  return normalizeServerUrl((import.meta.env.VITE_MONO_SERVER as string | undefined) || '')
}

export function writeServerUrl(raw: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(KEY, normalizeServerUrl(raw))
}

/** Base for every API call: an absolute `…/api` or the same-origin `/api`. */
export function audioServerBase(): string {
  const origin = readServerUrl()
  return origin ? `${origin}/api` : '/api'
}

/** True when the user (or the build) pointed the app at a remote server. */
export function serverConfigured(): boolean {
  return !!readServerUrl()
}
