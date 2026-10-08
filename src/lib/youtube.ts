/**
 * Minimal wrapper around the official YouTube IFrame Player API.
 *
 * Mainstream labels only license 30-second previews to free third-party apps,
 * so full-length playback for commercial music goes through YouTube's own
 * player. That means the audio never passes through our Web Audio graph —
 * the trade-off is no analyser, so the visualiser falls back to its idle
 * animation for YouTube tracks.
 */

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

type YTNamespace = {
  Player: new (el: HTMLElement, options: Record<string, unknown>) => YTPlayer
  PlayerState: {
    ENDED: number
    PLAYING: number
    PAUSED: number
    BUFFERING: number
  }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let loader: Promise<YTNamespace> | null = null

/** Inject the IFrame API script once and resolve when it is ready. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT)
      return
    }
    const timeout = setTimeout(() => reject(new Error('YouTube API timeout')), 15000)
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      clearTimeout(timeout)
      if (window.YT) resolve(window.YT)
      else reject(new Error('YouTube API unavailable'))
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('YouTube API failed to load'))
    }
    document.head.appendChild(script)
  })
  return loader
}
