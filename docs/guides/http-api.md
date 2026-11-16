# HTTP API

Every enabled action is `POST /api/actions/<name>` with the body `{ "input": …, "confirmed"?: true }`.
The response body is the action's result: `{ ok: true, output }` or `{ ok: false, error }`.
`/api/openapi.json` describes every action, generated from the registry.

```sh
curl -X POST localhost:3000/api/actions/sample.greet \
  -H 'content-type: application/json' -d '{"input":{"name":"Ada"}}'
```

Tests: [`apps/server/src/server.integration.test.ts`](../../apps/server/src/server.integration.test.ts)
and the end-to-end [`apps/server/src/acceptance.integration.test.ts`](../../apps/server/src/acceptance.integration.test.ts).

| Result                  | Status                            |
| ----------------------- | --------------------------------- |
| ok                      | 200                               |
| `invalid_input`         | 400                               |
| `forbidden`             | 401 for a guest, 403 for an admin |
| `not_found`             | 404 (also an unknown action)      |
| `conflict`              | 409                               |
| `confirmation_required` | 428                               |
| rate limited            | 429, with `Retry-After`           |
| `handler_error`         | 500                               |

Other routes: `/healthz`, `/readyz` (checks the database), `/api/me` (who you are, and whether 2FA
is required) and `/api/auth/*`.

## Rules that bite

- JSON only (415 otherwise), at most 1 MiB (413 otherwise); `/api/auth/*` at most 64 KiB.
- Every POST to `/api/auth/*` (sign-in, 2FA changes, sign-out) writes an audit row
  `auth.<path>` with the address and outcome, never the body.
- A request with an admin session must send an `Origin` matching `AICOMMERCE_PUBLIC_URL`, or it is
  rejected with 403 before the action runs.
- Limits: 120 calls a minute per address for guests (an IPv6 /64 counts as one), 600 per admin. Behind a reverse proxy, set
  `AICOMMERCE_TRUSTED_PROXIES` to the number of proxies, or every guest shares one address.
- Logs are one JSON line per request without bodies or headers; use `X-Request-Id` to find one.
