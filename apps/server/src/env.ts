import { databaseEnv, parseEnv, parseSecretKey } from '@aicommerce/db'
import { z } from 'zod'

/** Modules of a fresh install when AICOMMERCE_MODULES is not set. */
export const DEFAULT_MODULES = 'system,access,sample'

/** Splits AICOMMERCE_MODULES. */
export const moduleList = (list: string) =>
  list
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)

const schema = databaseEnv.extend({
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
  AICOMMERCE_MODULES: z.string().default(DEFAULT_MODULES).transform(moduleList),
  AICOMMERCE_TRUSTED_PROXIES: z.coerce.number().int().min(0).max(10).default(0),
  /** Where uploaded files are kept. Default: /var/lib/aicommerce/files. */
  AICOMMERCE_FILES_DIR: z.string().min(1).optional(),
  NODE_ENV: z.string().optional(),
})

export type Env = z.output<typeof schema>

/** Reads the environment; the error names every missing or invalid variable. */
export function readEnv(env: Record<string, string | undefined> = process.env): Env {
  return parseEnv(schema, env)
}
