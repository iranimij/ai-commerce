import { createInterface } from 'node:readline/promises'
import { firstParty, loadInstall } from '@aicommerce/server'
import { add } from './commands/add.js'
import { backup, restore } from './commands/backup.js'
import { dev } from './commands/dev.js'
import { inspect } from './commands/inspect.js'
import { migrate } from './commands/migrate.js'
import { module } from './commands/module.js'
import { UsageError, type Command, type Io } from './io.js'

export type { Io } from './io.js'

export const USAGE = `Usage: ai-commerce <command>

  dev                               Migrations, then the server, worker and admin
  migrate [--status]                Apply pending migrations, or list them
  inspect <action|pipeline|event|service> <name> [--json]
  inspect modules [--json]          How the install is put together
  module list [--json]              Which modules are on
  module enable <name>              Switch a module on, with what it needs
  module disable <name> [--yes]     Switch a module off; its data is kept
  module create <name> [--dir <d>]  Start a new module (default folder: modules/)
  add <package> [--yes]             Install an extension after reviewing what it declares
  backup [--out <file>]             Dump the database (keep AICOMMERCE_SECRET_KEY with it)
  restore <file> [--yes]            Replace the database with a backup

Exit codes: 0 ok, 1 error, 2 wrong usage.`

const COMMANDS: Record<string, Command> = { dev, migrate, inspect, module, add, backup, restore }

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} (y/N) `)).trim())
  } finally {
    rl.close()
  }
}

const defaults: Io = {
  cwd: process.cwd(),
  env: process.env,
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  ask,
  install: firstParty,
}

/** Runs one command and returns its exit code. */
export async function run(argv: string[], overrides: Partial<Io> = {}): Promise<number> {
  const io: Io = { ...defaults, ...overrides }
  const [name, ...rest] = argv
  const command = name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined
  if (!command) {
    io.err(name === undefined ? 'No command given.' : `Unknown command "${name}".`)
    io.err(USAGE)
    return 2
  }
  try {
    if (!overrides.install) io.install = await loadInstall(io.cwd)
    return await command(rest, io)
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message)
      io.err(USAGE)
      return 2
    }
    io.err(`Error: ${(error as Error).message}`)
    return 1
  }
}
