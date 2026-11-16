import { parseSecretKey } from '@aicommerce/db'
import { z } from 'zod'

const schema = z.object({
  /** The runtime role: no DDL, append-only audit. */
  DATABASE_URL: z.url(),
  /** The owner role: runs migrations. */
  MIGRATION_DATABASE_URL: z.url(),
  AICOMMERCE_SECRET_KEY: z.string().transform((value, ctx) => {
    try {
      return parseSecretKey(value)
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message })
      return z.NEVER
    }
  }),
  AICOMMERCE_AUTH_SECRET: z.string().min(32),
  AICOMMERCE_PUBLIC_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  AICOMMERCE_ROLE: z.enum(['all', 'web', 'worker']).default('all'),
  AICOMMERCE_MODULES: z
    .string()
    .default('system,access,sample')
    .transform((list) =>
      list
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    ),
  AICOMMERCE_TRUSTED_PROXIES: z.coerce.number().int().min(0).max(10).default(0),
  NODE_ENV: z.string().optional(),
})

export type Env = z.output<typeof schema>

/** Reads the environment; the error names every missing or invalid variable. */
export function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(env)
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n${lines.join('\n')}`)
  }
  return result.data
}
