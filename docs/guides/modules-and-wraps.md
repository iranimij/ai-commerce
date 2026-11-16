# Modules and wraps

A module is a package that brings actions, resources, settings, jobs, subscribers, pipeline steps,
wraps and services. A disabled module is absent: none of its actions exist and its jobs wait.

Example: the `sample` module in [`modules/sample/src/index.ts`](../../modules/sample/src/index.ts),
and the wrap in [`modules/sample/src/index.test.ts`](../../modules/sample/src/index.test.ts)
("a wrap in another module changes sample.greet").

## Wraps: changing another module without editing it

```ts
const polite = defineModule({
  name: 'sample-polite',
  depends: ['sample'],
  wraps: [
    {
      action: 'sample.greet',
      module: 'sample-polite',
      order: 100,
      wrap: async (input, ctx, next) => {
        const out = (await next(input)) as { greeting: string }
        return { greeting: `${out.greeting}, welcome` }
      },
    },
  ],
})
```

A wrap runs after validation, the permission check and the confirm gate, and before output
validation. Lower `order` runs outside. It may change the input, the output, or answer without
calling `next`.

## Rules that bite

- A module may only wrap actions of modules it depends on, directly or transitively.
- `next` may be called once; a second call fails the action.
- `namespaces` lists the first segments the module's action, setting and job names use. The
  default is the module name. Each resource name is added automatically. Two modules cannot claim
  the same namespace.
- Everything a module declares carries `module: '<its name>'`; declaring another module's thing is
  a startup error.
- `app.inspect('action', name)` shows the wraps around an action, in order.
