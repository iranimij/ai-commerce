import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database } from '@aicommerce/db'

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Compares hashes, which always have the same length, in constant time. */
export function tokenMatches(token: string, storedHash: string | null): boolean {
  if (storedHash === null) return false
  return timingSafeEqual(Buffer.from(hashToken(token)), Buffer.from(storedHash))
}

/**
 * A fresh one-time token while setup is unfinished, or null. Only its SHA-256 is stored; each call
 * replaces the one before, so a restart recovers a setup whose link was lost. Run at startup, after
 * migrations. create-owner still refuses a second owner and finish still needs 2FA.
 */
export async function issueSetupToken(database: Database): Promise<string | null> {
  const { client } = database
  const [state] = await client`select finished_at from setup_state`
  if (!state || state.finished_at !== null) return null
  const token = randomBytes(32).toString('base64url')
  await client`update setup_state set token_hash = ${hashToken(token)}`
  return token
}
