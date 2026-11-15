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

// Always redacted, whatever an action declares, at any depth. Matched inside the key name with
// case and separators ignored, so "newPassword" and "access_token" are caught too.
const SECRET_WORDS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cookie',
  'cardnumber',
  'cvc',
  'cvv',
  'iban',
]

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSecret(key: string, named: ReadonlySet<string>): boolean {
  const plain = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return named.has(key) || SECRET_WORDS.some((word) => plain.includes(word))
}

function redactValue(value: unknown, named: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, named))
  if (!isPlainObject(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSecret(key, named) ? REDACTED : redactValue(item, named),
    ]),
  )
}

/**
 * A copy of `input` with secrets replaced at any depth: the keys the action names, and keys that
 * look like secrets. Anything that is not a plain object is not stored.
 */
export function redactInput(input: unknown, keys: readonly string[]): unknown {
  if (!isPlainObject(input)) return '[non-object input]'
  return redactValue(input, new Set(keys))
}

/** For input that failed validation: its key names only, never a value, which may be a secret. */
export function describeInvalidInput(input: unknown): unknown {
  if (!isPlainObject(input)) return '[non-object input]'
  return {
    '[invalid input]': Object.keys(input)
      .slice(0, 50)
      .map((key) => key.slice(0, 64)),
  }
}
