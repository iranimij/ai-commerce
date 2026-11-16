# My AI Commerce shop

Created with `npm create @aicommerce`.

## Start

```sh
docker compose up
```

The log prints a setup link on every start until setup is finished. Open it to create the owner
account (with two-factor sign-in), name the shop and choose its features. A new start prints a new
link and the old one stops working; once setup is finished, no link is printed and the setup page
is locked.

Lost the link? Run `docker compose logs shop` and look for the line ending in `/setup?token=…`.

## Files

- `compose.yaml`: the shop, a one-time migration step and PostgreSQL 17. The database is not
  published on any port.
- `.env`: the generated secrets and database passwords. It is readable only by you. Never commit
  it, and back it up: without `AICOMMERCE_SECRET_KEY` the stored secrets cannot be decrypted.
- `aicommerce.config.json`: the list of third-party modules. The stock image runs the first-party
  modules only; third-party ones need an image built with their packages.

## Going live

The shop listens on `127.0.0.1` only. Put a TLS reverse proxy in front, then in `.env`:

1. Set `AICOMMERCE_PUBLIC_URL` to the https address.
2. Add `AICOMMERCE_TRUSTED_PROXIES=1`, so rate limits count each visitor, not the proxy. Only do
   this when the proxy replaces any `X-Forwarded-For` header the visitor sent: Caddy does by
   default; for nginx, use `proxy_set_header X-Forwarded-For $remote_addr;`.

Then restart with `docker compose up -d`.

## Backups

```sh
docker compose exec -T db pg_dump -U aicommerce -Fc aicommerce > shop.dump
```

The file holds personal data and password hashes: store it encrypted. Keep `.env` with it, but
not in the same place.

To restore into an empty database (this deletes the current data):

```sh
docker compose down -v
docker compose up -d db
docker compose exec -T db pg_restore -U aicommerce -d aicommerce --no-owner --no-privileges < shop.dump
docker compose up -d
```

The migration step gives the shop's database role its rights back on start.

## Stop

`docker compose down` stops the shop and keeps the data. `docker compose down -v` deletes it.
