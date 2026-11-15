/* global process, console, URL */
// Creates the runtime login role named in DATABASE_URL, connecting as the owner in
// MIGRATION_DATABASE_URL. Idempotent: safe to run on every start and in CI.
import postgres from 'postgres'

const ownerUrl = process.env.MIGRATION_DATABASE_URL
const appUrl = process.env.DATABASE_URL
if (!ownerUrl || !appUrl) throw new Error('MIGRATION_DATABASE_URL and DATABASE_URL must be set')

const { username, password } = new URL(appUrl)
const owner = new URL(ownerUrl).username
if (!/^[a-z_][a-z0-9_]*$/.test(username)) throw new Error(`Invalid role name "${username}"`)
if (username === owner) throw new Error('DATABASE_URL must use a different role than the owner')

const sql = postgres(ownerUrl, { max: 1, onnotice: () => undefined })
try {
  const [row] = await sql`select 1 from pg_roles where rolname = ${username}`
  const secret = decodeURIComponent(password).replaceAll("'", "''")
  if (row) {
    await sql.unsafe(`alter role ${username} with login password '${secret}'`)
    console.info(`Role ${username} exists`)
  } else {
    await sql.unsafe(`create role ${username} with login password '${secret}'`)
    console.info(`Role ${username} created`)
  }
} finally {
  await sql.end()
}
