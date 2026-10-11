import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { Player } from './components/Player'
import { MobileNav } from './components/MobileNav'
import { Home } from './pages/Home'
import { Search } from './pages/Search'
import { Generate } from './pages/Generate'
import { Wave } from './pages/Wave'
import { Library } from './pages/Library'
import { AlbumPage } from './pages/AlbumPage'
import { ArtistPage } from './pages/ArtistPage'
import { PlaylistPage } from './pages/PlaylistPage'
import { LikedSongs } from './pages/LikedSongs'
import { NotFound } from './pages/NotFound'

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

  return (
    <div className="flex h-[100dvh] w-screen flex-col gap-2 p-2 lg:flex-row">
      {/* ambient monochrome light the glass panes blur */}
      <div className="mono-ambient" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

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
          <div id="main-scroll" className="h-full overflow-y-auto">
            <TopBar onOpenNav={() => setNavOpen(true)} />
            <ScrollReset />
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/search" element={<Search />} />
              <Route path="/generate" element={<Generate />} />
              <Route path="/wave" element={<Wave />} />
              <Route path="/library" element={<Library />} />
              <Route path="/album/:id" element={<AlbumPage />} />
              <Route path="/artist/:name" element={<ArtistPage />} />
              <Route path="/playlist/:id" element={<PlaylistPage />} />
              <Route path="/liked" element={<LikedSongs />} />
              <Route path="/home" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </div>
        <Player />
      </main>

      <MobileNav />
    </div>
  )
}
