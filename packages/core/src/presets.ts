import type { WriteMeta } from './resource.js'
import type { ModuleDefinition } from './module.js'
import { defineService } from './service.js'

type Known = Pick<ModuleDefinition, 'name' | 'required' | 'depends'>

export interface ResolvedModules {
  /** In the order the modules were given. */
  enabled: string[]
  /** Modules turned on that were not asked for; `requiredBy` is null for always-on modules. */
  added: { module: string; requiredBy: string | null }[]
}

/** The selection plus every required module and every dependency, with the reason for each. */
export function resolveModules(
  all: readonly Known[],
  selected: readonly string[],
): ResolvedModules {
  const byName = new Map(all.map((m) => [m.name, m]))
  for (const name of selected) {
    if (!byName.has(name)) throw new Error(`Unknown module "${name}"`)
  }
  const on = new Set(selected)
  const reasons = new Map<string, string | null>()
  for (const m of all) {
    if (m.required && !on.has(m.name)) {
      on.add(m.name)
      reasons.set(m.name, null)
    }
  }
  const queue = [...on]
  while (queue.length > 0) {
    const name = queue.shift() ?? ''
    for (const dep of byName.get(name)?.depends ?? []) {
      if (!byName.has(dep)) throw new Error(`Module "${name}" depends on unknown module "${dep}"`)
      if (on.has(dep)) continue
      on.add(dep)
      reasons.set(dep, name)
      queue.push(dep)
    }
  }
  const order = all.map((m) => m.name)
  return {
    enabled: order.filter((n) => on.has(n)),
    added: order
      .filter((n) => reasons.has(n))
      .map((module) => ({ module, requiredBy: reasons.get(module) ?? null })),
  }
}

/** Enabled modules that need `name`, directly or through another module. */
export function dependentsOf(
  all: readonly Known[],
  enabled: readonly string[],
  name: string,
): string[] {
  const byName = new Map(all.map((m) => [m.name, m]))
  const needs = (module: string, seen = new Set<string>()): boolean =>
    (byName.get(module)?.depends ?? []).some(
      (dep) => dep === name || (!seen.has(dep) && needs(dep, seen.add(dep))),
    )
  return enabled.filter((m) => m !== name && needs(m))
}

/** Named module lists. `starter` and `standard` come in M2, with their modules. */
export const PRESETS = {
  minimal: (all: readonly Known[]) => all.filter((m) => m.required).map((m) => m.name),
  full: (all: readonly Known[]) => all.map((m) => m.name),
} satisfies Record<string, (all: readonly Known[]) => string[]>

export type PresetName = keyof typeof PRESETS

/** Which modules are switched on, kept across restarts and shared by every process. */
export interface ModuleStateStore {
  /** `null` when never set: a fresh install. */
  enabled(): Promise<string[] | null>
  /** Records a revision; every process reloads once the call commits. */
  set(enabled: readonly string[], meta: WriteMeta): Promise<void>
}

export const moduleState = defineService<ModuleStateStore>('core.module-state')
