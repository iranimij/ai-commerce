import { randomUUID } from 'node:crypto'
import { createDb, type Database } from './client.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL must be set for integration tests')

/** A database handle on a fresh schema of its own, so test files never share state. */
export async function createTestDb(): Promise<
  Database & { schema: string; drop: () => Promise<void> }
> {
  const schema = `test_${randomUUID().replaceAll('-', '')}`
  const admin = createDb(url ?? '')
  await admin.client.unsafe(`create schema ${schema}`)
  await admin.close()
  const database = createDb(url ?? '', { searchPath: schema })
  return {
    ...database,
    schema,
    drop: async () => {
      await database.client.unsafe(`drop schema ${schema} cascade`)
      await database.close()
    },
  }
}
