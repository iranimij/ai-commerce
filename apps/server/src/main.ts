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
import { issueSetupToken } from '@aicommerce/module-setup'
import { createAppHost } from './app-host.js'
import { loadInstall, migrationSources } from './wiring.js'

const env = readEnv()
const production = env.NODE_ENV === 'production'
const appRole = new URL(env.DATABASE_URL).username
const ownerRole = new URL(env.MIGRATION_DATABASE_URL).username

// Kept open: switching a module on at run time runs its migrations as the owner.
const owner = createDb(env.MIGRATION_DATABASE_URL, { max: 1 })
await runMigrations(owner, migrationSources([]), {
  ...(appRole !== ownerRole && { appRole }),
})
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
// Third-party modules listed in aicommerce.config.json, next to the first-party ones.
const install = await loadInstall(process.cwd())
const host = await createAppHost({
  install,
  database,
  owner,
  ...(appRole !== ownerRole && { appRole }),
  secretKey: env.AICOMMERCE_SECRET_KEY,
  auth,
  fallback: env.AICOMMERCE_MODULES,
  ...(env.AICOMMERCE_FILES_DIR && { filesDir: env.AICOMMERCE_FILES_DIR }),
})
const stopListening = await host.listen()
const app = () => host.current()

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
  const token = await issueSetupToken(database)
  if (token) {
    const url = `${env.AICOMMERCE_PUBLIC_URL.replace(/\/$/, '')}/setup?token=${token}`
    const line = '='.repeat(Math.max(60, url.length + 4))
    console.info(
      `\n${line}\n  Finish setting up your shop. Open this link; it stops working once setup is finished:\n\n  ${url}\n${line}\n`,
    )
  }
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
  await stopListening()
  await database.close()
  await owner.close()
  process.exit(0)
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
