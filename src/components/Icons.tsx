import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (props: P) => ({
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const IconHome = (p: P) => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
)
export const IconSearch = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
export const IconLibrary = (p: P) => (
  <svg {...base(p)}><path d="M4 4v16M9 4v16" /><path d="m14 5 5 14" /></svg>
)
export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconHeart = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5c0 5-7 9.5-7 9.5Z" />
  </svg>
)
export const IconPlay = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M7 4.5v15l13-7.5z" /></svg>
)
export const IconPause = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>
)
export const IconNext = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M6 5v14l10-7z" /><rect x="17" y="5" width="2.4" height="14" rx="1" /></svg>
)
export const IconPrev = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><path d="M18 5v14L8 12z" /><rect x="4.6" y="5" width="2.4" height="14" rx="1" /></svg>
)
export const IconShuffle = (p: P) => (
  <svg {...base(p)}><path d="M3 6h4l4 6 4 6h4" /><path d="M3 18h4l2-3" /><path d="m14 6 3-3 3 3" transform="translate(0 0)" /><path d="M17 3v6" /></svg>
)
export const IconRepeat = (p: P) => (
  <svg {...base(p)}><path d="M4 12V9a4 4 0 0 1 4-4h10" /><path d="m15 2 3 3-3 3" /><path d="M20 12v3a4 4 0 0 1-4 4H6" /><path d="m9 22-3-3 3-3" /></svg>
)
export const IconRepeatOne = (p: P) => (
  <svg {...base(p)}><path d="M4 12V9a4 4 0 0 1 4-4h10" /><path d="m15 2 3 3-3 3" /><path d="M20 12v3a4 4 0 0 1-4 4H6" /><path d="m9 22-3-3 3-3" /><path d="M11.4 14v-3l-1 .8" strokeWidth="2" /></svg>
)
export const IconVolume = (p: P) => (
  <svg {...base(p)}><path d="M4 9v6h3l4 3V6L7 9z" /><path d="M15 9.5a3.5 3.5 0 0 1 0 5" /><path d="M17.5 7a7 7 0 0 1 0 10" /></svg>
)
export const IconVolumeMute = (p: P) => (
  <svg {...base(p)}><path d="M4 9v6h3l4 3V6L7 9z" /><path d="m16 10 4 4M20 10l-4 4" /></svg>
)
export const IconQueue = (p: P) => (
  <svg {...base(p)}><path d="M4 6h11M4 12h11M4 18h7" /><path d="M17 15v5l4-2.5z" fill="currentColor" stroke="none" /></svg>
)
export const IconDots = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
)
export const IconClock = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
)
export const IconSparkles = (p: P) => (
  <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M12 8.5 13.6 12 12 15.5 10.4 12z" fill="currentColor" stroke="none" /></svg>
)
export const IconChevron = (p: P) => (
  <svg {...base(p)}><path d="m9 6 6 6-6 6" /></svg>
)
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
)
export const IconExpand = (p: P) => (
  <svg {...base(p)}><path d="M9 3H3v6M15 21h6v-6M21 9V3h-6M3 15v6h6" /></svg>
)
export const IconClose = (p: P) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
)
export const IconBack = (p: P) => (
  <svg {...base(p)}><path d="m14 6-6 6 6 6" /></svg>
)
export const IconWave = (p: P) => (
  <svg {...base(p)}><path d="M3 12h2l2-5 3 10 3-14 3 12 2-3h3" /></svg>
)
export const IconMoon = (p: P) => (
  <svg {...base(p)}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>
)
export const IconSun = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
export const IconUser = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
)
export const IconDownload = (p: P) => (
  <svg {...base(p)}><path d="M12 3v11" /><path d="m7.5 9.5 4.5 4.5 4.5-4.5" /><path d="M4 20h16" /></svg>
)
export const IconListPlus = (p: P) => (
  <svg {...base(p)}><path d="M4 6h11M4 12h11M4 18h7" /><path d="M18 12v7M14.5 15.5h7" /></svg>
)
export const IconLink = (p: P) => (
  <svg {...base(p)}><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.6 1.6" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1.6-1.6" /></svg>
)
