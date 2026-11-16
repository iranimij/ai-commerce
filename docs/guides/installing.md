# Installing a shop

One command makes a shop folder; Docker runs it; a setup page in the browser finishes it.

```sh
npm create @aicommerce my-shop -- --port 3000
cd my-shop
docker compose up
```

`create-aicommerce` ([`packages/create`](../../packages/create/src/index.ts)) writes:

- `compose.yaml`: PostgreSQL 17 with no published port, a one-time `migrate` step, and `shop`;
- `.env`: fresh secrets and passwords for this shop only, readable only by you (mode 0600);
- `aicommerce.config.json` and a README.

The `@aicommerce` npm scope and the image registry are not published yet. Until then, build the
image from this repository and point the shop at it:

```sh
docker build -f docker/Dockerfile -t ai-commerce:local .
node packages/create/dist/index.js ~/my-shop --port 3000   # after ./dev pnpm build
cd ~/my-shop && AICOMMERCE_IMAGE=ai-commerce:local docker compose up
```

## What runs

The image ([`docker/Dockerfile`](../../docker/Dockerfile)) runs as the `node` user. A small
supervisor ([`apps/server/src/supervisor.ts`](../../apps/server/src/supervisor.ts)) starts:

- the admin (Next.js) on `PORT`, which passes `/api`, `/healthz` and `/readyz` to the server;
- the server on `PORT + 1`, inside the container only;
- the job worker.

If one stops, the supervisor stops the others and exits, and Docker restarts the container.
`AICOMMERCE_ROLE=worker` runs only the job worker, for scaling.

## Setup

On every start until setup is finished, the log prints a one-time link:

```
Finish setting up your shop. Open this link; it stops working once setup is finished:
  http://localhost:3000/setup?token=…
```

The setup page ([`apps/admin/src/SetupFlow.tsx`](../../apps/admin/src/SetupFlow.tsx)) walks
through these steps:

1. The database check.
2. The owner account.
3. Two-factor sign-in, with a QR code and backup codes.
4. The shop's name, country, currency and language, and an optional AI key, stored encrypted.
5. The features, with presets `minimal` and `full` or picked one by one; anything a feature needs
   is ticked, with the reason.
6. Import and sample data. These are placeholders until M3 and M1.

It is in English and Persian (right-to-left), in light and dark themes. A reload resumes at the
right step.

## Rules that bite

- **The terminal is the trust boundary.** Anyone who can read the log before setup is finished
  can take the shop. Finish setup right after the first start.
- **The token:**
  - only its SHA-256 hash is stored;
  - a new start prints a new token and drops the old one;
  - guessing is limited to 10 setup calls a minute per address, or per admin once signed in.
- **Setup cannot finish without the owner's 2FA.** It never creates a second owner. Once finished,
  every setup call is refused, even with the token.
- **Behind a TLS proxy,** set `AICOMMERCE_PUBLIC_URL` to the https address. Set
  `AICOMMERCE_TRUSTED_PROXIES=1` only if the proxy replaces the visitor's `X-Forwarded-For`.
- **Back up `.env`.** Without `AICOMMERCE_SECRET_KEY`, stored secrets such as the AI key cannot
  be read. The shop's README shows backup and restore with the `db` container's `pg_dump`.
- **The stock image runs first-party modules only.** Third-party modules need an image built with
  their packages; see [the CLI](cli.md).

See the [M0c threat model](../security/threat-model-m0c.md) for what each protection covers.
