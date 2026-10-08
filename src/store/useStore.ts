import { create } from 'zustand'
import type { Playlist, RepeatMode, Track } from '../types'
import { STARTER_PLAYLISTS, TRACK_BY_ID, tracksByIds } from '../data/library'
import { engine } from '../lib/audioEngine'

const LS_KEY = 'monochrome.v1'

interface Persisted {
  playlists: Playlist[]
  liked: string[]
  recentlyPlayed: string[]
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
  playlists: Playlist[]
  liked: string[]
  recentlyPlayed: string[]

  currentTrackId: string | null
  queue: string[]
  queueIndex: number
  playing: boolean
  volume: number
  repeat: RepeatMode
  shuffle: boolean
  /** shuffled order of queue indices, when shuffle is on */
  shuffleOrder: number[]

  playTrack: (trackId: string, context?: string[]) => void
  playContext: (ids: string[], startIndex: number) => void
  togglePlay: () => void
  next: (auto?: boolean) => void
  prev: () => void
  seek: (position: number) => void
  setVolume: (v: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void

  enqueue: (trackId: string) => void
  removeFromQueue: (index: number) => void

  toggleLike: (trackId: string) => void
  isLiked: (trackId: string) => boolean

  createPlaylist: (name: string, description: string, trackIds: string[]) => string
  deletePlaylist: (id: string) => void
  renamePlaylist: (id: string, name: string) => void
  addToPlaylist: (playlistId: string, trackId: string) => void
  removeFromPlaylist: (playlistId: string, trackId: string) => void

  currentTrack: () => Track | null
  queueTracks: () => Track[]
}

function persist(state: StoreState) {
  const data: Persisted = {
    playlists: state.playlists,
    liked: state.liked,
    recentlyPlayed: state.recentlyPlayed,
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

export const useStore = create<StoreState>((set, get) => {
  const bootVolume = persisted.volume ?? 0.85

  const startTrack = (trackId: string) => {
    const track = TRACK_BY_ID.get(trackId)
    if (!track) return
    const recent = [trackId, ...get().recentlyPlayed.filter((id) => id !== trackId)].slice(0, 30)
    set({ currentTrackId: trackId, playing: true, recentlyPlayed: recent })
    void engine.load(track, true, 0)
    persist(get())
  }

  return {
    playlists: persisted.playlists ?? STARTER_PLAYLISTS,
    liked: persisted.liked ?? [],
    recentlyPlayed: persisted.recentlyPlayed ?? [],

    currentTrackId: null,
    queue: [],
    queueIndex: -1,
    playing: false,
    volume: bootVolume,
    repeat: persisted.repeat ?? 'off',
    shuffle: persisted.shuffle ?? false,
    shuffleOrder: [],

    playTrack: (trackId, context) => {
      const ids = context && context.length ? context : [trackId]
      const index = Math.max(0, ids.indexOf(trackId))
      set({ queue: ids, queueIndex: index, shuffleOrder: makeShuffleOrder(ids.length) })
      startTrack(trackId)
    },

    playContext: (ids, startIndex) => {
      if (!ids.length) return
      const index = Math.max(0, Math.min(startIndex, ids.length - 1))
      set({ queue: ids, queueIndex: index, shuffleOrder: makeShuffleOrder(ids.length) })
      startTrack(ids[index])
    },

    togglePlay: () => {
      const { currentTrackId, playing, queue } = get()
      if (!currentTrackId) {
        if (queue.length) get().playContext(queue, 0)
        return
      }
      if (playing) {
        engine.pause()
        set({ playing: false })
      } else {
        engine.play()
        set({ playing: true })
      }
    },

    next: (auto = false) => {
      const { queue, queueIndex, repeat, shuffle, shuffleOrder } = get()
      if (!queue.length) return
      if (auto && repeat === 'one') {
        const id = queue[queueIndex]
        if (id) startTrack(id)
        return
      }
      let nextIndex: number
      if (shuffle && shuffleOrder.length === queue.length) {
        const pos = shuffleOrder.indexOf(queueIndex)
        const nextPos = pos + 1
        if (nextPos >= shuffleOrder.length) {
          if (auto && repeat === 'off') {
            engine.pause()
            set({ playing: false })
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
            set({ playing: false })
            return
          }
          nextIndex = 0
        }
      }
      set({ queueIndex: nextIndex })
      startTrack(queue[nextIndex])
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
      set({ queueIndex: prevIndex })
      startTrack(queue[prevIndex])
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

    enqueue: (trackId) => {
      const { queue, currentTrackId } = get()
      if (!currentTrackId) {
        get().playTrack(trackId)
        return
      }
      set({ queue: [...queue, trackId] })
    },

    removeFromQueue: (index) => {
      const { queue, queueIndex } = get()
      const next = queue.filter((_, i) => i !== index)
      let idx = queueIndex
      if (index < queueIndex) idx -= 1
      else if (index === queueIndex) idx = Math.min(idx, next.length - 1)
      set({ queue: next, queueIndex: idx, shuffleOrder: makeShuffleOrder(next.length) })
    },

    toggleLike: (trackId) => {
      const liked = get().liked
      const has = liked.includes(trackId)
      set({ liked: has ? liked.filter((id) => id !== trackId) : [trackId, ...liked] })
      persist(get())
    },

    isLiked: (trackId) => get().liked.includes(trackId),

    createPlaylist: (name, description, trackIds) => {
      const id = `pl-user-${Date.now()}`
      const playlist: Playlist = {
        id,
        name: name.trim() || 'Новый плейлист',
        description,
        trackIds,
        cover: 'custom',
        owned: true,
        createdAt: Date.now(),
      }
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

    addToPlaylist: (playlistId, trackId) => {
      set({
        playlists: get().playlists.map((p) =>
          p.id === playlistId && !p.trackIds.includes(trackId)
            ? { ...p, trackIds: [...p.trackIds, trackId] }
            : p,
        ),
      })
      persist(get())
    },

    removeFromPlaylist: (playlistId, trackId) => {
      set({
        playlists: get().playlists.map((p) =>
          p.id === playlistId ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p,
        ),
      })
      persist(get())
    },

    currentTrack: () => {
      const id = get().currentTrackId
      return id ? TRACK_BY_ID.get(id) ?? null : null
    },

    queueTracks: () => tracksByIds(get().queue),
  }
})

// Wire the audio engine back into the store: when a track finishes the
// engine asks us to advance the queue.
engine.onEnded = () => useStore.getState().next(true)

// Push the persisted volume into the engine on the first user gesture.
if (typeof window !== 'undefined') {
  const applyVolume = () => {
    engine.setVolume(useStore.getState().volume)
    window.removeEventListener('pointerdown', applyVolume)
    window.removeEventListener('keydown', applyVolume)
  }
  window.addEventListener('pointerdown', applyVolume)
  window.addEventListener('keydown', applyVolume)
}
