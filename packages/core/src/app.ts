import type { ActionDefinition } from './action.js'
import { createEventBus, type EventBus } from './events.js'
import type { ModuleDefinition } from './module.js'
import { createPipelines, type Pipelines } from './pipeline.js'
import { createRegistry, type Registry } from './registry.js'

export interface ActionInfo {
  name: string
  module: string
  permission: string | null
  risk: string
  wraps: { module: string; order: number }[]
}

export interface App {
  registry: Registry
  events: EventBus
  pipelines: Pipelines
  /** Enabled modules in load order. */
  modules: string[]
  inspect(kind: 'action', name: string): ActionInfo | undefined
  inspect(kind: 'pipeline', name: string): { step: string; module: string; order: number }[]
  inspect(kind: 'event', name: string): { module: string }[]
}

export interface AppOptions {
  modules: ModuleDefinition[]
  /** Names of the modules to load. Anything not listed contributes nothing. */
  enabled: string[]
}

const MODULE_NAME = /^[a-z][a-z0-9-]*$/

/** Enabled modules in dependency order; throws on unknown, missing or cyclic dependencies. */
function loadOrder(options: AppOptions): ModuleDefinition[] {
  const byName = new Map<string, ModuleDefinition>()
  for (const m of options.modules) {
    if (byName.has(m.name)) throw new Error(`Module "${m.name}" is defined twice`)
    byName.set(m.name, m)
  }
  const enabled = new Set(options.enabled)
  for (const name of enabled) {
    if (!byName.has(name)) throw new Error(`Unknown module: ${name}`)
    if (!MODULE_NAME.test(name)) throw new Error(`Invalid module name "${name}"`)
  }

  const ordered: ModuleDefinition[] = []
  const done = new Set<string>()
  const path: string[] = []

  const visit = (name: string): void => {
    if (done.has(name)) return
    if (path.includes(name)) {
      const cycle = [...path.slice(path.indexOf(name)), name]
      throw new Error(`Dependency cycle: ${cycle.join(' -> ')}`)
    }
    const module = byName.get(name)
    if (!module) throw new Error(`Unknown module: ${name}`)
    path.push(name)
    for (const dep of module.depends ?? []) {
      if (!enabled.has(dep)) {
        throw new Error(`Module "${name}" depends on "${dep}", which is not enabled`)
      }
      visit(dep)
    }
    path.pop()
    done.add(name)
    ordered.push(module)
  }
  for (const name of enabled) visit(name)
  return ordered
}

function assertOwner(module: string, kind: string, owner: string): void {
  if (owner !== module) {
    throw new Error(`Module "${module}" declares a ${kind} that belongs to module "${owner}"`)
  }
}

export function createApp(options: AppOptions): App {
  const pipelines = createPipelines()
  const events = createEventBus()
  const registry = createRegistry({ pipelines, events })
  const actionOwner = new Map<string, string>()
  const ordered = loadOrder(options)

  for (const m of ordered) {
    for (const action of m.actions ?? []) {
      registry.register(action as ActionDefinition)
      actionOwner.set(action.name, m.name)
    }
    for (const s of m.subscribers ?? []) {
      assertOwner(m.name, 'subscriber', s.module)
      events.subscribe(s)
    }
    for (const step of m.steps ?? []) {
      assertOwner(m.name, 'step', step.module)
      pipelines.addStep(step)
    }
  }
  // Wraps last, so a module may wrap an action of any module it depends on.
  for (const m of ordered) {
    for (const w of m.wraps ?? []) {
      assertOwner(m.name, 'wrap', w.module)
      registry.addWrap(w)
    }
  }

  function inspect(kind: 'action' | 'pipeline' | 'event', name: string): unknown {
    if (kind === 'pipeline') return pipelines.steps(name)
    if (kind === 'event') return events.subscribers(name)
    const action = registry.get(name)
    if (!action) return undefined
    return {
      name: action.name,
      module: actionOwner.get(name) ?? '',
      permission: action.permission,
      risk: action.risk,
      wraps: registry.wraps(name),
    } satisfies ActionInfo
  }

  return {
    registry,
    events,
    pipelines,
    modules: ordered.map((m) => m.name),
    inspect: inspect as App['inspect'],
  }
}
