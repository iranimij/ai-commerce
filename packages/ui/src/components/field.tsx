import type { ReactNode } from 'react'

/** The hint and error under a control, and the ids to put in aria-describedby. */
export function describedBy(id: string, hint?: ReactNode, error?: ReactNode) {
  const ids = [hint !== undefined && `${id}-hint`, error !== undefined && `${id}-error`].filter(
    (x): x is string => typeof x === 'string',
  )
  return ids.length > 0 ? ids.join(' ') : undefined
}

export function FieldMessages({
  id,
  hint,
  error,
}: {
  id: string
  hint?: ReactNode
  error?: ReactNode
}) {
  return (
    <>
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </>
  )
}
