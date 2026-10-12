import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Track } from '../types'
import { useReveal } from '../lib/useReveal'
import { Cover } from './Cover'
import { IconPause, IconPlay } from './Icons'
import { useStore } from '../store/useStore'

interface MediaCardProps {
  to: string
  seed: string
  artwork?: string | null
  tone?: number
  title: string
  subtitle: string
  context?: Track[]
  badge?: ReactNode
  circle?: boolean
  /** Position in its grid, used to stagger the reveal animation. */
  index?: number
}

export function MediaCard({ to, seed, artwork, tone = 40, title, subtitle, context, badge, circle = false, index = 0 }: MediaCardProps) {
  const playContext = useStore((s) => s.playContext)
  const currentId = useStore((s) => s.currentTrack?.id ?? null)
  const playing = useStore((s) => s.playing)
  const ref = useReveal<HTMLAnchorElement>(index)

  const containsCurrent = Boolean(context?.some((t) => t.id === currentId))
  const showPause = containsCurrent && playing

  const handlePlay = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (context?.length) playContext(context, 0)
  }

  return (
    <Link
      ref={ref}
      to={to}
      className="reveal group relative flex flex-col gap-3 rounded-lg bg-ink-10 p-3 transition-colors duration-300 hover:bg-ink-20"
    >
      <div className="relative">
        <Cover
          seed={seed}
          artwork={artwork}
          tone={tone}
          rounded={circle ? 'rounded-full' : 'rounded-md'}
          className="aspect-square w-full shadow-lg shadow-black/40 transition-transform duration-500 ease-out group-hover:-translate-y-1 group-hover:scale-[1.02]"
          alt={title}
        />
        {context && context.length > 0 && (
          <button
            onClick={handlePlay}
            className="press absolute bottom-2 right-2 grid h-11 w-11 translate-y-2 place-items-center rounded-full bg-ink-100 text-ink-0 opacity-0 shadow-xl transition-all duration-300 hover:scale-105 group-hover:translate-y-0 group-hover:opacity-100"
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
