# Attributes

Attributes are extra fields on a resource with `attributes: true`. Merchants add them in the admin;
modules add them in code. Values live in the record's `attributes` column.

Example: the integration tests in
[`modules/system/src/attributes.integration.test.ts`](../../modules/system/src/attributes.integration.test.ts),
which add a `colour` select attribute from a module and others as a merchant to the sample `note`.

```ts
defineModule({
  name: 'extra',
  depends: ['sample'],
  attributes: [
    defineAttribute({
      resource: 'note',
      code: 'colour',
      label: 'Colour',
      type: 'select',
      options: ['red', 'blue'],
    }),
  ],
})
```

Types: `text`, `number`, `boolean`, `date` (`YYYY-MM-DD`), `select` and `multiselect`.

## Rules that bite

- An unknown code or a bad value is `invalid_input`, with the issue path `['attributes', code]`.
- Required attributes must be given on create. On update, a key replaces its value and `null`
  removes a non-required one.
- `list` filters by attribute with containment (`attributes @> …`), validated the same way.
- Module attributes cannot be deleted by a merchant. Deleting a merchant attribute keeps the stored
  values hidden; recreating it with the same code and type shows them again.
- A module may only add attributes to its own resources or those of modules it depends on.
