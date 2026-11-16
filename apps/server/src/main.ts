import { createAdminAuth } from '@aicommerce/auth'
import {
  createDb,
  createDbAuditSink,
  createRateLimiter,
  createWorker,
  runMigrations,
  type Worker,
} from '@aicommerce/db'
import { serve } from '@hono/node-server'
import { readEnv } from './env.js'
import { CLIENT_IP_HEADER, createServer } from './server.js'
import { createAicommerce, migrationSources } from './wiring.js'

const env = readEnv()
const production = env.NODE_ENV === 'production'
const appRole = new URL(env.DATABASE_URL).username
const ownerRole = new URL(env.MIGRATION_DATABASE_URL).username

const owner = createDb(env.MIGRATION_DATABASE_URL, { max: 1 })
await runMigrations(owner, migrationSources(env.AICOMMERCE_MODULES), {
  ...(appRole !== ownerRole && { appRole }),
})
await owner.close()
if (appRole === ownerRole) {
  console.warn('DATABASE_URL uses the owner role: the audit log is not protected from the app')
}

const database = createDb(env.DATABASE_URL)
const origin = new URL(env.AICOMMERCE_PUBLIC_URL).origin
const auth = createAdminAuth({
  database,
  baseURL: env.AICOMMERCE_PUBLIC_URL,
  secret: env.AICOMMERCE_AUTH_SECRET,
  trustedOrigins: [origin],
  production,
  ipHeader: CLIENT_IP_HEADER,
})
const app = createAicommerce({
  database,
  secretKey: env.AICOMMERCE_SECRET_KEY,
  auth,
  modules: env.AICOMMERCE_MODULES,
})

let http: ReturnType<typeof serve> | undefined
let worker: Worker | undefined
if (env.AICOMMERCE_ROLE !== 'worker') {
  const server = createServer({
    app,
    auth,
    database,
    rateLimiter: createRateLimiter(database),
    publicUrl: env.AICOMMERCE_PUBLIC_URL,
    production,
    audit: createDbAuditSink(database),
    trustedProxies: env.AICOMMERCE_TRUSTED_PROXIES,
  })
  http = serve({ fetch: server.fetch, port: env.PORT })
  console.info(`AI Commerce listening on port ${String(env.PORT)}`)
}
if (env.AICOMMERCE_ROLE !== 'web') {
  worker = createWorker({ database, app })
  worker.start()
  console.info('Job worker started')
}

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.info(`${signal}: finishing requests and jobs in flight`)
  await new Promise<void>((resolve) => {
    if (http) {
      http.close(() => {
        resolve()
      })
    } else resolve()
  })
  await worker?.stop()
  await database.close()
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
