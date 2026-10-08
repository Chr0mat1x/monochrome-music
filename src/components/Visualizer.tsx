import { useEffect, useRef } from 'react'
import { engine } from '../lib/audioEngine'
import { useStore } from '../store/useStore'

interface VisualizerProps {
  bars?: number
  className?: string
  mode?: 'bars' | 'mirror' | 'wave'
}

/**
 * Live spectrum drawn from the audio engine's analyser. Falls back to a
 * gentle animated idle state when nothing is playing.
 */
export function Visualizer({ bars = 48, className = '', mode = 'mirror' }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number>(0)
  const playing = useStore((s) => s.playing)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const data = new Uint8Array(engine.frequencyBinCount)
    const smoothed = new Float32Array(bars)
    let phase = 0

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      phase += 0.02
      const analyser = engine.getAnalyser()
      const isPlaying = engine.isPlaying()
      if (analyser && isPlaying) analyser.getByteFrequencyData(data)

      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#ffffff'

      const gap = 2
      const barW = Math.max(1, (width - gap * (bars - 1)) / bars)

      for (let i = 0; i < bars; i++) {
        let value: number
        if (analyser && isPlaying) {
          const idx = Math.floor((i / bars) * (data.length * 0.7))
          value = data[idx] / 255
        } else {
          value = 0.08 + 0.06 * Math.abs(Math.sin(phase + i * 0.35))
        }
        smoothed[i] = smoothed[i] * 0.72 + value * 0.28
        const v = Math.max(0.02, smoothed[i])

        const x = i * (barW + gap)
        if (mode === 'bars') {
          const h = v * height
          ctx.globalAlpha = 0.35 + v * 0.65
          ctx.fillRect(x, height - h, barW, h)
        } else if (mode === 'mirror') {
          const h = v * height * 0.5
          ctx.globalAlpha = 0.35 + v * 0.65
          ctx.fillRect(x, height / 2 - h, barW, h)
          ctx.fillRect(x, height / 2, barW, h)
        } else {
          const y = height / 2 + Math.sin(i * 0.4 + phase * 2) * (v * height * 0.45)
          ctx.globalAlpha = 0.5 + v * 0.5
          ctx.fillRect(x, y - 1, barW, 2)
        }
      }
      ctx.globalAlpha = 1
    }
    draw()

    return () => {
      cancelAnimationFrame(rafRef.current)
      ro.disconnect()
    }
  }, [bars, mode])

  return <canvas ref={canvasRef} className={className} data-playing={playing} />
}

/** Tiny 4-bar animated equaliser used on cards and the now-playing row. */
export function Equalizer({ active, className = '' }: { active: boolean; className?: string }) {
  return (
    <span className={`flex items-end gap-[2px] ${className}`} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[3px] origin-bottom rounded-sm bg-ink-100 ${
            active ? `animate-bar-${i + 1}` : ''
          }`}
          style={{ height: active ? 14 : 3 }}
        />
      ))}
    </span>
  )
}
