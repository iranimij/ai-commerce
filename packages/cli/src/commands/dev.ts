import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, UsageError, type Io } from '../io.js'
import { migrate } from './migrate.js'

/** Migrations, then the server and worker (restarting when their code changes), and the admin. */
export async function dev(argv: string[], io: Io): Promise<number> {
  if (parse(argv, {}).positionals.length > 0) throw new UsageError('dev takes no arguments')
  const migrated = await migrate([], io)
  if (migrated !== 0) return migrated
  const children: ChildProcess[] = []
  const start = (command: string, args: string[]) => {
    const child = spawn(command, args, { cwd: io.cwd, env: io.env, stdio: 'inherit' })
    children.push(child)
    return child
  }
  const server = fileURLToPath(import.meta.resolve('@aicommerce/server/main'))
  start(process.execPath, ['--watch', server])
  if (existsSync(join(io.cwd, 'apps/admin/package.json'))) {
    start('pnpm', ['--filter', '@aicommerce/admin', 'dev'])
  }
  // shortcut: the server restarts on built code; run `pnpm build` (or turbo watch) after edits.
  io.out('Rebuild with `pnpm build` after a change; the server restarts by itself. Ctrl+C stops.')
  return new Promise((resolve) => {
    const stop = () => {
      for (const child of children) child.kill('SIGTERM')
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    let open = children.length
    for (const child of children) {
      child.on('exit', (code) => {
        stop()
        if (--open === 0) resolve(code === 0 || code === null ? 0 : 1)
      })
    }
  })
}
