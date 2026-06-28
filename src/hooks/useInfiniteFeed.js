import { useState, useEffect, useRef, useCallback } from 'react'

// Infinite-scroll windowing for the Stream feed (replaces page-based slicing).
//
// Instead of rendering page N, we render the first `visibleCount` items and grow
// that window as a sentinel element near the bottom scrolls into view. An
// IntersectionObserver (passive, no scroll listeners) drives it, with a
// buffer-ahead `rootMargin` so the next batch starts loading BEFORE the user
// hits the end - the spinner barely flashes and scrolling feels seamless.
//
// Scale: the window only grows as the user scrolls, so the full sorted feed
// (which may be thousands of items) is computed once but only the cards the user
// has actually reached are ever mounted. Nothing is rendered up front, and there
// is no all-at-once page load - the heavy lifting stays bounded by scroll depth.
//
// Returns:
//   visibleCount - how many items to render (<= total)
//   sentinelRef  - attach to the bottom sentinel element (callback ref)
//   loadingMore  - true while the next batch is pending (show the spinner)
//   hasMore      - more items remain beyond the current window
//   ensureVisible(i) - grow the window so item index `i` is rendered (deep links)
export default function useInfiniteFeed(total, { batch = 8, rootMargin = '200px', delay = 350, resetKey } = {}) {
  const [visible, setVisible] = useState(batch)
  const [atEnd, setAtEnd] = useState(false)
  const ioRef = useRef(null)

  // Collapse the window back to one batch whenever the filter signature changes.
  useEffect(() => { setVisible(batch) }, [resetKey, batch])

  // Callback ref so the observer (re)attaches whenever the sentinel mounts -
  // robust to the feed mounting only after `fbReady` flips.
  const sentinelRef = useCallback(node => {
    if (ioRef.current) { ioRef.current.disconnect(); ioRef.current = null }
    if (node && typeof IntersectionObserver !== 'undefined') {
      ioRef.current = new IntersectionObserver(entries => setAtEnd(entries[0].isIntersecting), { rootMargin })
      ioRef.current.observe(node)
    }
  }, [rootMargin])

  useEffect(() => () => { if (ioRef.current) ioRef.current.disconnect() }, [])

  const hasMore = visible < total
  const loadingMore = atEnd && hasMore

  // Grow the window one batch at a time while the sentinel stays in view. The
  // short delay throttles bursts and lets the loading spinner register.
  useEffect(() => {
    if (!atEnd || visible >= total) return
    const t = setTimeout(() => setVisible(v => Math.min(v + batch, total)), delay)
    return () => clearTimeout(t)
  }, [atEnd, visible, total, batch, delay])

  const ensureVisible = useCallback(i => {
    setVisible(v => (i + 1 > v ? i + 1 + batch : v))
  }, [batch])

  return { visibleCount: Math.min(visible, total), sentinelRef, loadingMore, hasMore, ensureVisible }
}
