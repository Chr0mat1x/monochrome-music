import { useEffect, useRef } from 'react'

/**
 * Fade-and-rise an element the first time it scrolls into view.
 *
 * Returns a ref to attach to the element. `index` staggers a list: each item
 * waits a little longer than the one before it, so a page settles in as a
 * ripple instead of one block. The delay is capped so a long list does not
 * leave the last rows waiting seconds to appear.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(index = 0, step = 55) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('reveal-in')
      return
    }
    el.style.setProperty('--reveal-delay', `${Math.min(index * step, 480)}ms`)
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('reveal-in')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [index, step])

  return ref
}
