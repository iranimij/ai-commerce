# Services

A service is an implementation behind a name: storage, the settings reader, the job queue, the
identity provider. Code asks for it with `ctx.service(def)`; the app decides which implementation
answers. This is how core behaviour is replaced without editing core.

Example: `ctx.service(settings)` in `sample.greet`
([`modules/sample/src/index.ts`](../../modules/sample/src/index.ts)).

```ts
export const clock = defineService<{ now(): Date }>('shop.clock')
createApp({ services: [provide(clock, 'app', { now: () => new Date() })] /* … */ })
// a module replacing it:
defineModule({ name: 'fixed-clock', provides: [provide(clock, 'fixed-clock', fixedClock)] })
```

## Rules that bite

- Defaults come from `createApp({ services })`; a module's `provides` replaces them.
- Two unrelated modules providing the same service is a startup error. If one depends on the
  other, the dependent wins.
- `app.inspect('service', name)` shows the provider and what it replaced.
- `createApp` itself provides `appInfo` (resources, attributes, permissions, settings), and a
  defaults-only `settings` reader when none is given.
