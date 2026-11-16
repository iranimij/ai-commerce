# AI Commerce

[![CI](https://github.com/iranimij/ai-commerce/actions/workflows/ci.yml/badge.svg)](https://github.com/iranimij/ai-commerce/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An open-source, AI-native e-commerce platform. A modern TypeScript replacement for Magento,
Shopify and Shopware, for shops of any size.

> **Status: planning.** No product code yet. The design is in
> [docs/superpowers/specs](docs/superpowers/specs/2026-11-15-ai-commerce-design.md) and progress is
> tracked in [PROGRESS.md](PROGRESS.md).

## What it will be

- **Chat-first admin.** Ask "what are today's orders?" and get an answer with a page you can
  download as HTML, PDF or CSV. The AI acts with your permissions, asks before anything
  destructive, and everything is logged.
- **Edit on the page.** Log in as an admin and change titles, galleries and content directly on
  the storefront.
- **Any AI.** Gemini, Claude and OpenAI are a configuration change apart. External AI clients
  connect through an MCP endpoint.
- **As extensible as Magento, far simpler.** Modules, themes and language packs are npm packages.
  Declare an action once and it appears in the API, the chat, MCP and the admin.
- **Any size.** Pick the features you need in the web installer. A tiny shop and a very large
  one run the same code.
- **Easy to move to.** Importers for Magento, Shopify and Shopware.

## Roadmap

| #   | Milestone                                             |
| --- | ----------------------------------------------------- |
| M0  | Foundation: core, auth, CLI, design system, installer |
| M1  | Catalog, storefront, AI admin                         |
| M2  | Selling: checkout, payments, shipping, tax, orders    |
| M3  | Migration from Magento, Shopify, Shopware             |
| M4  | Content and page builder                              |
| M5  | Promotions and pricing                                |
| M6  | Channels and languages                                |
| M7  | Inventory                                             |
| M8  | More product types and engagement                     |
| M9  | Marketing and reports                                 |
| M10 | Integrations and operations                           |
| M11 | Adobe Commerce parity (B2B and more)                  |
| M12 | Benchmarks, audits, version 1.0                       |

## Documentation

- [Guides](docs/guides/README.md): one page per contract, with examples from `modules/sample`.
- Threat models: [M0b](docs/security/threat-model-m0b.md) (data, auth, server) and
  [M0c](docs/security/threat-model-m0c.md) (install, setup, CLI, module switching).
- [Decisions log](docs/decisions/log.md).

## Install

Not on npm yet: the `@aicommerce` scope and the image are published at 1.0. To try it now, with
only Docker and git:

```sh
git clone https://github.com/iranimij/ai-commerce && cd ai-commerce
./dev pnpm install && ./dev pnpm build
docker compose up -d server admin
docker compose logs server   # open the setup link it prints (http://localhost:3001/setup?token=…)
```

Once published, a shop will be one command: `npm create @aicommerce my-shop`. See
[Installing a shop](docs/guides/installing.md).

## Development

You need Docker and git. Nothing else is installed on your machine.

```sh
./dev pnpm install
./dev pnpm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and
[SECURITY.md](SECURITY.md) for reporting security problems.

## Licence

MIT
