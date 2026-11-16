import { defineModule } from '@aicommerce/core'
import { createAttribute, deleteAttribute, listAttributes } from './attributes.js'
import { listJobs, retryJob } from './jobs.js'
import { listSettings, resetSetting, setSetting, settingHistory } from './settings.js'

export { createAttribute, deleteAttribute, listAttributes }
export { listJobs, retryJob }
export { listSettings, resetSetting, setSetting, settingHistory }

/** Admin actions every shop has: attributes, settings and jobs. */
export const system = defineModule({
  name: 'system',
  namespaces: ['attribute', 'setting', 'job'],
  actions: [
    listAttributes,
    createAttribute,
    deleteAttribute,
    listSettings,
    setSetting,
    resetSetting,
    settingHistory,
    listJobs,
    retryJob,
  ],
})
