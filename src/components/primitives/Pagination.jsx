import React from 'react'
import { buildPageRange } from '@/utils/format'

/**
 * Pagination bar.
 * @param {{ page: number, total: number, perPage: number, onPageChange: (p:number)=>void }} props
 */
export default function Pagination({ page, total, perPage = 20, onPageChange, onChange }) {
  onPageChange = onPageChange || onChange
  const totalPages = Math.ceil(total / perPage)
  if (totalPages <= 1) return null

  const range = buildPageRange(page, totalPages)
  const start = (page - 1) * perPage + 1
  const end   = Math.min(page * perPage, total)

  return (
    <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
      <span className="text-xs text-ink3">
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          className="btn btn-ghost btn-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        {range.map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-ink3 text-xs">…</span>
          ) : (
            <button
              key={p}
              className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          className="btn btn-ghost btn-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
      </div>
    </div>
  )
}
