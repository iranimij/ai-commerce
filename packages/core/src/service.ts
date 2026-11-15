/** A named interface a module can provide or replace, such as the tax calculator (spec 4.2a). */
export interface ServiceDefinition<T> {
  readonly name: string
  /** Type carrier only; never set. */
  readonly type?: T
}

export function defineService<T>(name: string): ServiceDefinition<T> {
  return { name }
}

export interface ServiceProvision<T = unknown> {
  service: ServiceDefinition<T>
  /** The module providing it, or 'app' for a default passed to `createApp`. */
  module: string
  implementation: T
}

export function provide<T>(
  service: ServiceDefinition<T>,
  module: string,
  implementation: T,
): ServiceProvision<T> {
  return { service, module, implementation }
}
