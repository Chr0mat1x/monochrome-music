import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Player } from './components/Player'
import { MobileNav } from './components/MobileNav'
import { AuthPanel } from './components/AuthPanel'
import { useStore } from './store/useStore'
import { useSwipeTabs } from './lib/useSwipeTabs'
import { Home } from './pages/Home'
import { Search } from './pages/Search'
import { Generate } from './pages/Generate'
import { Wave } from './pages/Wave'
import { Library } from './pages/Library'
import { AlbumPage } from './pages/AlbumPage'
import { ArtistPage } from './pages/ArtistPage'
import { PlaylistPage } from './pages/PlaylistPage'
import { SharedPage } from './pages/SharedPage'
import { LikedSongs } from './pages/LikedSongs'
import { NotFound } from './pages/NotFound'

/** Tabs in bottom-nav order; a swipe moves one step through this list. */
const TAB_PATHS = ['/', '/search', '/wave', '/generate', '/library']

function ScrollReset() {
  const { pathname } = useLocation()
  useEffect(() => {
    const el = document.getElementById('main-scroll')
    if (el) el.scrollTo({ top: 0 })
  }, [pathname])
  return null
}

export default function App() {
  const [navOpen, setNavOpen] = useState(false)
  const restoreSession = useStore((s) => s.restoreSession)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Pull the account (and its library) in once, on start.
  useEffect(() => {
    void restoreSession()
  }, [restoreSession])

  const onSwipe = useCallback(
    (d: -1 | 1) => {
      const i = TAB_PATHS.indexOf(pathname)
      // Only between the five tabs: on an album, artist or shared page a swipe
      // would have no obvious destination, so it does nothing.
      if (i === -1) return
      const next = TAB_PATHS[i + d]
      if (next) navigate(next)
    },
    [pathname, navigate],
  )
  const { ref, dir } = useSwipeTabs(onSwipe)

  return (
    <div className="flex h-[100dvh] w-screen flex-col gap-2 p-2 lg:flex-row">
      {/* flat backdrop; the panes carry the design */}
      <div className="mono-ambient" aria-hidden="true" />

      {/* desktop sidebar */}
      <div className="hidden w-64 shrink-0 lg:block">
        <Sidebar />
      </div>

      {/* mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-72 animate-fade-up">
            <Sidebar onClose={() => setNavOpen(false)} />
          </div>
          <button
            className="flex-1 bg-black/60 backdrop-blur-md"
            onClick={() => setNavOpen(false)}
            aria-label="Закрыть меню"
          />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="glass relative min-h-0 flex-1 overflow-hidden rounded-2xl grain">
          <div id="main-scroll" ref={ref} className="h-full overflow-y-auto">
            <TopBar onOpenNav={() => setNavOpen(true)} />
            <ScrollReset />
            <div key={pathname} className={dir === 1 ? 'animate-tab-left' : 'animate-tab-right'}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/search" element={<Search />} />
                <Route path="/generate" element={<Generate />} />
                <Route path="/wave" element={<Wave />} />
                <Route path="/library" element={<Library />} />
                <Route path="/album/:id" element={<AlbumPage />} />
                <Route path="/artist/:name" element={<ArtistPage />} />
                <Route path="/playlist/:id" element={<PlaylistPage />} />
                <Route path="/s/:payload" element={<SharedPage />} />
                <Route path="/liked" element={<LikedSongs />} />
                <Route path="/auth" element={<AuthPanel />} />
                <Route path="/home" element={<Navigate to="/" replace />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </div>
        </div>
        <Player />
      </main>

      <MobileNav />
    </div>
  )
}
