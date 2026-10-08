import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { generatePlaylist, parseMood } from '../lib/moodEngine'
import type { GeneratedPlaylist } from '../lib/moodEngine'
import { tracksByIds } from '../data/library'
import { TrackRow, TrackListHeader } from '../components/TrackRow'
import { Cover } from '../components/Cover'
import { IconCheck, IconPlay, IconSparkles } from '../components/Icons'

const QUICK_PROMPTS = [
  'мрачный техно для ночной поездки',
  'тёплый lo-fi для учёбы и работы',
  'спокойный эмбиент для медитации',
  'энергичный брейкбит для тренировки',
  'грустный нео-классик под дождь',
  'неоновый синтвейв, ретро 80-х',
  'эпичный пост-рок, стадионный',
  'тревожный дарквейв, готика',
  'лёгкий джаз-нуар, вечерний город',
  'космический дрон для сна',
]

export function Generate() {
  const [text, setText] = useState('')
  const [limit, setLimit] = useState(24)
  const [result, setResult] = useState<GeneratedPlaylist | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const navigate = useNavigate()

  const playContext = useStore((s) => s.playContext)
  const createPlaylist = useStore((s) => s.createPlaylist)

  const preview = text.trim() ? parseMood(text, limit) : null

  const run = () => {
    if (!text.trim()) return
    setBusy(true)
    setSaved(false)
    // brief delay so the analysis animation reads on screen
    window.setTimeout(() => {
      setResult(generatePlaylist(text, limit))
      setBusy(false)
    }, 650)
  }

  const save = () => {
    if (!result) return
    const id = createPlaylist(result.name, result.description, result.trackIds)
    setSaved(true)
    window.setTimeout(() => navigate(`/playlist/${id}`), 400)
  }

  const resultTracks = result ? tracksByIds(result.trackIds) : []

  return (
    <div className="px-4 pb-10 sm:px-6">
      <div className="pt-2">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-60">
          <IconSparkles width={15} height={15} /> генератор по настроению
        </div>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink-100 sm:text-4xl">
          Опишите настроение
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-60">
          Напишите состояние, место, время суток или жанр — движок разберёт описание по параметрам
          (энергия, светлотa, темп, жанр) и соберёт плейлист из каталога.
        </p>
      </div>

      <div className="mt-6 rounded-xl border border-ink-25 bg-ink-10 p-4 sm:p-6">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run()
          }}
          rows={3}
          placeholder="например: мрачный медленный эмбиент для ночной работы, без слов, спокойный…"
          className="w-full resize-none rounded-lg border border-ink-25 bg-ink-5 p-4 text-base leading-relaxed text-ink-95 outline-none transition-colors placeholder:text-ink-50 focus:border-ink-100"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-ink-50">Примеры:</span>
          {QUICK_PROMPTS.map((p) => (
            <button key={p} className="chip" onClick={() => setText(p)}>
              {p}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-ink-25 pt-4">
          <label className="flex items-center gap-3 text-sm text-ink-70">
            Треков:
            <input
              type="range"
              min={8}
              max={40}
              step={2}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="mono-range h-4 w-40"
              style={{ ['--fill' as any]: `${((limit - 8) / 32) * 100}%` }}
            />
            <span className="w-6 tabular-nums text-ink-100">{limit}</span>
          </label>

          <button
            onClick={run}
            disabled={!text.trim() || busy}
            className="ml-auto flex items-center gap-2 rounded-full bg-ink-100 px-5 py-2.5 text-sm font-bold text-ink-0 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconSparkles width={16} height={16} />
            {busy ? 'Анализирую…' : 'Сгенерировать'}
          </button>
        </div>
      </div>

      {/* live mood profile preview */}
      {preview && (
        <div className="mt-4 grid gap-3 rounded-xl border border-ink-25 bg-ink-10 p-4 sm:grid-cols-3">
          <MoodMeter label="Энергия" value={preview.energy} />
          <MoodMeter label="Светлотa настроения" value={preview.valence} />
          <div className="flex flex-col justify-center gap-1 text-sm">
            <div className="text-[11px] uppercase tracking-widest text-ink-50">Профиль</div>
            <div className="text-ink-80">
              {preview.bpm ? `≈ ${preview.bpm} BPM` : 'темп по умолчанию'}
              {preview.genres.length ? ` · ${preview.genres.join(', ')}` : ''}
              {preview.instrumental ? ' · инструментал' : ''}
            </div>
          </div>
        </div>
      )}

      {busy && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-ink-25 bg-ink-10 p-6">
          <span className="flex items-end gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`w-1 origin-bottom animate-bar-${(i % 4) + 1} rounded bg-ink-100`}
                style={{ height: 24 }}
              />
            ))}
          </span>
          <span className="text-sm text-ink-70">Разбираю описание и подбираю треки…</span>
        </div>
      )}

      {result && !busy && (
        <div className="mt-8 animate-fade-up">
          <div className="flex flex-col gap-5 rounded-xl bg-ink-10 p-4 sm:flex-row sm:p-5">
            <div className="w-full shrink-0 sm:w-52">
              <Cover
                seed={result.name + result.trackIds.join('')}
                tone={result.query.valence}
                rounded="rounded-lg"
                className="aspect-square w-full shadow-xl shadow-black/50"
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-50">
                Сгенерированный плейлист
              </span>
              <h2 className="mt-1 text-3xl font-black tracking-tight text-ink-100">{result.name}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-60">{result.description}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="chip">Энергия {result.query.energy}</span>
                <span className="chip">Светлотa {result.query.valence}</span>
                {result.query.bpm && <span className="chip">≈ {result.query.bpm} BPM</span>}
                {result.query.genres.map((g) => (
                  <span key={g} className="chip">
                    {g}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="flex items-center gap-2 rounded-full bg-ink-100 px-5 py-2.5 text-sm font-bold text-ink-0 transition-transform hover:scale-[1.02]"
                  onClick={() => playContext(result.trackIds, 0)}
                >
                  <IconPlay width={16} height={16} /> Играть
                </button>
                <button
                  className="flex items-center gap-2 rounded-full border border-ink-40 px-5 py-2.5 text-sm font-semibold text-ink-90 transition-colors hover:border-ink-100"
                  onClick={save}
                >
                  {saved ? <IconCheck width={16} height={16} /> : null}
                  {saved ? 'Сохранено' : 'Сохранить в медиатеку'}
                </button>
                <button
                  className="rounded-full px-4 py-2.5 text-sm font-medium text-ink-60 hover:text-ink-100"
                  onClick={run}
                >
                  Перегенерировать
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <TrackListHeader />
            {resultTracks.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                contextIds={result.trackIds}
                showCover
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MoodMeter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-widest text-ink-50">{label}</span>
        <span className="text-sm font-bold tabular-nums text-ink-100">{value}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-30">
        <div
          className="h-full rounded-full bg-ink-100 transition-[width] duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}
