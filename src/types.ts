export type Mode = 'major' | 'minor' | 'dorian' | 'lydian' | 'mixolydian' | 'phrygian'

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  genre: string
  year: number
  /** 0..100 */
  energy: number
  /** 0..100 */
  valence: number
  bpm: number
  mood: string[]
  seed: number
  key: number
  mode: Mode
  waveform: 'sine' | 'triangle' | 'sawtooth' | 'square'
}

export interface Album {
  id: string
  title: string
  artist: string
  year: number
  trackIds: string[]
  accent: number
}

export interface Artist {
  id: string
  name: string
  genres: string[]
  bio: string
  monthly: number
}

export interface Playlist {
  id: string
  name: string
  description: string
  trackIds: string[]
  cover: string
  owned: boolean
  createdAt: number
}

export type RepeatMode = 'off' | 'all' | 'one'
