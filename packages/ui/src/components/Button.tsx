import { useState, type ButtonHTMLAttributes, type MouseEvent } from 'react'
import { cx } from './provider.js'
import { Spinner } from './Spinner.js'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  variant?: 'primary' | 'secondary' | 'danger'
  /** Busy from outside, e.g. while a form submits. */
  busy?: boolean
  /** Read out while busy, e.g. "Saving". */
  busyLabel?: string
  /** When it returns a promise, the button stays busy until it settles. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => unknown
}

const VARIANTS = {
  primary: 'bg-accent text-accent-fg border-transparent',
  secondary: 'bg-surface text-fg border-border',
  danger: 'bg-danger text-danger-fg border-transparent',
}

export function Button({
  variant = 'primary',
  busy = false,
  busyLabel,
  onClick,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  const [pending, setPending] = useState(false)
  const isBusy = busy || pending
  const handle = (event: MouseEvent<HTMLButtonElement>) => {
    // aria-disabled keeps the button focusable, so clicks must be blocked here.
    if (isBusy || disabled) {
      event.preventDefault()
      return
    }
    const result = onClick?.(event)
    if (result instanceof Promise) {
      setPending(true)
      void result.finally(() => {
        setPending(false)
      })
    }
  }
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-busy={isBusy || undefined}
      aria-disabled={isBusy || undefined}
      onClick={handle}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-ui border px-4 py-2 text-sm font-semibold',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        'disabled:opacity-60 aria-disabled:cursor-wait',
        VARIANTS[variant],
        className,
      )}
    >
      {isBusy && busyLabel !== undefined && <Spinner label={busyLabel} />}
      {children}
    </button>
  )
}
