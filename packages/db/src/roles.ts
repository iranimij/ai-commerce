import type { ReservedSql, Sql } from 'postgres'

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

/** Tables the app role may read and insert into, but never change. */
const APPEND_ONLY = ['audit_log', 'revision']
/** Tables the app role may only read. */
const READ_ONLY = ['migrations']

/**
 * Gives the runtime role what the app needs in the current schema and no more: no DDL (it owns
 * nothing), no changes to append-only tables, and no changes to the migration records.
 */
// Takes a connection, not the pool: the migration runner calls it on its reserved connection.
export async function grantAppRole(client: Sql | ReservedSql, role: string): Promise<void> {
  if (!IDENTIFIER.test(role)) throw new Error(`Invalid role name "${role}"`)
  const [row] = await client`select current_schema() as schema`
  const schema = String(row?.schema)
  if (!IDENTIFIER.test(schema)) throw new Error(`Invalid schema name "${schema}"`)
  const tables = new Set(
    (await client`select tablename from pg_tables where schemaname = ${schema}`).map((r) =>
      String(r.tablename),
    ),
  )

  await client.unsafe(`grant usage on schema ${schema} to ${role}`)
  await client.unsafe(
    `grant select, insert, update, delete on all tables in schema ${schema} to ${role}`,
  )
  await client.unsafe(`grant usage, select on all sequences in schema ${schema} to ${role}`)
  for (const table of APPEND_ONLY.filter((t) => tables.has(t))) {
    await client.unsafe(`revoke update, delete, truncate on ${table} from ${role}`)
  }
  for (const table of READ_ONLY.filter((t) => tables.has(t))) {
    await client.unsafe(`revoke insert, update, delete, truncate on ${table} from ${role}`)
  }
}
