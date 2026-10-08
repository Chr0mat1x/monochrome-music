import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div>
        <div className="font-mono text-7xl font-black tracking-tighter text-ink-30">404</div>
        <h1 className="mt-4 text-2xl font-black text-ink-100">Страница не найдена</h1>
        <p className="mt-2 text-sm text-ink-60">Возможно, трек, альбом или артист был перемещён.</p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-ink-100 px-5 py-2.5 text-sm font-bold text-ink-0"
        >
          На главную
        </Link>
      </div>
    </div>
  )
}
