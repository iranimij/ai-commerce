import { authMigrations, identity, type AdminAuth } from '@aicommerce/auth'
import {
  attributeStore,
  createApp,
  jobs,
  provide,
  resourceStore,
  settings,
  settingStore,
  type App,
} from '@aicommerce/core'
import {
  coreMigrations,
  createDbAuditSink,
  createPgAttributeStore,
  createPgJobQueue,
  createPgResourceStore,
  createPgSettings,
  databaseService,
  type Database,
  type MigrationSource,
} from '@aicommerce/db'
import { access } from '@aicommerce/module-access'
import { sample, sampleMigrations } from '@aicommerce/module-sample'
import { system } from '@aicommerce/module-system'

/** Every module this server can run. */
export const firstPartyModules = [system, access, sample]

const moduleMigrations: Record<string, MigrationSource[]> = { sample: [sampleMigrations] }

/** Core and auth tables, then those of the enabled modules. */
export function migrationSources(enabled: readonly string[]): MigrationSource[] {
  return [coreMigrations, authMigrations, ...enabled.flatMap((m) => moduleMigrations[m] ?? [])]
}

export interface AicommerceOptions {
  database: Database
  /** From AICOMMERCE_SECRET_KEY: encrypts secret settings. */
  secretKey: Buffer
  auth: AdminAuth
  modules: readonly string[]
}

/** The app with every PostgreSQL-backed service. */
export function createAicommerce(options: AicommerceOptions): App {
  const { database } = options
  const known = new Set(firstPartyModules.map((m) => m.name))
  const unknown = options.modules.filter((m) => !known.has(m))
  if (unknown.length > 0) throw new Error(`Unknown modules: ${unknown.join(', ')}`)
  const pgSettings = createPgSettings(database, { secretKey: options.secretKey })
  return createApp({
    modules: firstPartyModules,
    enabled: [...options.modules],
    services: [
      provide(resourceStore, 'app', createPgResourceStore(database)),
      provide(attributeStore, 'app', createPgAttributeStore(database)),
      provide(settings, 'app', pgSettings.reader),
      provide(settingStore, 'app', pgSettings.store),
      provide(jobs, 'app', createPgJobQueue(database)),
      provide(identity, 'app', options.auth.identity),
      provide(databaseService, 'app', database),
    ],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
  })
}
