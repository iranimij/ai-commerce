import { AsyncLocalStorage } from 'node:async_hooks'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { drizzle, type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'

/** A database or an open transaction; handlers use it the same way. */
export type Db = PgDatabase<PostgresJsQueryResultHKT>

export interface Database {
  /** The root connection pool. */
  db: Db
  /** The raw client, for migrations and audit writes. */
  client: Sql
  /** The transaction of the current call if there is one, otherwise the root pool. */
  current: () => Db
  /** Runs `fn` in a transaction; nested calls use a savepoint. Anything thrown rolls back. */
  transaction: <T>(fn: () => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

export interface DatabaseOptions {
  /** PostgreSQL search_path; used to give each test file its own schema. */
  searchPath?: string
  /** Maximum connections in the pool. */
  max?: number
}

export function createDb(url: string, options: DatabaseOptions = {}): Database {
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => undefined,
    ...(options.searchPath ? { connection: { search_path: options.searchPath } } : {}),
  })
  const db: Db = drizzle(client)
  const store = new AsyncLocalStorage<Db>()
  const current = (): Db => store.getStore() ?? db

  return {
    db,
    client,
    current,
    transaction: (fn) => current().transaction((tx) => store.run(tx, fn)),
    close: () => client.end(),
  }
}
