import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

// Property names are Better Auth's field names; columns are snake_case.
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const adminUser = pgTable('admin_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  disabled: boolean('disabled').notNull().default(false),
})

export const adminSession = pgTable('admin_session', {
  id: text('id').primaryKey(),
  expiresAt: at('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull(),
})

export const adminAccount = pgTable('admin_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: at('access_token_expires_at'),
  refreshTokenExpiresAt: at('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
})

export const adminVerification = pgTable('admin_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: at('expires_at').notNull(),
  createdAt: at('created_at').notNull(),
  updatedAt: at('updated_at').notNull(),
})

export const adminTwoFactor = pgTable('admin_two_factor', {
  id: text('id').primaryKey(),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),
  userId: text('user_id').notNull(),
  verified: boolean('verified').default(true),
  failedVerificationCount: integer('failed_verification_count').default(0),
  lockedUntil: at('locked_until'),
})

export const adminRole = pgTable('admin_role', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull(),
  system: boolean('system').notNull().default(false),
  createdAt: at('created_at').notNull().defaultNow(),
})

export const adminUserRole = pgTable(
  'admin_user_role',
  {
    userId: text('user_id').notNull(),
    roleId: text('role_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
)
