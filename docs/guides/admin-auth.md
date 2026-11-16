# Admin sign-in and roles

Admins sign in with email and password at `/api/auth/*` (Better Auth). An admin without two-factor
authentication can sign in but has no permissions until they turn on TOTP. Permissions come from
roles.

Tests: [`packages/auth/src/auth.integration.test.ts`](../../packages/auth/src/auth.integration.test.ts)
and [`modules/access/src/access.integration.test.ts`](../../modules/access/src/access.integration.test.ts).

## Sessions

- 8-hour sessions, refreshed after an hour of use. Cookies `aicommerce-admin.*`: httpOnly,
  SameSite=Strict, Secure in production.
- 5 sign-in attempts per minute per address. Self sign-up is off; admins are created by admins.
- A disabled admin cannot sign in, and disabling ends their sessions.

## Roles

The `owner` role has `*` and cannot be changed or deleted. Other roles list permissions; the
permissions that exist are those of the enabled modules (`appInfo.permissions()`).

## Rules that bite

- Nobody can grant, remove or edit permissions they do not have. Only a `*` holder can grant `*` or
  the owner role.
- At least one active owner must remain, and an admin cannot disable themselves.
- A role still assigned cannot be deleted.
- The installer (M0c) creates the first owner.
