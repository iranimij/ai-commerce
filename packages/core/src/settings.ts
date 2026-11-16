import type { z } from 'zod'
import type { PrivacyClass } from './privacy.js'
import type { Page, Revision, WriteMeta } from './resource.js'
import { defineService } from './service.js'

const KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

export interface SettingDefinition<S extends z.ZodType = z.ZodType> {
  /** Looks like an action name; its first segment is a namespace of the module. */
  key: string
  module: string
  label: string
  description?: string
  schema: S
  default?: z.infer<S>
  privacy: PrivacyClass
  /** `channel` settings may have a value per sales channel. */
  scope: 'global' | 'channel'
  /** Needed to change it, on top of `setting.manage`. Default: `setting.manage`. */
  permission: string
}

export interface SettingInput<S extends z.ZodType> extends Omit<
  SettingDefinition<S>,
  'permission'
> {
  permission?: string
}

export function defineSetting<S extends z.ZodType>(def: SettingInput<S>): SettingDefinition<S> {
  if (!KEY.test(def.key)) throw new Error(`Invalid setting key "${def.key}"`)
  if (def.default !== undefined) {
    if (def.privacy === 'secret') {
      throw new Error(`Setting "${def.key}" is secret and cannot have a default`)
    }
    def.schema.parse(def.default)
  }
  return { ...def, permission: def.permission ?? 'setting.manage' }
}

export interface SettingsReader {
  /** The channel value, then the global value, then the default. */
  get<S extends z.ZodType>(
    def: SettingDefinition<S>,
    options?: { channel?: string },
  ): Promise<z.infer<S> | undefined>
}

export const settings = defineService<SettingsReader>('core.settings')

/** Where stored values come from. `read` throws when a stored value cannot be read. */
export interface SettingSource {
  read(key: string, channel: string | null): Promise<{ value: unknown } | undefined>
}

/** Writes and history, used by the setting actions. Writes record a revision. */
export interface SettingStore extends SettingSource {
  write(
    def: SettingDefinition,
    channel: string | null,
    value: unknown,
    meta: WriteMeta,
  ): Promise<number>
  /** Returns false when nothing was stored. */
  remove(def: SettingDefinition, channel: string | null, meta: WriteMeta): Promise<boolean>
  history(
    key: string,
    channel: string | null,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<Revision>>
}

export const settingStore = defineService<SettingStore>('core.setting-store')

/** The revision record id of a setting value. */
export const settingRecordId = (key: string, channel: string | null) =>
  channel === null ? key : `${key}@${channel}`

/**
 * Reads settings with precedence and validation. A stored value that cannot be read or no longer
 * validates gives the default, and is reported once.
 */
export function createSettingsReader(
  source: SettingSource,
  onError: (error: unknown) => void = (error) => {
    console.error(error)
  },
): SettingsReader {
  const reported = new Set<string>()
  const report = (id: string, error: unknown) => {
    if (reported.has(id)) return
    reported.add(id)
    onError(error)
  }
  return {
    async get(def, options) {
      const channels =
        def.scope === 'channel' && options?.channel ? [options.channel, null] : [null]
      for (const channel of channels) {
        const id = settingRecordId(def.key, channel)
        let stored: { value: unknown } | undefined
        try {
          stored = await source.read(def.key, channel)
        } catch (error) {
          report(id, new Error(`Setting "${id}" cannot be read`, { cause: error }))
          return def.default
        }
        if (stored === undefined) continue
        const parsed = def.schema.safeParse(stored.value)
        if (parsed.success) return parsed.data
        report(id, new Error(`Stored value of setting "${id}" no longer validates`))
        return def.default
      }
      return def.default
    },
  }
}
