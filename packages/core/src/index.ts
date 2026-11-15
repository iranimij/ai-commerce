export const VERSION = '0.0.0'

export { defineAction, type ActionContext, type ActionDefinition, type Risk } from './action.js'
export { can, guestActor, systemActor, type Actor, type ActorType } from './actor.js'
export { createRegistry, type CallOptions, type Registry } from './registry.js'
export { type CallError, type ErrorCode, type Result } from './result.js'
export {
  createEventBus,
  defineEvent,
  type EventBus,
  type EventBusOptions,
  type EventDefinition,
  type Subscriber,
} from './events.js'
export {
  createPipelines,
  definePipeline,
  defineStep,
  type PipelineDefinition,
  type Pipelines,
  type Step,
  type TraceEntry,
} from './pipeline.js'
export { createApp, type ActionInfo, type App, type AppOptions, type ServiceInfo } from './app.js'
export { defineModule, type ActionWrap, type ModuleDefinition } from './module.js'
export { type RegistryOptions } from './registry.js'
export { ActionError, type HandlerErrorCode } from './errors.js'
export { defineService, provide, type ServiceDefinition, type ServiceProvision } from './service.js'
export { describeInvalidInput, redactInput, type AuditEntry, type AuditSink } from './audit.js'
export {
  classify,
  privacyOf,
  toModel,
  type BoundaryResult,
  type ModelPolicy,
  type PrivacyClass,
} from './privacy.js'
