# Settings

A setting is typed configuration with a privacy class, a scope and a default. Secret settings are
encrypted at rest and never shown again.

Example: `sample.greeting-word` and `sample.webhook-secret` in
[`modules/sample/src/index.ts`](../../modules/sample/src/index.ts); `sample.greet` reads the first.

```ts
export const greetingWord = defineSetting({
  key: 'sample.greeting-word',
  module: 'sample',
  label: 'Greeting word',
  schema: z.string().min(1).max(50),
  default: 'Hello',
  privacy: 'public',
  scope: 'global',
})
const word = await ctx.service(settings).get(greetingWord)
```

## Rules that bite

- Reading gives the channel value, then the global value, then the default. A stored value that
  no longer validates gives the default and is reported once.
- A secret setting has no default. Its value is encrypted with AES-256-GCM using
  `AICOMMERCE_SECRET_KEY`; a ciphertext copied to another setting cannot be read.
- `setting.set` checks the setting's own `permission` (default `setting.manage`) and never writes
  the value to the audit log. Revisions keep non-secret values; secrets show as `[secret]`.
- `setting.list` never includes the value of a secret setting.
- Changing `AICOMMERCE_SECRET_KEY` makes stored secrets unreadable. Key rotation is not built yet.
