import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { authApi } from '../../api/endpoints'
import { errorMessage } from '../../api/http'
import { AccountReminderCard } from '../../components/layout/AccountReminderCard'

export const SUBSCRIPTION_KEY = ['billing', 'subscription'] as const

export function VerifyEmailAlert({ onDismiss }: { onDismiss: () => void }) {
  const resend = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => toast.success('Te enviamos un nuevo enlace. Revisa también la carpeta de spam.'),
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <AccountReminderCard title="Confirma tu correo" tone="warning" onDismiss={onDismiss}>
      Confirma tu correo electrónico con el enlace que te enviamos para recibir avisos de pagos y recuperar tu contraseña.{' '}
      <button type="button" className="font-medium underline" disabled={resend.isPending} onClick={() => resend.mutate()}>
        Reenviar enlace
      </button>
    </AccountReminderCard>
  )
}
