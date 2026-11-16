import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { describedBy, FieldMessages } from './field.js'
import { cx } from './provider.js'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const generated = useId()
  const inputId = id ?? generated
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        aria-describedby={describedBy(inputId, hint, error)}
        aria-invalid={error !== undefined || undefined}
        className={cx(
          'rounded-ui border border-border bg-surface px-3 py-2 text-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
          error !== undefined && 'border-danger',
          className,
        )}
      />
      <FieldMessages id={inputId} hint={hint} error={error} />
    </div>
  )
}
