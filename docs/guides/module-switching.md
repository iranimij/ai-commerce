# Switching modules on and off

A module is installed (its code is in the shop) or not, and enabled or not. Only enabled modules
contribute anything: a disabled module's actions answer 404, its steps, wraps and subscribers do
not run, and its jobs are not picked up. Its tables and rows stay, and come back when it is
enabled again.

## Who decides what is on

- **On a fresh install**, the server runs `AICOMMERCE_MODULES` (default `system,access,sample`)
  plus every module marked `required` (`system`, `access` and `setup`).
- **From then on**, the `module_state` table decides. It is written by setup (presets `minimal`
  and `full`), by `module.enable` and `module.disable`, and by `ai-commerce module …`.

```ts
// packages/core/src/presets.ts
resolveModules(all, ['checkout'])
// → { enabled: ['system', 'access', 'catalog', 'cart', 'checkout'],
//     added: [{ module: 'system', requiredBy: null }, …, { module: 'cart', requiredBy: 'checkout' }] }
```

## The actions

- `module.list` (`module.read`): every installed module and whether it is on.
- `module.enable` (`module.manage`): switches on the module and every dependency, and lists what
  it added and why.
- `module.disable` (`module.manage`, destructive, so it needs `confirmed`):
  - It refuses a required module.
  - It refuses a module that an enabled module needs, and names those modules.
  - It keeps the data.

Each change writes a revision of `module` and an audit row.

## No restart

Writing module state sends `NOTIFY aicommerce_modules` with the schema name. PostgreSQL delivers
it only when the call commits. Every server and worker process listens
([`apps/server/src/app-host.ts`](../../apps/server/src/app-host.ts)). On a notification, a process:

1. reads the stored state;
2. runs the migrations of any newly enabled module, as the owner role;
3. builds a new app and swaps it in.

Requests and jobs already running finish on the app they started with. If a rebuild fails, the
running app stays and the error is logged. A stored module that is no longer installed is skipped
and reported, so the shop still starts.

The contract test ([`apps/server/src/contract.integration.test.ts`](../../apps/server/src/contract.integration.test.ts))
checks this through the real server: with the sample module off, its notes are 404; switched back
on, they are back.
