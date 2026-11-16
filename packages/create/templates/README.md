# My AI Commerce shop

Created with `npm create @aicommerce`.

## Start

```sh
docker compose up
```

The log prints a setup link once. Open it to create the owner account (with two-factor sign-in),
name the shop and choose its features. The link stops working when setup is finished.

## Files

- `compose.yaml`: the shop, a one-time migration step and PostgreSQL 17. The database is not
  published on any port.
- `.env`: the generated secrets and database passwords. It is readable only by you. Never commit
  it, and back it up: without `AICOMMERCE_SECRET_KEY` the stored secrets cannot be decrypted.
- `aicommerce.config.json`: the list of third-party modules. The stock image runs the first-party
  modules only; third-party ones need an image built with their packages.

## Going live

The shop listens on `127.0.0.1` only. Put a TLS reverse proxy (Caddy, nginx, Traefik) in front,
then set `AICOMMERCE_PUBLIC_URL` in `.env` to the https address and restart with
`docker compose up -d`.

## Stop

`docker compose down` stops the shop and keeps the data. `docker compose down -v` deletes it.
