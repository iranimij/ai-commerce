import { resolveModules } from '@aicommerce/core'
import { createPgModuleState, type Database } from '@aicommerce/db'
import { DEFAULT_MODULES, moduleList } from '@aicommerce/server'
import type { Io } from './io.js'

/** What the server would run: the stored module state, or AICOMMERCE_MODULES on a fresh install. */
export async function installedModules(database: Database, io: Io): Promise<string[]> {
  let stored: string[] | null = null
  try {
    stored = await createPgModuleState(database).enabled()
  } catch (error) {
    // undefined_table: nothing is migrated yet, so this is a fresh install.
    const { code, cause } = error as { code?: string; cause?: { code?: string } }
    if ((code ?? cause?.code) !== '42P01') throw error
  }
  const { modules } = io.install
  const known = new Set(modules.map((m) => m.name))
  const wanted = (stored ?? moduleList(io.env.AICOMMERCE_MODULES ?? DEFAULT_MODULES)).filter((m) =>
    known.has(m),
  )
  return resolveModules(modules, wanted).enabled
}
