import { useEffect, useState } from 'react'
import { hasAudioServer, resetAudioServerCache } from '../lib/musicApi'
import { normalizeServerUrl, readServerUrl, writeServerUrl } from '../lib/serverConfig'

type Status = 'idle' | 'checking' | 'ok' | 'fail'

/**
 * Settings, currently just the companion-server address.
 *
 * The bundled app has no server of its own, so on a network that blocks the
 * music CDNs it needs one to stream through. Letting the user point the app at
 * a deployment (and remember it) is what makes full-length playback work there
 * without rebuilding the APK.
 */
export function SettingsPanel() {
  const [url, setUrl] = useState(() => readServerUrl())
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  // Probe the saved address once so the panel opens with a live verdict.
  useEffect(() => {
    void check(readServerUrl())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function check(value: string) {
    setStatus('checking')
    setError('')
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      setStatus('idle')
      return
    }
    resetAudioServerCache()
    writeServerUrl(normalized)
    const up = await hasAudioServer()
    setStatus(up ? 'ok' : 'fail')
  }

  function save() {
    const normalized = normalizeServerUrl(url)
    if (url.trim() && !normalized) {
      setError('Похоже, это не адрес. Пример: https://example.com')
      setStatus('idle')
      return
    }
    setUrl(normalized)
    void check(normalized)
  }

  function clear() {
    setUrl('')
    resetAudioServerCache()
    writeServerUrl('')
    setStatus('idle')
    setError('')
  }

  return (
    <div className="rounded-xl border border-ink-20 bg-ink-5 p-4">
      <h2 className="text-sm font-bold tracking-tight text-ink-100">Сервер</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-60">
        Адрес сервера, через который приложение качает полные треки. Нужен, если ваша
        сеть блокирует SoundCloud и каталоги напрямую. Оставьте пустым, чтобы играть
        напрямую с CDN.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          className="w-full rounded-lg border border-ink-25 bg-ink-10 px-3 py-2.5 text-sm text-ink-95 outline-none placeholder:text-ink-50 focus:border-ink-100"
        />
        <button
          onClick={save}
          disabled={status === 'checking'}
          className="shrink-0 rounded-full bg-ink-100 px-5 py-2.5 text-sm font-semibold text-ink-0 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === 'checking' ? 'Проверяю…' : 'Сохранить'}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-ink-100">{error}</p>}
      {status === 'ok' && <p className="mt-2 text-xs text-ink-70">Сервер отвечает — полные треки доступны.</p>}
      {status === 'fail' && (
        <p className="mt-2 text-xs text-ink-100">
          Сервер не ответил. Проверьте адрес — он должен быть доступен из этой сети.
        </p>
      )}

      {(url || readServerUrl()) && (
        <button onClick={clear} className="mt-3 text-xs font-semibold text-ink-60 hover:text-ink-100">
          Сбросить адрес
        </button>
      )}
    </div>
  )
}
