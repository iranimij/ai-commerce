import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ActionError, defineService, type Actor } from '@aicommerce/core'
import { createRateLimiter, type Database, type MigrationSource } from '@aicommerce/db'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { and, eq, sql } from 'drizzle-orm'
import {
  adminAccount,
  adminRole,
  adminSession,
  adminTwoFactor,
  adminUser,
  adminUserRole,
  adminVerification,
} from './schema.js'

export * from './schema.js'

export const authMigrations: MigrationSource = {
  module: 'auth',
  dir: fileURLToPath(new URL('../migrations', import.meta.url)),
}

/** Creating and managing admin accounts, for the access module. */
export interface Identity {
  createAdmin(input: { email: string; name: string; password: string }): Promise<{ id: string }>
  /** Disabling also ends every session of the admin. */
  setDisabled(id: string, disabled: boolean): Promise<void>
  revokeSessions(id: string): Promise<void>
}

export const identity = defineService<Identity>('core.identity')

export interface AdminAuthOptions {
  database: Database
  /** Where the admin is served, e.g. https://shop.example.com. */
  baseURL: string
  /** At least 32 characters; signs session cookies. */
  secret: string
  trustedOrigins: string[]
  /** Secure cookies. */
  production: boolean
  /** The header the reverse proxy puts the client address in. Default: x-forwarded-for. */
  ipHeader?: string
}

export interface AdminAuth {
  /** Handles everything under /api/auth. */
  handler(request: Request): Promise<Response>
  /** The admin behind a request, or null for a guest. */
  resolveActor(headers: Headers): Promise<Actor | null>
  identity: Identity
}

export const SESSION_SECONDS = 8 * 60 * 60
const PASSWORD = { min: 12, max: 128 }

export function createAdminAuth(options: AdminAuthOptions): AdminAuth {
  const { database } = options
  const limiter = createRateLimiter(database)
  const db = () => database.current()

  const auth = betterAuth({
    appName: 'AI Commerce',
    baseURL: options.baseURL,
    basePath: '/api/auth',
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(database.db, {
      provider: 'pg',
      schema: {
        admin_user: adminUser,
        admin_session: adminSession,
        admin_account: adminAccount,
        admin_verification: adminVerification,
        admin_two_factor: adminTwoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: PASSWORD.min,
      maxPasswordLength: PASSWORD.max,
    },
    user: {
      modelName: 'admin_user',
      additionalFields: { disabled: { type: 'boolean', defaultValue: false, input: false } },
    },
    session: { modelName: 'admin_session', expiresIn: SESSION_SECONDS, updateAge: 60 * 60 },
    account: { modelName: 'admin_account' },
    verification: { modelName: 'admin_verification' },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
      // The same PostgreSQL counters the API uses, shared by every process.
      customStorage: {
        consume: async (key, rule) => {
          const result = await limiter.hit(`auth:${key}`, {
            limit: rule.max,
            windowSeconds: rule.window,
          })
          return {
            allowed: result.allowed,
            retryAfter: result.allowed ? null : result.retryAfterSeconds,
          }
        },
      },
    },
    advanced: {
      cookiePrefix: 'aicommerce-admin',
      useSecureCookies: options.production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'strict' },
      ipAddress: { ipAddressHeaders: [options.ipHeader ?? 'x-forwarded-for'] },
    },
    databaseHooks: {
      session: {
        create: {
          // A disabled admin gets no session, whatever the sign-in method.
          before: async (session) => {
            const [user] = await database.db
              .select({ disabled: adminUser.disabled })
              .from(adminUser)
              .where(eq(adminUser.id, session.userId))
            return user?.disabled === true ? false : undefined
          },
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: 'AI Commerce',
        schema: { twoFactor: { modelName: 'admin_two_factor' } },
      }),
    ],
    telemetry: { enabled: false },
  })

  const revokeSessions = async (id: string) => {
    await db().delete(adminSession).where(eq(adminSession.userId, id))
  }

  const identityImpl: Identity = {
    async createAdmin({ email, name, password }) {
      if (password.length < PASSWORD.min || password.length > PASSWORD.max) {
        throw new ActionError('invalid_input', 'Password must be 12 to 128 characters')
      }
      const normalized = email.trim().toLowerCase()
      const id = randomUUID()
      const hash = await (await auth.$context).password.hash(password)
      const now = new Date()
      const inserted = await db()
        .insert(adminUser)
        .values({
          id,
          email: normalized,
          name,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: adminUser.id })
      if (inserted.length === 0) {
        throw new ActionError('conflict', `An admin with email "${normalized}" already exists`)
      }
      await db().insert(adminAccount).values({
        id: randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: hash,
        createdAt: now,
        updatedAt: now,
      })
      return { id }
    },
    async setDisabled(id, disabled) {
      await db()
        .update(adminUser)
        .set({ disabled, updatedAt: new Date() })
        .where(eq(adminUser.id, id))
      if (disabled) await revokeSessions(id)
    },
    revokeSessions,
  }

  return {
    handler: (request) => auth.handler(request),
    async resolveActor(headers) {
      const found = await auth.api.getSession({ headers })
      if (!found) return null
      const [user] = await database.db
        .select({ disabled: adminUser.disabled, twoFactorEnabled: adminUser.twoFactorEnabled })
        .from(adminUser)
        .where(eq(adminUser.id, found.user.id))
      if (!user || user.disabled) return null
      // Signed in but without 2FA: may only turn 2FA on.
      if (!user.twoFactorEnabled)
        return { type: 'admin', id: found.user.id, permissions: new Set() }
      const rows = await database.db
        .select({ permissions: adminRole.permissions })
        .from(adminUserRole)
        .innerJoin(adminRole, eq(adminRole.id, adminUserRole.roleId))
        .where(and(eq(adminUserRole.userId, found.user.id), sql`true`))
      return {
        type: 'admin',
        id: found.user.id,
        permissions: new Set(rows.flatMap((r) => r.permissions)),
      }
    },
    identity: identityImpl,
  }
}
