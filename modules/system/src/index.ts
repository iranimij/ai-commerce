import { defineModule } from '@aicommerce/core'
import { createAttribute, deleteAttribute, listAttributes } from './attributes.js'
import { listJobs, retryJob } from './jobs.js'
import { disableModule, enableModule, listModules } from './modules.js'
import { listSettings, resetSetting, setSetting, settingHistory } from './settings.js'

export { createAttribute, deleteAttribute, listAttributes }
export { listJobs, retryJob }
export { disableModule, enableModule, listModules }
export { listSettings, resetSetting, setSetting, settingHistory }

/** Admin actions every shop has: attributes, settings, jobs and modules. */
export const system = defineModule({
  name: 'system',
  label: 'System',
  description: 'Settings, attributes, background jobs and switching modules on and off',
  required: true,
  namespaces: ['attribute', 'setting', 'job', 'module'],
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
    listModules,
    enableModule,
    disableModule,
  ],
})
