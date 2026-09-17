'use client'

import { useState } from 'react'
import { exportAuditLog } from '@/lib/actions/audit-actions'
import type { AuditLogFilters } from '@/lib/audit/audit-types'

export function AuditExportButton({ filters }: { filters: AuditLogFilters }) {
  const [loading, setLoading] = useState(false)

  async function handleExport() {
    setLoading(true)
    try {
      const result = await exportAuditLog(filters)
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      URL.revokeObjectURL(url)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button type="button" onClick={handleExport} disabled={loading} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
      {loading ? 'Exporting...' : 'Export CSV'}
    </button>
  )
}
