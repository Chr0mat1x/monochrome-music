import { useState } from 'react'
import type { Playlist, Track } from '../types'
import { copyText, playlistShareLink, trackShareLink } from '../lib/share'
import { IconCheck, IconLink } from './Icons'

type Props =
  | { kind: 'track'; track: Track; className?: string; label?: string }
  | { kind: 'playlist'; playlist: Playlist; className?: string; label?: string }

/** Copy a permanent share link to the clipboard, with a short "скопировано" state. */
export function ShareButton(props: Props) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')

  const share = async () => {
    const url = props.kind === 'track' ? await trackShareLink(props.track) : await playlistShareLink(props.playlist)
    // Prefer the native share sheet on phones; fall back to the clipboard.
    if (props.kind === 'track' && navigator.share) {
      try {
        await navigator.share({ title: `${props.track.artist} — ${props.track.title}`, url })
        return
      } catch {
        /* the listener dismissed the sheet — fall through to copying */
      }
    }
    const ok = await copyText(url)
    setState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setState('idle'), 1800)
  }

  const label = props.label ?? 'Поделиться'
  return (
    <button
      className={
        props.className ??
        'flex items-center gap-2 rounded-full border border-ink-40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-ink-80 hover:border-ink-100'
      }
      onClick={() => void share()}
      aria-label={label}
      title="Скопировать постоянную ссылку"
    >
      {state === 'ok' ? <IconCheck width={15} height={15} /> : <IconLink width={15} height={15} />}
      {state === 'ok' ? 'Ссылка скопирована' : state === 'fail' ? 'Не удалось' : label}
    </button>
  )
}
