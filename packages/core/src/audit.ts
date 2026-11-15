import type { ActorType } from './actor.js'
import type { ErrorCode } from './result.js'

export interface AuditEntry {
  actorType: ActorType
  actorId: string | null
  /** The admin the AI acted for, if any. */
  onBehalfOf: string | null
  action: string
  /** Input with redacted keys replaced. */
  input: unknown
  outcome: 'ok' | ErrorCode
  durationMs: number
}

export interface AuditSink {
  write(entry: AuditEntry): Promise<void>
}

const REDACTED = '[redacted]'

/** A copy of `input` with `keys` replaced. Anything that is not a plain object is not stored. */
export function redactInput(input: unknown, keys: readonly string[]): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return '[non-object input]'
  }
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) }
  for (const key of keys) {
    if (key in copy) copy[key] = REDACTED
  }
  return copy
}
