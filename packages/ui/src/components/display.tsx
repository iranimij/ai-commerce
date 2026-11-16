import type { ReactNode } from 'react'
import { cx } from './provider.js'

const TONES = {
  info: 'border-info text-info',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
}

export interface AlertProps {
  tone: keyof typeof TONES
  title?: ReactNode
  children: ReactNode
}

/** Warnings and errors interrupt a screen reader; info and success wait their turn. */
export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cx('rounded-ui border border-s-4 bg-surface px-4 py-3', TONES[tone])}
    >
      {title !== undefined && <p className="font-semibold">{title}</p>}
      <div className="text-sm text-fg">{children}</div>
    </div>
  )
}

export interface CardProps {
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

export function Card({ title, children, footer }: CardProps) {
  return (
    <section className="flex flex-col gap-4 rounded-ui-lg border border-border bg-surface p-6">
      {title !== undefined && <h2 className="text-lg font-semibold">{title}</h2>}
      <div>{children}</div>
      {footer !== undefined && <div className="flex justify-end gap-2">{footer}</div>}
    </section>
  )
}

export interface StepperProps {
  /** Names the list for screen readers, e.g. "Setup steps". */
  label: string
  steps: { id: string; label: ReactNode }[]
  current: string
}

export function Stepper({ label, steps, current }: StepperProps) {
  const at = steps.findIndex((s) => s.id === current)
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap gap-4">
        {steps.map((s, i) => (
          <li
            key={s.id}
            aria-current={i === at ? 'step' : undefined}
            className={cx(
              'flex items-center gap-2 text-sm',
              i === at ? 'font-semibold text-fg' : 'text-muted',
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                'grid size-6 place-items-center rounded-full border',
                i < at && 'border-accent bg-accent text-accent-fg',
                i === at && 'border-accent text-accent',
                i > at && 'border-border',
              )}
            >
              {i < at ? '✓' : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-ui-lg border border-dashed border-border p-10 text-center">
      <p className="font-semibold">{title}</p>
      {description !== undefined && <p className="text-sm text-muted">{description}</p>}
      {action}
    </div>
  )
}
