# Privacy classes

Every field has a privacy class that decides whether it may reach an AI model: `public`,
`internal`, `personal` or `secret`. A field without one is treated as `personal`.

Example: the `note` fields in [`modules/sample/src/index.ts`](../../modules/sample/src/index.ts):
`title` is public, `body` is internal.

```ts
title: classify(z.string().min(1).max(200), 'public'),
```

`toModel(schema, value, policy)` is the only place data is prepared for a model. It keeps public
fields; internal fields only when the owner allows rows (`internalRows`); personal fields only at
paths the owner allowed (`personalFields`); never secret ones; never keys the schema does not know.
It reports which classes were kept and which paths were removed, for the "what left my server" log.

## Rules that bite

- The nearest class wins, but nothing under a `secret` object can be reclassified.
- Unions, records and transforms are treated as one leaf with the nearest class.
- Resources refuse `secret` fields: store secrets as [settings](settings.md).
- Attribute values in record output are personal until M1 applies each attribute's own class.
