import { useEffect, useMemo, useState } from 'react'
import type { Track } from '../types'
import { useStore } from '../store/useStore'
import { buildTaste } from '../lib/wave'
import { Visualizer } from '../components/Visualizer'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { IconPlay, IconPause, IconWave, IconSparkles } from '../components/Icons'

const SEEDS = [
  'спокойное утро',
  'мрачный ночной город',
  'энергия для тренировки',
  'фокус и работа',
  'меланхолия под дождь',
  'лёгкий вечерний вайб',
]

/**
 * "Моя волна" — an endless personal stream. With no account to learn from, the
 * taste is read from what the listener liked and played; a typed mood blends
 * into that profile and steers the next batch.
 */
export function Wave() {
  const liked = useStore((s) => s.liked)
  const recentlyPlayed = useStore((s) => s.recentlyPlayed)
  const waveMode = useStore((s) => s.waveMode)
  const waveSeed = useStore((s) => s.waveSeed)
  const waveLoading = useStore((s) => s.waveLoading)
  const queue = useStore((s) => s.queue)
  const queueIndex = useStore((s) => s.queueIndex)
  const currentTrack = useStore((s) => s.currentTrack)
  const playing = useStore((s) => s.playing)

  const startWave = useStore((s) => s.startWave)
  const stopWave = useStore((s) => s.stopWave)
  const setWaveSeed = useStore((s) => s.setWaveSeed)
  const extendWave = useStore((s) => s.extendWave)
  const togglePlay = useStore((s) => s.togglePlay)

  const [draft, setDraft] = useState(waveSeed)

  useEffect(() => setDraft(waveSeed), [waveSeed])

  const taste = useMemo(() => buildTaste(liked, recentlyPlayed), [liked, recentlyPlayed])

  const isActive = waveMode && !!currentTrack
  const upcoming: Track[] = isActive ? queue.slice(queueIndex + 1) : []

  const launch = () => {
    void startWave(draft.trim())
    if (isActive) window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="px-4 pb-10 sm:px-6">
      <div className="relative mt-2 overflow-hidden rounded-2xl border border-ink-25 bg-ink-10">
        {/* The wave itself: a live monochrome spectrum behind the hero. */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.14]">
          <Visualizer bars={72} mode="wave" className="h-full w-full" />
        </div>

        <div className="relative p-5 sm:p-8">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-60">
            <IconWave width={15} height={15} /> персональный поток
          </div>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-ink-100 sm:text-5xl">Моя волна</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-60">
            Бесконечный поток, который подстраивается под вас. Он читает лайки и историю прослушиваний,
            добавляет треки на лету и никогда не повторяется. Опишите настроение — и волна уйдёт в нужную сторону.
          </p>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && launch()}
              placeholder="настроение: мрачный ночной город…"
              className="w-full flex-1 rounded-full border border-ink-25 bg-ink-5 px-5 py-3 text-sm text-ink-95 outline-none transition-colors placeholder:text-ink-50 focus:border-ink-100"
            />
            <button
              onClick={launch}
              disabled={waveLoading}
              className="flex shrink-0 items-center justify-center gap-2 rounded-full bg-ink-100 px-6 py-3 text-sm font-bold text-ink-0 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isActive && playing ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}
              {waveLoading ? 'Собираю волну…' : isActive ? 'Новая волна' : 'Включить волну'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-ink-50">Настроение:</span>
            {SEEDS.map((s) => (
              <button key={s} className="chip" onClick={() => { setDraft(s); void startWave(s) }}>
                {s}
              </button>
            ))}
            {isActive && (
              <button
                className="ml-auto rounded-full px-3 py-1.5 text-xs font-medium text-ink-60 hover:text-ink-100"
                onClick={() => { togglePlay() }}
              >
                Пауза / продолжить
              </button>
            )}
          </div>

          {isActive && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-25 pt-4">
              <span className="chip">Энергия {taste.energy}</span>
              <span className="chip">Настроение {taste.valence}</span>
              <span className="chip">≈ {taste.bpm} BPM</span>
              {taste.genres.slice(0, 3).map((g) => (
                <span key={g} className="chip">{g}</span>
              ))}
              {!taste.personal && (
                <span className="chip" title="Волна станет точнее, когда вы полайкаете треки">
                  <IconSparkles width={12} height={12} /> волна учится
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {!isActive && !waveLoading && (
        <div className="mt-8 rounded-xl border border-ink-25 bg-ink-10 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-50">Как это работает</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-70">
            <li>— Лайкайте и слушайте: волна собирает профиль по энергии, настроению, темпу и жанрам.</li>
            <li>— Движок ищет реальные треки в Deezer, iTunes и Audius и ранжирует их под ваш вкус.</li>
            <li>— Поток не кончается: следующая партия подгружается до того, как доиграет текущая.</li>
          </ul>
        </div>
      )}

      {isActive && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-ink-100">Дальше в волне</h2>
            <button className="text-xs font-medium uppercase tracking-widest text-ink-60 hover:text-ink-100" onClick={() => void stopWave()}>
              Остановить
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-ink-60">Волна догружает следующие треки…</p>
          ) : (
            <>
              <TrackListHeader />
              {upcoming.map((t, i) => (
                <TrackRow key={`${t.id}-${i}`} track={t} index={queueIndex + 1 + i} context={queue} showCover />
              ))}
            </>
          )}
          <button
            onClick={() => void extendWave()}
            disabled={waveLoading}
            className="mt-4 w-full rounded-xl border border-ink-25 py-3 text-sm font-medium text-ink-70 transition-colors hover:border-ink-100 hover:text-ink-100 disabled:opacity-40"
          >
            {waveLoading ? 'Загружаю ещё…' : 'Добавить ещё треки'}
          </button>
        </div>
      )}
    </div>
  )
}
