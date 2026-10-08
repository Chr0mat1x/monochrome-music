export type Mode = 'major' | 'minor' | 'dorian' | 'lydian' | 'mixolydian' | 'phrygian'

/** Which upstream catalogue a track came from. */
export type Source = 'deezer' | 'itunes' | 'audius'

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  /** 0 means "unknown / still streaming" */
  duration: number
  genre: string
  year: number
  /** 0..100 — inferred from genre/tempo when the source has no such field */
  energy: number
  /** 0..100 */
  valence: number
  bpm: number
  mood: string[]
  seed: number
  source: Source
  /** Direct audio URL; null while it is still being resolved. */
  streamUrl: string | null
  /** Real cover image, when the source provides one. */
  artwork: string | null
  /** True for short 30-second iTunes previews, false for full Audius streams. */
  preview: boolean
  sourceId: string
  permalink: string | null
}

export interface Album {
  id: string
  title: string
  artist: string
  year: number
  trackIds: string[]
  artwork: string | null
  genre: string
}

export interface Artist {
  id: string
  name: string
  genres: string[]
  bio: string
  monthly: number
  picture: string | null
}

export interface Playlist {
  id: string
  name: string
  description: string
  tracks: Track[]
  cover: string
  owned: boolean
  createdAt: number
}

export type RepeatMode = 'off' | 'all' | 'one'
