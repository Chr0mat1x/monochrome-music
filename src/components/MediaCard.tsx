import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Cover } from './Cover'
import { IconPause, IconPlay } from './Icons'
import { useStore } from '../store/useStore'

interface MediaCardProps {
  to: string
  seed: string
  tone?: number
  title: string
  subtitle: string
  contextIds?: string[]
  badge?: ReactNode
  circle?: boolean
  onPlay?: () => void
}

export function MediaCard({
  to,
  seed,
  tone = 40,
  title,
  subtitle,
  contextIds,
  badge,
  circle = false,
  onPlay,
}: MediaCardProps) {
  const playContext = useStore((s) => s.playContext)
  const currentId = useStore((s) => s.currentTrackId)
  const playing = useStore((s) => s.playing)

  const containsCurrent = Boolean(contextIds?.includes(currentId ?? ''))
  const showPause = containsCurrent && playing

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onPlay) onPlay()
    else if (contextIds?.length) playContext(contextIds, 0)
  }

  return (
    <Link
      to={to}
      className="group relative flex flex-col gap-3 rounded-lg bg-ink-10 p-3 transition-colors duration-300 hover:bg-ink-20"
    >
      <div className="relative">
        <Cover
          seed={seed}
          tone={tone}
          rounded={circle ? 'rounded-full' : 'rounded-md'}
          className="aspect-square w-full shadow-lg shadow-black/40"
        />
        {(contextIds?.length || onPlay) && (
          <button
            onClick={handlePlay}
            className="absolute bottom-2 right-2 grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-ink-100 text-ink-0 opacity-0 shadow-xl transition-all duration-300 hover:scale-105 group-hover:translate-y-0 group-hover:opacity-100"
            aria-label={showPause ? 'Пауза' : 'Играть'}
          >
            {showPause ? <IconPause width={18} height={18} /> : <IconPlay width={18} height={18} />}
          </button>
        )}
        {badge}
      </div>
      <div className="min-w-0">
        <div className="truncate font-semibold text-ink-95">{title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-60">{subtitle}</div>
      </div>
    </Link>
  )
}
