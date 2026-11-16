import type { AdminAuth } from '@aicommerce/auth'
import { resolveModules, type App } from '@aicommerce/core'
import { createPgModuleState, MODULES_CHANNEL, runMigrations, type Database } from '@aicommerce/db'
import { createAicommerce, firstParty, migrationSources, type Install } from './wiring.js'

export interface AppHostOptions {
  /** The runtime connection. */
  database: Database
  /** The owner connection, for migrations of modules switched on at run time. */
  owner: Database
  /** Granted after migrations; leave out when the runtime and owner roles are the same. */
  appRole?: string
  secretKey: Buffer
  auth: AdminAuth
  /** Modules of a fresh install, before anything is stored (AICOMMERCE_MODULES). */
  fallback: readonly string[]
  /** Every module the shop can run. Default: the first-party modules. */
  install?: Install
  /** Where uploaded files are kept (AICOMMERCE_FILES_DIR). */
  filesDir?: string
  /** A reload that failed, or a stored module this install no longer has. Default: console.error. */
  onError?: (error: unknown) => void
}

/** The running app, rebuilt when the enabled modules change in any process. */
export interface AppHost {
  current(): App
  /** Rebuilds from the stored module state; on failure the running app stays. */
  reload(): Promise<void>
  /** Reloads on every module change; returns a function that stops listening. */
  listen(): Promise<() => Promise<void>>
}

export async function createAppHost(options: AppHostOptions): Promise<AppHost> {
  const { database } = options
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.error(error)
    })
  const state = createPgModuleState(database)
  const install = options.install ?? firstParty
  const known = new Set(install.modules.map((m) => m.name))

  const build = async (): Promise<App> => {
    const stored = await state.enabled()
    const wanted = (stored ?? options.fallback).filter((name) => {
      if (known.has(name)) return true
      onError(new Error(`Module "${name}" is enabled but not installed; it is skipped`))
      return false
    })
    const { enabled } = resolveModules(install.modules, wanted)
    await runMigrations(options.owner, migrationSources(enabled, install), {
      ...(options.appRole && { appRole: options.appRole }),
      log: () => undefined,
    })
    return createAicommerce({ ...options, modules: enabled })
  }

  let app = await build()
  // One reload at a time; a notification during a reload triggers one more afterwards.
  let running: Promise<void> = Promise.resolve()
  const reload = () => {
    running = running.then(async () => {
      try {
        app = await build()
      } catch (error) {
        onError(new Error('Reloading modules failed; the running modules stay', { cause: error }))
      }
    })
    return running
  }

  return {
    current: () => app,
    reload,
    async listen() {
      const [row] = await database.client`select current_schema() as schema`
      const schema = String(row?.schema)
      const listener = await database.client.listen(MODULES_CHANNEL, (payload) => {
        if (payload === schema) void reload()
      })
      return () => listener.unlisten()
    },
  }
}
