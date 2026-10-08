import { useMemo, useState } from 'react'

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

type Variant = 'rings' | 'grid' | 'wave' | 'burst' | 'blocks' | 'scan'
const VARIANTS: Variant[] = ['rings', 'grid', 'wave', 'burst', 'blocks', 'scan']

/** Deterministic monochrome SVG art — used when no real artwork exists. */
function GenerativeCover({
  seed,
  tone,
  rounded,
  className,
}: {
  seed: string
  tone: number
  rounded: string
  className: string
}) {
  const art = useMemo(() => {
    const h = hash(seed)
    let a = h
    const rnd = () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const variant = VARIANTS[h % VARIANTS.length]
    const gid = `g-${h.toString(36)}`
    const light = Math.max(0, Math.min(100, tone)) / 100
    const bgTop = Math.round(6 + light * 10)
    const bgBottom = Math.round(2 + light * 4)
    const elements: JSX.Element[] = []

    if (variant === 'rings') {
      const cx = 20 + rnd() * 60
      const cy = 20 + rnd() * 60
      for (let i = 0; i < 7; i++) {
        elements.push(
          <circle key={i} cx={cx} cy={cy} r={6 + i * (5 + rnd() * 4)} fill="none" stroke="#fff"
            strokeOpacity={0.75 - i * 0.09} strokeWidth={0.6 + rnd() * 1.4} />,
        )
      }
    } else if (variant === 'grid') {
      const cols = 4 + Math.floor(rnd() * 3)
      const cell = 100 / cols
      for (let x = 0; x < cols; x++)
        for (let y = 0; y < cols; y++) {
          if (rnd() > 0.55) continue
          elements.push(<rect key={`${x}-${y}`} x={x * cell + 1} y={y * cell + 1} width={cell - 2}
            height={cell - 2} fill="#fff" fillOpacity={0.12 + rnd() * 0.7} />)
        }
    } else if (variant === 'wave') {
      for (let i = 0; i < 9; i++) {
        const y = 8 + i * 10
        const amp = 2 + rnd() * 6
        let d = `M0 ${y}`
        for (let x = 0; x <= 100; x += 10)
          d += ` Q ${x + 5} ${y + ((x / 10) % 2 === 0 ? -amp : amp)} ${x + 10} ${y}`
        elements.push(<path key={i} d={d} fill="none" stroke="#fff" strokeOpacity={0.3 + rnd() * 0.5}
          strokeWidth={0.7 + rnd() * 1.6} />)
      }
    } else if (variant === 'burst') {
      const cx = 30 + rnd() * 40
      const cy = 30 + rnd() * 40
      const rays = 14 + Math.floor(rnd() * 14)
      for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2
        const len = 30 + rnd() * 55
        elements.push(<line key={i} x1={cx} y1={cy} x2={cx + Math.cos(ang) * len} y2={cy + Math.sin(ang) * len}
          stroke="#fff" strokeOpacity={0.15 + rnd() * 0.5} strokeWidth={0.6 + rnd() * 1.8} />)
      }
      elements.push(<circle key="c" cx={cx} cy={cy} r={4 + rnd() * 5} fill="#fff" fillOpacity={0.9} />)
    } else if (variant === 'blocks') {
      let y = 0
      while (y < 100) {
        const hgt = 4 + rnd() * 14
        elements.push(<rect key={y} x={0} y={y} width={100} height={hgt - 1.5} fill="#fff"
          fillOpacity={0.06 + rnd() * 0.55} />)
        y += hgt
      }
    } else {
      for (let i = 0; i < 46; i++)
        elements.push(<line key={i} x1={0} y1={i * 2.2 + 1} x2={100} y2={i * 2.2 + 1} stroke="#fff"
          strokeOpacity={rnd() * 0.4} strokeWidth={0.4 + rnd() * 0.9} />)
      elements.push(<rect key="bar" x={0} y={40 + rnd() * 20} width={100} height={1.5} fill="#fff" fillOpacity={0.95} />)
    }
    return { bgTop, bgBottom, gid, elements }
  }, [seed, tone])

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className={`${rounded} ${className}`} aria-hidden>
      <defs>
        <linearGradient id={art.gid} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={`rgb(${art.bgTop} ${art.bgTop} ${art.bgTop})`} />
          <stop offset="100%" stopColor={`rgb(${art.bgBottom} ${art.bgBottom} ${art.bgBottom})`} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${art.gid})`} />
      {art.elements}
    </svg>
  )
}

interface CoverProps {
  seed: string
  artwork?: string | null
  tone?: number
  className?: string
  rounded?: string
  alt?: string
}

/** Real cover art when available, monochrome generative art otherwise. */
export function Cover({ seed, artwork, tone = 40, className = '', rounded = 'rounded-md', alt = '' }: CoverProps) {
  const [failed, setFailed] = useState(false)
  const showImage = artwork && !failed

  return (
    <div className={`relative overflow-hidden ${rounded} ${className} bg-ink-15`}>
      {showImage ? (
        <img
          src={artwork}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover ${rounded}`}
        />
      ) : (
        <GenerativeCover seed={seed} tone={tone} rounded={rounded} className="h-full w-full" />
      )}
    </div>
  )
}
