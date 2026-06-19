import { useState, useMemo } from 'react'

/**
 * Generic paginator hook.
 *
 * @param {Array}  items    — full array to paginate
 * @param {number} pageSize — items per page (default 10)
 * @returns {{ page, pageCount, paginated, setPage, nextPage, prevPage, reset }}
 */
export function usePagination(items = [], pageSize = 10) {
  const [page, setPage] = useState(1)

  const pageCount = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  )

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  function nextPage() {
    setPage(p => Math.min(p + 1, pageCount))
  }

  function prevPage() {
    setPage(p => Math.max(p - 1, 1))
  }

  function reset() {
    setPage(1)
  }

  return { page, pageCount, paginated, setPage, nextPage, prevPage, reset }
}
