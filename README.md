# AI Commerce

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

## Licence

MIT
