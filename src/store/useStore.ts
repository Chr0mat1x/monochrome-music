import { create } from 'zustand'
import type { Playlist, RepeatMode, Track } from '../types'
import { engine } from '../lib/audioEngine'
import { findAudiusFull, inferProfile, upgradeToFullTrack } from '../lib/musicApi'

const LS_KEY = 'monochrome.v2'

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

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Partial<Persisted>
  } catch {
    return {}
  }
}

const persisted = loadPersisted()

interface StoreState {
  /** runtime cache of every track seen from the APIs */
  registry: Map<string, Track>
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

  toggleLike: (track: Track) => void
  isLiked: (id: string) => boolean

  createPlaylist: (name: string, description: string, tracks: Track[]) => string
  deletePlaylist: (id: string) => void
  renamePlaylist: (id: string, name: string) => void
  updatePlaylistDescription: (id: string, description: string) => void
  addToPlaylist: (playlistId: string, track: Track) => void
  removeFromPlaylist: (playlistId: string, trackId: string) => void
}

function persist(state: StoreState) {
  const data: Persisted = {
    liked: state.liked,
    recentlyPlayed: state.recentlyPlayed,
    playlists: state.playlists,
    volume: state.volume,
    repeat: state.repeat,
    shuffle: state.shuffle,
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {
    /* storage full or unavailable */
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

export const useStore = create<StoreState>((set, get) => {
  const bootVolume = persisted.volume ?? 0.85

  const bootRegistry = new Map<string, Track>()
  const bootLiked = (persisted.liked ?? []).map(reviveTrack)
  const bootRecent = (persisted.recentlyPlayed ?? []).map(reviveTrack)
  const bootPlaylists = (persisted.playlists ?? []).map((p) => ({
    ...p,
    tracks: (p.tracks ?? []).map(reviveTrack),
  }))
  ;[...bootLiked, ...bootRecent, ...bootPlaylists.flatMap((p) => p.tracks)].forEach((t) => {
    if (t && t.id) bootRegistry.set(t.id, t)
  })

  /**
   * In-flight full-version upgrades, so repeated plays of the same preview
   * do not fire duplicate YouTube lookups.
   */
  const upgrades = new Map<string, Promise<Track | null>>()

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
    liked: bootLiked,
    recentlyPlayed: bootRecent,
    playlists: bootPlaylists,

    currentTrack: null,
    queue: [],
    queueIndex: -1,
    playing: false,
    loading: false,
    volume: bootVolume,
    repeat: persisted.repeat ?? 'off',
    shuffle: persisted.shuffle ?? false,
    shuffleOrder: [],
    sleepAt: null,
    upgrading: false,
    playbackNote: null,

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
      const { queue, queueIndex, repeat, shuffle, shuffleOrder } = get()
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
          if (auto && repeat === 'off') {
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
          if (auto && repeat === 'off') {
            engine.pause()
            return
          }
          nextIndex = 0
        }
      }
      startTrack(queue[nextIndex], nextIndex)
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
    // full-length Audius upload, which streams whole songs from any IP.
    if (cur && cur.source === 'youtube') {
      const preview = cur.previewTrack
      const base = preview || cur // keep the original title/artist/artwork
      void findAudiusFull(cur.artist, cur.title)
        .then(async (full) => {
          if (useStore.getState().currentTrack?.id !== cur.id) return
          if (full) {
            const swapped: Track = {
              ...base,
              source: 'audius',
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
            return
          }
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
        })
        .catch(() => {
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
