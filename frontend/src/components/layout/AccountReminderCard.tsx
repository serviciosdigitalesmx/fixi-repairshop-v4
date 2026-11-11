import type { ReactNode } from 'react'
import { Card } from '../ui'

export function AccountReminderCard({ title, tone = 'info', onDismiss, children }: {
  title: string
  tone?: 'info' | 'warning' | 'danger'
  onDismiss: () => void
  children: ReactNode
}) {
  return (
    <Card className={`fx-account-reminder is-${tone}`} title={title} actions={
      <button type="button" className="fx-reminder-close" onClick={onDismiss} aria-label={`Cerrar aviso: ${title}`}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    }>
      {children}
    </Card>
  )
}
