# Threat model: M0c (install, setup, CLI, module switching)

Scope: first-run setup and its one-time token, the setup page, switching modules at run time,
`ai-commerce add`, backup and restore, `create-aicommerce` and the production image. It builds on
the [M0b threat model](threat-model-m0b.md); its mitigations still hold.

## Assets

| Asset                      | Why it matters                                                       |
| -------------------------- | -------------------------------------------------------------------- |
| The setup token            | Until setup finishes, whoever holds it can create the owner          |
| The owner account          | Full control of the shop, created through setup                      |
| `AICOMMERCE_SECRET_KEY`    | Decrypts secret settings, including the AI key entered at setup      |
| Backups                    | A full copy of the database: personal data, password hashes, secrets |
| The shop's dependency tree | Extensions run with the server's rights                              |

## Entry points

1. The public `setup.*` actions, reachable by anyone until setup finishes.
2. The setup page in the admin, which calls them through the admin's `/api` proxy.
3. `NOTIFY aicommerce_modules`: every process rebuilds its app when it arrives.
4. `ai-commerce add`, `backup` and `restore`, run by whoever has shell access.
5. `create-aicommerce`, which writes the secrets of a new shop.

## Threats and mitigations

| Threat                                          | Mitigation                                                                                                                                                         | Proven by                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Someone else finishes setup first               | 32 random bytes (base64url), shown only in the server's terminal output; every setup write needs it                                                                | `setup`: setup actions need the token                                                          |
| Guessing the token                              | Only its SHA-256 is stored; constant-time comparison; 10 setup calls a minute per address                                                                          | `setup`: guessing the token is rate-limited                                                    |
| Reusing the token, or a stale link, after setup | `setup.finish` drops the token and locks setup; no new token is issued once an owner exists                                                                        | `setup`: a finished setup refuses everything                                                   |
| An owner without 2FA                            | `setup.finish` refuses until the owner has turned on TOTP                                                                                                          | `setup`: finish needs the owner to have 2FA                                                    |
| A second owner through setup                    | `setup.create-owner` refuses when any owner exists                                                                                                                 | `setup`: create-owner twice is a conflict                                                      |
| A lost link or a restart locking setup          | A signed-in owner with 2FA may carry on without the token                                                                                                          | `setup`: an owner who lost the token can carry on signed in, after 2FA                         |
| The AI key in logs or the audit trail           | Stored as a secret setting (encrypted); the field is redacted from the audit row                                                                                   | `setup`: the AI key is stored as a secret setting                                              |
| Leaking server details to strangers             | `setup.status` shows the PostgreSQL version only while setup is unfinished                                                                                         | `setup`: status reports the next step                                                          |
| Another install or test hearing a module change | The notification carries the schema name; listeners ignore other schemas                                                                                           | `system`: set notifies aicommerce_modules only on commit                                       |
| A half-applied module change                    | NOTIFY is delivered on commit only; a failed rebuild keeps the running app                                                                                         | `server`: a reload that fails keeps the running app                                            |
| Switching off a module others need              | `module.disable` refuses and names the dependents; required modules cannot be switched off; destructive, so it needs confirmation                                  | `system`: disabling a needed module names its dependents; a required module cannot be disabled |
| Data loss when switching off                    | Disabling keeps the tables and rows                                                                                                                                | `server`: off and on keeps the notes                                                           |
| Install scripts of an extension                 | `pnpm add --ignore-scripts`                                                                                                                                        | `cli`: install scripts never run                                                               |
| An extension that does more than it says        | The declaration review shows its public actions, secrets, jobs, wraps, service replacements and migrations; it is added switched off                               | `cli`: add prints the declarations of a module                                                 |
| A rejected or failed add leaving traces         | `package.json`, the lockfile and the config are written back byte for byte                                                                                         | `cli`: a rejected add changes nothing                                                          |
| Restoring the wrong file                        | `pg_restore --list` must read it; asks before replacing; one transaction                                                                                           | `cli`: restore refuses a file that is not a backup; restore without --yes asks and stops on no |
| Database passwords in the process list          | The CLI passes them in `PGPASSWORD`, never on the command line                                                                                                     | `cli` `io.ts`: `pgTool` (reviewed)                                                             |
| Weak or shared secrets in new shops             | `create-aicommerce` generates every key and password per shop; `.env` is mode 0600                                                                                 | `create`: create writes a project with fresh secrets; .env is not readable by others           |
| The database reachable from the network         | The generated compose file publishes no PostgreSQL port; the shop listens on 127.0.0.1                                                                             | `create` template (reviewed)                                                                   |
| Script injection on the setup page              | A nonce-based CSP: `script-src 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, no referrer; the page holds no text that is not from a catalog               | `apps/admin/proxy.ts` (reviewed); the e2e axe and setup tests load the page under it           |
| The token leaking through the address bar       | The page moves the token from the URL to the tab's `sessionStorage` (gone when the tab closes), out of the address bar and history; `Referrer-Policy: no-referrer` | `apps/admin/src/SetupFlow.tsx` (reviewed)                                                      |
| Root in the container                           | The image runs as the `node` user; the code is owned by root                                                                                                       | Image build in CI (reviewed)                                                                   |

## Residual risks

- **Importing an extension runs its code.** The declaration review imports the package's default
  export, so its top-level code runs with the CLI's rights, at review time. `--ignore-scripts`
  only stops install scripts. Only add packages you would run.
- **A structurally broken extension** passes the review's shape check, which looks only at the
  module name. Enabling it makes the reload fail, and the running app stays. A restart with it
  enabled fails to start, until it is disabled with `ai-commerce module disable`.
- **The terminal is the trust boundary for setup.** Anyone who can read the server's output
  before setup finishes can take the shop. Finish setup right after the first start.
- **Backups** hold personal data and need `AICOMMERCE_SECRET_KEY` to read secrets. Store them
  encrypted, away from the key. Backups are not encrypted by the CLI yet.
- **Module reloads** rebuild the app in every process. In-flight requests finish on the old app,
  so for a moment two processes can run different module sets.
- **Inline style attributes** are allowed on the admin pages (`style-src-attr 'unsafe-inline'`),
  because Radix renders one on the server. Scripts and `<style>` elements still need the nonce.
- **One rate-limit address behind the admin.** The admin's `/api` proxy passes the client's
  `X-Forwarded-For` unchanged, so the server does not trust it (`AICOMMERCE_TRUSTED_PROXIES=0`).
  Everyone who comes through the admin shares the 10-a-minute setup limit. That is fine for one
  owner setting up a shop; the limit has to become per client before the admin's sign-in page
  uses the same path.
- **Persian strings** have not been reviewed by a native speaker.
- **Not published yet:** the `@aicommerce` npm scope and the image registry. Until then, shops are
  built from source.
