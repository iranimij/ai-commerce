// Test helpers: a real server on a fresh schema, and signed-in admins. Not part of the build.
import { createAdminAuth } from '@aicommerce/auth'
import { createDbAuditSink, createRateLimiter, runMigrations } from '@aicommerce/db'
import { createTestDb } from '@aicommerce/db/testing'
import * as OTPAuth from 'otpauth'
import { createServer } from './server.js'
import { createAppHost } from './app-host.js'
import { migrationSources } from './wiring.js'

export const BASE = 'http://localhost:3000'
export const PASSWORD = 'correct horse battery'

export interface RequestOptions {
  cookie?: string
  origin?: string
  ip?: string
  contentType?: string
}

export async function createTestServer() {
  const database = await createTestDb()
  const modules = ['system', 'access', 'sample']
  await runMigrations(database, migrationSources(modules), { log: () => undefined })
  const auth = createAdminAuth({
    database,
    baseURL: BASE,
    secret: 'a-test-secret-that-is-long-enough-1234567890',
    trustedOrigins: [BASE],
    production: false,
    ipHeader: 'x-aicommerce-client-ip',
  })
  const host = await createAppHost({
    database,
    owner: database,
    secretKey: Buffer.alloc(32, 7),
    auth,
    fallback: modules,
  })
  const stopListening = await host.listen()
  const logs: string[] = []
  const server = createServer({
    app: () => host.current(),
    auth,
    database,
    rateLimiter: createRateLimiter(database),
    publicUrl: BASE,
    production: false,
    audit: createDbAuditSink(database),
    trustedProxies: 1,
    log: (line) => logs.push(JSON.stringify(line)),
  })

  let n = 1
  // Every client gets its own address, so rate limits never leak between tests.
  const nextIp = () => `10.1.${String(Math.floor(n / 250))}.${String(n++ % 250)}`

  const post = (path: string, body: unknown, options: RequestOptions = {}) =>
    server.request(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'content-type': options.contentType ?? 'application/json',
        origin: options.origin ?? BASE,
        'x-forwarded-for': options.ip ?? nextIp(),
        ...(options.cookie && { cookie: options.cookie }),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

  const action = (
    name: string,
    input: unknown,
    options: RequestOptions & { confirmed?: boolean } = {},
  ) =>
    post(
      `/api/actions/${name}`,
      { input, ...(options.confirmed !== undefined && { confirmed: options.confirmed }) },
      options,
    )

  /** Signs in through the server; with `totp`, turns 2FA on first (fails if already on). */
  async function signIn(email: string, options: { totp?: boolean } = {}) {
    const ip = nextIp()
    const jar = new Map<string, string>()
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const send = async (path: string, body: unknown) => {
      const current = cookie()
      const response = await post(path, body, { ip, ...(current && { cookie: current }) })
      for (const c of response.headers.getSetCookie()) {
        const [pair = ''] = c.split(';')
        const [name = '', value = ''] = pair.split('=')
        if (value) jar.set(name, value)
        else jar.delete(name)
      }
      return response
    }
    const signedIn = await send('/api/auth/sign-in/email', { email, password: PASSWORD })
    if (signedIn.status !== 200) throw new Error(`Sign-in failed: ${String(signedIn.status)}`)
    if (options.totp) {
      const enabled = (await (
        await send('/api/auth/two-factor/enable', { password: PASSWORD })
      ).json()) as { totpURI: string }
      const code = (OTPAuth.URI.parse(enabled.totpURI) as OTPAuth.TOTP).generate()
      const verified = await send('/api/auth/two-factor/verify-totp', { code })
      if (verified.status !== 200) throw new Error('Turning on 2FA failed')
    }
    return cookie()
  }

  /** An admin with the given roles, created directly (as the installer will create the owner). */
  async function createAdminUser(roles: string[]) {
    const email = `admin${String(n++)}@example.com`
    const { id } = await auth.identity.createAdmin({ email, name: 'Admin', password: PASSWORD })
    for (const role of roles) {
      await database.client`insert into admin_user_role (user_id, role_id) values (${id}, ${role})`
    }
    return { id, email }
  }

  async function signedIn(roles: string[], totp = false) {
    const { id, email } = await createAdminUser(roles)
    return { id, cookie: await signIn(email, { totp }) }
  }

  const auditCount = async () =>
    Number((await database.client`select count(*)::int as n from audit_log`)[0]?.n)

  /** Polls until `check` passes, for changes that arrive by notification. */
  const until = async (check: () => Promise<boolean>, ms = 3000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await check()) return true
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return false
  }

  return {
    database,
    auth,
    host,
    /** The app running now; it changes when modules are switched. */
    get app() {
      return host.current()
    },
    server,
    until,
    stop: stopListening,
    logs,
    nextIp,
    post,
    action,
    signIn,
    createAdminUser,
    signedIn,
    auditCount,
  }
}
