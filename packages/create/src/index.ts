#!/usr/bin/env node
// npm create @aicommerce [dir] [--port 3000]: a shop folder with Docker Compose and fresh secrets.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const templates = new URL('../templates/', import.meta.url)
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string
}

// The .env template has no dot: git ignores .env files, and npm would not publish it.
const FILES = [
  ['compose.yaml', 'compose.yaml'],
  ['env', '.env'],
  ['README.md', 'README.md'],
  ['aicommerce.config.json', 'aicommerce.config.json'],
] as const

export interface CreateOptions {
  port?: number
}

/** Writes a new shop project into `dir`, which must be missing or empty. */
export function create(dir: string, { port = 3000 }: CreateOptions = {}): void {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`${dir} is not empty: choose a new or empty folder`)
  }
  mkdirSync(dir, { recursive: true })
  const values: Record<string, string> = {
    VERSION: version,
    PORT: String(port),
    SECRET_KEY: randomBytes(32).toString('base64'),
    AUTH_SECRET: randomBytes(48).toString('base64url'),
    // Hex: safe inside a database URL without escaping.
    OWNER_PASSWORD: randomBytes(24).toString('hex'),
    APP_PASSWORD: randomBytes(24).toString('hex'),
  }
  for (const [from, to] of FILES) {
    const text = readFileSync(new URL(from, templates), 'utf8').replace(
      /\{\{(\w+)\}\}/g,
      (_, key: string) => {
        const value = values[key]
        if (value === undefined) throw new Error(`Unknown template value {{${key}}} in ${from}`)
        return value
      },
    )
    // 'wx' never overwrites; 0600 is set at creation, so the secrets are never readable by others.
    writeFileSync(join(dir, to), text, { flag: 'wx', mode: to === '.env' ? 0o600 : 0o644 })
  }
}

if (import.meta.main) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { port: { type: 'string', default: '3000' } },
    })
    const port = Number(values.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`--port must be a number from 1 to 65535, not "${values.port}"`)
    }
    if (positionals.length > 1) throw new Error('Usage: npm create @aicommerce [dir] [--port 3000]')
    const dir = positionals[0] ?? 'ai-commerce'
    create(dir, { port })
    console.info(
      [
        `Created your shop in ${dir}. The secrets are in ${join(dir, '.env')}: keep it private and back it up.`,
        '',
        'Next:',
        `  cd ${dir}`,
        '  docker compose up',
        '',
        'Then open the setup link printed in the log to create the owner account.',
      ].join('\n'),
    )
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
