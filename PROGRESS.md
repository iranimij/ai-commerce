# Progress

Read this first, then the Notion page "AI Commerce" (Start here section).

## Current state (2026-11-15)

- Planning is finished and approved by Iman.
- Design: `docs/superpowers/specs/2026-11-15-ai-commerce-design.md`.
- No product code yet.

## Next

M0 Foundation:

1. Write the M0 implementation plan in `docs/superpowers/plans/`.
2. Docker Compose environment (Node, PostgreSQL, mail catcher, Playwright). Nothing on the host.
3. Monorepo tooling, CI, GitHub repository setup, branch protection.
4. `core` contracts, database, auth, server, CLI, design system, installer, sample module.

## Standing rules

- Docker only. Use Iman's Chrome for manual QA.
- One pull request per section; merge it without asking once CI is green; never merge red.
- No Claude or Anthropic attribution in commits or pull requests.
- Unit, integration and end-to-end tests for everything; manual QA gate per milestone.
- Update Notion (build log, roadmap, decisions, parity map) and this file at the end of every
  session.
- English everywhere.

## Open items

- Register the `@aicommerce` npm scope (start of M0).
- Gemini API key (M1): create in the browser, store in a git-ignored `.env`.
- Shopify development store for M3 testing: Iman provides.
- Visual identity: three proposals in M0 for Iman to choose from.
- Model track (X1 to X3): own models on Hugging Face; needs a Hugging Face organisation and a
  GPU budget from Iman when X1 starts (after M2).
