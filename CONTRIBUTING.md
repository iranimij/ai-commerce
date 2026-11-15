# Contributing

Thank you for helping. AI Commerce is at an early stage, so the most useful contributions right
now are bug reports, questions that show where the docs are unclear, and small focused pull
requests.

## Setup

You need Docker and git. Nothing else is installed on your machine.

```sh
git clone https://github.com/iranimij/ai-commerce.git
cd ai-commerce
./dev pnpm install
./dev pnpm test
```

`./dev <command>` runs any command inside the app container, next to PostgreSQL and a mail
catcher.

## Checks

| Command                       | What it does                              |
| ----------------------------- | ----------------------------------------- |
| `./dev pnpm lint`             | ESLint                                    |
| `./dev pnpm format`           | Format with Prettier                      |
| `./dev pnpm typecheck`        | TypeScript, strict                        |
| `./dev pnpm test`             | Unit tests                                |
| `./dev pnpm test:integration` | Integration tests against real PostgreSQL |
| `./dev pnpm build`            | Build every package                       |

CI runs all of them on every pull request.

## Tests

Every change comes with tests, written first:

- **Unit tests** for logic.
- **Integration tests** for anything that touches the database. Every action is tested for
  success, for a caller without permission, and for invalid input.
- **End-to-end tests** for anything a person sees or clicks.

## Pull requests

- One change per pull request.
- The title follows [Conventional Commits](https://www.conventionalcommits.org), for example
  `feat(core): add pipeline tracing`. Pull requests are squashed, so the title becomes the commit.
- Add a changeset (`./dev pnpm changeset`) when a published package changes.
- `main` is protected. A pull request is merged when CI is green.

## Design rules

Read the [design](docs/superpowers/specs/2026-11-15-ai-commerce-design.md) before a larger
change. The rules that most often matter:

- Everything that reads or changes shop data is an action with a permission and a risk level.
- Core modules get no private access. If core needs something a third-party module could not do,
  the public contract is fixed instead.
- A disabled module adds nothing: no route, menu, setting, query or storefront code.
- Every field has a privacy class. A field without one is treated as personal.

## Security

Never report a security problem in a public issue. See [SECURITY.md](SECURITY.md).
