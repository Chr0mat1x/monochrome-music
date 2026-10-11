export interface Account {
  id: string
  email: string
  name: string
  createdAt: number
}

export interface LibrarySnapshot {
  liked: unknown[]
  playlists: unknown[]
  recentlyPlayed: unknown[]
}

const TOKEN_KEY = 'monochrome.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/**
 * The account API is served by the same yt-dlp proxy the app already talks to.
 * When it is not running, sign-in is simply unavailable rather than broken.
 */
export function hasAccountServer(): boolean {
  return typeof window !== 'undefined'
}

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body?.error || 'Сервер недоступен')
  return body
}

interface AuthResponse {
  token: string
  user: Account
}

export async function register(email: string, password: string, name: string): Promise<AuthResponse> {
  const out = await call<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  })
  setToken(out.token)
  return out
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const out = await call<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(out.token)
  return out
}

export async function logout(): Promise<void> {
  try {
    await call('/api/auth/logout', { method: 'POST' })
  } catch {
    /* token is cleared locally regardless */
  }
  setToken(null)
}

/** Restore the signed-in user from a stored token, or null when there is none. */
export async function currentUser(): Promise<Account | null> {
  if (!getToken()) return null
  try {
    const out = await call<{ user: Account }>('/api/me')
    return out.user
  } catch {
    setToken(null)
    return null
  }
}

export async function fetchLibrary(): Promise<LibrarySnapshot | null> {
  if (!getToken()) return null
  try {
    const out = await call<{ library: LibrarySnapshot }>('/api/library')
    return out.library
  } catch {
    return null
  }
}

export async function saveLibrary(library: LibrarySnapshot): Promise<void> {
  if (!getToken()) return
  try {
    await call('/api/library', { method: 'PUT', body: JSON.stringify(library) })
  } catch {
    /* offline: the local copy stays authoritative until the next save */
  }
}
