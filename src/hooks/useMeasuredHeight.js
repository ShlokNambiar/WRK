import { useEffect, useRef, useState } from 'react'

// Measure an element's rendered height and keep it current on resize. Used so a
// screen's absolutely-positioned header can hand its real height to the scroller
// below it, instead of a hand-tuned magic constant that clips under OS
// large-text or browser zoom. Returns [ref, height]; height is 0 until measured,
// so callers fall back to their constant for the first paint (and SSR).
export function useMeasuredHeight() {
  const ref = useRef(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setHeight(el.getBoundingClientRect().height)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, height]
}
