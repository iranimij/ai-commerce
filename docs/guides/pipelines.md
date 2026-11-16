# Pipelines

A pipeline is a value that passes through ordered steps from any module, so modules can adjust a
result without knowing about each other. Every run returns a trace of what each step changed.

Example: `sample.greeting` in [`modules/sample/src/index.ts`](../../modules/sample/src/index.ts),
and the `sample-loud` step in [`modules/sample/src/index.test.ts`](../../modules/sample/src/index.test.ts).

```ts
export const greeting = definePipeline<{ text: string }>('sample.greeting')
const { value, trace } = await ctx.pipelines.run(greeting, { text: `Hello, ${name}` })
```

## Rules that bite

- Steps run by `order` (lower first), then module name, then step name.
- A step returns the new value; it should not mutate the one it was given.
- `app.inspect('pipeline', name)` lists the steps in order.
