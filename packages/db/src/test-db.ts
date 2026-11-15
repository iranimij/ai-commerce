import { randomUUID } from 'node:crypto'
import { createDb, type Database } from './client.js'

// The owner runs DDL and migrations; DATABASE_URL is the restricted runtime role.
const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL
const appUrl = process.env.DATABASE_URL
if (!ownerUrl || !appUrl) throw new Error('DATABASE_URL must be set for integration tests')

/** The runtime role's name, from DATABASE_URL. */
export const appRoleName = (): string => new URL(appUrl).username

export interface TestDb extends Database {
  schema: string
  /** A second handle on the same schema, connected as the runtime role. */
  connectAsApp: () => Database
  drop: () => Promise<void>
}

/** An owner handle on a fresh schema of its own, so test files never share state. */
export async function createTestDb(): Promise<TestDb> {
  const schema = `test_${randomUUID().replaceAll('-', '')}`
  const admin = createDb(ownerUrl ?? '')
  await admin.client.unsafe(`create schema ${schema}`)
  await admin.close()
  const database = createDb(ownerUrl ?? '', { searchPath: schema })
  const others: Database[] = []
  return {
    ...database,
    schema,
    connectAsApp: () => {
      const app = createDb(appUrl ?? '', { searchPath: schema })
      others.push(app)
      return app
    },
    drop: async () => {
      await Promise.all(others.map((o) => o.close()))
      await database.client.unsafe(`drop schema ${schema} cascade`)
      await database.close()
    },
  }
}
