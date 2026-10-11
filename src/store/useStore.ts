import { create } from 'zustand'
import type { Playlist, RepeatMode, Track } from '../types'
import { engine } from '../lib/audioEngine'
import { cachedFullTrack, findAudiusFull, findSoundCloudFull, inferProfile, prefetchFullTracks, resolveFullAudio, subscribeFullTracks, upgradeToFullTrack } from '../lib/musicApi'
import { nextWaveBatch } from '../lib/wave'
import type { Taste } from '../lib/wave'
import * as auth from '../lib/authApi'
import type { Account } from '../lib/authApi'

const PREFS_KEY = 'monochrome.v2'
/** Library data is scoped per account so each listener keeps their own. */
const libKey = (userId: string | null) => `monochrome.lib.${userId ?? 'guest'}`

/* ------------------------------------------------------------------ *
 * Remote tracks arrive from live APIs, so the store keeps a runtime
 * registry that maps id → Track. Anything the user persists (likes,
 * playlists, history) is stored as a full track snapshot.
 * ------------------------------------------------------------------ */

interface Persisted {
  liked: Track[]
  recentlyPlayed: Track[]
  playlists: Playlist[]
  volume: number
  repeat: RepeatMode
  shuffle: boolean
}

interface Prefs {
  volume: number
  repeat: RepeatMode
  shuffle: boolean
}

function readJson<T>(key: string): Partial<T> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Partial<T>) : {}
  } catch {
    return {}
  }
}

const prefs = readJson<Prefs>(PREFS_KEY)

interface StoreState {
  /** runtime cache of every track seen from the APIs */
  registry: Map<string, Track>

  /** signed-in listener, or null for a local guest session */
  user: Account | null
  authReady: boolean
  /** true while a sign-in / sign-up request is in flight */
  authBusy: boolean
  authError: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  signOut: () => Promise<void>
  /** Restore a signed-in session from the stored token on app start. */
  restoreSession: () => Promise<void>
  liked: Track[]
  recentlyPlayed: Track[]
  playlists: Playlist[]

  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  playing: boolean
  loading: boolean
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  shuffleOrder: number[]
  /** Sleep timer: epoch ms when playback should stop, or null when off. */
  sleepAt: number | null
  /** True while a 30s preview is being swapped for its full-length version. */
  upgrading: boolean
  /** Transient note shown in the player when full-length playback is unavailable. */
  playbackNote: string | null
  /** "Моя волна": while true the queue is an endless stream and grows on its own. */
  waveMode: boolean
  /** The mood text the wave is tuned to, if the listener set one. */
  waveSeed: string
  waveLoading: boolean

  register: (tracks: Track[]) => void
  playTrack: (track: Track, context?: Track[]) => void
  playContext: (tracks: Track[], startIndex: number) => void
  togglePlay: () => void
  next: (auto?: boolean) => void
  prev: () => void
  seek: (position: number) => void
  setVolume: (v: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  setSleepTimer: (minutes: number | null) => void

  enqueue: (track: Track) => void
  playNext: (track: Track) => void
  removeFromQueue: (index: number) => void

  startWave: (seed?: string) => Promise<void>
  stopWave: () => void
  setWaveSeed: (seed: string) => void
  /** Fetch and append the next batch; called when the queue runs low. */
  extendWave: () => Promise<void>
  /**
   * Fetch the opening batch before it is asked for, so pressing play on the
   * wave page starts the music immediately instead of waiting on the network.
   */
  prewarmWave: (seed?: string) => void
  /** Pull the current track out of the wave and keep it in the library. */
  likeCurrentIntoWave: () => void

  toggleLike: (track: Track) => void
  isLiked: (id: string) => boolean

  createPlaylist: (name: string, description: string, tracks: Track[]) => string
  deletePlaylist: (id: string) => void
  renamePlaylist: (id: string, name: string) => void
  updatePlaylistDescription: (id: string, description: string) => void
  addToPlaylist: (playlistId: string, track: Track) => void
  removeFromPlaylist: (playlistId: string, trackId: string) => void
}

/** Save the playable preferences (volume/repeat/shuffle) — these are not per-account. */
function persistPrefs(state: StoreState) {
  const data: Prefs = {
    volume: state.volume,
    repeat: state.repeat,
    shuffle: state.shuffle,
  }
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(data))
  } catch {
    /* storage full or unavailable */
  }
}

/**
 * Save the listener's library. When signed in it goes to their account so a
 * second device sees the same playlists; locally it is mirrored to a key
 * scoped by user id, so signing out and back in never mixes libraries.
 */
function persist(state: StoreState) {
  const data: Persisted = {
    liked: state.liked,
    recentlyPlayed: state.recentlyPlayed,
    playlists: state.playlists,
    volume: state.volume,
    repeat: state.repeat,
    shuffle: state.shuffle,
  }
  persistPrefs(state)
  try {
    localStorage.setItem(libKey(state.user?.id ?? null), JSON.stringify(data))
  } catch {
    /* storage full or unavailable */
  }
  if (state.user) {
    void auth.saveLibrary({
      liked: state.liked,
      playlists: state.playlists,
      recentlyPlayed: state.recentlyPlayed,
    })
  }
}

/** Load the library for a given account (or the guest bucket). */
function readLibrary(userId: string | null): Persisted {
  const data = readJson<Persisted>(libKey(userId))
  return {
    liked: data.liked ?? [],
    recentlyPlayed: data.recentlyPlayed ?? [],
    playlists: data.playlists ?? [],
    volume: data.volume ?? 0.85,
    repeat: data.repeat ?? 'off',
    shuffle: data.shuffle ?? false,
  }
}

function makeShuffleOrder(length: number): number[] {
  const order = Array.from({ length }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/** Rehydrate persisted tracks through the profile inference so old saves stay valid. */
function reviveTrack(t: any): Track {
  if (!t || typeof t !== 'object') return t
  if (typeof t.energy === 'number' && typeof t.seed === 'number') return t as Track
  const profile = inferProfile(t.genre ?? '', `${t.title}${t.artist}`)
  return { ...t, ...profile } as Track
}

let sleepAtTimer: number | null = null

/** Rehydrate a whole library snapshot (tracks revived through profile inference). */
function reviveLibrary(lib: Persisted) {
  const liked = (lib.liked ?? []).map(reviveTrack)
  const recentlyPlayed = (lib.recentlyPlayed ?? []).map(reviveTrack)
  const playlists = (lib.playlists ?? []).map((p) => ({
    ...p,
    tracks: (p.tracks ?? []).map(reviveTrack),
  }))
  const registry = new Map<string, Track>()
  ;[...liked, ...recentlyPlayed, ...playlists.flatMap((p) => p.tracks)].forEach((t) => {
    if (t && t.id) registry.set(t.id, t)
  })
  return { liked, recentlyPlayed, playlists, registry }
}

type SetState = (partial: Partial<StoreState>) => void
type GetState = () => StoreState

/**
 * Switch the app to an account. The server copy wins when it already has data
 * (so a second device sees the same playlists); otherwise whatever is on this
 * device seeds the account, so nothing the guest built is lost on sign-up.
 */
async function adoptAccount(user: Account, set: SetState, get: GetState) {
  const remote = await auth.fetchLibrary()
  const remoteHasData = !!remote && ((remote.liked?.length ?? 0) > 0 || (remote.playlists?.length ?? 0) > 0)
  const lib: Persisted = remoteHasData
    ? {
        liked: (remote!.liked as Track[]) ?? [],
        recentlyPlayed: (remote!.recentlyPlayed as Track[]) ?? [],
        playlists: (remote!.playlists as Playlist[]) ?? [],
        volume: get().volume,
        repeat: get().repeat,
        shuffle: get().shuffle,
      }
    : { ...readLibrary(null), volume: get().volume, repeat: get().repeat, shuffle: get().shuffle }

  const revived = reviveLibrary(lib)
  set({
    user,
    authReady: true,
    authBusy: false,
    authError: null,
    liked: revived.liked,
    recentlyPlayed: revived.recentlyPlayed,
    playlists: revived.playlists,
    registry: revived.registry,
  })
  void auth.saveLibrary({
    liked: revived.liked,
    playlists: revived.playlists,
    recentlyPlayed: revived.recentlyPlayed,
  })
}

export const useStore = create<StoreState>((set, get) => {
  const bootLib = readLibrary(null)
  const bootVolume = prefs.volume ?? bootLib.volume ?? 0.85

  const boot = reviveLibrary(bootLib)
  const bootRegistry = boot.registry
  const bootLiked = boot.liked
  const bootRecent = boot.recentlyPlayed
  const bootPlaylists = boot.playlists

  /**
   * In-flight full-version upgrades, so repeated plays of the same preview
   * do not fire duplicate YouTube lookups.
   */
  const upgrades = new Map<string, Promise<Track | null>>()
  /** Prefetched opening batches for the wave, keyed by mood text. */
  const wavePrewarm = new Map<string, Promise<{ tracks: Track[]; taste: Taste }>>()

  // When any page resolves a full version (e.g. the mood generator pre-fetches
  // a whole playlist), fold it into the live queue so an already-playing
  // preview is upgraded in place, and so `cachedFullTrack` makes the next play
  // start full immediately.
  subscribeFullTracks((full) => {
    const state = get()
    const queue = state.queue.map((t) =>
      t.id === full.id || (t.artist === full.artist && t.title === full.title) ? full : t,
    )
    const current =
      state.currentTrack &&
      (state.currentTrack.id === full.id ||
        (state.currentTrack.artist === full.artist && state.currentTrack.title === full.title))
        ? full
        : state.currentTrack
    state.register([full])
    if (current !== state.currentTrack || queue.some((t, i) => t !== state.queue[i])) {
      set({ currentTrack: current, queue })
    }
  })

  const startTrack = (track: Track, index?: number) => {
    get().register([track])
    const recent = [track, ...get().recentlyPlayed.filter((t) => t.id !== track.id)].slice(0, 30)
    set({ currentTrack: track, playing: true, loading: true, recentlyPlayed: recent, playbackNote: null })
    if (index !== undefined) set({ queueIndex: index })
    void engine.load(track, true)
    persist(get())

    // Commercial previews start playing immediately; meanwhile we look for the
    // full-length version and hot-swap it in (keeping the position) so the
    // 30-second cut is never the end of the song.
    if (!track.preview) return
    set({ upgrading: true })
    const key = `${track.artist}|${track.title}`.toLowerCase()
    // If the full version was already resolved (e.g. the page pre-fetched it),
    // skip straight to it instead of playing a preview first.
    const known = cachedFullTrack(track)
    if (known) {
      const queue = get().queue.map((t) => (t.id === track.id ? known : t))
      get().register([known])
      set({ currentTrack: known, queue })
      persist(get())
      void engine.load(known, true, 0)
      set({ upgrading: false })
      return
    }
    let pending = upgrades.get(key)
    if (!pending) {
      pending = upgradeToFullTrack(track)
      upgrades.set(key, pending)
      void pending.finally(() => upgrades.delete(key))
    }
    void pending
      .then((full) => {
        if (!full) return // no matching video
        const state = get()
        if (state.currentTrack?.id !== track.id) return // user moved on
        const position = engine.getPosition()
        const queue = state.queue.map((t) => (t.id === track.id ? full : t))
        get().register([full])
        set({ currentTrack: full, queue, playbackNote: null })
        persist(get())
        void engine.load(full, true, position)
      })
      .catch(() => {})
      .finally(() => {
        if (get().currentTrack?.id === track.id) set({ upgrading: false })
      })
  }

  return {
    registry: bootRegistry,
    user: null,
    authReady: false,
    authBusy: false,
    authError: null,
    liked: bootLiked,
    recentlyPlayed: bootRecent,
    playlists: bootPlaylists,

    currentTrack: null,
    queue: [],
    queueIndex: -1,
    playing: false,
    loading: false,
    volume: bootVolume,
    repeat: prefs.repeat ?? 'off',
    shuffle: prefs.shuffle ?? false,
    shuffleOrder: [],
    sleepAt: null,
    upgrading: false,
    playbackNote: null,
    waveMode: false,
    waveSeed: '',
    waveLoading: false,

    register: (tracks) => {
      const registry = get().registry
      let changed = false
      for (const t of tracks) {
        if (t && t.id && !registry.has(t.id)) {
          registry.set(t.id, t)
          changed = true
        }
      }
      if (changed) set({ registry })
    },

    signIn: async (email, password) => {
      set({ authBusy: true, authError: null })
      try {
        const { user } = await auth.login(email, password)
        await adoptAccount(user, set, get)
      } catch (e) {
        set({ authBusy: false, authError: e instanceof Error ? e.message : 'Не удалось войти' })
      }
    },

    signUp: async (email, password, name) => {
      set({ authBusy: true, authError: null })
      try {
        const { user } = await auth.register(email, password, name)
        await adoptAccount(user, set, get)
      } catch (e) {
        set({ authBusy: false, authError: e instanceof Error ? e.message : 'Не удалось создать аккаунт' })
      }
    },

    signOut: async () => {
      const guest = readLibrary(null)
      await auth.logout()
      const revived = reviveLibrary(guest)
      set({
        user: null,
        authError: null,
        liked: revived.liked,
        recentlyPlayed: revived.recentlyPlayed,
        playlists: revived.playlists,
        registry: revived.registry,
      })
    },

    restoreSession: async () => {
      const user = await auth.currentUser()
      if (!user) {
        set({ authReady: true })
        return
      }
      await adoptAccount(user, set, get)
    },

    playTrack: (track, context) => {
      const list = context && context.length ? context : [track]
      const index = Math.max(0, list.findIndex((t) => t.id === track.id))
      set({ queue: list, queueIndex: index, shuffleOrder: makeShuffleOrder(list.length) })
      startTrack(track, index)
    },

    playContext: (tracks, startIndex) => {
      if (!tracks.length) return
      const index = Math.max(0, Math.min(startIndex, tracks.length - 1))
      set({ queue: tracks, queueIndex: index, shuffleOrder: makeShuffleOrder(tracks.length) })
      startTrack(tracks[index], index)
    },

    togglePlay: () => {
      const { currentTrack, playing, queue } = get()
      if (!currentTrack) {
        if (queue.length) get().playContext(queue, 0)
        return
      }
      if (playing) {
        engine.pause()
      } else {
        void engine.play()
      }
    },

    next: (auto = false) => {
      const { queue, queueIndex, repeat, shuffle, shuffleOrder, waveMode } = get()
      if (!queue.length) return
      if (auto && repeat === 'one') {
        const t = queue[queueIndex]
        if (t) startTrack(t, queueIndex)
        return
      }
      let nextIndex: number
      if (shuffle && shuffleOrder.length === queue.length) {
        const pos = shuffleOrder.indexOf(queueIndex)
        const nextPos = pos + 1
        if (nextPos >= shuffleOrder.length) {
          if (auto && repeat === 'off' && !waveMode) {
            engine.pause()
            return
          }
          nextIndex = shuffleOrder[0]
        } else {
          nextIndex = shuffleOrder[nextPos]
        }
      } else {
        nextIndex = queueIndex + 1
        if (nextIndex >= queue.length) {
          if (auto && repeat === 'off' && !waveMode) {
            engine.pause()
            return
          }
          nextIndex = 0
        }
      }
      startTrack(queue[nextIndex], nextIndex)
      if (waveMode && queue.length - (nextIndex + 1) < 5) void get().extendWave()
    },

    prev: () => {
      const { queue, queueIndex, shuffle, shuffleOrder } = get()
      if (!queue.length) return
      if (engine.getPosition() > 4) {
        engine.seek(0)
        return
      }
      let prevIndex: number
      if (shuffle && shuffleOrder.length === queue.length) {
        const pos = shuffleOrder.indexOf(queueIndex)
        prevIndex = shuffleOrder[(pos - 1 + shuffleOrder.length) % shuffleOrder.length]
      } else {
        prevIndex = (queueIndex - 1 + queue.length) % queue.length
      }
      startTrack(queue[prevIndex], prevIndex)
    },

    seek: (position) => engine.seek(position),

    setVolume: (v) => {
      engine.setVolume(v)
      set({ volume: v })
      persist(get())
    },

    toggleShuffle: () => {
      const shuffle = !get().shuffle
      set({ shuffle, shuffleOrder: makeShuffleOrder(get().queue.length) })
      persist(get())
    },

    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one']
      const nextMode = order[(order.indexOf(get().repeat) + 1) % order.length]
      set({ repeat: nextMode })
      persist(get())
    },

    setSleepTimer: (minutes) => {
      if (sleepAtTimer) {
        window.clearTimeout(sleepAtTimer)
        sleepAtTimer = null
      }
      if (minutes == null) {
        set({ sleepAt: null })
        return
      }
      const at = Date.now() + minutes * 60_000
      set({ sleepAt: at })
      sleepAtTimer = window.setTimeout(() => {
        engine.pause()
        set({ sleepAt: null })
        sleepAtTimer = null
      }, minutes * 60_000)
    },

    enqueue: (track) => {
      const { queue, currentTrack } = get()
      get().register([track])
      if (!currentTrack) {
        get().playTrack(track)
        return
      }
      set({ queue: [...queue, track], shuffleOrder: makeShuffleOrder(queue.length + 1) })
    },

    playNext: (track) => {
      const { queue, queueIndex, currentTrack } = get()
      get().register([track])
      if (!currentTrack || queueIndex < 0) {
        get().playTrack(track)
        return
      }
      const next = [...queue]
      next.splice(queueIndex + 1, 0, track)
      set({ queue: next, shuffleOrder: makeShuffleOrder(next.length) })
    },

    removeFromQueue: (index) => {
      const { queue, queueIndex } = get()
      const next = queue.filter((_, i) => i !== index)
      let idx = queueIndex
      if (index < queueIndex) idx -= 1
      else if (index === queueIndex) idx = Math.min(idx, next.length - 1)
      set({ queue: next, queueIndex: idx, shuffleOrder: makeShuffleOrder(next.length) })
    },

    startWave: async (seed) => {
      const cleanSeed = (seed ?? get().waveSeed ?? '').trim()
      set({ waveMode: true, waveSeed: cleanSeed, waveLoading: true })
      const { liked, recentlyPlayed } = get()
      // Reuse the batch the wave page prewarmed while the listener was reading,
      // so pressing play starts instantly instead of waiting on the network.
      const warmed = wavePrewarm.get(cleanSeed || '~default')
      let batch = warmed
      if (!batch) {
        batch = nextWaveBatch(liked, recentlyPlayed, new Set(), 24, cleanSeed, true)
        wavePrewarm.set(cleanSeed || '~default', batch)
      }
      const { tracks, taste } = await batch
      if (!tracks.length) {
        set({ waveLoading: false })
        return
      }
      get().register(tracks)
      set({ waveLoading: false })
      get().playContext(tracks, 0)
      void prefetchFullTracks(tracks)
      // Warm the next batch right away so the stream never stalls.
      void get().extendWave()
      return void taste
    },

    stopWave: () => set({ waveMode: false, waveSeed: '', waveLoading: false }),

    setWaveSeed: (seed) => set({ waveSeed: seed }),

    prewarmWave: (seed) => {
      const cleanSeed = (seed ?? '').trim()
      const key = cleanSeed || '~default'
      if (wavePrewarm.has(key)) return
      const { liked, recentlyPlayed } = get()
      const task = nextWaveBatch(liked, recentlyPlayed, new Set(), 24, cleanSeed, true).then((r) => {
        get().register(r.tracks)
        return r
      })
      wavePrewarm.set(key, task)
      task.catch(() => wavePrewarm.delete(key))
    },

    extendWave: async () => {
      const { waveMode, waveLoading, queue, liked, recentlyPlayed, waveSeed } = get()
      if (!waveMode || waveLoading) return
      set({ waveLoading: true })
      const exclude = new Set(queue.map((t) => t.id))
      const { tracks } = await nextWaveBatch(liked, recentlyPlayed, exclude, 20, waveSeed)
      if (tracks.length) {
        get().register(tracks)
        const next = [...get().queue, ...tracks]
        set({ queue: next, shuffleOrder: makeShuffleOrder(next.length) })
        void prefetchFullTracks(tracks)
      }
      set({ waveLoading: false })
    },

    likeCurrentIntoWave: () => {
      const t = get().currentTrack
      if (t) get().toggleLike(t)
    },

    toggleLike: (track) => {
      get().register([track])
      const liked = get().liked
      const has = liked.some((t) => t.id === track.id)
      set({ liked: has ? liked.filter((t) => t.id !== track.id) : [track, ...liked] })
      persist(get())
    },

    isLiked: (id) => get().liked.some((t) => t.id === id),

    createPlaylist: (name, description, tracks) => {
      const id = `pl-user-${Date.now()}`
      const playlist: Playlist = {
        id,
        name: name.trim() || 'Новый плейлист',
        description,
        tracks,
        cover: 'custom',
        owned: true,
        createdAt: Date.now(),
      }
      get().register(tracks)
      set({ playlists: [playlist, ...get().playlists] })
      persist(get())
      return id
    },

    deletePlaylist: (id) => {
      set({ playlists: get().playlists.filter((p) => p.id !== id) })
      persist(get())
    },

    renamePlaylist: (id, name) => {
      set({
        playlists: get().playlists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)),
      })
      persist(get())
    },

    updatePlaylistDescription: (id, description) => {
      set({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, description } : p)) })
      persist(get())
    },

    addToPlaylist: (playlistId, track) => {
      get().register([track])
      set({
        playlists: get().playlists.map((p) =>
          p.id === playlistId && !p.tracks.some((t) => t.id === track.id)
            ? { ...p, tracks: [...p.tracks, track] }
            : p,
        ),
      })
      persist(get())
    },

    removeFromPlaylist: (playlistId, trackId) => {
      set({
        playlists: get().playlists.map((p) =>
          p.id === playlistId ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p,
        ),
      })
      persist(get())
    },
  }
})

// Keep the store in sync with the engine's real playback events.
engine.setEvents({
  onEnded: () => useStore.getState().next(true),
  onPlayingChange: (playing) => useStore.setState({ playing }),
  onLoadingChange: (loading) => useStore.setState({ loading }),
  onDuration: (duration) => {
    const cur = useStore.getState().currentTrack
    if (cur && Math.abs(cur.duration - duration) > 1) {
      useStore.setState({ currentTrack: { ...cur, duration } })
    }
  },
  onError: () => {
    const state = useStore.getState()
    const cur = state.currentTrack
    // A YouTube embed/stream can be refused (bot check, region block, blocked
    // datacenter IP). Before dropping to the 30-second preview, look for a
    // full-length SoundCloud upload (streams anywhere), then Audius.
    if (cur && (cur.source === 'youtube' || cur.source === 'soundcloud')) {
      const preview = cur.previewTrack
      const base = preview || cur // keep the original title/artist/artwork
      const swapTo = (full: Track, source: Track['source']): boolean => {
        if (useStore.getState().currentTrack?.id !== cur.id) return false
        const swapped: Track = {
          ...base,
          source,
          sourceId: full.sourceId,
          streamUrl: full.streamUrl,
          permalink: full.permalink,
          preview: false,
          previewTrack: preview,
          duration: base.duration || full.duration,
        }
        const queue = state.queue.map((t) => (t.id === cur.id ? swapped : t))
        useStore.getState().register([swapped])
        useStore.setState({ currentTrack: swapped, queue, playbackNote: null })
        void engine.load(swapped, true)
        return true
      }
      void (async () => {
        // SoundCloud can actually stream full audio from this machine.
        const sc = await findSoundCloudFull(cur.artist, cur.title).catch(() => null)
        if (sc) {
          const url = await resolveFullAudio(sc.sourceId, 'sc').catch(() => null)
          if (url && swapTo({ ...sc, streamUrl: url }, 'soundcloud')) return
        }
        const full = await findAudiusFull(cur.artist, cur.title).catch(() => null)
        if (full && swapTo(full, 'audius')) return
        if (useStore.getState().currentTrack?.id !== cur.id) return
        // Nothing full-length anywhere → fall back to the commercial preview.
        if (preview) {
          const queue = state.queue.map((t) => (t.id === cur.id ? preview : t))
          useStore.setState({
            currentTrack: preview,
            queue,
            playbackNote: 'Полная версия недоступна — играет превью 30 секунд',
          })
          void engine.load(preview, true)
          return
        }
        if (useStore.getState().playing) state.next(true)
        else useStore.setState({ playing: false, loading: false })
      })().catch(() => {
        // Total failure: prefer the commercial preview over silence.
        if (preview) {
          const queue = state.queue.map((t) => (t.id === cur.id ? preview : t))
          useStore.setState({
            currentTrack: preview,
            queue,
            playbackNote: 'Полная версия недоступна — играет превью 30 секунд',
          })
          void engine.load(preview, true)
        } else if (state.playing) {
          state.next(true)
        } else {
          useStore.setState({ playing: false, loading: false })
        }
      })
      return
    }
    // Move on rather than getting stuck on a broken stream.
    if (state.playing) state.next(true)
    else useStore.setState({ playing: false, loading: false })
  },
})

if (typeof window !== 'undefined') {
  const applyVolume = () => {
    engine.setVolume(useStore.getState().volume)
    window.removeEventListener('pointerdown', applyVolume)
    window.removeEventListener('keydown', applyVolume)
  }
  window.addEventListener('pointerdown', applyVolume)
  window.addEventListener('keydown', applyVolume)
}
