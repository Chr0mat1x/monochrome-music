import { useEffect, useRef, useState } from 'react'

/**
 * Horizontal swipe between the mobile tabs.
 *
 * The bottom nav makes the app feel native on a phone, but reaching for it for
 * every page change does not; a swipe across the content is the gesture a phone
 * user actually tries. We only take over clearly-horizontal, reasonably long
 * gestures so vertical scrolling, carousels and the seek bar keep working.
 *
 * @param onSwipe called with -1 for "next tab", +1 for "previous tab".
 * @returns a ref to attach to the scroll container, and the direction of the
 *   last change so the new page can animate in from the right side.
 */
export function useSwipeTabs(onSwipe: (dir: -1 | 1) => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [dir, setDir] = useState<1 | -1>(1)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(min-width: 1024px)').matches) return

    let startX = 0
    let startY = 0
    let tracking = false

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      tracking = true
    }

    const end = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      // Ignore anything that is not a deliberate horizontal flick: a big
      // vertical component means the user is scrolling, and a small dx means a
      // tap or an accidental nudge.
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return
      const d: -1 | 1 = dx < 0 ? 1 : -1
      setDir(d)
      onSwipe(d)
    }

    const cancel = () => {
      tracking = false
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', end, { passive: true })
    el.addEventListener('touchcancel', cancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', cancel)
    }
  }, [onSwipe])

  return { ref, dir }
}
