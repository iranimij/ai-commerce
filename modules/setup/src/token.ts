import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database } from '@aicommerce/db'

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Compares hashes, which always have the same length, in constant time. */
export function tokenMatches(token: string, storedHash: string | null): boolean {
  if (storedHash === null) return false
  return timingSafeEqual(Buffer.from(hashToken(token)), Buffer.from(storedHash))
}

/**
 * A fresh one-time token while setup is unfinished and no owner exists, or null. Only its SHA-256
 * is stored; each call replaces the one before. Run at startup, after migrations.
 */
export async function issueSetupToken(database: Database): Promise<string | null> {
  const { client } = database
  const [state] = await client`select finished_at from setup_state`
  if (!state || state.finished_at !== null) return null
  const [owner] = await client`select 1 from admin_user_role where role_id = 'owner' limit 1`
  if (owner) return null
  const token = randomBytes(32).toString('base64url')
  await client`update setup_state set token_hash = ${hashToken(token)}`
  return token
}
