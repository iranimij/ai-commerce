import { ActionError } from '@aicommerce/core'

/** Keyset cursors: base64url JSON of `[timestamp, uuid]`. */
export function encodeCursor(value: [string, string]): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      !Number.isNaN(Date.parse(value[0])) &&
      typeof value[1] === 'string' &&
      /^[0-9a-f-]{36}$/.test(value[1])
    ) {
      return [value[0], value[1]]
    }
  } catch {
    // Falls through to the error below.
  }
  throw new ActionError('invalid_input', 'Invalid cursor')
}
