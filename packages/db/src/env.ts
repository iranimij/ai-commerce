import { z } from 'zod'

/** The two database URLs every process needs: the server, the worker and the CLI. */
export const databaseEnv = z.object({
  /** The runtime role: no DDL, append-only audit. */
  DATABASE_URL: z.url(),
  /** The owner role: runs migrations, backups and restores. */
  MIGRATION_DATABASE_URL: z.url(),
})

/** Parses the environment; the error names every missing or invalid variable. */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  env: Record<string, string | undefined> = process.env,
): z.output<S> {
  const result = schema.safeParse(env)
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n${lines.join('\n')}`)
  }
  return result.data
}
