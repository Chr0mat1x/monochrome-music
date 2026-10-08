import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { IconMoon } from './Icons'

const OPTIONS = [5, 15, 30, 45, 60]

function fmtRemaining(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Sleep timer: stop playback after a chosen number of minutes. */
export function SleepTimer() {
  const sleepAt = useStore((s) => s.sleepAt)
  const setSleepTimer = useStore((s) => s.setSleepTimer)
  const [open, setOpen] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!sleepAt) {
      setRemaining(0)
      return
    }
    const tick = () => setRemaining(sleepAt - Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [sleepAt])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        className={`icon-btn h-8 w-8 ${sleepAt ? 'text-ink-100' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Таймер сна"
        title={sleepAt ? `Стоп через ${fmtRemaining(remaining)}` : 'Таймер сна'}
      >
        <IconMoon width={18} height={18} />
      </button>
      {sleepAt && (
        <span className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-ink-100 px-1.5 text-[9px] font-bold tabular-nums text-ink-0">
          {fmtRemaining(remaining)}
        </span>
      )}

      {open && (
        <div className="absolute bottom-10 right-0 z-50 w-44 overflow-hidden rounded-lg border border-ink-30 bg-ink-10 py-1 text-sm shadow-2xl shadow-black">
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-ink-50">Таймер сна</p>
          {OPTIONS.map((m) => (
            <button
              key={m}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-ink-90 hover:bg-ink-20"
              onClick={() => {
                setSleepTimer(m)
                setOpen(false)
              }}
            >
              {m} мин
            </button>
          ))}
          <div className="my-1 h-px bg-ink-25" />
          <button
            className="w-full px-3 py-1.5 text-left text-ink-70 hover:bg-ink-20 disabled:opacity-40"
            disabled={!sleepAt}
            onClick={() => {
              setSleepTimer(null)
              setOpen(false)
            }}
          >
            Выключить
          </button>
        </div>
      )}
    </div>
  )
}
