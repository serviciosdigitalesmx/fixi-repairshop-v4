import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { billingApi } from '../../api/endpoints'
import { useSession } from '../../auth/session'
import { SUBSCRIPTION_KEY, VerifyEmailAlert } from '../../features/billing/shared'
import { AccountReminderCard } from './AccountReminderCard'

/** Dismissals last until this authenticated layout unmounts or the shop changes. */
export function SubscriptionBanner() {
  const { can } = useSession()
  const [dismissed, setDismissed] = useState<string[]>([])
  const sub = useQuery({ queryKey: SUBSCRIPTION_KEY, queryFn: billingApi.subscription, staleTime: 60_000, retry: false })
  const s = sub.data
  if (!s) return null

  const isAdmin = can('admin')
  const subscriptionId = `subscription:${s.status}`
  const showSubscription = ['Expired', 'PastDue', 'Trialing'].includes(s.status) && !dismissed.includes(subscriptionId)
  const showEmail = isAdmin && !s.emailVerified && !dismissed.includes('email')
  const dismiss = (id: string) => setDismissed(current => [...current, id])
  if (!showSubscription && !showEmail) return null

  const plansLink = isAdmin ? (
    <Link to="/billing" className="font-medium underline">
      Elegir un plan
    </Link>
  ) : (
    <span>Pídele a un administrador que elija un plan.</span>
  )

  return (
    <aside className="no-print fx-account-reminders" aria-label="Recordatorios de tu cuenta" aria-live="polite" aria-relevant="additions">
      {showSubscription && s.status === 'Expired' ? (
        <AccountReminderCard title="Cuenta en modo consulta" tone="danger" onDismiss={() => dismiss(subscriptionId)}>
          La prueba gratis o la suscripción terminó y la cuenta está en modo consulta. {plansLink}
        </AccountReminderCard>
      ) : showSubscription && s.status === 'PastDue' ? (
        <AccountReminderCard title="Revisa tu suscripción" tone="warning" onDismiss={() => dismiss(subscriptionId)}>
          No pudimos cobrar el último pago mensual. Revisa el medio de pago para no perder el acceso. {isAdmin ? plansLink : null}
        </AccountReminderCard>
      ) : showSubscription && s.status === 'Trialing' ? (
        <AccountReminderCard title="Prueba gratis" onDismiss={() => dismiss(subscriptionId)}>
          Prueba gratis: {s.trialDaysLeft === 1 ? 'te queda 1 día' : `te quedan ${s.trialDaysLeft} días`} con todos los módulos. {isAdmin ? plansLink : null}
        </AccountReminderCard>
      ) : null}
      {showEmail ? <VerifyEmailAlert onDismiss={() => dismiss('email')} /> : null}
    </aside>
  )
}
