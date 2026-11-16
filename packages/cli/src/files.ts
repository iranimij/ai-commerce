import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The nearest folder at or above `from` that holds `name`, or null. */
export function findUp(from: string, name: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, name))) return join(dir, name)
    if (dirname(dir) === dir) return null
  }
}

/** The monorepo root (the folder with pnpm-workspace.yaml) this package lives in. */
export function repoRoot(): string {
  const found = findUp(dirname(fileURLToPath(import.meta.url)), 'pnpm-workspace.yaml')
  if (!found) throw new Error('Not inside the AI Commerce repository')
  return dirname(found)
}
