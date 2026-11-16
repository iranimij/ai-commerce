# Actions

Everything a person, the AI, a job or another module does goes through an action: a named, typed
function with a permission and a risk. The admin, the API, the chat and the importers all call the
same actions, so the same checks and the same audit log apply everywhere.

Example: `sample.greet` in [`modules/sample/src/index.ts`](../../modules/sample/src/index.ts).

```ts
export const greet = defineAction({
  name: 'sample.greet',
  description: 'Greet someone by name',
  input: z.object({ name: z.string().min(1).max(100) }),
  output: z.object({ greeting: z.string() }),
  permission: null, // public
  risk: 'read',
  handler: async (input, ctx) => {
    /* … */
  },
})
```

## What happens on a call

1. The input is validated against a **strict** version of `input`: unknown keys are refused.
2. The permission is checked (`can(actor, permission)`; `*` grants everything).
3. A `destructive` action called by an admin or customer needs `confirmed: true`, otherwise the
   result is `confirmation_required`.
4. Writes run in a transaction. Wraps run around the handler, then the output is validated.
5. One audit row is written, whatever the outcome. Events are delivered only after success.

## Rules that bite

- The name is `namespace.verb`, and the namespace must belong to the module declaring it.
- Nested objects in `input` must be `z.strictObject`; `register` refuses anything looser.
- Throw `ActionError('not_found' | 'conflict' | 'forbidden' | 'invalid_input', message)` for an
  expected failure. Anything else becomes `handler_error` and is reported, not shown.
- `read` actions do not run in a transaction and must not write.
- Keys containing words such as password, token or secret are redacted from the audit log; list
  other sensitive keys in `redact`.
- Await everything: `db.current()` is only valid during the call.
- Every `permission: null` action must be listed in `apps/server/security/public-actions.json`, or
  CI fails.
