export { createDb, type Database, type DatabaseOptions, type Db } from './client.js'
export {
  coreMigrations,
  runMigrations,
  type MigrateOptions,
  type MigrationSource,
} from './migrate.js'
export { createDbAuditSink } from './audit.js'
export { grantAppRole } from './roles.js'
export { createRateLimiter, type RateLimiter, type RateLimitRule } from './rate-limit.js'
export { createPgResourceStore } from './resources.js'
export { createPgAttributeStore } from './attributes.js'
export { decryptSecret, encryptSecret, parseSecretKey } from './crypto.js'
export { createPgSettings, type PgSettingsOptions } from './settings.js'
export { createPgModuleState, MODULES_CHANNEL } from './modules.js'
export { createPgJobQueue, createWorker, type Worker, type WorkerOptions } from './jobs.js'

import { defineService } from '@aicommerce/core'
import type { Database } from './client.js'
/** The database, for modules that run typed queries on `current()`. */
export const databaseService = defineService<Database>('db.database')
