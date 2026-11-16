import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { authMigrations, identity, type AdminAuth } from '@aicommerce/auth'
import {
  attributeStore,
  createApp,
  jobs,
  moduleState,
  provide,
  resourceStore,
  settings,
  settingStore,
  type AicommerceConfig,
  type App,
  type ModuleDefinition,
} from '@aicommerce/core'
import {
  coreMigrations,
  createDbAuditSink,
  createPgAttributeStore,
  createPgJobQueue,
  createPgModuleState,
  createPgResourceStore,
  createPgSettings,
  databaseService,
  type Database,
  type MigrationSource,
} from '@aicommerce/db'
import { access } from '@aicommerce/module-access'
import { sample, sampleMigrations } from '@aicommerce/module-sample'
import { setup, setupMigrations } from '@aicommerce/module-setup'
import { system } from '@aicommerce/module-system'

/** Every module this server can run. */
export const firstPartyModules = [system, access, sample, setup]

/** The modules a shop can run, and where each one's migrations are. */
export interface Install {
  modules: readonly ModuleDefinition[]
  migrations: Readonly<Record<string, readonly MigrationSource[]>>
}

export const firstParty: Install = {
  modules: firstPartyModules,
  migrations: { sample: [sampleMigrations], setup: [setupMigrations] },
}

export const CONFIG_FILE = 'aicommerce.config.json'

/** Core and auth tables, then those of the enabled modules. */
export function migrationSources(
  enabled: readonly string[],
  install: Install = firstParty,
): MigrationSource[] {
  return [coreMigrations, authMigrations, ...enabled.flatMap((m) => install.migrations[m] ?? [])]
}

const MODULE_NAME = /^[a-z][a-z0-9-]*$/

export function isModuleDefinition(value: unknown): value is ModuleDefinition {
  if (typeof value !== 'object' || value === null) return false
  const { name } = value as { name?: unknown }
  return typeof name === 'string' && MODULE_NAME.test(name)
}

export interface ModulePackage {
  module: ModuleDefinition
  version: string
  /** The package's migrations/ folder, by convention, when it has one. */
  migrations: MigrationSource | null
}

/**
 * Imports a package, resolved from `dir`, whose default export must be a module. Importing runs the
 * package's top-level code, as any import does.
 */
export async function loadModulePackage(dir: string, pkg: string): Promise<ModulePackage> {
  const entry = createRequire(join(dir, 'package.json')).resolve(pkg)
  const loaded = (await import(pathToFileURL(entry).href)) as { default?: unknown }
  if (!isModuleDefinition(loaded.default)) {
    throw new Error(`${pkg} is not an AI Commerce module: its default export is not a module`)
  }
  // The package root: the nearest package.json above the entry (exports may hide the file).
  let root = dirname(entry)
  while (!existsSync(join(root, 'package.json')) && dirname(root) !== root) root = dirname(root)
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    version?: string
  }
  const migrations = join(root, 'migrations')
  return {
    module: loaded.default,
    version: version ?? '',
    migrations: existsSync(migrations) ? { module: loaded.default.name, dir: migrations } : null,
  }
}

/** The first-party modules plus the packages listed in the shop's aicommerce.config.json. */
export async function loadInstall(dir: string): Promise<Install> {
  const file = join(dir, CONFIG_FILE)
  if (!existsSync(file)) return firstParty
  const config = JSON.parse(readFileSync(file, 'utf8')) as Partial<AicommerceConfig>
  const listed = config.modules ?? []
  if (!Array.isArray(listed) || !listed.every((m) => typeof m === 'string')) {
    throw new Error(`${file}: "modules" must be a list of package names`)
  }
  const modules = [...firstParty.modules]
  const migrations = { ...firstParty.migrations }
  for (const pkg of listed) {
    const loaded = await loadModulePackage(dir, pkg)
    if (modules.some((m) => m.name === loaded.module.name)) {
      throw new Error(`${pkg}: a module named "${loaded.module.name}" is already installed`)
    }
    modules.push(loaded.module)
    if (loaded.migrations) migrations[loaded.module.name] = [loaded.migrations]
  }
  return { modules, migrations }
}

export interface AicommerceOptions {
  database: Database
  /** From AICOMMERCE_SECRET_KEY: encrypts secret settings. */
  secretKey: Buffer
  auth: AdminAuth
  modules: readonly string[]
  /** Every module the shop can run. Default: the first-party modules. */
  install?: Install
}

/** The app with every PostgreSQL-backed service. */
export function createAicommerce(options: AicommerceOptions): App {
  const { database } = options
  const all = (options.install ?? firstParty).modules
  const known = new Set(all.map((m) => m.name))
  const unknown = options.modules.filter((m) => !known.has(m))
  if (unknown.length > 0) throw new Error(`Unknown modules: ${unknown.join(', ')}`)
  const pgSettings = createPgSettings(database, { secretKey: options.secretKey })
  return createApp({
    modules: [...all],
    enabled: [...options.modules],
    services: [
      provide(resourceStore, 'app', createPgResourceStore(database)),
      provide(attributeStore, 'app', createPgAttributeStore(database)),
      provide(settings, 'app', pgSettings.reader),
      provide(settingStore, 'app', pgSettings.store),
      provide(jobs, 'app', createPgJobQueue(database)),
      provide(identity, 'app', options.auth.identity),
      provide(databaseService, 'app', database),
      provide(moduleState, 'app', createPgModuleState(database)),
    ],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
  })
}
