export function formatDuration(sec: number): string {
  if (!sec || !Number.isFinite(sec)) return '—:—'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatTotal(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} мин`
  const h = Math.floor(m / 60)
  return `${h} ч ${m % 60} мин`
}

export function formatMonthlyLike(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} млн`
  if (n >= 1_000) return `${Math.round(n / 1_000)} тыс.`
  return `${n}`
}
