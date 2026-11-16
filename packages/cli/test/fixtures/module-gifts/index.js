// A third-party module as plain objects. zod is a peer dependency, as for a real module, so the
// test shop links the monorepo's copy and installs stay offline.
import { z } from 'zod'

const none = z.object({})
const handler = () => Promise.resolve({})

export default {
  name: 'gifts',
  label: 'Gift wrapping',
  description: 'Adds gift wrapping to orders',
  depends: ['sample'],
  actions: [
    {
      name: 'gifts.wrap',
      description: 'Wrap an order',
      input: none,
      output: none,
      permission: 'gifts.manage',
      risk: 'write',
      handler,
    },
    {
      name: 'gifts.peek',
      description: 'Show the wrapping papers',
      input: none,
      output: none,
      permission: null,
      risk: 'read',
      handler,
    },
  ],
  settings: [
    {
      key: 'gifts.api-key',
      module: 'gifts',
      label: 'Paper supplier key',
      schema: z.string(),
      privacy: 'secret',
      scope: 'global',
    },
    {
      key: 'gifts.paper',
      module: 'gifts',
      label: 'Default paper',
      schema: z.string(),
      privacy: 'public',
      scope: 'global',
    },
  ],
  jobs: [
    {
      name: 'gifts.restock',
      module: 'gifts',
      description: 'Order more paper',
      payload: z.strictObject({}),
      handler,
    },
  ],
  wraps: [
    {
      action: 'sample.greet',
      module: 'gifts',
      order: 100,
      wrap: (input, _ctx, next) => next(input),
    },
  ],
  provides: [{ service: { name: 'core.tax' }, module: 'gifts', implementation: {} }],
}
