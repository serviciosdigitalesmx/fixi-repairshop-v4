// Adapted from Kiranism/next-shadcn-dashboard-starter src/components/ui/card.tsx.
// MIT © 2023 Kiranism. See public/licenses/Kiranism.txt (included in the web build).
// Tailwind 4 utilities are expressed through scoped CSS for Fixi's Tailwind 3 / React 18 runtime.
import type { ComponentProps } from 'react'
import { cn } from '../../lib/cn'
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('cc-card', className)} {...props} />
}
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('cc-card-header', className)} {...props} />
}
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 data-slot="card-title" className={cn('cc-card-title', className)} {...props} />
}
export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('cc-muted', className)} {...props} />
}
export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('cc-card-content', className)} {...props} />
}
