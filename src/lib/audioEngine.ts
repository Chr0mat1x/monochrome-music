import type { Track } from '../types'
import { resolveAudiusStream, resolveDeezerStream, resolveFullAudio, resolveMediaUrl } from './musicApi'
import { loadYouTubeApi } from './youtube'

type YTPlayer = {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  loadVideoById: (options: { videoId: string; startSeconds?: number }) => void
  getCurrentTime: () => number
  getDuration: () => number
  setVolume: (v: number) => void
  mute: () => void
  unMute: () => void
  destroy: () => void
}

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

  /** YouTube backend — used for full-length mainstream tracks. */
  private yt: YTPlayer | null = null
  private ytHost: HTMLDivElement | null = null
  private ytReady: Promise<void> | null = null
  private ytVolume = 0.85
  private ytMuted = false
  private usingYt = false
  private ytPlaying = false

  /** True when the current track plays through YouTube (no analyser). */
  get isYouTube() {
    return this.usingYt
  }

  private ensureElement(): HTMLAudioElement | null {
    if (this.el) return this.el
    if (typeof Audio === 'undefined') return null
    const el = new Audio()
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    el.addEventListener('ended', () => this.events.onEnded?.())
    el.addEventListener('error', () => {
      if (this.loading) return
      // A URL minted during the search can expire before the listener gets to
      // the track. Drop it and re-resolve once rather than failing the play.
      const cur = this.current
      if (cur?.source === 'soundcloud' && cur.streamUrl) {
        this.current = { ...cur, streamUrl: null }
        void resolveFullAudio(cur.sourceId, 'sc')
          .then((url) => {
            if (!url || this.current?.id !== cur.id) return
            this.current = { ...cur, streamUrl: url }
            this.load({ ...cur, streamUrl: url }, true, this.getPosition())
          })
          .catch(() => this.events.onError?.())
        return
      }
      this.events.onError?.()
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

  /**
   * Build a hidden YouTube player. The host div is never displayed — the
   * player exists purely to stream audio. It is created lazily so the IFrame
   * API is only downloaded the first time a YouTube track is played.
   */
  private async ensureYouTube(): Promise<YTPlayer | null> {
    if (this.yt) return this.yt
    if (this.ytReady) {
      await this.ytReady
      return this.yt
    }
    this.ytReady = (async () => {
      const YT = await loadYouTubeApi()
      const host = document.createElement('div')
      host.setAttribute('aria-hidden', 'true')
      // kept out of the layout but still rendered, which the API requires
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:200px;pointer-events:none'
      document.body.appendChild(host)
      this.ytHost = host
      await new Promise<void>((resolve) => {
        const player = new YT.Player(host, {
          height: '200',
          width: '200',
          playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => {
              this.yt = player
              player.setVolume(Math.round(this.ytVolume * 100))
              if (this.ytMuted) player.mute()
              resolve()
            },
            onStateChange: (e: { data: number }) => {
              const S = YT.PlayerState
              if (e.data === S.ENDED) {
                this.ytPlaying = false
                this.events.onEnded?.()
              } else if (e.data === S.PLAYING) {
                this.ytPlaying = true
                this.loading = false
                this.events.onLoadingChange?.(false)
                this.events.onPlayingChange?.(true)
                this.events.onDuration?.(player.getDuration() || this.current?.duration || 0)
              } else if (e.data === S.PAUSED) {
                this.ytPlaying = false
                this.events.onPlayingChange?.(false)
              } else if (e.data === S.BUFFERING) {
                this.events.onLoadingChange?.(true)
              }
            },
            onError: () => {
              this.loading = false
              this.events.onLoadingChange?.(false)
              this.events.onError?.()
            },
          },
        })
        // if the API never fires onReady we still release the await
        setTimeout(resolve, 12000)
      })
    })()
    await this.ytReady
    return this.yt
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

  /**
   * Resolve a playable URL for a track. Audius and Deezer both sign their
   * media URLs on demand and the signatures expire, so the result is never
   * cached back onto the track — it is fetched fresh for each load.
   */
  private async urlFor(track: Track): Promise<string | null> {
    if (track.source === 'audius') return resolveAudiusStream(track.sourceId)
    if (track.source === 'deezer') return resolveDeezerStream(track.sourceId)
    // A SoundCloud track that already carries its URL (resolved during the
    // search) plays without another round trip to the extractor.
    if (track.source === 'soundcloud') return track.streamUrl ?? resolveFullAudio(track.sourceId, 'sc')
    if (track.source === 'itunes') return resolveMediaUrl(track.streamUrl)
    return track.streamUrl
  }

  async load(track: Track, autoplay: boolean, seek = 0) {
    const el = this.ensureElement()
    if (!el) return
    const token = ++this.token
    this.current = track
    this.loading = true
    this.events.onLoadingChange?.(true)

    // Work out a direct audio URL first. YouTube tracks prefer the local
    // yt-dlp server (full-length audio, analyser intact); if it is not
    // available we fall back to the official IFrame player further down.
    let url: string | null
    if (track.source === 'youtube') {
      url = track.streamUrl
      if (!url) {
        url = await resolveFullAudio(track.sourceId).catch(() => null)
        if (token !== this.token) return
      }
    } else {
      url = await this.urlFor(track)
      if (token !== this.token) return
    }

    // No direct URL for a YouTube track → hand it to the IFrame player.
    if (track.source === 'youtube' && !url) {
      this.usingYt = true
      this.el?.pause()
      const player = await this.ensureYouTube()
      if (token !== this.token) return
      if (!player) {
        this.loading = false
        this.events.onLoadingChange?.(false)
        this.events.onError?.()
        return
      }
      player.loadVideoById({ videoId: track.sourceId, startSeconds: seek > 0 ? seek : undefined })
      if (!autoplay) player.pauseVideo()
      return
    }

    this.usingYt = false
    this.yt?.pauseVideo()

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
    if (this.usingYt) {
      this.yt?.playVideo()
      return
    }
    await this.resume()
    try {
      await el.play()
    } catch {
      this.events.onPlayingChange?.(false)
    }
  }

  pause() {
    if (this.usingYt) {
      this.yt?.pauseVideo()
      return
    }
    this.el?.pause()
  }

  seek(position: number) {
    const target = Math.max(0, position)
    if (this.usingYt) {
      this.yt?.seekTo(target, true)
      return
    }
    if (this.el) {
      try {
        this.el.currentTime = target
      } catch {
        /* ignore */
      }
    }
  }

  setVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v))
    this.ytVolume = clamped
    if (this.yt) this.yt.setVolume(Math.round(clamped * 100))
    if (this.gain) this.gain.gain.value = clamped
    else if (this.el) this.el.volume = clamped
  }

  getPosition(): number {
    if (this.usingYt) return this.yt?.getCurrentTime() ?? 0
    return this.el?.currentTime ?? 0
  }

  getDuration(): number {
    if (this.usingYt) {
      const d = this.yt?.getDuration()
      return d && Number.isFinite(d) && d > 0 ? d : this.current?.duration ?? 0
    }
    const d = this.el?.duration
    return d && Number.isFinite(d) ? d : this.current?.duration ?? 0
  }

  isPlaying(): boolean {
    if (this.usingYt) return this.ytPlaying
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
