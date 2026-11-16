import { defineModule } from '@aicommerce/core'
import { createAttribute, deleteAttribute, listAttributes } from './attributes.js'

export { createAttribute, deleteAttribute, listAttributes }

/** Admin actions every shop has: attributes, settings and jobs. */
export const system = defineModule({
  name: 'system',
  namespaces: ['attribute', 'setting', 'job'],
  actions: [listAttributes, createAttribute, deleteAttribute],
})
