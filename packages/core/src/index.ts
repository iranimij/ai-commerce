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
export {
  defineResource,
  isStructured,
  resourceActions,
  resourceStore,
  type ListQuery,
  type Page,
  type ResourceDefinition,
  type ResourceInput,
  type ResourcePermissions,
  type ResourceRecord,
  type ResourceStore,
  type Revision,
  type WriteMeta,
} from './resource.js'
export {
  appInfo,
  attributeInput,
  attributeStore,
  attributeValueSchema,
  checkAttributeValues,
  defineAttribute,
  merchantAttribute,
  visibleAttributes,
  type AppInfo,
  type AttributeDefinition,
  type AttributeInput,
  type AttributeStore,
  type AttributeType,
  type Swatch,
} from './attributes.js'
export {
  createSettingsReader,
  defineSetting,
  settingRecordId,
  settings,
  settingStore,
  type SettingDefinition,
  type SettingInput,
  type SettingSource,
  type SettingsReader,
  type SettingStore,
} from './settings.js'
export {
  defineJob,
  jobs,
  type JobContext,
  type JobDefinition,
  type JobInfo,
  type JobInput,
  type JobQueue,
  type JobStatus,
} from './jobs.js'
export {
  dependentsOf,
  moduleState,
  PRESETS,
  resolveModules,
  type ModuleStateStore,
  type PresetName,
  type ResolvedModules,
} from './presets.js'
export type { KnownModule } from './attributes.js'
export type { AicommerceConfig } from './config.js'
