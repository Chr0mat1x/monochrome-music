import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { Cover } from '../components/Cover'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { MediaCard } from '../components/MediaCard'
import { SettingsPanel } from '../components/SettingsPanel'
import { IconHeart, IconPlay, IconPlus } from '../components/Icons'

type Tab = 'liked' | 'playlists' | 'recent' | 'settings'

export function Library() {
  const [tab, setTab] = useState<Tab>('liked')
  const liked = useStore((s) => s.liked)
  const playlists = useStore((s) => s.playlists)
  const recentlyPlayed = useStore((s) => s.recentlyPlayed)
  const playContext = useStore((s) => s.playContext)
  const createPlaylist = useStore((s) => s.createPlaylist)

  return (
    <div className="px-4 pb-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h1 className="text-3xl font-black tracking-tight text-ink-100">Медиатека</h1>
        <button
          className="flex items-center gap-2 rounded-full border border-ink-40 px-4 py-2 text-sm font-semibold text-ink-90 hover:border-ink-100"
          onClick={() => createPlaylist('Новый плейлист', 'Описание пока не задано', [])}
        >
          <IconPlus width={16} height={16} /> Плейлист
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['liked', `Избранное · ${liked.length}`],
            ['playlists', `Плейлисты · ${playlists.length}`],
            ['recent', `Недавно · ${recentlyPlayed.length}`],
            ['settings', 'Настройки'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={`chip ${tab === k ? 'chip-active' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'liked' && (
        <div className="mt-6">
          {liked.length === 0 ? (
            <Empty icon text="Пока пусто. Нажимайте на сердце рядом с треком." />
          ) : (
            <>
              <div className="mb-4 flex items-center gap-4">
                <button
                  className="grid h-14 w-14 place-items-center rounded-full bg-ink-100 text-ink-0 transition-transform hover:scale-105"
                  onClick={() => playContext(liked, 0)}
                  aria-label="Играть"
                >
                  <IconPlay width={22} height={22} />
                </button>
                <Link to="/liked" className="text-sm font-semibold text-ink-80 hover:text-ink-100">
                  Открыть страницу избранного →
                </Link>
              </div>
              <TrackListHeader />
              {liked.map((t, i) => (
                <TrackRow key={t.id} track={t} index={i} context={liked} showCover />
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'playlists' && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {playlists.map((p) => (
            <MediaCard
              key={p.id}
              to={`/playlist/${p.id}`}
              seed={p.id + p.name}
              artwork={p.tracks.find((t) => t.artwork)?.artwork ?? null}
              tone={38}
              title={p.name}
              subtitle={`${p.owned ? 'Мой' : 'Подборка'} · ${p.tracks.length} треков`}
              context={p.tracks}
            />
          ))}
          <button
            onClick={() => createPlaylist('Новый плейлист', 'Описание пока не задано', [])}
            className="flex aspect-auto flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-ink-30 p-6 text-ink-60 transition-colors hover:border-ink-100 hover:text-ink-100"
          >
            <IconPlus width={28} height={28} />
            <span className="text-sm">Создать плейлист</span>
          </button>
        </div>
      )}

      {tab === 'recent' && (
        <div className="mt-6">
          {recentlyPlayed.length === 0 ? (
            <Empty text="Здесь появятся треки, которые вы слушали." />
          ) : (
            <>
              <TrackListHeader />
              {recentlyPlayed.map((t, i) => (
                <TrackRow key={t.id} track={t} index={i} context={recentlyPlayed} showCover />
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="mt-6 max-w-xl">
          <SettingsPanel />
        </div>
      )}
    </div>
  )
}

function Empty({ text, icon = false }: { text: string; icon?: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-30 p-12 text-center">
      {icon && <IconHeart width={40} height={40} className="mx-auto text-ink-40" />}
      <p className="mt-3 text-sm text-ink-60">{text}</p>
    </div>
  )
}
