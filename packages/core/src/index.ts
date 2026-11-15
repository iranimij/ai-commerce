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
  type PipelineDefinition,
  type Pipelines,
  type Step,
  type TraceEntry,
} from './pipeline.js'
