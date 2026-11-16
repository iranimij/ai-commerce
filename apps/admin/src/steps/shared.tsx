import { Alert } from '@aicommerce/ui'
import { useState, type SubmitEvent } from 'react'
import type { Failure, Result } from '../api'

/** One request at a time, with its error kept for the form to show. */
export function useCall() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const run = async <O,>(call: () => Promise<Result<O>>, onOk: (output: O) => void) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await call()
    setBusy(false)
    if (result.ok) onOk(result.output)
    else setError(result.error)
  }
  return { busy, error, run }
}

export function FormError({ message }: { message: string | null }) {
  return message === null ? null : <Alert tone="danger">{message}</Alert>
}

/** Stops the browser's own submit and reads the form's text fields. */
export function formFields(event: SubmitEvent<HTMLFormElement>) {
  event.preventDefault()
  const form = new FormData(event.currentTarget)
  return (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value : ''
  }
}

/** The token is optional for a signed-in owner, and the server refuses null. */
export const withToken = (token: string | null, input: Record<string, unknown>) =>
  token ? { token, ...input } : input
