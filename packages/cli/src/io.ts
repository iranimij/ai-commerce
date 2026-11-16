import { spawn } from 'node:child_process'
import { parseArgs, type ParseArgsConfig } from 'node:util'
import type { Install } from '@aicommerce/server'

export interface Io {
  cwd: string
  env: Record<string, string | undefined>
  out: (line: string) => void
  err: (line: string) => void
  /** A yes or no question; false when nobody can answer (no terminal). */
  ask: (question: string) => Promise<boolean>
  /** Every module the shop can run: first-party plus aicommerce.config.json. */
  install: Install
}

/** Wrong usage: exit code 2 and the usage text. */
export class UsageError extends Error {}

export type Command = (argv: string[], io: Io) => Promise<number>

type Options = NonNullable<ParseArgsConfig['options']>

export function parse<O extends Options>(argv: string[], options: O) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true })
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
}

/** Runs a command in `cwd`; rejects with its output when it fails. */
export function exec(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${command} ${args.join(' ')} failed:\n${output.trim()}`))
    })
  })
}

/**
 * Runs a PostgreSQL tool. The password goes in PGPASSWORD, so it never shows in the process list.
 */
export function pgTool(tool: string, args: string[], url: string): Promise<string> {
  const target = new URL(url)
  const password = decodeURIComponent(target.password)
  target.password = ''
  return new Promise((resolve, reject) => {
    const child = spawn(tool, [...args, `--dbname=${target.href}`], {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new Error(`${tool} is not installed: install the PostgreSQL 17 client tools`)
          : error,
      )
    })
    child.on('close', (code) => {
      if (code === 0) resolve(output)
      else reject(new Error(`${tool} failed:\n${output.trim()}`))
    })
  })
}

/** A value as table or listing text. */
export function show(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(show).join(', ')
  return JSON.stringify(value)
}

/** Lines of left-aligned columns. */
export function table(rows: Record<string, unknown>[]): string[] {
  const first = rows[0]
  if (!first) return []
  const keys = Object.keys(first)
  const cell = show
  const widths = keys.map((k) => Math.max(k.length, ...rows.map((r) => cell(r[k]).length)))
  const line = (values: string[]) =>
    values
      .map((v, i) => v.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()
  return [
    line(keys),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map((r) => line(keys.map((k) => cell(r[k])))),
  ]
}
