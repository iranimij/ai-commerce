// Passes the shape check, but its action has no Zod schemas, so building the app throws.
export default {
  name: 'broken',
  label: 'Broken',
  actions: [{ name: 'broken.go', description: 'Go', permission: 'broken.go', risk: 'read' }],
}
