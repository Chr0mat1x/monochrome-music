import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Track } from '../types'
import { useStore } from '../store/useStore'
import { downloadTrack } from '../lib/download'
import { upgradeToFullTrack } from '../lib/musicApi'
import { IconCheck, IconDownload, IconHeart, IconListPlus, IconPlus, IconQueue, IconTrash, IconWave } from './Icons'

interface TrackMenuProps {
  track: Track
  x: number
  y: number
  onClose: () => void
  onRemove?: () => void
}

export function TrackMenu({ track, x, y, onClose, onRemove }: TrackMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [subOpen, setSubOpen] = useState(false)
  const playlists = useStore((s) => s.playlists)
  const liked = useStore((s) => s.liked.some((t) => t.id === track.id))
  const toggleLike = useStore((s) => s.toggleLike)
  const enqueue = useStore((s) => s.enqueue)
  const playNext = useStore((s) => s.playNext)
  const addToPlaylist = useStore((s) => s.addToPlaylist)
  const createPlaylist = useStore((s) => s.createPlaylist)
  const playTrack = useStore((s) => s.playTrack)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', handle)
    window.addEventListener('keydown', esc)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('mousedown', handle)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const ownedPlaylists = playlists.filter((p) => p.owned)
  const left = Math.min(x + 8, window.innerWidth - 240)
  const top = Math.min(y + 4, window.innerHeight - 320)

  return createPortal(
    <div
      ref={ref}
      style={{ left, top }}
      className="glass-menu fixed z-50 w-56 animate-fade-up overflow-hidden rounded-xl py-1 text-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-ink-90 hover:bg-ink-20"
        onClick={() => {
          playTrack(track)
          onClose()
        }}
      >
        <span className="w-4" />
        Играть
      </button>
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-ink-90 hover:bg-ink-20"
        onClick={() => {
          playNext(track)
          onClose()
        }}
      >
        <IconListPlus width={16} height={16} />
        Играть следующим
      </button>
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-ink-90 hover:bg-ink-20"
        onClick={() => {
          enqueue(track)
          onClose()
        }}
      >
        <IconQueue width={16} height={16} />
        В конец очереди
      </button>
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-ink-90 hover:bg-ink-20"
        onClick={() => {
          toggleLike(track)
          onClose()
        }}
      >
        <IconHeart filled={liked} width={16} height={16} />
        {liked ? 'Убрать из избранного' : 'В избранное'}
      </button>

      {track.preview && (
        <button
          className="flex w-full items-center gap-3 px-3 py-2 text-left text-ink-100 hover:bg-ink-20"
          onClick={() => {
            void upgradeToFullTrack(track).then((full) => {
              if (full) playTrack(full)
            })
            onClose()
          }}
        >
          <IconWave width={16} height={16} />
          Слушать полную версию
        </button>
      )}

      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-ink-90 hover:bg-ink-20"
        onClick={() => {
          void downloadTrack(track).catch(() => {})
          onClose()
        }}
      >
        <IconDownload width={16} height={16} />
        {track.source === 'youtube' ? 'Открыть на YouTube' : track.preview ? 'Скачать превью' : 'Скачать трек'}
      </button>

      <div className="my-1 h-px bg-ink-25" />

      <div className="relative">
        <button
          className="flex w-full items-center justify-between px-3 py-2 text-left text-ink-90 hover:bg-ink-20"
          onClick={() => setSubOpen((v) => !v)}
        >
          <span className="flex items-center gap-3">
            <IconPlus width={16} height={16} />
            Добавить в плейлист
          </span>
          <span className="text-ink-60">›</span>
        </button>
        {subOpen && (
          <div className="mx-2 mb-1 max-h-56 overflow-y-auto rounded-md border border-ink-25 bg-ink-5">
            {ownedPlaylists.length === 0 && <div className="px-3 py-2 text-xs text-ink-60">Нет своих плейлистов</div>}
            {ownedPlaylists.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-ink-80 hover:bg-ink-20"
                onClick={() => {
                  addToPlaylist(p.id, track)
                  onClose()
                }}
              >
                <span className="truncate">{p.name}</span>
                {p.tracks.some((t) => t.id === track.id) && <IconCheck width={14} height={14} />}
              </button>
            ))}
            <button
              className="flex w-full items-center gap-2 border-t border-ink-25 px-3 py-2 text-left text-xs text-ink-100 hover:bg-ink-20"
              onClick={() => {
                createPlaylist('Новый плейлист', '', [track])
                onClose()
              }}
            >
              <IconPlus width={14} height={14} /> Новый плейлист
            </button>
          </div>
        )}
      </div>

      {onRemove && (
        <>
          <div className="my-1 h-px bg-ink-25" />
          <button
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-ink-80 hover:bg-ink-20"
            onClick={() => {
              onRemove()
              onClose()
            }}
          >
            <IconTrash width={16} height={16} />
            Удалить из этого плейлиста
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
