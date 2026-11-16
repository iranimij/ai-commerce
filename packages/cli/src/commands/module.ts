import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createApp, moduleState, provide, systemActor, VERSION, type App } from '@aicommerce/core'
import {
  createDb,
  createDbAuditSink,
  createPgModuleState,
  databaseEnv,
  parseEnv,
} from '@aicommerce/db'
import { findUp } from '../files.js'
import { parse, table, UsageError, type Io } from '../io.js'
import { installedModules } from '../modules.js'

const NAME = /^[a-z][a-z0-9-]{1,39}$/

/** `module list|enable|disable|create`. */
export async function module(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(argv, {
    yes: { type: 'boolean' },
    dir: { type: 'string' },
    json: { type: 'boolean' },
  })
  const [sub, name, extra] = positionals
  if (extra !== undefined) throw new UsageError('Too many arguments')
  if (sub === 'create') return create(name, values.dir, io)
  if (sub === 'list' && name === undefined) {
    return withApp(io, async (app) => {
      const result = await app.registry.call('module.list', {}, { actor: systemActor })
      if (!result.ok) return fail(io, result.error.message)
      const items = result.output as {
        name: string
        label: string
        enabled: boolean
        required: boolean
      }[]
      if (values.json) io.out(JSON.stringify(items, null, 2))
      else
        for (const line of table(
          items.map((m) => ({
            module: m.name,
            enabled: m.enabled ? 'yes' : 'no',
            required: m.required ? 'yes' : '',
            label: m.label,
          })),
        ))
          io.out(line)
      return 0
    })
  }
  if ((sub === 'enable' || sub === 'disable') && name !== undefined) {
    if (sub === 'disable' && !values.yes) {
      const sure = await io.ask(
        `Disable module "${name}"? Its data is kept and comes back when you enable it again.`,
      )
      if (!sure) return fail(io, 'Cancelled; nothing was changed.')
    }
    return withApp(io, async (app) => {
      const result = await app.registry.call(
        `module.${sub}`,
        { name },
        { actor: systemActor, confirmed: true },
      )
      if (!result.ok) return fail(io, result.error.message)
      const output = result.output as {
        enabled: string[]
        added?: { module: string; requiredBy: string | null }[]
      }
      for (const a of output.added ?? []) {
        io.out(`Also enabled ${a.module}${a.requiredBy ? `, which ${a.requiredBy} needs` : ''}`)
      }
      io.out(
        `${sub === 'enable' ? 'Enabled' : 'Disabled'} ${name}. Running servers switch over by themselves.`,
      )
      return 0
    })
  }
  throw new UsageError('module takes list, enable <name>, disable <name> or create <name>')
}

function fail(io: Io, message: string): number {
  io.err(message)
  return 1
}

// The module actions as the system actor, on the runtime role; the server hears the change.
async function withApp(io: Io, fn: (app: App) => Promise<number>): Promise<number> {
  const env = parseEnv(databaseEnv, io.env)
  const database = createDb(env.DATABASE_URL, { max: 2 })
  try {
    const app = createApp({
      modules: [...io.install.modules],
      enabled: await installedModules(database, io),
      services: [provide(moduleState, 'app', createPgModuleState(database))],
      audit: createDbAuditSink(database),
      transaction: database.transaction,
      onError: (error) => {
        io.err(String(error))
      },
    })
    return await fn(app)
  } finally {
    await database.close()
  }
}

const camel = (name: string) => name.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase())

function create(name: string | undefined, parentDir: string | undefined, io: Io): number {
  if (name === undefined || !NAME.test(name)) {
    throw new UsageError(
      'A module name is 2 to 40 lower-case letters, digits and dashes, starting with a letter',
    )
  }
  const dir = join(resolve(io.cwd, parentDir ?? 'modules'), name)
  if (existsSync(dir)) return fail(io, `${dir} already exists; nothing was written.`)
  const base = findUp(dirname(dir), 'tsconfig.base.json')
  const inWorkspace = findUp(dirname(dir), 'pnpm-workspace.yaml') !== null
  const id = camel(name)
  const files: Record<string, string> = {
    'package.json': `${JSON.stringify(
      {
        name: `@aicommerce/module-${name}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        license: 'MIT',
        exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
        files: ['dist'],
        scripts: { build: 'tsc -p tsconfig.json', typecheck: 'tsc --noEmit', test: 'vitest run' },
        dependencies: {
          '@aicommerce/core': inWorkspace ? 'workspace:*' : `^${VERSION}`,
          zod: '^4.6.7',
        },
      },
      null,
      2,
    )}\n`,
    'tsconfig.json': `${JSON.stringify(
      base
        ? {
            extends: relative(dir, base),
            compilerOptions: { outDir: 'dist', rootDir: 'src' },
            include: ['src'],
            exclude: ['src/**/*.test.ts'],
          }
        : {
            compilerOptions: {
              target: 'ES2023',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              strict: true,
              declaration: true,
              outDir: 'dist',
              rootDir: 'src',
            },
            include: ['src'],
            exclude: ['src/**/*.test.ts'],
          },
      null,
      2,
    )}\n`,
    'vitest.config.ts': `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
`,
    'src/index.ts': `import { defineAction, defineModule } from '@aicommerce/core'
import { z } from 'zod'

export const hello = defineAction({
  name: '${name}.hello',
  description: 'Say hello: the smallest action, to copy from',
  input: z.object({ name: z.string().min(1).max(100) }),
  output: z.object({ greeting: z.string() }),
  permission: '${name}.read',
  risk: 'read',
  handler: (input) => Promise.resolve({ greeting: \`Hello, \${input.name}\` }),
})

export const ${id} = defineModule({
  name: '${name}',
  label: '${name}',
  description: 'Describe in one sentence what this module adds',
  actions: [hello],
})
`,
    'src/index.test.ts': `import { createApp, systemActor } from '@aicommerce/core'
import { expect, test } from 'vitest'
import { ${id} } from './index.js'

test('${name}.hello greets', async () => {
  const app = createApp({ modules: [${id}], enabled: ['${name}'] })
  const result = await app.registry.call('${name}.hello', { name: 'Ada' }, { actor: systemActor })
  expect(result).toEqual({ ok: true, output: { greeting: 'Hello, Ada' } })
})
`,
    'README.md': `# ${name}

An AI Commerce module.

- \`src/index.ts\` defines the module and its actions. See docs/guides/actions.md and
  docs/guides/modules-and-wraps.md in the AI Commerce repository.
- \`pnpm test\` runs its tests.
- Add it to the server's module list, then switch it on with \`ai-commerce module enable ${name}\`.
`,
  }
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), content, { flag: 'wx' })
  }
  io.out(`Created module ${name} in ${relative(io.cwd, dir) || dir}`)
  return 0
}
