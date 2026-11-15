import type { z } from 'zod'

export type ErrorCode =
  'not_found' | 'invalid_input' | 'forbidden' | 'confirmation_required' | 'handler_error'

export interface CallError {
  code: ErrorCode
  message: string
  issues?: z.core.$ZodIssue[]
}

export type Result<T> = { ok: true; output: T } | { ok: false; error: CallError }

export function fail(code: ErrorCode, message: string, issues?: z.core.$ZodIssue[]): Result<never> {
  return { ok: false, error: issues ? { code, message, issues } : { code, message } }
}
