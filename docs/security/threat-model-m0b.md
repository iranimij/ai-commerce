# Threat model: M0b (data, auth, server)

Scope: the HTTP server, admin sign-in, the action call path, settings, jobs and migrations as of
M0b. No storefront, customer accounts, AI or payments yet.

## Assets

| Asset           | Why it matters                                                                 |
| --------------- | ------------------------------------------------------------------------------ |
| Admin accounts  | Full control of the shop                                                       |
| Secrets         | Setting secrets (payment keys later), `AICOMMERCE_SECRET_KEY`, the auth secret |
| Personal data   | Admin emails now; customers and orders from M2                                 |
| The audit trail | The record of who did what; must survive a compromised app                     |

## Entry points

1. `POST /api/actions/:name`: every read and write.
2. `/api/auth/*`: sign-in, 2FA, sessions (Better Auth).
3. The worker: runs job payloads stored in the database.
4. Migrations: run with the owner role at startup.

## Threats and mitigations

| Threat                                                                 | Mitigation                                                                                                                          | Proven by                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password guessing                                                      | 5 attempts a minute per address, shared across processes; 12-character minimum                                                      | `auth`: the sixth failed sign-in within a minute is refused with 429                                                                                                                                                                  |
| Forged client address to dodge limits                                  | The server sets the address header Better Auth reads; X-Forwarded-For only for trusted hops                                         | `server`: a forged client address header cannot reach Better Auth                                                                                                                                                                     |
| Stolen password                                                        | Mandatory TOTP before any permission                                                                                                | `auth`: an admin without 2FA has no permissions                                                                                                                                                                                       |
| Cross-site request with the admin cookie                               | SameSite=Strict cookie, and an Origin check before the action runs                                                                  | `server`: cookie request from another origin is rejected                                                                                                                                                                              |
| Privilege escalation by an admin                                       | Nobody grants, removes or edits permissions they lack; only `*` grants owner                                                        | `access`: an admin cannot grant a permission they lack; only an owner can grant the owner role                                                                                                                                        |
| Locking everyone out                                                   | Last active owner cannot be demoted or disabled                                                                                     | `access`: the last owner cannot be demoted or disabled                                                                                                                                                                                |
| Disabled admin keeps access                                            | Disabling ends sessions; no new sessions                                                                                            | `auth`: a disabled admin cannot sign in and their session stops working                                                                                                                                                               |
| Unreviewed public action                                               | Every `permission: null` action must be in `public-actions.json`                                                                    | `public-actions`: the public actions are exactly the reviewed list                                                                                                                                                                    |
| Mass assignment, prototype pollution                                   | Strict input schemas everywhere, strict request envelope                                                                            | `public-actions`: bad input is 400, never 500                                                                                                                                                                                         |
| Untraced security changes (2FA off, password change, sign-in attempts) | Every POST to `/api/auth` writes an audit row by path, actor and outcome, without the body                                          | `server`: auth requests are audited by path and outcome, never with the body                                                                                                                                                          |
| Lost update                                                            | Optimistic versions on update, delete and restore                                                                                   | `note`: concurrent updates from one version, exactly one wins; restore takes the version you read                                                                                                                                     |
| Tampering with history                                                 | `audit_log` and `revision` are append-only; the runtime role cannot update or delete them, even with triggers off                   | `roles`: the app role cannot change or delete audit rows                                                                                                                                                                              |
| Secrets leaking from the database or logs                              | AES-256-GCM with the key and channel as AAD; values redacted from the audit log; request bodies never logged                        | `settings`: a secret is stored encrypted; the audit row never contains the value; `server`: the log line never contains the request body                                                                                              |
| Secret moved to another setting                                        | AAD binds a ciphertext to its key                                                                                                   | `settings`: a ciphertext copied to another key cannot be read                                                                                                                                                                         |
| Clickjacking, sniffing, referrer leaks                                 | CSP `default-src 'none'; frame-ancestors 'none'`, nosniff, no-referrer, CORP; HSTS in production                                    | `server`: every response carries the security headers                                                                                                                                                                                 |
| Denial of service by large bodies                                      | 1 MiB limit on actions, 64 KiB on `/api/auth`, read before Better Auth parses; per-address (IPv6 per /64) and per-admin rate limits | `server`: a non-JSON body is 415, an oversized body 413; the 121st guest call in a minute is 429 with Retry-After; an auth request over 64 KiB is 413 before Better Auth reads it; guest addresses in one IPv6 /64 share a rate limit |
| Data sent to an AI model                                               | `toModel` removes secret, unknown and unallowed fields (used from M1)                                                               | `core`: the `toModel` unit tests in `privacy.test.ts`                                                                                                                                                                                 |

## Residual risks

- **IP allow-list for the admin** is not built (M1).
- **API tokens** for non-browser clients are not built (M10); until then the cookie needs an Origin.
- **Key rotation** for `AICOMMERCE_SECRET_KEY` is not built; losing the key loses stored secrets,
  and a leaked key exposes them. Keep it in a secret manager, never in git.
- **Fixed-window rate limits** allow up to twice the limit across a window boundary. Old windows
  are pruned on about one hit in a hundred, until a scheduled job exists.
- **Settings** are last-write-wins: two admins setting one key do not get a conflict.
- **Events** are delivered in-process after commit and can be lost on a crash (outbox later).
- **TOTP issuer** is form-encoded in the setup URI ("AI+Commerce"); check with a real
  authenticator app at the M0c QA gate.
- **Better Auth** is a third-party dependency on the sign-in path: pinned exactly, updated
  deliberately, covered by integration tests.
