import React from 'react'
import { cn } from '@/utils/cn'

// Thin canonical table wrapper. Pairs the existing `.tbl` styling with the
// `.tbl-wrap` scroll container so wide tables (GradesTab, StudentsTab) scroll
// horizontally on phones instead of clipping. Pass `minWidth` to force a scroll
// threshold; everything inside is plain <thead>/<tbody> markup, so existing
// table bodies drop in unchanged.
//
// Props:
//   minWidth   px width below which the wrapper scrolls horizontally (optional)
//   stickyFirst  pin the first column (header + cells) for wide grids
//   ...props   forwarded to the <table>
export default function DataTable({ minWidth, stickyFirst = false, className, children, ...props }) {
  return (
    <div className="tbl-wrap">
      <table
        className={cn('tbl', stickyFirst && 'tbl--sticky-first', className)}
        style={minWidth ? { minWidth } : undefined}
        {...props}
      >
        {children}
      </table>
    </div>
  )
}
