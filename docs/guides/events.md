# Events

An event tells other modules that something happened. Subscribers cannot change the outcome; use a
pipeline or a wrap for that.

Example: `sample.greeted` in [`modules/sample/src/index.ts`](../../modules/sample/src/index.ts),
emitted by `sample.greet`, and the subscriber test in
[`modules/sample/src/index.test.ts`](../../modules/sample/src/index.test.ts).

```ts
export const greeted = defineEvent('sample.greeted', z.object({ name: z.string() }))
// in a handler:
await ctx.events.emit(greeted, { name: input.name })
```

## Rules that bite

- Events emitted in a handler are delivered after the call commits, and only if it succeeded.
- A failing subscriber is reported (`onEventError`) and does not affect the call or other
  subscribers.
- Delivery is in-process for now: a crash between commit and delivery loses the event. An outbox
  comes later; do not use events for work that must happen — enqueue a [job](jobs.md) instead.
- The payload is validated on emit.
