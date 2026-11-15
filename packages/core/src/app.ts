import type { ActionDefinition } from './action.js'
import { createEventBus, type EventBus, type EventBusOptions } from './events.js'
import type { ModuleDefinition } from './module.js'
import { createPipelines, type Pipelines } from './pipeline.js'
import { createRegistry, type Registry, type RegistryOptions } from './registry.js'
import type { ServiceDefinition, ServiceProvision } from './service.js'

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
  inspect(kind: 'service', name: string): ServiceInfo | undefined
  /** The implementation of a service; throws if nothing provides it. */
  service<T>(def: ServiceDefinition<T>): T
}

export interface ServiceInfo {
  /** The module whose implementation is used, or 'app' for the default. */
  provider: string
  /** Providers it replaced, in load order. */
  replaced: string[]
}

export interface AppOptions extends Pick<
  RegistryOptions,
  'audit' | 'transaction' | 'onAuditError' | 'onError'
> {
  /** Reported when an event subscriber fails. Default: console.error. */
  onEventError?: EventBusOptions['onError']
  modules: ModuleDefinition[]
  /** Names of the modules to load. Anything not listed contributes nothing. */
  enabled: string[]
  /** Default service implementations; an enabled module may replace them. */
  services?: ServiceProvision[]
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

/** Each module's transitive dependencies. `ordered` lists dependencies before dependents. */
function dependencyClosure(ordered: ModuleDefinition[]): Map<string, Set<string>> {
  const closure = new Map<string, Set<string>>()
  for (const m of ordered) {
    const all = new Set<string>()
    for (const dep of m.depends ?? []) {
      all.add(dep)
      for (const d of closure.get(dep) ?? []) all.add(d)
    }
    closure.set(m.name, all)
  }
  return closure
}

/** Namespace -> owning module. Two modules may not claim the same namespace. */
function claimNamespaces(ordered: ModuleDefinition[]): Map<string, string> {
  const owners = new Map<string, string>()
  for (const m of ordered) {
    for (const ns of m.namespaces ?? [m.name]) {
      const other = owners.get(ns)
      if (other !== undefined && other !== m.name) {
        throw new Error(`Namespace "${ns}" is claimed by modules "${other}" and "${m.name}"`)
      }
      owners.set(ns, m.name)
    }
  }
  return owners
}

interface Provider extends ServiceInfo {
  implementation: unknown
}

function resolveServices(
  options: AppOptions,
  ordered: ModuleDefinition[],
  closure: Map<string, Set<string>>,
): Map<string, Provider> {
  const providers = new Map<string, Provider>()
  for (const p of options.services ?? []) {
    providers.set(p.service.name, {
      provider: 'app',
      replaced: [],
      implementation: p.implementation,
    })
  }
  for (const m of ordered) {
    for (const p of m.provides ?? []) {
      assertOwner(m.name, 'service provision', p.module)
      const current = providers.get(p.service.name)
      if (current && current.provider !== 'app' && !closure.get(m.name)?.has(current.provider)) {
        throw new Error(
          `Modules "${current.provider}" and "${m.name}" both provide service "${p.service.name}"; one must depend on the other`,
        )
      }
      providers.set(p.service.name, {
        provider: m.name,
        replaced: current ? [...current.replaced, current.provider] : [],
        implementation: p.implementation,
      })
    }
  }
  return providers
}

export function createApp(options: AppOptions): App {
  const pipelines = createPipelines()
  const ordered = loadOrder(options)
  const closure = dependencyClosure(ordered)
  const namespaceOwner = claimNamespaces(ordered)
  const providers = resolveServices(options, ordered, closure)
  const service = <T>(def: ServiceDefinition<T>): T => {
    const p = providers.get(def.name)
    if (!p) throw new Error(`Service "${def.name}" is not provided`)
    return p.implementation as T
  }
  const { onEventError, audit, transaction, onAuditError, onError } = options
  const events = createEventBus({
    onError:
      onEventError ??
      ((error, info) => {
        console.error(`Subscriber of ${info.module} failed on ${info.event}`, error)
      }),
  })
  // Only the hooks that were given: exactOptionalPropertyTypes forbids passing undefined.
  const registry = createRegistry({
    pipelines,
    events,
    service,
    ...(audit && { audit }),
    ...(transaction && { transaction }),
    ...(onAuditError && { onAuditError }),
    ...(onError && { onError }),
  })
  const actionOwner = new Map<string, string>()

  for (const m of ordered) {
    for (const action of m.actions ?? []) {
      const ns = action.name.split('.')[0] ?? ''
      if (namespaceOwner.get(ns) !== m.name) {
        throw new Error(
          `Module "${m.name}" cannot declare action "${action.name}": namespace "${ns}" is not declared by module "${m.name}"`,
        )
      }
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
      const target = actionOwner.get(w.action)
      if (target !== undefined && target !== m.name && !closure.get(m.name)?.has(target)) {
        throw new Error(
          `Module "${m.name}" wraps "${w.action}" but does not depend on module "${target}"`,
        )
      }
      registry.addWrap(w)
    }
  }

  function inspect(kind: 'action' | 'pipeline' | 'event' | 'service', name: string): unknown {
    if (kind === 'service') {
      const p = providers.get(name)
      return p ? ({ provider: p.provider, replaced: p.replaced } satisfies ServiceInfo) : undefined
    }
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
    service,
  }
}
