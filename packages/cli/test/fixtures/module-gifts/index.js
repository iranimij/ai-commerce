// A third-party module as a plain object: no dependencies, so tests install it offline.
export default {
  name: 'gifts',
  label: 'Gift wrapping',
  description: 'Adds gift wrapping to orders',
  depends: ['sample'],
  actions: [
    { name: 'gifts.wrap', description: 'Wrap an order', permission: 'gifts.manage', risk: 'write' },
    { name: 'gifts.peek', description: 'Show the wrapping papers', permission: null, risk: 'read' },
  ],
  settings: [
    { key: 'gifts.api-key', label: 'Paper supplier key', privacy: 'secret', scope: 'global' },
    { key: 'gifts.paper', label: 'Default paper', privacy: 'public', scope: 'global' },
  ],
  jobs: [{ name: 'gifts.restock', description: 'Order more paper' }],
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
