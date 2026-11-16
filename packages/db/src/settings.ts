import {
  createSettingsReader,
  settingRecordId,
  type SettingsReader,
  type SettingStore,
} from '@aicommerce/core'
import { sql } from 'drizzle-orm'
import type { Database } from './client.js'
import { decryptSecret, encryptSecret } from './crypto.js'
import { createRevisions } from './revisions.js'

export interface PgSettingsOptions {
  /** From AICOMMERCE_SECRET_KEY, through parseSecretKey. */
  secretKey: Buffer
  /** Stored values that cannot be read or no longer validate. Default: console.error. */
  onError?: (error: unknown) => void
}

const SECRET = '[secret]'

/** Settings in the `setting` table; secret values are encrypted with the key as AAD. */
export function createPgSettings(
  database: Database,
  options: PgSettingsOptions,
): { reader: SettingsReader; store: SettingStore } {
  const run = async (query: ReturnType<typeof sql>) =>
    (await database.current().execute(query)) as unknown as Record<string, unknown>[]
  const revisions = createRevisions(database)
  const same = (channel: string | null) => sql`coalesce(channel, '') = ${channel ?? ''}`

  const store: SettingStore = {
    async read(key, channel) {
      const [row] = await run(sql`select value, encrypted from setting
        where key = ${key} and ${same(channel)}`)
      if (!row) return undefined
      if (typeof row.encrypted === 'string') {
        const plain = decryptSecret(row.encrypted, options.secretKey, settingRecordId(key, channel))
        return { value: JSON.parse(plain) as unknown }
      }
      return { value: row.value }
    },

    async write(def, channel, value, meta) {
      const id = settingRecordId(def.key, channel)
      const secret = def.privacy === 'secret'
      const shown = (v: unknown) => ({ key: def.key, channel, value: secret ? SECRET : v })
      const [old] = await run(sql`select value, version from setting
        where key = ${def.key} and ${same(channel)} for update`)
      const encrypted = secret ? encryptSecret(JSON.stringify(value), options.secretKey, id) : null
      const stored = secret ? null : JSON.stringify(value)
      const [row] = await run(sql`insert into setting (key, channel, value, encrypted)
        values (${def.key}, ${channel}, ${stored}::jsonb, ${encrypted})
        on conflict (key, (coalesce(channel, ''))) do update set
          value = excluded.value, encrypted = excluded.encrypted,
          version = setting.version + 1, updated_at = now()
        returning version`)
      const version = Number(row?.version)
      await revisions.record({
        resource: 'setting',
        recordId: id,
        version,
        meta,
        before: old ? shown(old.value) : null,
        after: shown(value),
      })
      return version
    },

    async remove(def, channel, meta) {
      const rows = await run(sql`delete from setting
        where key = ${def.key} and ${same(channel)} returning value`)
      const [old] = rows
      if (!old) return false
      await revisions.record({
        resource: 'setting',
        recordId: settingRecordId(def.key, channel),
        version: null,
        meta,
        before: { key: def.key, channel, value: def.privacy === 'secret' ? SECRET : old.value },
        after: null,
      })
      return true
    },

    history: (key, channel, cursor, limit) =>
      revisions.page('setting', settingRecordId(key, channel), cursor, limit),
  }

  return { reader: createSettingsReader(store, options.onError), store }
}
