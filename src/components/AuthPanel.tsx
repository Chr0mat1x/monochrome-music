import { useState } from 'react'
import { useStore } from '../store/useStore'
import { IconClose } from './Icons'

type Mode = 'login' | 'register'

/**
 * Email sign-in / sign-up. Each account keeps its own likes and playlists.
 */
export function AuthPanel({ onClose }: { onClose?: () => void }) {
  const user = useStore((s) => s.user)
  const busy = useStore((s) => s.authBusy)
  const error = useStore((s) => s.authError)
  const signIn = useStore((s) => s.signIn)
  const signUp = useStore((s) => s.signUp)
  const signOut = useStore((s) => s.signOut)

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  if (user) {
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-10">
        <div className="glass rounded-2xl p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-ink-25 text-lg font-black text-ink-100">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <h1 className="mt-4 text-lg font-bold text-ink-100">{user.name}</h1>
          <p className="mt-1 text-sm text-ink-60">{user.email}</p>
          <p className="mt-4 text-xs text-ink-50">
            Ваши плейлисты, избранное и история привязаны к этому аккаунту.
          </p>
          <button
            className="mt-6 w-full rounded-full border border-ink-30 py-2.5 text-sm font-medium text-ink-90 transition-colors hover:border-ink-100"
            onClick={() => {
              void signOut()
              onClose?.()
            }}
          >
            Выйти
          </button>
        </div>
      </div>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'login') void signIn(email, password)
    else void signUp(email, password, name)
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-10">
      <div className="glass relative rounded-2xl p-6">
        {onClose && (
          <button className="icon-btn absolute right-3 top-3 h-8 w-8" onClick={onClose} aria-label="Закрыть">
            <IconClose width={18} height={18} />
          </button>
        )}
        <h1 className="text-xl font-black tracking-tight text-ink-100">
          {mode === 'login' ? 'Вход' : 'Создать аккаунт'}
        </h1>
        <p className="mt-1 text-sm text-ink-60">
          {mode === 'login'
            ? 'Войдите, чтобы вернуться к своим плейлистам.'
            : 'Свои плейлисты, избранное и история — на любой устройство.'}
        </p>

        <form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
          {mode === 'register' && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя"
              autoComplete="nickname"
              className="w-full rounded-lg border border-ink-25 bg-ink-10 px-3 py-2.5 text-sm text-ink-95 outline-none placeholder:text-ink-50 focus:border-ink-100"
            />
          )}
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
            placeholder="Почта"
            autoComplete="email"
            className="w-full rounded-lg border border-ink-25 bg-ink-10 px-3 py-2.5 text-sm text-ink-95 outline-none placeholder:text-ink-50 focus:border-ink-100"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            placeholder="Пароль"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            className="w-full rounded-lg border border-ink-25 bg-ink-10 px-3 py-2.5 text-sm text-ink-95 outline-none placeholder:text-ink-50 focus:border-ink-100"
          />

          {error && <p className="text-xs text-ink-100">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 w-full rounded-full bg-ink-100 py-2.5 text-sm font-bold text-ink-0 transition-opacity disabled:opacity-50"
          >
            {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <button
          className="mt-4 w-full text-center text-xs text-ink-60 transition-colors hover:text-ink-100"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
        </button>
      </div>
    </div>
  )
}
