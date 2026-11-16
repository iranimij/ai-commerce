import { appInfo, createApp, resolveModules } from '@aicommerce/core'
import { parse, show, table, UsageError, type Io } from '../io.js'

const KINDS = ['action', 'pipeline', 'event', 'service'] as const

/** Shows how the install is put together, with every installed module switched on. */
export async function inspect(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(argv, { json: { type: 'boolean' } })
  const [kind, name, extra] = positionals
  const all = io.install.modules
  const app = createApp({
    modules: [...all],
    enabled: resolveModules(
      all,
      all.map((m) => m.name),
    ).enabled,
    onError: () => undefined,
  })
  let data: unknown
  if (kind === 'modules' && name === undefined) {
    data = app.service(appInfo).modules()
  } else if (
    KINDS.includes(kind as (typeof KINDS)[number]) &&
    name !== undefined &&
    extra === undefined
  ) {
    data = app.inspect(kind as 'action', name)
    if (data === undefined) {
      io.err(`No ${String(kind)} named "${name}"`)
      return 1
    }
  } else {
    throw new UsageError('inspect takes <action|pipeline|event|service> <name>, or modules')
  }
  if (values.json) {
    io.out(JSON.stringify(data, null, 2))
  } else if (Array.isArray(data)) {
    for (const line of table(data as Record<string, unknown>[])) io.out(line)
    if (data.length === 0) io.out('(none)')
  } else {
    const record = data as Record<string, unknown>
    const width = Math.max(...Object.keys(record).map((k) => k.length))
    for (const [key, value] of Object.entries(record)) {
      if (key === 'wraps' && Array.isArray(value)) {
        const wraps = value as { module: string; order: number }[]
        io.out(`${key.padEnd(width)}  ${wraps.length === 0 ? '(none)' : 'in order:'}`)
        wraps.forEach((w, i) => {
          io.out(`${''.padEnd(width)}  ${String(i + 1)}. ${w.module} (order ${String(w.order)})`)
        })
      } else {
        io.out(`${key.padEnd(width)}  ${value === null ? '(public)' : show(value)}`)
      }
    }
  }
  return Promise.resolve(0)
}
