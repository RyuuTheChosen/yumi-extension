/**
 * AlertToast Component
 *
 * Displays Solana token alerts as toast notifications.
 */

import { useEffect, useState } from 'react'
import { useAlertStore } from '../../lib/stores/alert.store'
import type { TokenAlert, AlertSeverity } from '../../lib/stores/solana.types'

const TOAST_DURATION_MS = 8000
const MAX_VISIBLE_TOASTS = 3

interface ToastProps {
  alert: TokenAlert
  onDismiss: () => void
}

function getSeverityStyles(severity: AlertSeverity): string {
  switch (severity) {
    case 'high':
      return 'border-red-500 bg-gradient-to-br from-slate-900 to-red-950'
    case 'medium':
      return 'border-amber-500 bg-gradient-to-br from-slate-900 to-amber-950'
    case 'low':
      return 'border-blue-500 bg-gradient-to-br from-slate-900 to-blue-950'
  }
}

function getSeverityTextColor(severity: AlertSeverity): string {
  switch (severity) {
    case 'high':
      return 'text-red-400'
    case 'medium':
      return 'text-amber-400'
    case 'low':
      return 'text-blue-400'
  }
}

function Toast({ alert, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div
      className={`
        flex items-start gap-3 p-3 rounded-lg border shadow-lg
        animate-[slideIn_0.3s_ease-out]
        ${getSeverityStyles(alert.severity)}
      `}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-semibold text-sm text-white">{alert.tokenSymbol}</span>
          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/10 text-slate-400">
            {alert.severity}
          </span>
        </div>
        <p className="text-[13px] text-slate-400 leading-tight">{alert.message}</p>
        {alert.data.changePercent !== undefined && (
          <p className={`text-xs font-semibold mt-1 ${getSeverityTextColor(alert.severity)}`}>
            {alert.data.changePercent > 0 ? '+' : ''}
            {alert.data.changePercent.toFixed(1)}%
          </p>
        )}
      </div>
      <button
        className="text-slate-400 hover:text-white transition-colors p-1 text-sm leading-none"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        x
      </button>
    </div>
  )
}

export function AlertToast() {
  const { alerts, settings, dismissAlert, connect } = useAlertStore()
  const [visibleAlerts, setVisibleAlerts] = useState<TokenAlert[]>([])

  useEffect(() => {
    if (settings.enabled) {
      connect()
    }
  }, [settings.enabled, connect])

  useEffect(() => {
    setVisibleAlerts(alerts.slice(0, MAX_VISIBLE_TOASTS))
  }, [alerts])

  if (!settings.enabled || visibleAlerts.length === 0) {
    return null
  }

  return (
    <div className="fixed top-20 right-5 z-[10001] flex flex-col gap-2 max-w-[320px]">
      {visibleAlerts.map((alert) => (
        <Toast key={alert.id} alert={alert} onDismiss={() => dismissAlert(alert.id)} />
      ))}
    </div>
  )
}
