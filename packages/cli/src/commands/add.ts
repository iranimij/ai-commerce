import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AicommerceConfig, ModuleDefinition } from '@aicommerce/core'
import { CONFIG_FILE, loadModulePackage, type ModulePackage } from '@aicommerce/server'
import { exec, parse, show, table, UsageError, type Io } from '../io.js'

// What a rejected or failed add must leave exactly as it found it.
const TRACKED = ['package.json', 'pnpm-lock.yaml', CONFIG_FILE]

const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value : [])

/** Installs a package, shows what its module declares, and adds it (switched off) on yes. */
export async function add(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(argv, { yes: { type: 'boolean' } })
  const [spec, extra] = positionals
  if (spec === undefined || extra !== undefined) throw new UsageError('add takes one package')
  const path = (file: string) => join(io.cwd, file)
  if (!existsSync(path('package.json'))) {
    io.err(`No package.json in ${io.cwd}: run this in the shop's folder.`)
    return 1
  }
  const before = new Map(
    TRACKED.map((f) => [f, existsSync(path(f)) ? readFileSync(path(f)) : null] as const),
  )
  const dependencies = () =>
    Object.keys(
      (JSON.parse(readFileSync(path('package.json'), 'utf8')) as { dependencies?: object })
        .dependencies ?? {},
    )
  const had = new Set(dependencies())
  let installed: string | undefined
  const undo = async () => {
    if (installed !== undefined) {
      await exec('pnpm', ['remove', '--ignore-scripts', installed], io.cwd).catch(() => undefined)
    }
    for (const [file, content] of before) {
      if (content === null) rmSync(path(file), { force: true })
      else writeFileSync(path(file), content)
    }
  }

  try {
    // Install scripts never run: the package is reviewed before any of it is trusted.
    await exec('pnpm', ['add', '--ignore-scripts', spec], io.cwd)
    installed = dependencies().find((d) => !had.has(d))
    if (installed === undefined) throw new Error(`${spec} is already a dependency of this shop`)
    const loaded = await loadModulePackage(io.cwd, installed)
    if (io.install.modules.some((m) => m.name === loaded.module.name)) {
      throw new Error(`A module named "${loaded.module.name}" is already installed`)
    }
    for (const line of describe(installed, loaded)) io.out(line)
    const yes =
      values.yes === true ||
      (await io.ask(`Add ${installed}? It stays switched off until you enable it.`))
    if (!yes) {
      await undo()
      io.err('Cancelled; nothing was changed.')
      return 1
    }
    const config: AicommerceConfig = existsSync(path(CONFIG_FILE))
      ? (JSON.parse(readFileSync(path(CONFIG_FILE), 'utf8')) as AicommerceConfig)
      : { modules: [] }
    config.modules = [...list(config.modules), installed]
    writeFileSync(path(CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`)
    io.out(`Added ${installed}. Switch it on with: ai-commerce module enable ${loaded.module.name}`)
    return 0
  } catch (error) {
    await undo()
    throw new Error(`${(error as Error).message}\nNothing was changed.`, { cause: error })
  }
}

/** What the module declares, in the order a reviewer asks about it. */
function describe(pkg: string, { module, version, migrations }: ModulePackage): string[] {
  const m: ModuleDefinition = module
  const actions = list(m.actions)
  const publicActions = actions.filter((a) => a.permission === null).map((a) => a.name)
  const lines = [
    `Package     ${pkg} ${version}`,
    `Module      ${m.name}${m.label ? ` (${m.label})` : ''}${m.description ? `: ${m.description}` : ''}`,
    `Needs       ${list(m.depends).join(', ') || '(no other modules)'}`,
    '',
    'Actions',
    ...(actions.length === 0
      ? ['  (none)']
      : table(
          actions.map((a) => ({
            action: a.name,
            permission: a.permission === null ? 'PUBLIC: anyone, signed in or not' : a.permission,
            risk: a.risk,
          })),
        ).map((l) => `  ${l}`)),
    '',
    `Public actions     ${publicActions.join(', ') || 'none'}`,
    `Settings           ${
      list(m.settings)
        .map((s) => `${s.key}${s.privacy === 'secret' ? ' (secret)' : ''}`)
        .join(', ') || 'none'
    }`,
    `Jobs               ${
      list(m.jobs)
        .map((j) => j.name)
        .join(', ') || 'none'
    }`,
    `Wraps (changes)    ${
      list(m.wraps)
        .map((w) => `${w.action} (order ${show(w.order)})`)
        .join(', ') || 'none'
    }`,
    `Replaces services  ${
      list(m.provides)
        .map((p) => p.service.name)
        .join(', ') || 'none'
    }`,
    `Migrations         ${
      migrations
        ? readdirSync(migrations.dir)
            .filter((f) => f.endsWith('.sql'))
            .sort()
            .join(', ')
        : 'none'
    }`,
    '',
  ]
  return lines
}
