import type { Track } from '../types'
import { resolveAudiusStream } from './musicApi'

export interface EngineEvents {
  onEnded: () => void
  onError: () => void
  onDuration: (seconds: number) => void
  onPlayingChange: (playing: boolean) => void
  onLoadingChange: (loading: boolean) => void
}

/**
 * Streams real audio through an <audio> element, routed via a Web Audio
 * graph so the visualiser gets an analyser. Audius streams are resolved
 * lazily (their URL is signed on demand); iTunes previews are direct.
 */
export class AudioEngine {
  private el: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private source: MediaElementAudioSourceNode | null = null
  private gain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private events: Partial<EngineEvents> = {}
  private current: Track | null = null
  private loading = false
  private token = 0

  private ensureElement(): HTMLAudioElement | null {
    if (this.el) return this.el
    if (typeof Audio === 'undefined') return null
    const el = new Audio()
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.addEventListener('ended', () => this.events.onEnded?.())
    el.addEventListener('error', () => {
      if (!this.loading) this.events.onError?.()
    })
    el.addEventListener('durationchange', () => {
      if (Number.isFinite(el.duration)) this.events.onDuration?.(el.duration)
    })
    el.addEventListener('waiting', () => this.events.onLoadingChange?.(true))
    el.addEventListener('playing', () => this.events.onLoadingChange?.(false))
    el.addEventListener('play', () => this.events.onPlayingChange?.(true))
    el.addEventListener('pause', () => this.events.onPlayingChange?.(false))
    this.el = el
    return el
  }

  private ensureGraph() {
    const el = this.ensureElement()
    if (!el) return
    if (this.ctx) return
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    this.ctx = new AC()
    this.source = this.ctx.createMediaElementSource(el)
    this.gain = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.82
    this.source.connect(this.gain)
    this.gain.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  setEvents(events: Partial<EngineEvents>) {
    this.events = events
  }

  getAnalyser() {
    return this.analyser
  }

  get frequencyBinCount() {
    return this.analyser?.frequencyBinCount ?? 128
  }

  async resume() {
    this.ensureGraph()
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume()
  }

  /** Resolve a playable URL for a track (Audius streams are signed lazily). */
  private async urlFor(track: Track): Promise<string | null> {
    if (track.streamUrl) return track.streamUrl
    if (track.source === 'audius') {
      const url = await resolveAudiusStream(track.sourceId)
      if (url) track.streamUrl = url
      return url
    }
    return null
  }

  async load(track: Track, autoplay: boolean, seek = 0) {
    const el = this.ensureElement()
    if (!el) return
    const token = ++this.token
    this.current = track
    this.loading = true
    this.events.onLoadingChange?.(true)

    const url = await this.urlFor(track)
    if (token !== this.token) return
    if (!url) {
      this.loading = false
      this.events.onLoadingChange?.(false)
      this.events.onError?.()
      return
    }

    if (el.src !== url) {
      el.src = url
      el.load()
    }
    this.loading = false
    this.events.onLoadingChange?.(false)

    if (seek > 0) {
      try {
        el.currentTime = seek
      } catch {
        /* not seekable yet */
      }
    }
    if (autoplay) {
      await this.resume()
      try {
        await el.play()
      } catch {
        this.events.onPlayingChange?.(false)
      }
    }
  }

  async play() {
    const el = this.ensureElement()
    if (!el || !this.current) return
    await this.resume()
    try {
      await el.play()
    } catch {
      this.events.onPlayingChange?.(false)
    }
  }

  pause() {
    this.el?.pause()
  }

  seek(position: number) {
    if (this.el) {
      try {
        this.el.currentTime = Math.max(0, position)
      } catch {
        /* ignore */
      }
    }
  }

  setVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v))
    if (this.gain) this.gain.gain.value = clamped
    else if (this.el) this.el.volume = clamped
  }

  getPosition(): number {
    return this.el?.currentTime ?? 0
  }

  getDuration(): number {
    const d = this.el?.duration
    return d && Number.isFinite(d) ? d : this.current?.duration ?? 0
  }

  isPlaying(): boolean {
    return this.el ? !this.el.paused : false
  }

  currentTrackId(): string | null {
    return this.current?.id ?? null
  }

  /** Short audition used by cards without disturbing the main player. */
  preview(track: Track, onDone?: () => void) {
    void this.urlFor(track).then((url) => {
      if (!url) return
      const a = new Audio(url)
      a.crossOrigin = 'anonymous'
      a.volume = 0.8
      const stop = () => {
        a.pause()
        onDone?.()
      }
      a.addEventListener('timeupdate', () => {
        if (a.currentTime > 12) stop()
      })
      a.addEventListener('ended', stop)
      a.play().catch(stop)
    })
  }
}

export const engine = new AudioEngine()
