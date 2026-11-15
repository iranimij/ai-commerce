import type { CallError } from './result.js'

export type HandlerErrorCode = 'invalid_input' | 'not_found' | 'conflict' | 'forbidden'

/**
 * Thrown by a handler to fail with a specific code and a message meant for the caller. The
 * transaction rolls back, as with any throw, but the caller sees this code and message.
 */
export class ActionError extends Error {
  constructor(
    readonly code: HandlerErrorCode,
    message: string,
    readonly issues?: CallError['issues'],
  ) {
    super(message)
    this.name = 'ActionError'
  }
}
