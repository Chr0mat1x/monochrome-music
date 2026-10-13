import { SettingsPanel } from '../components/SettingsPanel'

export function SettingsPage() {
  return (
    <div className="px-4 pb-10 sm:px-6">
      <h1 className="pt-2 text-3xl font-black tracking-tight text-ink-100">Настройки</h1>
      <div className="mt-6 max-w-xl">
        <SettingsPanel />
      </div>
    </div>
  )
}
